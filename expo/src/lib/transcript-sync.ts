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
 * for accessibility compliance). The moment the pipeline returns real timings,
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
  return estimateCues(lines, durationMs);
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
 * Which line is being read at `positionMs`.
 *
 * Binary search: a long chapter is a few thousand lines and this runs on every
 * playback status callback. Returns -1 when there are no cues, and clamps to
 * the first/last line outside the covered range.
 */
export function cueIndexAt(
  cues: readonly TranscriptCue[],
  positionMs: number,
): number {
  if (cues.length === 0) return -1;
  if (positionMs <= cues[0].startMs) return cues[0].index;
  const last = cues[cues.length - 1];
  if (positionMs >= last.endMs) return last.index;

  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (positionMs < cue.startMs) high = mid - 1;
    else if (positionMs >= cue.endMs) low = mid + 1;
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
