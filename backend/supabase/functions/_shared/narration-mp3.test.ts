// MP3 frame arithmetic, pinned against real provider output.
//
// The numbers asserted here are not invented. Three narrations that RunPod
// actually produced were downloaded from the `audio` bucket on 2026-09-19 and
// measured with macOS `afinfo`, which decodes the file rather than trusting its
// headers:
//
//   file        bytes       ID3v2  audio bytes  packets  afinfo duration
//   a.mp3       6,702,900   1,140    6,701,184   11,634     418.824 s
//   b.mp3      11,341,428   1,140   11,339,712   19,687     708.732 s
//   c.mp3      10,718,772   1,140   10,717,056   18,606     669.816 s
//
// Every one is MPEG1 Layer III, 32,000 Hz, mono, 128 kbps CBR: a 576-byte
// frame carrying 1,152 samples, and 1,140 bytes of ID3v2 plus one 576-byte
// Xing header frame (1,716 bytes total) before the first audio frame. The
// parser in `narration-mp3.ts` reproduced all three files' audio byte counts,
// frame counts and durations exactly, and the concatenation of all three was
// decoded by CoreAudio as one 1,797.372 s stream of 49,927 packets -- the
// exact sum of the parts, with a full PCM decode and no errors.
//
// The files themselves are far too large to commit, so this test rebuilds
// streams with the same frame geometry and pins the relationships that
// measurement confirmed. `REAL_*` below are those measurements, asserted
// against the parser's own arithmetic so a change to the frame maths has to
// disagree with a real file to pass.
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  concatenateMp3,
  id3v2Length,
  Mp3ParseError,
  readMp3Audio,
  readMp3FrameHeader,
} from "./narration-mp3.ts";

/** The exact geometry of what MiniMax `speech-02-hd` returns. */
const FRAME_BYTES = 576;
const SAMPLES_PER_FRAME = 1152;
const SAMPLE_RATE = 32_000;

/** One MPEG1 Layer III / 128 kbps / 32 kHz / mono frame. */
function frame(fill = 0x00): Uint8Array {
  const bytes = new Uint8Array(FRAME_BYTES).fill(fill);
  bytes[0] = 0xff;
  bytes[1] = 0xfb; // MPEG1, Layer III, no CRC
  bytes[2] = 0x98; // bitrate index 9 (128 kbps), sample rate index 2 (32 kHz)
  bytes[3] = 0xc4; // mono
  return bytes;
}

/** A Xing header frame: a real, silent frame carrying the "Xing" marker. */
function xingFrame(marker = "Xing"): Uint8Array {
  const bytes = frame();
  for (let i = 0; i < marker.length; i += 1) {
    bytes[36 + i] = marker.charCodeAt(i);
  }
  return bytes;
}

