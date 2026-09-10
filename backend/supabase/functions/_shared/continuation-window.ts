/**
 * The previous-chapters block of a continuation prompt.
 *
 * Lives here rather than in `continue-story/index.ts` because it is a
 * prompt-assembly decision with a measurable cost, and a decision with a
 * measurable cost needs a test. It was a four-line `.map().join()` inside the
 * handler, where the only way to check it was to generate a chapter.
 */
/**
 * How much of the most recent chapter travels verbatim, in characters.
 *
 * ~5 000 characters is roughly the last third of a standard chapter. It is the
 * END of the previous chapter that a continuation is written from: the scene it
 * closed on, the line of dialogue still hanging, the voice as it actually
 * sounds. The opening pages are what `previously_summary` and `series_state`
 * exist to carry, and carrying them twice is what made the prompt big.
 *
 * The chapter's own opening is kept as well, because the first paragraph is
 * where a chapter's register is set and a model handed only an ending will
 * drift toward whatever the ending's mood was.
 */
export const VERBATIM_TAIL_CHARS = 5_000;
export const VERBATIM_HEAD_CHARS = 600;

/**
 * The previous-chapters block: the newest chapter in near-full, older ones as
 * the summaries they already carry.
 *
 * WHY THIS EXISTS. Time-to-first-token scales with prompt size at roughly
 * 0.21 s per KB against this model, measured 2026-09-11: chapter 1's prompt is
 * 14.7 KB and starts in 4.0 s; chapter 2's is 30.5 KB and starts in 7.0-7.9 s.
 * The whole of that difference is the previous chapter travelling verbatim.
 *
 * The read above is `.limit(4)`, and every one of those four used to be sent in
 * full, so the cost was not a fixed penalty on chapter 2 -- it GREW. By chapter
 * 5 the window carried four whole chapters, about 66 KB, which extrapolates to
 * roughly 15 s before a reader sees a word. Fixing chapter 2 alone would have
 * been fixing the least broken chapter in the series.
 *
 * So the window is now bounded rather than proportional:
 *
 *   * The chapter immediately before this one is what continuity is actually
 *     built from, and it keeps its opening and its ending verbatim.
 *   * Everything older is sent as its stored `previously_summary` -- a field
 *     the model itself wrote for exactly this purpose, which `continue-story`
 *     already trusted for the finale's chapter-1 callback. It is not a
 *     downgrade to a summary; it is the summary being used where it was always
 *     meant to be used.
 *   * `series_state` travels separately and carries the open hooks, the
 *     promised payoffs and the world facts, which is the continuity that older
 *     prose was being re-read for.
 *
 * A chapter that is already short enough is sent untouched, so nothing changes
 * for the stories where nothing needed to.
 */
export function buildPreviousChapterWindow(
  chapters: readonly {
    chapter_number: number;
    title?: string | null;
    content?: string | null;
    previously_summary?: string | null;
    hook_type?: string | null;
    hook_text?: string | null;
  }[],
): string {
  if (chapters.length === 0) return "";
  // The read orders newest first; the prompt reads oldest first.
  const ordered = [...chapters].toReversed();
  const newest = ordered[ordered.length - 1];

  const parts = ordered.slice(0, -1).map(summarizeChapterForPrompt);

  /*
    THE NEWEST CHAPTER'S OWN SUMMARY GOES IN WHEN ITS MIDDLE COMES OUT.

    `trimToEnds` drops roughly the middle 60% of a standard chapter, and the
    first version of this function dropped it into nothing: the elision marker
    told the model the passage was "summarised above" while the only summaries
    above belonged to OLDER chapters. The model was pointed at a summary that
    did not exist, for the one chapter it most needs to be continuous with.

    `previously_summary` is written by the model itself at the end of every
    chapter for exactly this purpose, so the material is already there and was
    simply not being used. It is emitted only when the prose was actually cut —
    a chapter short enough to travel whole needs no summary of itself, and
    adding one would be the same fact twice.
  */
  const body = (newest.content ?? "").trim();
  const trimmed = trimToEnds(body);
  const summary = newest.previously_summary?.trim();
  const bridge = trimmed !== body && summary
    ? `\nWhat this chapter covered: ${summary}\n`
    : "";
  parts.push(`Chapter ${newest.chapter_number}:${bridge} ${trimmed}`);
  return parts.join("\n\n");
}

/**
 * A chapter's opening and its ending, with the middle named rather than hidden.
 *
 * The elision is stated out loud instead of the two halves being silently
 * concatenated. A model handed a paragraph that ends mid-scene and resumes
 * somewhere else treats the join as a jump cut it has to explain, and writes
 * around it; told that a passage was omitted, it does not.
 */
export function trimToEnds(content: string): string {
  const text = content.trim();
  if (text.length <= VERBATIM_HEAD_CHARS + VERBATIM_TAIL_CHARS) return text;
  const head = text.slice(0, VERBATIM_HEAD_CHARS);
  const tail = text.slice(-VERBATIM_TAIL_CHARS);
  // The marker is true whether or not a summary accompanies it. It used to say
  // "summarised above", which was a claim about the rest of the prompt that
  // this function cannot make and that was false whenever the chapter carried
  // no `previously_summary`.
  return `${head}\n\n[... a passage from the middle of this chapter is omitted; it continues ...]\n\n${tail}`;
}

export function summarizeChapterForPrompt(chapter: {
  chapter_number: number;
  title?: string | null;
  content?: string | null;
  previously_summary?: string | null;
  hook_type?: string | null;
  hook_text?: string | null;
}): string {
  const summary = chapter.previously_summary?.trim();
  const body = chapter.content?.trim() ?? "";
  const excerpt = body.length > 1200 ? `${body.slice(0, 1200)}...` : body;
  const hook = chapter.hook_text?.trim()
    ? `\nOpening hook: ${chapter.hook_type ?? "unknown"} - ${chapter.hook_text}`
    : "";
  return `Chapter ${chapter.chapter_number}: ${chapter.title ?? "Untitled"}\n${
    summary || excerpt
  }${hook}`;
}
