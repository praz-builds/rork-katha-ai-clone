/**
 * The reading modes are checked, not eyeballed.
 *
 * A theme is a pair of colours somebody picked because it looked right at the
 * moment they picked it — the kind of decision that rots quietly. A token gets
 * nudged, a mode is added in a hurry, and nothing notices that body prose on
 * one of them has become unreadable for a reader with low vision. Nothing here
 * asserts that a theme is *pretty*; it asserts the two properties that decide
 * whether a person can actually read on it for half an hour.
 */
import {
  contrastRatio,
  isPureBlackOnWhite,
  relativeLuminance,
  WCAG_AA_NORMAL,
  WCAG_AAA_NORMAL,
} from "@/lib/contrast";
import {
  READER_THEMES as THEMES,
  READING_THEME_ORDER,
  type ReaderTheme,
} from "@/lib/reading-themes";

const entries: ReaderTheme[] = Object.values(THEMES);

describe("contrastRatio", () => {
  it("agrees with the two ratios everyone knows", () => {
    // The anchors. If these drift the formula is wrong and every assertion
    // below is measuring nothing.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // Order must not matter: the lighter colour is always the numerator.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#767676"),
      10,
    );
  });

  it("accepts shorthand hex and rejects anything that is not a colour", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
    expect(() => relativeLuminance("rebeccapurple")).toThrow();
    expect(() => relativeLuminance("#12345")).toThrow();
  });
});

describe("every reading mode", () => {
  it.each(entries.map((theme) => [theme.label, theme] as const))(
    "%s: body text clears WCAG AAA against its own page",
    (_label, theme) => {
      // AAA (7:1), not AA (4.5:1). AA is aimed at interface text read in
      // glances; this is prose someone holds their eyes on.
      const ratio = contrastRatio(theme.text, theme.background);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA_NORMAL);
    },
  );

  it.each(entries.map((theme) => [theme.label, theme] as const))(
    "%s: secondary text still clears AA",
    (_label, theme) => {
      // Deliberately AA and not AAA. `muted` is page furniture — page numbers,
      // captions — and holding it to the body-text bar would flatten the
      // hierarchy that makes a page scannable.
      const ratio = contrastRatio(theme.muted, theme.background);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    },
  );

  it.each(entries.map((theme) => [theme.label, theme] as const))(
    "%s: is not pure black on pure white",
    (_label, theme) => {
      // 21:1 is the maximum contrast and the wrong choice for long-form
      // reading: it produces the strongest halation, the trailing ghost that
      // smears a line as the page moves. Uncomfortable for most readers,
      // painful for readers with astigmatism.
      expect(isPureBlackOnWhite(theme.text, theme.background)).toBe(false);
    },
  );

  it.each(entries.map((theme) => [theme.label, theme] as const))(
    "%s: the divider is visible without competing with the text",
    (_label, theme) => {
      // A divider nobody can see is decoration; one as strong as the prose is
      // noise. Both failures look like a styling slip and neither shows up in
      // a screenshot review.
      const divider = contrastRatio(theme.divider, theme.background);
      const text = contrastRatio(theme.text, theme.background);
      expect(divider).toBeGreaterThan(1.1);
      expect(divider).toBeLessThan(text);
    },
  );
});

describe("the set of modes", () => {
  it("offers warm, neutral and dark — and leads with the default", () => {
    // Three, not five. The bigger libraries add cool-blue and green pages
    // because they carry every kind of book; this app has one kind, and a row
    // of five swatches is a decision nobody came here to make. Sepia is first
    // because it is the default.
    expect(READING_THEME_ORDER).toEqual(["sepia", "paper", "night"]);
  });

  it("lists every defined mode exactly once, and nothing else", () => {
    // The picker renders from this order. A mode defined but missing from it
    // is unreachable; a name in it with no definition crashes the picker.
    expect([...READING_THEME_ORDER].sort()).toEqual(
      Object.keys(THEMES).sort(),
    );
    expect(new Set(READING_THEME_ORDER).size).toBe(READING_THEME_ORDER.length);
  });

  it("ends on a page that is genuinely dark, not merely the darkest", () => {
    const luminances = READING_THEME_ORDER.map((name) =>
      relativeLuminance(THEMES[name].background)
    );
    const darkest = luminances[luminances.length - 1];
    expect(darkest).toBe(Math.min(...luminances));
    // A set of three light themes would satisfy "darkest" and offer no night
    // reading at all, which is the failure worth catching.
    expect(darkest).toBeLessThan(0.05);
  });

  it("gives each mode a page a reader could tell apart from the others", () => {
    // Two modes that look identical are one mode and a wasted tap.
    for (let i = 0; i < READING_THEME_ORDER.length; i += 1) {
      for (let j = i + 1; j < READING_THEME_ORDER.length; j += 1) {
        const a = THEMES[READING_THEME_ORDER[i]].background;
        const b = THEMES[READING_THEME_ORDER[j]].background;
        expect(a.toLowerCase()).not.toBe(b.toLowerCase());
      }
    }
  });
});
