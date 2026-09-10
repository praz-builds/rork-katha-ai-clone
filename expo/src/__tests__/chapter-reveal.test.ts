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
  revealableChapterProse,
} from "@/lib/generation-session";

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
  it("shows nothing until a paragraph has actually finished", () => {
    // A part-written word and a sentence with no paragraph break after it are
    // both still being written, and neither may appear.
    expect(revealableChapterProse("The door was not")).toBe("");
    expect(revealableChapterProse("The door was not there yesterday.")).toBe("");
    // A trailing blank line with nothing before it is not a paragraph either.
    expect(revealableChapterProse("\n\nThe door was not there")).toBe("");
  });

  it("reveals settled paragraphs, and only settled paragraphs", () => {
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

  // The page threshold has gone. It lived here as REVEAL_MIN_PAGES = 3 and
  // measured whole pages against a GUESSED 390x640 viewport, which held about
  // 720 characters -- while the reader's real first page holds about 324,
  // because the chapter opener takes the top of it. So it withheld roughly
  // 460 words to fill a page that shows 60, and that wait was the largest
  // single component of the time before anyone saw a word.
  //
  // The promise it was making -- never reflow a page the reader is looking at
  // -- now lives in the reader, which knows the real geometry and simply does
  // not draw the one page that can still grow. What is left here is the rule
  // this function is actually for: never reveal half a sentence.
  it("reveals a settled paragraph without waiting for a page to fill", () => {
    const oneParagraph = "The door was not there yesterday.\n\nShe pushed it";
    expect(revealableChapterProse(oneParagraph)).toBe(
      "The door was not there yesterday.",
    );
  });

  it("never reveals the paragraph still being written", () => {
    const midSentence = "Settled paragraph.\n\nShe pushed it open and the hinges";
    const revealed = revealableChapterProse(midSentence);
    expect(revealed).toBe("Settled paragraph.");
    expect(revealed).not.toContain("hinges");
  });

  it("treats malformed and empty input as nothing to show", () => {
    expect(revealableChapterProse("")).toBe("");
    expect(revealableChapterProse("\n\n")).toBe("");
    expect(revealableChapterProse("   \n\n   ")).toBe("");
  });
});

/**
 * The single-page case, which the first version of this fix got wrong.
 *
 * The reader draws every page whose end can no longer move, and drops the
 * last one while writing because a trailing remainder gets absorbed into it.
 * The guard for "what if there is only one page" fell through and drew that
 * page -- the very page that can still grow -- so a chapter whose settled
 * prose fits a single page reflowed under the reader.
 *
 * This asserts the rule at the level it can be tested without a viewport:
 * whatever is revealed only ever grows and never rewrites what it showed, so
 * a reader who has seen a prefix keeps seeing exactly that prefix.
 */
it("what has been shown is never rewritten, even one page in", () => {
  const paragraph =
    "She pushed it open and the hinges gave without a sound, which was the "
    + "first thing that felt wrong about it.";
  let previous = "";
  for (let count = 1; count <= 10; count += 1) {
    const raw = Array.from({ length: count }, () => paragraph).join("\n\n")
      + "\n\nand a half-written";
    const revealed = revealableChapterProse(raw);
    if (previous) {
      expect(revealed.startsWith(previous)).toBe(true);
    }
    expect(revealed).not.toContain("half-written");
    previous = revealed;
  }
});
