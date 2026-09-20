import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { spacing } from "./theme";

/**
 * How wide the window is, in the three sizes anything here actually cares
 * about.
 *
 * WHY A BAND AND NOT A PIXEL COUNT. Every surface that has tried to be
 * responsive in this app so far has done it with one bare comparison against
 * one bare number — `width >= 768` in the reader is the whole system — so the
 * same phone is "small" in one file and "large" in the next, and nothing can
 * be changed in one place. A band is a name three screens can agree on.
 *
 * - `compact`  — under 375pt. The 320pt phone, and a narrow web window.
 * - `regular`  — the reference frame the design system is drawn at (390 x 844)
 *   and everything up to a tablet.
 * - `wide`     — 768pt and up: tablets, and a desktop browser. This is the one
 *   where the answer is NOT "make everything bigger": a feed card stretched to
 *   1400pt is a line of text with a stamp on the end of it. Wide means cap the
 *   column and centre it.
 *
 * `content` is the usable width INSIDE the screen gutter, already capped, and
 * is the number a layout should divide up. It is not the window width, and the
 * difference is the bug this hook exists to stop: a card sized from the window
 * is always one gutter too wide.
 *
 * SCOPE. This is used by the feed card and by Explore. It is deliberately not
 * applied app-wide in the change that introduced it — the reader, onboarding
 * and the tab bar keep the geometry they were signed off at until each is
 * migrated on purpose.
 */
export type LayoutBand = "compact" | "regular" | "wide";

/** The band edges. `wide` matches the reader's existing lone breakpoint. */
export const LAYOUT_BREAKPOINTS = { regular: 375, wide: 768 } as const;

/** The gutter every screen already pads its content by. */
export const LAYOUT_GUTTER = spacing.xl;

/**
 * The widest a single column of content may grow. Past this a feed row stops
 * being scannable: the cover and the stats end up at opposite ends of the eye's
 * travel and the title floats alone in the middle.
 */
export const MAX_CONTENT_WIDTH = 560;

export type LayoutWidth = {
  /** The whole window, for the rare case something really does need it. */
  window: number;
  /** Usable width inside the gutters, capped at `MAX_CONTENT_WIDTH`. */
  content: number;
  /** The gutter used to get there, so a caller can re-apply it. */
  gutter: number;
  band: LayoutBand;
};

/** The pure half, so the bands can be tested without a window. */
export function layoutWidth(window: number): LayoutWidth {
  const band: LayoutBand = window >= LAYOUT_BREAKPOINTS.wide
    ? "wide"
    : window >= LAYOUT_BREAKPOINTS.regular
    ? "regular"
    : "compact";

  // `Math.max` rather than trusting the subtraction: a zero or unmeasured
  // window (it happens on the first web frame) must not produce a negative
  // width that every downstream `clamp` then has to defend against.
  const usable = Math.max(0, window - LAYOUT_GUTTER * 2);

  return {
    window,
    content: Math.min(usable, MAX_CONTENT_WIDTH),
    gutter: LAYOUT_GUTTER,
    band,
  };
}

export function useLayoutWidth(): LayoutWidth {
  const { width } = useWindowDimensions();
  return useMemo(() => layoutWidth(width), [width]);
}
