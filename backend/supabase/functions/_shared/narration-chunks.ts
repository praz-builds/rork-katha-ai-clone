/**
 * How a chapter is cut up for a text-to-speech provider that will not take it
 * whole, and the two ceilings that decide how long a chapter may be at all.
 *
 * ## The measurement this file is built on
 *
 * Measured against production RunPod on 2026-09-19 (`backend/build-log.md`,
 * "Narration measured on a real Original"): MiniMax `speech-02-hd` **accepted
 * 9,849 characters and refused 10,105**. That is the provider's per-request
 * character cap and nothing in this codebase knew about it, because the
 * provider reports the refusal as an English sentence and `safeErrorCode`
 * correctly refuses to publish provider prose -- so every one of these landed
 * in `chapter_audio.error_code` as `unclassified_error` with the reason
 * discarded. Five production occurrences share one fingerprint, first seen
 * 2026-09-15.
 *
 * The consequence was not an edge case. The generator's own word bands top out
 * near 2,000 words, which is 11,000+ characters, so a normal full-length
 * chapter is over the provider's line **by design**: 133 of the 354 live
 * published chapters (37.6%), spanning 41 of the 80 stories, could never be
 * narrated. The reader saw a spinner and then "Try again", and no retry could
 * ever have succeeded. Median live chapter 9,112 characters, p90 13,382.
 */

/**
 * The provider's own per-request ceiling, as measured, not as documented.
 *
 * 9,849 succeeded and 10,105 failed, so the true cap is somewhere in that
 * 256-character band and 10,000 is the round number inside it. This constant
 * exists to be *never reached*: `NARRATION_CHUNK_CHARS` is what is actually
 * sent, and this is the line that number is kept behind.
 */
export const NARRATION_PROVIDER_CHAR_LIMIT = 10_000;

/**
 * The largest slice actually sent in one provider request.
 *
 * 849 characters of headroom under the smallest length ever observed to
 * succeed. The headroom is not arbitrary caution: the split points are
 * sentence and paragraph boundaries, so a chunk lands wherever the prose
 * allows rather than exactly on a target, and a single long paragraph can
 * overshoot a tight target by several hundred characters before the packer
 * gives up and starts a new chunk. It also absorbs any per-request overhead
 * the provider counts that we cannot see. Losing a few percent of chunk
 * efficiency costs a fraction of a provider call on a long chapter; losing the
 * headroom costs the whole chapter, for the reader, permanently.
 */
export const NARRATION_CHUNK_CHARS = 9_000;

/**
 * How many provider requests one chapter may be split into.
 *
 * **The reason this used to be three is no longer one of the reasons it is
 * three.** The old argument led with the reader's patience: chunks ran
 * *sequentially*, one per `audio-status` poll at a measured ~45 seconds each,
 * so three chunks was ~135 seconds and the constant was the thing keeping a
 * working narration inside `NARRATION_OVERDUE_MS` (180s) in
 * `expo/src/lib/listen-machine.ts`. Every chunk is now started in the same
 * `generate-audio` request (`NARRATION_MAX_CONCURRENT_CHUNKS` below), so
 * wall-clock time to the FIRST audio is one chunk -- ~45 seconds -- whether
 * the chapter is one chunk or three, and a fourth chunk would not move it.
 * Latency no longer constrains this number at all.
 *
 * What still does, and what the number is therefore derived from alone:
 *
 * **The Edge Function's memory.** Assembling the finished file holds the
 * earlier parts and the joined copy in the isolate at the same time. At the
 * measured 1,124 bytes per character, three chunks is ~30 MB of parts plus a
 * ~30 MB joined buffer: roughly 61 MB at peak, against a Supabase Edge
 * Function's ~150 MB. Four chunks would be ~81 MB at peak, which is still
 * under the limit but is close enough that a provider returning slightly
 * larger audio than measured would turn a working narration into an OOM --
 * and an OOM mid-assembly is the worst failure available here, because the
 * chapter has already been paid for chunk by chunk.
 *
 * So: **do not raise this because narration got faster.** The stitch is off
 * the critical path for the reader, who is already listening by the time it
 * runs, but it still happens in an isolate with a ceiling, and that ceiling
 * has not moved. Raising this number needs its own memory measurement, not
 * this comment.
 */
