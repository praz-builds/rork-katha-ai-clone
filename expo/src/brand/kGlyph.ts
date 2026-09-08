/**
 * The Katha "K", as geometry.
 *
 * Extracted from `assets/fonts/Baloo2-ExtraBold.ttf` — the same `fonts.brandHeavy`
 * face the wordmark renders — so the mark and the word are the identical letter,
 * not a lookalike.
 *
 * Why this is a baked path and not a `<Text>K</Text>`:
 *
 * 1. Text cannot be stroke-traced. The draw-on animation needs a path to run a
 *    dash offset along; a text node has no length to animate.
 * 2. The raw glyph is FOUR overlapping unmerged contours (stem-top, stem-bottom,
 *    arm, leg). Filled with nonzero winding it looks correct, but traced it draws
 *    four disconnected rectangles with seams straight through the letter. This
 *    path is their boolean union: one closed contour, no holes, no interior seams.
 *
 * Regenerate with `scripts/extract-k-glyph.py` if the brand face ever changes.
 */

/** Single closed contour, normalized into a 100x100 box at 86 percent fill. */
export const K_PATH =
  "M76.06,33.04 L79.11,29.35 L81.56,25.28 L82.99,21.72 L83.30,20.16 L83.30,18.85 L82.98,17.58 L82.36,16.26 L80.30,13.63 L77.32,11.20 L73.62,9.24 L69.93,8.10 L65.95,7.68 L37.47,40.39 L37.44,17.54 L36.87,14.83 L35.43,12.13 L33.89,10.42 L32.02,9.03 L29.50,7.83 L27.12,7.21 L25.02,7.01 L22.60,7.09 L13.50,8.23 L13.51,81.62 L13.77,83.52 L14.36,85.31 L15.26,86.97 L16.44,88.46 L18.18,90.00 L19.88,91.04 L22.14,91.96 L24.20,92.43 L26.38,92.59 L29.56,92.43 L37.47,91.36 L37.47,60.41 L57.99,84.29 L61.05,87.18 L64.46,89.71 L67.05,91.22 L69.32,92.20 L71.55,92.83 L73.68,92.99 L75.41,92.70 L77.60,91.86 L79.80,90.57 L81.87,88.91 L83.98,86.63 L85.37,84.49 L86.25,82.26 L86.50,80.40 L58.73,50.38 Z";

/** viewBox the path is authored against. */
export const K_VIEWBOX = "0 0 100 100";

/**
 * Perimeter of `K_PATH` in viewBox units.
 *
 * React Native has no `SVGGeometryElement.getTotalLength()`, so the dash array
 * the draw animation interpolates cannot be measured at runtime. It is computed
 * once at extraction time and asserted in `src/__tests__/katha-mark.test.tsx`.
 */
export const K_LENGTH = 402.56;
