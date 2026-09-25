/**
 * How a "Moments to include" entry is shown back to the writer.
 *
 * A DISPLAY cap, never a data cap. The moment is stored and sent in full (up
 * to the 300-character server cap mirrored as `MAX_MOMENT_CHARS` in
 * `CreateBriefFlow`); only the chip that echoes it is shortened.
 *
 * WHY 40. The chip sits in the More options panel, whose text column at the
 * 390pt reference width is about 280pt once the panel padding, the chip's own
 * padding and its remove "×" are taken out. At the chip's 13pt/700 Hanken that
 * is roughly 44 average characters, and about 38 on a 360pt Android. The old
 * cap was 60, which is wider than the chip can ever draw: the platform clipped
 * the line itself, mid-word ("her grandmother hi…"), and on web the ellipsis
 * the code produced was never the one on screen. At 40 the "…" a writer sees
 * is ours, at a word boundary, and `numberOfLines={1}` stays only as a
 * backstop for a line of unusually wide glyphs.
 */
export const MOMENT_DISPLAY_CHARS = 40;

/**
 * Cut `text` to at most `max` characters plus a trailing "…".
 *
 * Prefers the last word boundary inside the cap, so a chip reads "She finally
 * opens the letter her…" rather than "…her grandm…". A boundary is only used
 * when it keeps at least half the cap: one unbroken 80-character word, or a
 * short first word followed by a very long one, would otherwise collapse to a
 * stub. Internal runs of whitespace (a pasted line break) are folded to one
 * space first, because a newline in a single-line chip is an invisible gap.
 */
export function truncateForDisplay(text: string, max: number = MOMENT_DISPLAY_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const hard = flat.slice(0, max);
  // The cap can land exactly on the end of a word; then the whole slice is
  // already at a boundary and nothing needs dropping.
  const endsOnWord = flat[max] === " ";
  const lastSpace = hard.lastIndexOf(" ");
  const cut = endsOnWord || lastSpace < Math.ceil(max / 2) ? hard : hard.slice(0, lastSpace);
  // Trailing punctuation before the ellipsis reads as a typo ("rain,…").
  return `${cut.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}
