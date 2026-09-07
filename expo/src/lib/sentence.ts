/**
 * Sentence-boundary helpers for phrase capture.
 *
 * Deliberately as naive as the page-break heuristic in `lib/paginate.ts`
 * (`". "`, `"? "`, `"! "`, `"\n\n"`): good enough for real prose, wrong on a
 * handful of abbreviations, and never worth a full sentence tokenizer for a
 * feature that only needs "roughly the right sentence" to hand a reader back
 * for practice.
 */

const SENTENCE_END = /[.!?]["'’”)\]]?$/;

export type SentenceRange = { start: number; end: number; text: string };

/**
 * Given the ordered word tokens of a page (each token may carry attached
 * punctuation, exactly what `text.split(/(\s+)/)` produces once whitespace
 * tokens are dropped) and the index of one of them, return the token range
 * and joined text of the sentence that token sits inside.
 *
 * Falls back gracefully on an empty list or an out-of-range index instead of
 * throwing, so a caller never has to guard the call.
 */
export function sentenceAroundWord(
  words: readonly string[],
  index: number,
): SentenceRange {
  if (words.length === 0) return { start: 0, end: 0, text: "" };
  const at = Math.min(Math.max(index, 0), words.length - 1);

  let start = at;
  while (start > 0 && !SENTENCE_END.test(words[start - 1])) start -= 1;

  let end = at;
  while (end < words.length - 1 && !SENTENCE_END.test(words[end])) end += 1;

  return { start, end, text: words.slice(start, end + 1).join(" ").trim() };
}

/** Strips leading and trailing punctuation/quote marks a saved word should not carry. */
export function cleanWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
