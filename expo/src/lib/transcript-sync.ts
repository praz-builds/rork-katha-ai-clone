/**
 * Lining the transcript up with the narration.
 *
 * # THE TIMINGS HERE ARE AN APPROXIMATION. THEY ARE NOT REAL TIMING DATA.
 *
 * Nothing in the narration pipeline returns per-line, per-word or per-sentence
 * timings today. `generate-audio` and `audio-status` answer with a status and a
 * URL; the `chapter_audio` row stores a single `duration_seconds` for the whole
 * file and nothing finer. There is no alignment step, and MiniMax's response is
 * not parsed for one.
 *
 * So `estimateCues` distributes the *measured total duration* across the lines
 * in proportion to how much text each line contains. That is defensible -- a
 * narrator reading at a roughly constant rate spends roughly proportional time
 * on proportional text -- and it is wrong in all the ordinary ways: a line of
 * dialogue read slowly, a paragraph break the narrator pauses on, a name the
 * model labours over. Expect the highlight to drift by a line or so over a long
 * chapter, and to be at its worst right after a pause.
 *
 * **Do not mistake these cues for alignment data, and do not build anything on
 * them that needs to be exact** (word-level karaoke, clip extraction, captions
 * for accessibility compliance).
 *
 * There is one thing between the estimate and real data: when narration is
 * synthesized in chunks, each chunk's *measured* duration covers a known span
 * of characters, so `buildChunkAnchoredCues` can reset the estimate's error to
 * zero at every chunk boundary instead of letting it accumulate across a
 * thirteen-minute chapter. Still an estimate; a much shorter-lived one.
 *
 * The moment the pipeline returns real timings,
 * pass them to `buildCues` as `timings` and this estimate stops being used --
 * that seam is the whole reason `buildCues` takes an optional argument it has
 * no caller for yet.
 */
import { splitWords } from "@/lib/sentence";

/** One highlightable line of the transcript. */
export type TranscriptLine = {
  /** Index into the line list; also its identity for keys and scrolling. */
  index: number;
  text: string;
  /** Which paragraph of the chapter it came from, so paragraphs can be spaced. */
  paragraphIndex: number;
  /** True for the first line of its paragraph. */
  startsParagraph: boolean;
};

/** A line's span in the audio, in milliseconds from the start of the file. */
export type TranscriptCue = {
  index: number;
  startMs: number;
  endMs: number;
};

/**
 * Real per-line timings, if the pipeline ever produces them.
 *
 * There is no producer for this today. It exists so the day one appears, the
 * change is "pass it in" rather than "rewrite the sync".
 */
export type NarrationTiming = {
  index: number;
  startMs: number;
  endMs: number;
};

/**
 * The same naive sentence rule the reader already uses
 * (`sentenceAroundWord` in `lib/sentence.ts`): a word ends a sentence when it
 * ends in `.`, `!` or `?`, optionally followed by one closing quote or bracket.
 * Good enough for prose, wrong on "Dr. Ames", and not worth a tokenizer for a
 * highlight that is an approximation anyway.
 *
 * Matching the reader's rule matters more than being right: a transcript that
 * split differently from the page would highlight fragments the reader never
 * saw as a unit. Written as a scan over `splitWords` tokens rather than as a
 * lookbehind split for the same reason `sentence.ts` is -- one rule, one
 * implementation shape, and no dependence on a regex feature Hermes may or may
 * not carry on a given release.
 */
const SENTENCE_END = /[.!?]["'’”)\]]?$/;

function splitIntoSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let current: string[] = [];
  for (const word of splitWords(paragraph)) {
    current.push(word);
    if (SENTENCE_END.test(word)) {
      sentences.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) sentences.push(current.join(" "));
  return sentences;
}

/** Break a chapter's paragraphs into the lines the transcript highlights. */
export function buildTranscriptLines(
  paragraphs: readonly string[],
): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const pieces = splitIntoSentences(paragraph)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0);
    pieces.forEach((text, at) => {
      lines.push({
        index: lines.length,
        text,
        paragraphIndex,
        startsParagraph: at === 0,
      });
    });
  });
  return lines;
}

