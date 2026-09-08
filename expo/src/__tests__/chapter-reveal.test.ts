/**
 * The rule that decides when a reader is allowed to see a chapter.
 *
 * `create-streaming-integration.test.tsx` proves the *screen* obeys it, by
 * driving a real stream. This file pins the rule itself, because the screen
 * test cannot: to assert "three finished pages" through the UI you would have
 * to hard-code the page arithmetic into the fixture, and then the fixture and
 * the rule would drift apart silently the first time either moved.
 *
 * The three properties that matter, and why each is a property and not a
 * detail:
 *
 * - **Nothing below the threshold.** This is the letter-by-letter behaviour the
 *   change exists to remove. If this returns text early, the reader watches
 *   their chapter be typed.
 * - **Whole paragraphs only.** The tail of a stream is always a half-written
 *   sentence.
 * - **A prefix that never changes.** Page 1 is finished when it is revealed and
 *   stays finished. Everything the reveal promises rests on this: if a later
 *   chunk could move an earlier page boundary, the page the reader is looking
 *   at would reflow underneath them.
 */

import {
  REVEAL_MIN_PAGES,
  revealableChapterProse,
} from "@/screens/CreateStudioScreen";

/** ~315 characters; the nominal page is ~650, so two of these is about a page. */
const PARAGRAPH =
  "She pushed it open and the hinges gave without a sound, which was the " +
  "first thing that felt wrong about it. Beyond the frame the library went " +
  "on exactly as it did on the other side, the same shelves, the same brass " +
  "lamps, the same dust turning slowly in the same slant of afternoon light, " +
  "and that was the second.\n\n";

/** A chapter of `n` paragraphs, plus a sentence still being typed. */
function streamOf(n: number, tail = ""): string {
  return PARAGRAPH.repeat(n) + tail;
}

describe("what a reader may be shown mid-generation", () => {
  it("shows nothing at all until the threshold is cleared", () => {
    // A part-written word, a finished sentence, a finished paragraph. Under the
    // behaviour this replaces, every one of these was on screen.
    expect(revealableChapterProse("The door was not")).toBe("");
    expect(revealableChapterProse("The door was not there yesterday.")).toBe("");
    expect(revealableChapterProse("The door was not there yesterday.\n\n")).toBe(
      "",
    );
    expect(revealableChapterProse(streamOf(2))).toBe("");
  });

  it("reveals once enough finished pages exist, and only whole pages", () => {
    const revealed = revealableChapterProse(streamOf(12));
    expect(revealed.length).toBeGreaterThan(0);

    // Whole paragraphs: what is revealed is a run of complete paragraphs, so
    // splitting it the way the reader's view does leaves no ragged tail.
    for (const paragraph of revealed.split(/\n\s*\n/)) {
      expect(paragraph.trim()).toBe(PARAGRAPH.trim());
    }

    // And less than everything received, because the page still filling up is
    // held back along with the paragraph still being written.
    expect(revealed.length).toBeLessThan(streamOf(12).length);
  });

  it("never reveals the paragraph that is still being written", () => {
    const tail = "She counted the lamps twice before she";
    const revealed = revealableChapterProse(streamOf(12, tail));
    expect(revealed).not.toContain(tail);
  });

  it("only ever grows, and never changes what it already showed", () => {
    // The property page 1 rests on. `paginateChapter` walks forward greedily
    // from character zero, so a boundary it has already set cannot be moved by
    // text arriving after it - but that is an assumption this rule makes about
    // another module, which is exactly the kind of assumption that should be
    // asserted rather than believed.
    let previous = "";
    for (let n = 1; n <= 20; n += 1) {
      const revealed = revealableChapterProse(streamOf(n, "and then she"));
      if (previous) {
        expect(revealed.startsWith(previous)).toBe(true);
      }
      expect(revealed.length).toBeGreaterThanOrEqual(previous.length);
      previous = revealed;
    }
    expect(previous.length).toBeGreaterThan(0);
  });

  it("holds back at least the threshold's worth of pages before revealing", () => {
    // Not an assertion about the constant's value - product may retune it -
    // but about the two numbers agreeing. A threshold of three that revealed
    // after one page would pass every test above.
    const perPage = 650;
    const justUnder = revealableChapterProse(
      streamOf(Math.max(1, Math.floor((REVEAL_MIN_PAGES * perPage) / 400))),
    );
    expect(justUnder).toBe("");
  });

  it("treats malformed and empty input as nothing to show", () => {
    expect(revealableChapterProse("")).toBe("");
    expect(revealableChapterProse("\n\n")).toBe("");
    expect(revealableChapterProse("   \n\n   ")).toBe("");
  });
});
