/**
 * Contrast maths, so a reading theme is checked rather than eyeballed.
 *
 * Every reading theme in this app is a pair of colours somebody chose because
 * it looked nice at the moment they chose it. That is exactly the kind of
 * decision that rots: a token gets nudged, a theme is added in a hurry, and
 * nothing anywhere notices that body text on one of them is now unreadable for
 * a reader with low vision. `contrastRatio` makes it checkable, and the test
 * beside `READER_THEMES` turns "we think these are fine" into a gate.
 *
 * The formula is WCAG 2's relative luminance and contrast ratio, implemented
 * here rather than pulled in: it is fifteen lines, it has no dependencies, and
 * a dependency for fifteen lines is a supply-chain surface for nothing.
 */

/** WCAG AA for body text. The floor, not the target. */
export const WCAG_AA_NORMAL = 4.5;

/**
 * WCAG AAA for body text, and the bar this app's reading themes are held to.
 *
 * AA is the legal floor and is aimed at interface text read in glances. A
 * reading app asks someone to hold their eyes on body prose for half an hour,
 * which is a different demand, and the accessibility guidance for long-form
 * reading is consistent that AAA is where sustained reading should sit.
 */
export const WCAG_AAA_NORMAL = 7;

/** Parse `#RGB` or `#RRGGBB` into 0-255 channels. Throws on anything else. */
function channels(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  const full = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance for one 0-255 channel. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, 1 (identical) to 21 (black on white).
 *
 * Order does not matter; the lighter colour is always the numerator.
 */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Is this pair pure black against pure white, in either direction?
 *
 * Maximum contrast at 21:1, and deliberately excluded from every reading
 * theme. Pure white on pure black produces the strongest halation -- the
 * trailing ghost that makes a line of text smear as the page moves -- which is
 * uncomfortable for most readers and genuinely painful for readers with
 * astigmatism. The guidance for long-form reading is consistent: reach AAA
 * with a deep grey and an off-white, not with the extremes.
 */
export function isPureBlackOnWhite(a: string, b: string): boolean {
  const extremes = new Set(["#000000", "#ffffff"]);
  const normalise = (hex: string) => {
    const [r, g, b_] = channels(hex);
    return `#${[r, g, b_].map((v) => v.toString(16).padStart(2, "0")).join("")}`
      .toLowerCase();
  };
  return extremes.has(normalise(a)) && extremes.has(normalise(b));
}