/**
 * How much of the narration a line is assumed to occupy.
 *
 * Character count, floored at 1 so a line of "Yes." still gets a slice rather
 * than a zero-width one that can never be the active line. Whitespace is left
 * in: it is a rough proxy for the beats between words, and stripping it made
 * short, punchy dialogue lines finish visibly early.
 */
function weightOf(line: TranscriptLine): number {
  return Math.max(1, line.text.trim().length);
}

/**
 * Cues for a chapter, from real timings when they exist and from the
 * proportional estimate when they do not.
 *
 * `durationMs` must be the *measured* duration of the loaded audio (expo-av
 * reports it once the sound is loaded), never a guess: the estimate is only as
 * good as the total it is dividing up, and a guessed total makes it worthless.
 * A zero or unknown duration yields no cues at all, which the screen renders as
 * a plain unhighlighted transcript -- an honest "we do not know where you are"
 * rather than a highlight parked on line one.
 */
export function buildCues(
  lines: readonly TranscriptLine[],
  durationMs: number,
  timings?: readonly NarrationTiming[],
  chunks?: readonly CueChunk[],
): TranscriptCue[] {
  if (timings && timings.length > 0) {
    // Real data wins outright. Only the lines it covers are cued; a partial
    // alignment leaves the rest unhighlighted rather than mixing measured and
    // estimated spans in one transcript, which would look identical to the
    // reader while being two different levels of trustworthy.
    return timings
      .filter((timing) =>
        timing.index >= 0 && timing.index < lines.length &&
        timing.endMs > timing.startMs
      )
      .map((timing) => ({
        index: timing.index,
        startMs: timing.startMs,
        endMs: timing.endMs,
      }))
      .sort((a, b) => a.startMs - b.startMs);
  }
  // Chunk boundaries are the next best thing to real timings: they are measured
  // durations for known spans of text, so the estimate only has to be right
  // within a chunk instead of across a whole chapter.
  if (chunks && chunks.length > 0) {
    const anchored = buildChunkAnchoredCues(lines, chunks);
    if (anchored.length > 0) return anchored;
  }
  return estimateCues(lines, durationMs);
}

/** A synthesized piece, as far as the transcript cares: how long, how much text. */
export type CueChunk = {
  durationMs: number | null;
  charCount: number;
};

/**
 * Cues anchored to the chunk boundaries the narration was synthesized on.
 *
 * The whole-chapter estimate accumulates error for thirteen minutes: one slow
 * line early on pushes every later line late, and nothing ever pulls it back.
 * Chunking gives us measured durations for known spans of text, so the same
 * proportional estimate can run *within* each chunk and the error resets to
 * zero at every boundary. Drift is then bounded by one chunk of prose -- around
 * 9,000 characters -- instead of by the chapter.
 *
 * Lines are assigned to chunks greedily by cumulative character count against
 * the chunks' cumulative `char_count`, which is the same measure the server
 * split on. A line that straddles a boundary belongs to the earlier chunk: the
 * narrator has already started it there.
 *
 * Returns `[]` when the chunks cannot support this -- a missing duration, no
 * character counts -- so `buildCues` falls back to the whole-chapter estimate
 * rather than inventing a timeline.
 */
export function buildChunkAnchoredCues(
  lines: readonly TranscriptLine[],
  chunks: readonly CueChunk[],
): TranscriptCue[] {
  if (lines.length === 0 || chunks.length === 0) return [];
  if (
    chunks.some((chunk) =>
      !chunk.durationMs || chunk.durationMs <= 0 || chunk.charCount <= 0
    )
  ) {
    return [];
  }

  // Which chunk each line belongs to.
  const groups: TranscriptLine[][] = chunks.map(() => []);
  const budget = chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  let chunkAt = 0;
  let consumed = 0;
  let boundary = chunks[0].charCount;
  for (const line of lines) {
    // Past the prose these chunks cover. While a chapter is still being
    // synthesized that is the whole unrecorded tail, and it gets no cue at all
    // rather than being crushed into the last chunk that exists -- an
    // uncued line is honest, a wrong one moves the highlight.
    if (consumed >= budget) break;
    groups[chunkAt].push(line);
    consumed += weightOf(line);
    while (consumed >= boundary && chunkAt < chunks.length - 1) {
      chunkAt += 1;
      boundary += chunks[chunkAt].charCount;
    }
  }

  const cues: TranscriptCue[] = [];
  let offset = 0;
  chunks.forEach((chunk, at) => {
    const group = groups[at];
    const duration = chunk.durationMs as number;
    // A chunk with no lines still moves the clock on: its audio exists even if
    // the line split put its prose on either side of it.
    if (group.length > 0) {
      const within = estimateCues(group, duration);
      within.forEach((cue, i) => {
        cues.push({
          index: group[i].index,
          startMs: offset + cue.startMs,
          endMs: offset + cue.endMs,
        });
      });
    }
    offset += duration;
  });
  return cues;
}