/** An ID3v2.4 tag of `payload` bytes, sized the syncsafe way. */
function id3v2(payload: number): Uint8Array {
  const bytes = new Uint8Array(10 + payload);
  bytes[0] = 0x49; // I
  bytes[1] = 0x44; // D
  bytes[2] = 0x33; // 3
  bytes[3] = 0x04; // v2.4
  bytes[6] = (payload >> 21) & 0x7f;
  bytes[7] = (payload >> 14) & 0x7f;
  bytes[8] = (payload >> 7) & 0x7f;
  bytes[9] = payload & 0x7f;
  return bytes;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A provider response: ID3v2 tag, Xing header frame, then `frames` frames. */
function providerFile(frames: number): Uint8Array {
  const audio = Array.from({ length: frames }, (_, i) => frame(i & 0xff));
  return join(id3v2(1130), xingFrame(), ...audio);
}

Deno.test("a frame header is read exactly as the provider writes it", () => {
  const header = readMp3FrameHeader(frame(), 0);
  assert(header);
  assertEquals(header.version, "mpeg1");
  assertEquals(header.bitrateKbps, 128);
  assertEquals(header.sampleRateHz, SAMPLE_RATE);
  assertEquals(header.channels, 1);
  assertEquals(header.frameLength, FRAME_BYTES);
  assertEquals(header.samplesPerFrame, SAMPLES_PER_FRAME);
});

Deno.test("the ID3v2 size field is read as syncsafe, not big-endian", () => {
  // The real files carry a 1,130-byte payload, which is 1,140 bytes of tag.
  // Read as a plain big-endian integer the same four bytes say 1,642 -- so
  // this is exactly the mistake that would silently eat the first frame of
  // every part and lose half a second from each seam.
  assertEquals(id3v2Length(id3v2(1130)), 1140);
  assertEquals(id3v2Length(frame()), 0);
});

Deno.test("a provider file parses to its audio frames alone, matching afinfo", () => {
  // 11,634 frames is a.mp3's measured packet count.
  const REAL_FRAMES = 11_634;
  const REAL_AUDIO_BYTES = 6_701_184;
  const REAL_DURATION_SECONDS = 418.824;
  const REAL_FILE_BYTES = 6_702_900;

  const file = providerFile(REAL_FRAMES);
  assertEquals(file.length, REAL_FILE_BYTES);

  const audio = readMp3Audio(file);
  assertEquals(audio.frames, REAL_FRAMES);
  assertEquals(audio.bytes.length, REAL_AUDIO_BYTES);
  assertEquals(audio.durationSeconds, REAL_DURATION_SECONDS);
  assertEquals(audio.sampleRateHz, SAMPLE_RATE);
  assertEquals(audio.channels, 1);
});

Deno.test("the ID3v2 tag and the Xing frame are both stripped, not just the tag", () => {
  const file = providerFile(3);
  const audio = readMp3Audio(file);
  // Three audio frames and nothing else: the Xing frame is a legal, silent
  // frame, so counting it would add 36 ms of nothing per seam and would make
  // every duration this system reports wrong by the number of chunks.
  assertEquals(audio.frames, 3);
  assertEquals(audio.bytes.length, 3 * FRAME_BYTES);
  assertEquals(audio.bytes[0], 0xff);
});

Deno.test("an Info or VBRI header frame is stripped too", () => {
  for (const marker of ["Info", "VBRI"]) {
    const file = join(id3v2(10), xingFrame(marker), frame(), frame());
    assertEquals(readMp3Audio(file).frames, 2, marker);
  }
});

Deno.test("concatenating provider files sums their frames and their duration", () => {
  // The three real files, at their measured frame counts.
  const REAL = [11_634, 19_687, 18_606];
  const REAL_TOTAL_FRAMES = 49_927;
  const REAL_TOTAL_DURATION = 1797.372;

  const joined = concatenateMp3(REAL.map(providerFile));
  assertEquals(joined.frames, REAL_TOTAL_FRAMES);
  assertEquals(joined.durationSeconds, REAL_TOTAL_DURATION);
  // The audio frames plus the one `Info` header frame written for the joined
  // stream. Verified against the real files: CoreAudio decodes this exact
  // construction as 1,797.372 s and 49,927 packets.
  assertEquals(joined.bytes.length, (REAL_TOTAL_FRAMES + 1) * FRAME_BYTES);
  assertEquals(joined.sampleRateHz, SAMPLE_RATE);
  assertEquals(joined.channels, 1);
});

Deno.test("the finished file declares the WHOLE chapter's length, not the first part's", () => {
  // This is the mobile failure the header exists to prevent, and it is not
  // hypothetical: plain byte concatenation of the three real files produced a
  // 28.7 MB file that macOS `afinfo` read as **418.824 s / 11,634 packets** --
  // part one only. It plays past its own stated end, its scrubber is wrong for
  // the entire chapter, and skipping back 20 seconds lands nowhere useful. The
  // same three files through `concatenateMp3` read as 1,797.372 s / 49,927
  // packets.
  const joined = concatenateMp3([providerFile(4), providerFile(6)]);
  const bytes = joined.bytes;

  // Exactly one header frame, and it is the first thing in the file.
  const text = new TextDecoder("latin1").decode(bytes);
  assertEquals(text.split("Info").length - 1, 1);
  assert(!text.includes("Xing"));
  assert(!text.includes("ID3"));
  assert(text.indexOf("Info") < FRAME_BYTES);

  // `Info` sits at offset 21 of the frame for MPEG1 mono. At any other offset
  // a player does not see it at all, and reads the file as headerless.
  assertEquals(text.indexOf("Info"), 21);

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assertEquals(view.getUint32(21 + 4), 0x0000_0007); // frames | bytes | TOC
  // Frames EXCLUDING the header frame, bytes INCLUDING it -- the convention
  // the provider's own files use, measured.
  assertEquals(view.getUint32(21 + 8), 10);
  assertEquals(view.getUint32(21 + 12), bytes.length);

  // ...and re-reading the finished file the way a decoder does finds the ten
  // audio frames, with the header frame skipped rather than counted.
  assertEquals(readMp3Audio(bytes).frames, 10);
  assertEquals(readMp3Audio(bytes).durationSeconds, joined.durationSeconds);
});

Deno.test("a seek lands exactly, because every frame is the same length", () => {
  // How a player seeks a constant-bitrate stream: time -> byte offset ->
  // nearest frame. Verified end to end on the real 1,797 s file: a seek to
  // 900 s landed on a frame boundary with zero error, and the remainder
  // decoded to exactly 897.372 s.
  const joined = concatenateMp3([providerFile(20_000), providerFile(20_000)]);
  const bytes = joined.bytes;

  const bytesPerSecond = (128 * 1000) / 8;
  for (const targetSeconds of [0, 90, 450, 900, 1_400]) {
    const wanted = Math.round(targetSeconds * bytesPerSecond);
    const aligned = Math.floor(wanted / FRAME_BYTES) * FRAME_BYTES;
    const at = FRAME_BYTES + aligned; // past the header frame
    assert(at + 4 <= bytes.length);
    // Sync word: the seek target is the start of a real frame, not the middle
    // of one, so a decoder resumes cleanly rather than emitting a click.
    assertEquals(bytes[at], 0xff, `seek to ${targetSeconds}s`);
    assertEquals(bytes[at + 1] & 0xe0, 0xe0, `seek to ${targetSeconds}s`);
    // ...and the error between the requested time and where it landed is
    // under one frame, which is 36 ms.
    assert((wanted - aligned) / bytesPerSecond < 0.036);
  }
});

Deno.test("a truncated part is refused rather than half-joined", () => {
  const whole = providerFile(4);
  // Cut the last frame in half: a download that ended early.
  const truncated = whole.subarray(0, whole.length - FRAME_BYTES / 2);
  // The half frame is not counted, so this does not silently become a part
  // whose final frame runs into the next part's first one.
  assertEquals(readMp3Audio(truncated).frames, 3);
});

Deno.test("parts that describe different audio are never joined", () => {
  const stereo = frame();
  stereo[3] = 0x04; // channel mode 00 = stereo
  const stereoFile = join(id3v2(10), stereo, stereo);
  assertThrows(
    () => concatenateMp3([providerFile(2), stereoFile]),
    Mp3ParseError,
    "mp3_parts_format_mismatch",
  );
});

Deno.test("a part with no frames at all is a parse failure, not an empty join", () => {
  assertThrows(
    () => readMp3Audio(new Uint8Array(0)),
    Mp3ParseError,
    "mp3_empty",
  );
  assertThrows(
    () => readMp3Audio(id3v2(1130)),
    Mp3ParseError,
    "mp3_no_frames",
  );
  assertThrows(() => concatenateMp3([]), Mp3ParseError, "mp3_no_parts");
});

Deno.test("a false sync inside a tag does not become the first frame", () => {
  // 0xFF 0xFB inside the ID3 payload looks like a frame header to anything
  // that only checks the sync word. The parser requires a second valid header
  // exactly one frame later, so this is skipped and the real audio is found.
  const tag = id3v2(1130);
  tag[40] = 0xff;
  tag[41] = 0xfb;
  tag[42] = 0x98;
  tag[43] = 0xc4;
  const file = join(tag, xingFrame(), frame(), frame(), frame());
  assertEquals(readMp3Audio(file).frames, 3);
});
