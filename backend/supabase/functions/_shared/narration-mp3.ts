/**
 * MPEG audio frame arithmetic, so a narration assembled from several provider
 * requests can be proven playable rather than assumed playable.
 *
 * ## Why this file exists
 *
 * MiniMax `speech-02-hd` refuses a request over ~10,000 characters, and the
 * median live chapter is 9,112 characters with a p90 of 13,382 -- so a normal
 * full-length chapter has to be narrated as several provider requests and then
 * joined into one file. "Just concatenate the MP3s" is the folklore answer and
 * it is *usually* right, but "usually" is not a thing to ship a reader's Listen
 * button on. What actually makes it right is narrow:
 *
 * 1. An MP3 file is not only frames. Every file MiniMax returns begins with an
 *    **ID3v2 tag** and then a **Xing/Info header frame** -- measured on three
 *    real production files, all three exactly 1,140 bytes of ID3v2 plus one
 *    576-byte Xing frame before the first audio frame. Naively concatenating
 *    two files therefore drops a metadata blob and a silent header frame into
 *    the middle of the stream. Decoders vary in how they cope; some resync,
 *    some emit a click, some report a nonsense duration because they trusted
 *    the *first* Xing frame's frame count and the file is now much longer than
 *    it claims. All three are defects a reader can hear or see.
 * 2. Frames may only be joined if they describe the same audio. Two streams at
 *    different sample rates or channel counts produce a file that changes
 *    format halfway through, which is legal MPEG and wrong for us.
 *
 * So this module strips each part down to **bare audio frames**, checks every
 * part describes the same audio, and returns the joined frames with a frame
 * count and a duration derived from the frames themselves. The caller compares
 * that count against the sum of the parts' counts: if a single frame was lost
 * or invented in the join, the number says so, and narration fails loudly
 * instead of shipping a truncated chapter.
 *
 * ## A correct header is written back, because the reader is on a phone
 *
 * The stale-header failure above is not hypothetical and it is not cosmetic.
 * A mobile player reads duration and builds its seek map from the first
 * Xing/Info frame it finds. Keep part 0's -- which is what plain byte
 * concatenation does -- and a 12-minute chapter reports itself as 4 minutes:
 * it plays past the end of what it claims, the scrubber is wrong for the whole
 * chapter, and skipping back 20 seconds lands somewhere arbitrary. That is a
 * worse listening experience than the failure this change is fixing, and it
 * would be cached permanently and shared by every reader.
 *
 * So every part's header is stripped and **one correct `Info` frame is written
 * for the joined stream**, declaring the true frame count and the true byte
 * count. This is exactly the shape MiniMax's own files carry -- measured: an
 * `Info` tag at offset 21 of the first frame (MPEG1, mono), flags `0x0f`,
 * `frames` = the audio frames *excluding* the header frame, `bytes` = the
 * whole stream *including* it -- so a stitched chapter and a single-request
 * chapter present themselves to a player identically.
 *
 * A bare CBR frame stream with no header at all would also have been legal, and
 * a player that falls back to constant-bitrate seeking would handle it. Not
 * every player does, and "probably seekable on this phone" is not a property
 * worth relying on when the correct header is fifty lines and testable.
 *
 * The true duration is also handed to `chapter_audio.duration_seconds`, which
 * is the first time that column has ever been populated for a RunPod
 * narration: the provider does not return one.
 *
 * ## Verification
 *
 * `narration-mp3.test.ts` pins the arithmetic against the three real
 * production files' measured numbers (see the constants in that file): this
 * parser's frame count times 1152 over 32000 reproduces macOS `afinfo`'s
 * "estimated duration" to the millisecond on all three, and its audio byte
 * count reproduces `afinfo`'s "audio bytes" exactly.
 */

/** MPEG version, as encoded in bits 20-19 of a frame header. */
type MpegVersion = "mpeg1" | "mpeg2" | "mpeg2.5";

