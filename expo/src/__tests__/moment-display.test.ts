/**
 * The "Moments to include" chip echoes a moment back at a fixed length ending
 * in "…", so a long moment cannot push the chip past the panel. The full text
 * is still what gets sent (`create-flow-more-options.test.tsx` pins that).
 */
import { MOMENT_DISPLAY_CHARS, truncateForDisplay } from "@/lib/moment-display";

const LONG =
  "She finally opens the letter her grandmother hid inside the piano for forty years";

describe("truncateForDisplay (moment chips)", () => {
  it("caps at a length the chip can draw on one line at 390pt", () => {
    // Wider than ~44 characters and the platform clips the line itself,
    // mid-word, before the code's own ellipsis is ever reached.
    expect(MOMENT_DISPLAY_CHARS).toBeLessThanOrEqual(44);
  });

  it("shortens a 50-character moment that the old 60-character cap let through", () => {
    const fifty = LONG.slice(0, 50);
    const shown = truncateForDisplay(fifty);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(MOMENT_DISPLAY_CHARS + 1);
  });

  it("cuts at a word boundary, not mid-word", () => {
    expect(truncateForDisplay(LONG)).toBe("She finally opens the letter her…");
  });

  it("hard-cuts one unbroken word rather than collapsing to a stub", () => {
    const word = "Supercalifragilisticexpialidociousantidisestablishmentarianism";
    expect(truncateForDisplay(word)).toBe(`${word.slice(0, MOMENT_DISPLAY_CHARS)}…`);
    expect(truncateForDisplay(`Hi ${word}`)).toBe(
      `${`Hi ${word}`.slice(0, MOMENT_DISPLAY_CHARS)}…`,
    );
  });

  it("leaves a short moment alone, and folds a pasted line break to a space", () => {
    expect(truncateForDisplay("  A short one ")).toBe("A short one");
    expect(truncateForDisplay("Rain on\nthe roof")).toBe("Rain on the roof");
  });

  it("does not leave punctuation hanging before the ellipsis", () => {
    const shown = truncateForDisplay(
      "They kiss in the rain, soaked, laughing, and the whole street watches",
    );
    expect(shown).toBe("They kiss in the rain, soaked, laughing…");
  });
});