export const NARRATION_MAX_CHUNKS = 3;

/**
 * How many of a chapter's chunks may be at the provider at the same moment.
 *
 * **Today this is a documented no-op**, because it equals
 * `NARRATION_MAX_CHUNKS`: a chapter can never have more chunks than this, so
 * the bound never actually holds anything back. It exists so that the day
 * `NARRATION_MAX_CHUNKS` rises (see the memory argument above), starting
 * every chunk of every concurrent narration at once is a decision somebody
 * makes deliberately rather than one that happens by default -- RunPod's
 * public endpoint queues per account, and a burst from several readers at
 * once is how a fast narration becomes a slow one for everybody.
 *
 * The **projected** consequence of starting them together rather than one per
 * poll -- projected, because none of this is deployed and the only number
 * underneath it is a single production job on 2026-09-19 that took ~45s: a
 * 2-chunk chapter measured 101.6s to its first second of audio and should now
 * take roughly one chunk; a 3-chunk chapter measured ~135s and should now take
 * the same. Treat "roughly one chunk" as the shape of the win and not as a
 * duration: three requests arriving together on a shared public endpoint queue
 * against each other and against every other reader's, so each one need not
 * get the ~45s a lone job got. Re-measure once this is live, here and in the
 * build log, before anything else is reasoned from these numbers. The stitch
 * still runs, and `concatenateMp3` still verifies it, but it happens behind a
 * reader who is already listening to chunk 0 rather than in front of one who
 * is not listening to anything.
 */
export const NARRATION_MAX_CONCURRENT_CHUNKS = 3;

/**
 * The longest chapter this product will narrate at all.
 *
 * **This number is reconciled against every ceiling that bears on it, which is
 * the whole point of it.** It was previously 40,000 and was reconciled against
 * exactly one of them, which is how narration came to accept, bill and then
 * fail 38% of the library:
 *
 * 1. **The provider's per-request cap (10,000 characters).** No longer binds
 *    the chapter, because a chapter is no longer one request. It binds
 *    `NARRATION_CHUNK_CHARS`, which is 9,000, and the splitter guarantees no
 *    chunk exceeds it.
 * 2. **The 50 MB response ceiling in `narration-audio.ts`
 *    (`MAX_AUDIO_BYTES`).** This is what the old 40,000 was sized against, and
 *    on the old design it was the *only* ceiling anyone had written down. It
 *    now applies per chunk, where 9,000 characters at the measured 1,124 bytes
 *    per character is ~10.1 MB -- a fifth of the ceiling. It also still
 *    applies to the assembled file we upload: 27,000 x 1,124 is ~30 MB,
 *    comfortably under 50 MB even if the measurement is off by half.
 * 3. **The reader's patience and the isolate's memory**, both via
 *    `NARRATION_MAX_CHUNKS` above.
 *
 * 3 x 9,000 is 27,000, and this is 25,000, because **chunks do not pack
 * perfectly**. Cuts land on paragraph boundaries, so the last paragraph that
 * will not fit starts the next chunk and a chunk typically closes a few
 * hundred characters short of 9,000. Measured across paragraph lengths from
 * 138 to 1,380 characters, 25,000 characters always fits in three chunks and
 * 26,000 sometimes needs four:
 *
 * | paragraph length | 20,000 | 24,000 | 25,000 | 26,000 | 27,000 |
 * |---|---|---|---|---|---|
 * | 138-690 chars | 3 | 3 | 3 | 3 | **4** |
 * | 1,380 chars | 3 | 3 | 3 | **4** | **4** |
 *
 * So this is the *advertised* cap, checked first because it is free; the
 * binding check is the chunk count itself, which `generate-audio` applies to
 * the real split and which therefore cannot be fooled by an unusual paragraph
 * shape. Both produce the same 413 and the same `chapter_too_long_to_narrate`.
 *
 * It is deliberately far *below* the old 40,000, and nothing is lost by that:
 * everything between 10,000 and 40,000 characters was accepted and then failed
 * anyway, so this change only ever turns a failure into a success or into an
 * honest refusal, and never turns a success into a refusal.
 *
 * Above this a chapter is refused **before** any provider spend, which is the
 * same refusal and the same 413 the old cap produced; the reader is told to
 * split the chapter. 25,000 characters is roughly 4,500 words in a single
 * chapter, which no generated chapter reaches -- the longest in the live
 * library is 17,755 characters and the p90 is 13,382 -- so only a hand-edited
 * chapter can get there, and `edit-story` accepts a body of up to 200,000
 * characters.
 */