/**
 * Bitrates in kbps by version group and bitrate index, Layer III only.
 *
 * Index 0 is "free format" and index 15 is invalid; both are represented as 0
 * and treated as an unparseable header, because a frame whose length cannot be
 * computed cannot be stepped over.
 */
const LAYER3_BITRATES: Record<"mpeg1" | "mpeg2", number[]> = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  // MPEG2 and MPEG2.5 share one table.
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

/** Sample rates in Hz by version and sample-rate index. Index 3 is reserved. */
const SAMPLE_RATES: Record<MpegVersion, number[]> = {
  mpeg1: [44100, 48000, 32000, 0],
  mpeg2: [22050, 24000, 16000, 0],
  "mpeg2.5": [11025, 12000, 8000, 0],
};

/**
 * Samples carried by one Layer III frame. MPEG2 and MPEG2.5 halve the granule
 * count, which is why a duration computed with MPEG1's 1152 against a MPEG2
 * stream comes out exactly twice as long.
 */
const LAYER3_SAMPLES_PER_FRAME: Record<MpegVersion, number> = {
  mpeg1: 1152,
  mpeg2: 576,
  "mpeg2.5": 576,
};

/** What one frame header says about the stream it belongs to. */
export interface Mp3FrameHeader {
  version: MpegVersion;
  bitrateKbps: number;
  sampleRateHz: number;
  channels: 1 | 2;
  /** Total bytes of this frame, header and padding included. */
  frameLength: number;
  samplesPerFrame: number;
}

/** A part reduced to the audio the decoder will actually play. */
export interface Mp3Audio {
  /** Frames only: ID3v2, ID3v1 and any Xing/Info/VBRI header frame removed. */
  bytes: Uint8Array;
  frames: number;
  sampleRateHz: number;
  channels: 1 | 2;
  /** Frames * samplesPerFrame / sampleRateHz, rounded to milliseconds. */
  durationSeconds: number;
}

/** Why a byte string could not be read as narration audio. */
export class Mp3ParseError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "Mp3ParseError";
  }
}

/**
 * Parse a frame header at `offset`, or return null if there is no valid Layer
 * III frame there.
 *
 * Deliberately strict. A "sync word" is only eleven set bits, so a random pair
 * of bytes hits one roughly once every 2 KB; every other field is therefore
 * validated as well, and the caller additionally requires that stepping by
 * `frameLength` lands on another valid header before it accepts the first one.
 */
export function readMp3FrameHeader(
  bytes: Uint8Array,
  offset: number,
): Mp3FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];

  // Sync: eleven set bits across the first byte and the top three of the next.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 0x01) return null; // reserved
  const version: MpegVersion = versionBits === 0x03
    ? "mpeg1"
    : versionBits === 0x02
    ? "mpeg2"
    : "mpeg2.5";

  // Layer III only. The narration provider emits Layer III and nothing else,
  // and supporting layers we never see would be untested code on a path whose
  // failure mode is a corrupted chapter.
  if (((b1 >> 1) & 0x03) !== 0x01) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const table = version === "mpeg1"
    ? LAYER3_BITRATES.mpeg1
    : LAYER3_BITRATES.mpeg2;
  const bitrateKbps = table[bitrateIndex];
  if (!bitrateKbps) return null; // free-format or invalid

  const sampleRateIndex = (b2 >> 2) & 0x03;
  const sampleRateHz = SAMPLE_RATES[version][sampleRateIndex];
  if (!sampleRateHz) return null; // reserved

  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;
  const channels: 1 | 2 = channelMode === 0x03 ? 1 : 2;

  // Layer III frame length. MPEG1 packs 1152 samples per frame, MPEG2/2.5 pack
  // 576, so the coefficient halves with the sample count.
  const coefficient = version === "mpeg1" ? 144 : 72;
  const frameLength =
    Math.floor((coefficient * bitrateKbps * 1000) / sampleRateHz) + padding;
  if (frameLength <= 4) return null;

  return {
    version,
    bitrateKbps,
    sampleRateHz,
    channels,
    frameLength,
    samplesPerFrame: LAYER3_SAMPLES_PER_FRAME[version],
  };
}

