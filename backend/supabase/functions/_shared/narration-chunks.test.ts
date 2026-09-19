// The splitter's guarantees, and the arithmetic behind the two ceilings.
//
// The measurement these tests exist to defend: MiniMax `speech-02-hd` accepted
// 9,849 characters and refused 10,105 on production RunPod, 2026-09-19. Before
// that was known, `MAX_NARRATION_CHARS` was 40,000 and 133 of the 354 live
// published chapters -- 37.6%, spanning 41 of 80 stories -- were accepted,
// billed and then failed in the reader's hands with no retry that could ever
// succeed.
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_NARRATION_CHARS,
  NARRATION_CHUNK_CHARS,
  NARRATION_MAX_CHUNKS,
  NARRATION_PROVIDER_CHAR_LIMIT,
  narrationChunkCount,
  splitNarrationText,
} from "./narration-chunks.ts";

/** Prose shaped like a generated chapter: paragraphs of several sentences. */
function chapter(chars: number, sentencesPerParagraph = 6): string {
  const sentence =
    "The lamp guttered and she counted the coins again, slower this time. ";
  const paragraph = sentence.repeat(sentencesPerParagraph) + "\n\n";
  let text = "";
  while (text.length < chars) text += paragraph;
  return text.slice(0, chars);
}

Deno.test("every chunk stays under the limit the provider actually refused at", () => {
  // 9,849 succeeded and 10,105 failed, so the chunk size has to sit under the
  // lower of those with room to spare -- this is the assertion that would have
  // caught the original bug.
  assert(NARRATION_CHUNK_CHARS < NARRATION_PROVIDER_CHAR_LIMIT);
  assert(NARRATION_PROVIDER_CHAR_LIMIT - NARRATION_CHUNK_CHARS >= 500);

  for (const length of [9_112, 10_105, 11_615, 13_382, 17_755, 26_999]) {
    const chunks = splitNarrationText(chapter(length));
    assert(chunks.length > 0, `${length} produced no chunks`);
    for (const chunk of chunks) {
      assert(
        chunk.length <= NARRATION_CHUNK_CHARS,
        `${length}: a chunk was ${chunk.length} characters`,
      );
      assert(
        chunk.length < NARRATION_PROVIDER_CHAR_LIMIT,
        `${length}: a chunk would be refused by the provider`,
      );
    }
  }
});

Deno.test("the chapter is narrated whole: nothing dropped, nothing repeated", () => {
  for (const length of [1, 500, 9_000, 9_001, 13_382, 17_755, 27_000]) {
    const text = chapter(length);
    assertEquals(splitNarrationText(text).join(""), text, `length ${length}`);
  }
});

Deno.test("no chunk is empty or whitespace-only", () => {
  // A whitespace-only request is a provider call that bills for silence, and
  // on a strict provider it is an error rather than a short file.
  for (
    const text of [
      chapter(20_000),
      "\n\n\n" + chapter(19_000),
      chapter(9_500) + "\n\n\n\n",
    ]
  ) {
    for (const chunk of splitNarrationText(text)) {
      assert(chunk.trim().length > 0);
    }
  }
});

Deno.test("a chapter the provider would take whole is left as one request", () => {
  // The change must not multiply provider calls for the 62% of the library
  // that already worked.
  const text = chapter(9_000);
  assertEquals(splitNarrationText(text).length, 1);
  assertEquals(splitNarrationText(chapter(1_200)).length, 1);
  assertEquals(narrationChunkCount(chapter(9_112)), 2);
});

Deno.test("cuts land on paragraph breaks when the prose offers them", () => {
  const chunks = splitNarrationText(chapter(17_000));
  assertEquals(chunks.length, 2);
  // The seam is inaudible only if it falls between paragraphs: the first chunk
  // ends on the blank line, so the second starts on a fresh paragraph.
  assert(/\n\s*\n\s*$/.test(chunks[0]), "first chunk did not end on a break");
  assert(/^\S/.test(chunks[1]), "second chunk began mid-whitespace");
});