/**
 * The proportional estimate. See the file header: this is not timing data.
 *
 * Cues tile the whole duration with no gaps -- each line ends exactly where the
 * next begins -- so `cueIndexAt` always has an answer and the highlight never
 * blinks off between lines.
 */
export function estimateCues(
  lines: readonly TranscriptLine[],
  durationMs: number,
): TranscriptCue[] {
  if (lines.length === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return [];
  }
  const weights = lines.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cues: TranscriptCue[] = [];
  let consumed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const startMs = (consumed / total) * durationMs;
    consumed += weights[i];
    // The last line is pinned to the exact duration rather than recomputed, so
    // floating-point drift cannot leave a sliver of audio after the final cue.
    const endMs = i === lines.length - 1
      ? durationMs
      : (consumed / total) * durationMs;
    cues.push({ index: i, startMs, endMs });
  }
  return cues;
}

/**
 * How far ahead of the playhead the highlight looks.
 *
 * The highlight was reliably late, and every cause pushed the same way:
 *
 * - expo-av reports position on an interval, so the number is already up to
 *   one interval old. We halve that interval to 250ms; half of it, ~125ms,
 *   is the average staleness left.
 * - Device output latency is real and never negative -- 100-300ms over
 *   Bluetooth, less on a speaker. The audio the reader hears is behind the
 *   position the player reports.
 * - React has to render, and a FlatList has to scroll.
 *
 * Roughly 250 + 150 covers the machinery; the last ~150 is deliberate. A reader
 * wants the line lit *as* the narrator starts it, which means lighting it a
 * beat before -- a highlight that arrives on the first syllable reads as late
 * even when it is exact.
 *
 * **Display only.** Seeking uses `cueStartMs` unshifted; a tap that seeked
 * `TRANSCRIPT_LEAD_MS` early would start playback mid-way through the previous
 * sentence.
 */
export const TRANSCRIPT_LEAD_MS = 450;

/**
 * Which line is being read at `positionMs`.
 *
 * Binary search: a long chapter is a few thousand lines and this runs on every
 * playback status callback. Returns -1 when there are no cues, and clamps to
 * the first/last line outside the covered range.
 *
 * `leadMs` is looked *ahead* (see `TRANSCRIPT_LEAD_MS`): the answer is the line
 * the narrator is about to be on, because by the time it is rendered and heard,
 * they are.
 */
export function cueIndexAt(
  cues: readonly TranscriptCue[],
  positionMs: number,
  leadMs: number = TRANSCRIPT_LEAD_MS,
): number {
  if (cues.length === 0) return -1;
  const at = positionMs + leadMs;
  if (at <= cues[0].startMs) return cues[0].index;
  const last = cues[cues.length - 1];
  if (at >= last.endMs) return last.index;

  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (at < cue.startMs) high = mid - 1;
    else if (at >= cue.endMs) low = mid + 1;
    else return cue.index;
  }
  // Only reachable across a gap between two cues, which `estimateCues` never
  // produces but supplied timings might. Attach to the cue that just ended.
  return cues[Math.min(Math.max(low - 1, 0), cues.length - 1)].index;
}

/** Where a line starts, for seeking to it by tap. */
export function cueStartMs(
  cues: readonly TranscriptCue[],
  index: number,
): number | null {
  const cue = cues.find((candidate) => candidate.index === index);
  return cue ? cue.startMs : null;
}

/** `m:ss`, or `h:mm:ss` past an hour. Used for both elapsed and total. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
