/**
 * The arithmetic behind long-press-and-drag selection in the reader.
 *
 * Kept out of the component so the part that decides WHICH WORDS ARE SELECTED
 * can be tested without a gesture, a renderer, or a device.
 *
 * WHY A DRAG DISTANCE AND NOT A HIT TEST. The obvious implementation is to
 * measure every word's frame and resolve the finger's position against it. In
 * this reader that is not available: prose is drawn as nested `<Text>` inside a
 * flowing paragraph (see `TappableWord` for why it has to be), and a nested
 * `Text` reports a frame relative to its enclosing text block on some
 * platforms, an unusable one on others, and none at all on react-native-web.
 * A hit test built on that would be silently wrong on whichever platform the
 * product owner happened to open, which is worse than not having it.
 *
 * So the drag is read as travel through the text in READING ORDER instead:
 * sideways moves word by word, downward moves line by line. The reader is not
 * asked to trust an invisible mapping -- the highlight moves under their finger
 * as they drag, so they steer by what they can see and stop when the phrase
 * they wanted is lit. Releasing and dragging again re-steers from the same
 * anchor, and a plain tap is untouched.
 */

/** Horizontal travel that advances the selection by one word. */
export const WORD_STEP_PX = 22;
/** Vertical travel that advances the selection by one line of prose. */
export const LINE_STEP_PX = 30;
/**
 * How many words a dragged line is worth.
 *
 * A 390-wide page at the default 18pt reading size holds roughly six words a
 * line. Erring low is deliberate: overshooting by a word costs one more nudge
 * sideways, overshooting by half a line costs the reader the phrase.
 */
export const WORDS_PER_LINE = 6;

export type SelectionRange = {
  /** Chapter-absolute index of the first selected word, inclusive. */
  start: number;
  /** Chapter-absolute index of the last selected word, inclusive. */
  end: number;
};

/**
 * How many words forward (or, negative, backward) a drag has travelled.
 *
 * A worklet-safe pure function: no closures, no imports at call time. The
 * gesture calls this on the UI runtime on every frame and only crosses back to
 * React when the result CHANGES, which is the one place a haptic and a
 * re-render belong.
 */
export function wordStepsForDrag(
  translationX: number,
  translationY: number,
): number {
  "worklet";
  const lines = Math.round(translationY / LINE_STEP_PX);
  const words = Math.round(translationX / WORD_STEP_PX);
  return lines * WORDS_PER_LINE + words;
}

/** Clamps an anchor plus a signed word travel into a real range over `wordCount`. */
export function rangeFromAnchor(
  anchor: number,
  steps: number,
  wordCount: number,
): SelectionRange {
  if (wordCount <= 0) return { start: 0, end: 0 };
  const last = wordCount - 1;
  const safeAnchor = Math.min(Math.max(anchor, 0), last);
  const focus = Math.min(Math.max(safeAnchor + steps, 0), last);
  return focus < safeAnchor
    ? { start: focus, end: safeAnchor }
    : { start: safeAnchor, end: focus };
}

/** True when `index` falls inside the range, both ends inclusive. */
export function isWordInRange(
  index: number,
  range: SelectionRange | null,
): boolean {
  if (!range) return false;
  return index >= range.start && index <= range.end;
}

/**
 * The selected prose, joined the way it reads.
 *
 * `splitWords` drops the whitespace tokens, so a single space between words is
 * the correct reconstruction for prose; a paragraph break inside a selection
 * becomes a space, which is what a quotation wants anyway.
 */
export function textForRange(
  words: readonly string[],
  range: SelectionRange | null,
): string {
  if (!range) return "";
  return words.slice(range.start, range.end + 1).join(" ").trim();
}

/** How many words a range covers. */
export function rangeLength(range: SelectionRange | null): number {
  return range ? range.end - range.start + 1 : 0;
}