export const MAX_NARRATION_CHARS = 25_000;

/**
 * The same ceiling for a voice that is **not** narrated through MiniMax.
 *
 * `MAX_NARRATION_CHARS` above is derived from a MiniMax fact -- a 10,000
 * character per-request cap -- and applying a number derived from one
 * provider's limits to a different provider is precisely the mistake this
 * whole change exists to correct. edge-tts takes the chapter whole in one
 * synchronous call and has no such cap.
 *
 * 40,000 is the *old* `MAX_NARRATION_CHARS`, kept here because for edge-tts it
 * was never wrong: it was reconciled against the 50 MB response ceiling in
 * `narration-audio.ts`, which is the only ceiling this path actually has.
 * edge-tts emits 48 kbps CBR, so 50 MB is about 8,300 seconds of speech --
 * over 100,000 characters -- and 40,000 sits comfortably inside it. The number
 * is conservative rather than derived to the edge, and deliberately so: nobody
 * has measured edge-tts's own request limits, and inventing a tighter number
 * from nothing is how the original bug was written.
 *
 * edge-tts is the non-English placeholder and is not wired to a live service,
 * so in practice nothing reaches this. It exists so that turning edge-tts on
 * does not silently inherit MiniMax's constraints.
 */
export const EDGE_TTS_MAX_NARRATION_CHARS = 40_000;

/**
 * Split text into pieces at `separator`, with each separator kept on the END of
 * the piece it follows.
 *
 * Keeping the separator attached is what makes the packer safe: every piece
 * carries its own trailing whitespace, so no piece is ever whitespace-only and
 * therefore no chunk can ever begin with (or consist of) whitespace alone. A
 * whitespace-only request is a provider call that bills for silence, and on a
 * strict provider it is an error. It also makes the pieces re-joinable into
 * exactly the original text, which is the invariant the tests assert: a
 * narration must contain every word of the chapter, once.
 */
function splitKeepingSeparators(text: string, separator: RegExp): string[] {
  const parts = text.split(separator);
  const pieces: string[] = [];
  // `String.split` with one capture group alternates content, separator,
  // content, separator, ... so the separators are the odd indices.
  for (let i = 0; i < parts.length; i += 2) {
    const content = parts[i] ?? "";
    const gap = parts[i + 1] ?? "";
    const piece = content + gap;
    if (piece) pieces.push(piece);
  }
  return pieces.length ? pieces : (text ? [text] : []);
}

/** A blank line or more: the paragraph break in generated chapter prose. */
const PARAGRAPH_BREAK = /(\n[ \t]*\n[\s]*)/;

/**
 * The end of a sentence, followed by whitespace.
 *
 * The lookbehind requires terminal punctuation optionally followed by closing
 * quotes or brackets, so `"Run," she said.` breaks after the period and not
 * after the comma inside the quotes. `(?<![A-Z])` before the punctuation keeps
 * single-initial abbreviations (`J. R. R.`) whole, which is the one
 * abbreviation shape that actually recurs in fiction; a seam after `Mr.` is
 * still possible and is an acceptable residual, because a seam is only audible
 * at all when the packer happens to end a chunk on exactly that boundary.
 */