/**
 * Byte length of the ID3v2 tag at the start of `bytes`, or 0 if there is none.
 *
 * The size field is "syncsafe": seven bits per byte, the high bit always clear,
 * so the tag length can never itself contain a false frame sync. Reading it as
 * a plain big-endian integer -- the obvious mistake -- overshoots on any tag
 * larger than 128 bytes, and every file this provider returns has a 1,140-byte
 * tag.
 */
export function id3v2Length(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  const flags = bytes[5];
  const size = ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  // Bit 4 of the flags byte is "a footer is present", and the footer is a
  // further 10 bytes that the size field does not cover.
  const footer = (flags & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Whether the frame beginning at `offset` is a Xing / Info / VBRI header rather
 * than audio.
 *
 * A Xing frame is a perfectly ordinary, perfectly silent frame carrying a tag
 * in its data area, so it decodes to a fraction of a second of nothing. One at
 * the head of the file is harmless and expected; one in the *middle*, which is
 * what naive concatenation produces, is an audible gap plus a duration every
 * seeking decoder will get wrong. Both are removed, because a joined file has
 * no use for either.
 *
 * The tag's offset within the frame depends on version and channel mode, so
 * rather than encode four cases this scans the frame's first 64 bytes for the
 * marker -- the tag always sits inside that window for every legal combination,
 * and a false positive would need those four ASCII bytes to appear in encoded
 * audio at the very start of a frame.
 */
export function isMp3HeaderFrame(
  bytes: Uint8Array,
  offset: number,
  frameLength: number,
): boolean {
  const end = Math.min(offset + Math.min(frameLength, 64), bytes.length);
  for (let i = offset + 4; i + 4 <= end; i += 1) {
    const marker = String.fromCharCode(
      bytes[i],
      bytes[i + 1],
      bytes[i + 2],
      bytes[i + 3],
    );
    if (marker === "Xing" || marker === "Info" || marker === "VBRI") {
      return true;
    }
  }
  return false;
}

/**
 * Find the first byte at or after `from` that begins a real frame.
 *
 * "Real" means: a valid header, AND another valid header exactly one frame
 * later (or the stream ends there). The second condition is what distinguishes
 * an actual frame boundary from the roughly-one-in-2-KB coincidence of eleven
 * set bits inside encoded audio or inside a cover image embedded in an ID3 tag.
 */
function findFrameStart(bytes: Uint8Array, from: number): number {
  for (let offset = from; offset + 4 <= bytes.length; offset += 1) {
    const header = readMp3FrameHeader(bytes, offset);
    if (!header) continue;
    const next = offset + header.frameLength;
    if (next + 4 > bytes.length) return offset; // last frame, possibly truncated
    if (readMp3FrameHeader(bytes, next)) return offset;
  }
  return -1;
}

/**
 * Reduce one provider response to bare audio frames.
 *
 * Throws `Mp3ParseError` rather than returning something plausible: a part
 * this cannot read is a part that must not be silently dropped from the middle
 * of a chapter, because the reader would hear a story that skips a scene and
 * nothing anywhere would have recorded that it did.
 */
export function readMp3Audio(bytes: Uint8Array): Mp3Audio {
  if (bytes.length === 0) throw new Mp3ParseError("mp3_empty");

  const start = findFrameStart(bytes, id3v2Length(bytes));
  if (start < 0) throw new Mp3ParseError("mp3_no_frames");

  const first = readMp3FrameHeader(bytes, start)!;
  let cursor = start;
  // A leading Xing/Info/VBRI frame is metadata, not audio: step over it before
  // the audio range begins.
  if (isMp3HeaderFrame(bytes, cursor, first.frameLength)) {
    cursor += first.frameLength;
  }
  const audioStart = cursor;

  let frames = 0;
  let sampleRateHz = 0;
  let channels: 1 | 2 = 1;
  let samplesPerFrame = 0;
  let audioEnd = cursor;

  while (cursor + 4 <= bytes.length) {
    const header = readMp3FrameHeader(bytes, cursor);
    if (!header) break;
    // A frame whose declared length runs off the end of the buffer is a
    // truncated download, not audio. Stop before it rather than counting it:
    // half a frame is not playable and must not be joined to the next part.
    if (cursor + header.frameLength > bytes.length) break;

    if (frames === 0) {
      sampleRateHz = header.sampleRateHz;
      channels = header.channels;
      samplesPerFrame = header.samplesPerFrame;
    } else if (
      header.sampleRateHz !== sampleRateHz || header.channels !== channels
    ) {
      // A format change inside one provider response. Not something MiniMax
      // does, and not something that can be joined to anything, so it is a
      // parse failure rather than a best effort.
      throw new Mp3ParseError("mp3_format_changed_midstream");
    }

    // A header frame anywhere other than the front is either a second file
    // already concatenated in, or a corrupt stream. Either way it is not
    // audio and must not be counted as duration.
    if (!isMp3HeaderFrame(bytes, cursor, header.frameLength)) {
      frames += 1;
    }
    cursor += header.frameLength;
    audioEnd = cursor;
  }

  if (frames === 0) throw new Mp3ParseError("mp3_no_frames");

  return {
    bytes: bytes.subarray(audioStart, audioEnd),
    frames,
    sampleRateHz,
    channels,
    durationSeconds: frameDuration(frames, samplesPerFrame, sampleRateHz),
  };
}

/** Frames to seconds, rounded to whole milliseconds. */
function frameDuration(
  frames: number,
  samplesPerFrame: number,
  sampleRateHz: number,
): number {
  return Math.round((frames * samplesPerFrame * 1000) / sampleRateHz) / 1000;
}

/**
 * Where the Xing/Info tag sits inside the header frame, counted from the start
 * of the frame.
 *
 * The gap is the frame's side-information block, whose size depends on the
 * MPEG version and the channel count -- so a tag written at a fixed offset is
 * invisible to every player for three of the four combinations. 21 for MPEG1
 * mono is the one measured directly against the provider's own files.
 */
function xingTagOffset(header: Mp3FrameHeader): number {
  if (header.version === "mpeg1") return header.channels === 1 ? 21 : 36;
  return header.channels === 1 ? 13 : 21;
}

/**
 * Build the `Info` header frame for a joined CBR stream.
 *
 * The frame's own four header bytes are copied from the audio rather than
 * synthesised, which is the only way to be certain the header frame has the
 * same geometry as the stream it introduces: same version, layer, bitrate,
 * sample rate, channel mode, and therefore the same length. A header frame
 * that decoded as a different format would be a click at the start of every
 * chapter.
 *
 * `Info` rather than `Xing` is the conventional marker for constant bitrate,
 * and it is what MiniMax itself writes. The TOC is a linear ramp because in a
 * CBR stream position really is proportional to time; including it (rather
 * than clearing the TOC flag) means a player that insists on a seek table gets
 * an exactly correct one instead of falling back to guesswork.
 */
function buildInfoFrame(
  audio: Uint8Array,
  header: Mp3FrameHeader,
  frames: number,
): Uint8Array {
  const frame = new Uint8Array(header.frameLength);
  frame.set(audio.subarray(0, 4), 0);

  const at = xingTagOffset(header);
  const view = new DataView(frame.buffer);
  frame[at] = 0x49; // I
  frame[at + 1] = 0x6e; // n
  frame[at + 2] = 0x66; // f
  frame[at + 3] = 0x6f; // o
  // Flags: frames | bytes | TOC. Quality is deliberately not claimed -- it is
  // an encoder's self-report and we are not the encoder.
  view.setUint32(at + 4, 0x0000_0007);
  // Audio frames, NOT counting this one. Measured against a provider file:
  // its `frames` was 11,634 against 11,634 audio frames plus the header frame.
  view.setUint32(at + 8, frames);
  // Total stream bytes, counting this frame. Same file: 6,701,760, which is
  // its 6,701,184 audio bytes plus this frame's 576.
  view.setUint32(at + 12, audio.length + header.frameLength);
  // 100-entry linear TOC: entry i points at i% of the way through the stream,
  // scaled to 0-255, which for constant bitrate is exactly right.
  for (let i = 0; i < 100; i += 1) {
    frame[at + 16 + i] = Math.round((i * 255) / 100);
  }
  return frame;
}

export interface Mp3Concatenation {
  bytes: Uint8Array;
  frames: number;
  durationSeconds: number;
  sampleRateHz: number;
  channels: 1 | 2;
}

/**
 * Join provider responses into one playable narration, and prove it.
 *
 * The proof is the frame count. Every part is parsed on its own, the parts are
 * joined, and **the joined stream is parsed again from its own bytes**: if the
 * re-read count does not equal the sum of the parts' counts, the join lost or
 * invented audio and this throws. That is a real check and not a tautology,
 * because the second parse is done by the same scanner a decoder's resync
 * behaviour approximates -- it walks the joined bytes frame by frame with no
 * knowledge of where the seams were, so a seam that does not land exactly on a
 * frame boundary shows up as a shortfall.
 */
export function concatenateMp3(parts: Uint8Array[]): Mp3Concatenation {
  if (parts.length === 0) throw new Mp3ParseError("mp3_no_parts");

  const decoded = parts.map(readMp3Audio);
  const first = decoded[0];
  for (const part of decoded.slice(1)) {
    if (
      part.sampleRateHz !== first.sampleRateHz ||
      part.channels !== first.channels
    ) {
      // Parts that do not describe the same audio cannot become one file. In
      // practice every part comes from one provider, one model and one set of
      // parameters, so this is a guard against a provider changing under us
      // mid-chapter rather than an expected branch.
      throw new Mp3ParseError("mp3_parts_format_mismatch");
    }
  }

  const total = decoded.reduce((sum, part) => sum + part.bytes.length, 0);
  const joined = new Uint8Array(total);
  let written = 0;
  for (const part of decoded) {
    joined.set(part.bytes, written);
    written += part.bytes.length;
  }

  const expectedFrames = decoded.reduce((sum, part) => sum + part.frames, 0);
  const verified = readMp3Audio(joined);
  if (verified.frames !== expectedFrames) {
    throw new Mp3ParseError(
      "mp3_concat_frame_mismatch",
      `joined stream has ${verified.frames} frames against ${expectedFrames} expected`,
    );
  }

  // One correct `Info` header for the whole stream, so a phone's player
  // reports the whole chapter's length and can scrub across every seam. See
  // the note at the top of this file for why keeping part 0's header instead
  // would produce a file that plays and cannot be seeked.
  const header = readMp3FrameHeader(joined, 0);
  if (!header) throw new Mp3ParseError("mp3_no_frames");
  const infoFrame = buildInfoFrame(joined, header, verified.frames);

  const withHeader = new Uint8Array(infoFrame.length + joined.length);
  withHeader.set(infoFrame, 0);
  withHeader.set(joined, infoFrame.length);

  // Read the finished file back exactly as a decoder would, header and all.
  // The header frame must be recognised as metadata and skipped, leaving the
  // same frame count -- so this catches both a header written at the wrong
  // offset (it would be counted as audio, and the duration would be one frame
  // long) and any damage the copy did.
  const final = readMp3Audio(withHeader);
  if (final.frames !== expectedFrames) {
    throw new Mp3ParseError(
      "mp3_concat_frame_mismatch",
      `finished file has ${final.frames} frames against ${expectedFrames} expected`,
    );
  }

  return {
    bytes: withHeader,
    frames: final.frames,
    durationSeconds: final.durationSeconds,
    sampleRateHz: final.sampleRateHz,
    channels: final.channels,
  };
}
