/**
 * The chapter's word tokens, in the same order and by the same rule the reader
 * renders them.
 *
 * The reader's per-page word offsets and narration's transcript sync must agree
 * on what "word number N" means. This is the one place that rule lives, so the
 * two cannot drift: `split(/(\s+)/)` then drop the whitespace tokens, which is
 * exactly what the page renderer does.
 */
export function splitWords(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token && !/^\s+$/.test(token));
}