const SENTENCE_BREAK = /(?<=(?<![A-Z])[.!?…][")'”’\]]*)(\s+)/;

/** Any run of whitespace: the last boundary above cutting inside a word. */
const WORD_BREAK = /(\s+)/;

/**
 * Break one piece down until nothing in it exceeds `maxChars`.
 *
 * The ladder is paragraph, then sentence, then word, then a hard slice. Each
 * rung is only used for the pieces the rung above could not make small enough,
 * so ordinary prose is cut at paragraph breaks (inaudible) and only unusually
 * long paragraphs are cut at sentence breaks (nearly inaudible). A seam inside
 * a sentence is audible -- two separately synthesised clauses do not share a
 * prosodic contour -- so the word rung exists for correctness, not for quality,
 * and is reached only by a single sentence over 9,000 characters. The hard
 * slice below it is reached only by a single unbroken 9,000-character "word",
 * which is not prose at all; it exists so this function cannot loop forever on
 * pathological input rather than because anything is expected to hit it.
 */
function breakDown(piece: string, maxChars: number): string[] {
  if (piece.length <= maxChars) return [piece];

  for (const separator of [PARAGRAPH_BREAK, SENTENCE_BREAK, WORD_BREAK]) {
    const parts = splitKeepingSeparators(piece, separator);
    if (parts.length > 1) {
      return parts.flatMap((part) => breakDown(part, maxChars));
    }
  }

  const slices: string[] = [];
  for (let at = 0; at < piece.length; at += maxChars) {
    slices.push(piece.slice(at, at + maxChars));
  }
  return slices;
}

/**
 * Cut narration text into provider-sized chunks.
 *
 * Guarantees, each of which is pinned by a test:
 * - `chunks.join("") === text` -- every character of the chapter is narrated,
 *   once, in order. Nothing is dropped and nothing is repeated.
 * - No chunk is longer than `maxChars`, so no request can be refused for
 *   length.
 * - No chunk is empty or whitespace-only.
 * - Cuts land on a paragraph boundary where possible, a sentence boundary
 *   otherwise, and never inside a word.
 * - The result is a pure function of the text, which is what lets
 *   `generate-audio` and `audio-status` derive the same chunk list
 *   independently, from the same stored chapter, without storing it anywhere.
 *   (`edit-story` deletes the `chapter_audio` rows whenever it rewrites a
 *   chapter body, so a narration in flight can never be reading one revision
 *   of the prose while the other function reads another.)
 */
export function splitNarrationText(
  text: string,
  maxChars: number = NARRATION_CHUNK_CHARS,
): string[] {
  if (maxChars < 1) throw new Error("maxChars must be at least 1");
  if (!text) return [];
  if (!text.trim()) return [];
  if (text.length <= maxChars) return [text];

  const pieces = breakDown(text, maxChars);
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }
    if (current.length + piece.length <= maxChars) {
      current += piece;
      continue;
    }
    // A chunk that is still nothing but whitespace is never closed and sent.
    // Text can begin with a run of blank lines, and the separator-keeping
    // split puts that run in a piece of its own; sending it would be a
    // provider request containing no words at all -- billed silence at best,
    // a refusal at worst. It is dropped rather than carried, because carrying
    // it is the only thing here that could push a chunk past `maxChars`, and
    // leading blank lines are not narration. (Reachable only when a chapter
    // opens with more than `maxChars` of consecutive whitespace, which no real
    // one does; the branch exists so the length guarantee is unconditional.)
    if (!current.trim()) {
      current = piece;
      continue;
    }
    chunks.push(current);
    current = piece;
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * How many provider requests a chapter of this length will take, without
 * building the chunks. Used for cost and latency reporting and for the
 * refusal check.
 */
export function narrationChunkCount(text: string): number {
  return splitNarrationText(text).length;
}