Deno.test("a single huge paragraph is cut between sentences, never inside one", () => {
  const sentence = "She waited for the tide to turn and it did not turn. ";
  const oneParagraph = sentence.repeat(400); // ~21,000 characters, no breaks
  const chunks = splitNarrationText(oneParagraph);
  assert(chunks.length >= 3);
  for (const chunk of chunks.slice(0, -1)) {
    // Every seam but the last falls after a full stop.
    assert(
      /[.!?]\s*$/.test(chunk),
      `a chunk ended mid-sentence: ...${chunk.slice(-40)}`,
    );
  }
  assertEquals(chunks.join(""), oneParagraph);
});

Deno.test("a sentence longer than a whole chunk is cut between words", () => {
  const words = "and ".repeat(5_000); // one 20,000-character "sentence"
  const chunks = splitNarrationText(words);
  assert(chunks.length >= 3);
  for (const chunk of chunks) {
    assert(chunk.length <= NARRATION_CHUNK_CHARS);
    // A cut inside a word would leave a fragment the narrator pronounces as
    // nonsense; every chunk here begins and ends on a whole word.
    assert(/^\S/.test(chunk));
  }
  assertEquals(chunks.join(""), words);
});

Deno.test("a single unbroken run longer than a chunk is hard-sliced rather than looping", () => {
  const blob = "x".repeat(25_000);
  const chunks = splitNarrationText(blob);
  assertEquals(chunks.length, Math.ceil(25_000 / NARRATION_CHUNK_CHARS));
  assertEquals(chunks.join(""), blob);
});

Deno.test("sentence cuts do not fall after an initial", () => {
  // "J. R. R." is the abbreviation shape that actually recurs in fiction; a
  // seam inside it would have the narrator pause mid-name.
  const text = "J. R. R. Tolkien wrote it. " +
    "Then she read it again. ".repeat(600);
  for (const chunk of splitNarrationText(text)) {
    assert(
      !/\b[A-Z]\.\s*$/.test(chunk),
      `chunk ended on an initial: ${chunk.slice(-20)}`,
    );
  }
});

Deno.test("empty and whitespace-only text produce no requests at all", () => {
  assertEquals(splitNarrationText(""), []);
  assertEquals(splitNarrationText("   \n\n  \t "), []);
  assertEquals(narrationChunkCount(""), 0);
});

Deno.test("the two ceilings are reconciled, and the reconciliation is the cap", () => {
  // `MAX_NARRATION_CHARS` is not a free number: it is as many chunks as the
  // pipeline is willing to run, each as large as the provider will take, less
  // the packing slack that paragraph-boundary cuts always leave. The old
  // 40,000 was reconciled against the 50 MB response ceiling alone and knew
  // nothing of the provider's 10,000, which is the whole bug.
  assert(MAX_NARRATION_CHARS <= NARRATION_MAX_CHUNKS * NARRATION_CHUNK_CHARS);

  // The cap must not admit a chapter the pipeline would then refuse to finish,
  // at any realistic paragraph length. 20 sentences is ~1,380 characters,
  // which is longer than any paragraph the generator writes.
  for (const sentencesPerParagraph of [2, 4, 6, 10, 20]) {
    const text = chapter(MAX_NARRATION_CHARS, sentencesPerParagraph);
    assert(
      splitNarrationText(text).length <= NARRATION_MAX_CHUNKS,
      `paragraphs of ${sentencesPerParagraph} sentences needed ${
        splitNarrationText(text).length
      } chunks`,
    );
  }

  // ...and it must be no higher than the old one, so nothing that could be
  // narrated before this change is refused after it.
  assert(MAX_NARRATION_CHARS <= 40_000);

  // A 50 MB response ceiling at the measured 1,124 bytes per character.
  const BYTES_PER_CHAR = 1_124;
  assert(NARRATION_CHUNK_CHARS * BYTES_PER_CHAR < 50 * 1024 * 1024);
  assert(MAX_NARRATION_CHARS * BYTES_PER_CHAR < 50 * 1024 * 1024);
});

Deno.test("maxChars is validated rather than looping forever", () => {
  assertThrows(() => splitNarrationText("abc", 0));
});
