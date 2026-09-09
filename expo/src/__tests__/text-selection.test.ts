/**
 * The arithmetic behind long-press-and-drag selection.
 *
 * The gesture itself cannot be judged from a test -- feel, velocity and haptic
 * timing need a device. What CAN be pinned is the part that decides which words
 * end up selected, and that is the part a reader will notice going wrong.
 */

import {
  isWordInRange,
  LINE_STEP_PX,
  rangeFromAnchor,
  rangeLength,
  textForRange,
  WORD_STEP_PX,
  WORDS_PER_LINE,
  wordStepsForDrag,
} from "@/lib/text-selection";

const WORDS = ["The", "lighthouse", "stood", "alone", "on", "the", "point."];

describe("wordStepsForDrag", () => {
  it("does not move at all until the finger has travelled", () => {
    expect(wordStepsForDrag(0, 0)).toBe(0);
    // Under half a word's travel is still the same word: a resting thumb must
    // not tick.
    expect(wordStepsForDrag(WORD_STEP_PX * 0.4, 0)).toBe(0);
  });

  it("moves one word per word of horizontal travel", () => {
    expect(wordStepsForDrag(WORD_STEP_PX, 0)).toBe(1);
    expect(wordStepsForDrag(WORD_STEP_PX * 3, 0)).toBe(3);
  });

  it("moves backwards when the finger does", () => {
    expect(wordStepsForDrag(-WORD_STEP_PX * 2, 0)).toBe(-2);
  });

  it("moves a line's worth of words per line of vertical travel", () => {
    expect(wordStepsForDrag(0, LINE_STEP_PX)).toBe(WORDS_PER_LINE);
    expect(wordStepsForDrag(0, -LINE_STEP_PX)).toBe(-WORDS_PER_LINE);
  });

  it("adds the two axes, because a drag through prose does both", () => {
    expect(wordStepsForDrag(WORD_STEP_PX * 2, LINE_STEP_PX)).toBe(WORDS_PER_LINE + 2);
  });
});

describe("rangeFromAnchor", () => {
  it("selects the anchor alone at zero travel", () => {
    expect(rangeFromAnchor(3, 0, WORDS.length)).toEqual({ start: 3, end: 3 });
  });

  it("grows forward from the anchor", () => {
    expect(rangeFromAnchor(1, 3, WORDS.length)).toEqual({ start: 1, end: 4 });
  });

  it("grows backward from the anchor, keeping start before end", () => {
    expect(rangeFromAnchor(4, -3, WORDS.length)).toEqual({ start: 1, end: 4 });
  });

  it("stops at both ends of the chapter rather than running off it", () => {
    expect(rangeFromAnchor(5, 999, WORDS.length)).toEqual({ start: 5, end: 6 });
    expect(rangeFromAnchor(2, -999, WORDS.length)).toEqual({ start: 0, end: 2 });
  });

  it("survives an empty chapter and an anchor past the end", () => {
    expect(rangeFromAnchor(0, 4, 0)).toEqual({ start: 0, end: 0 });
    expect(rangeFromAnchor(99, 0, WORDS.length)).toEqual({ start: 6, end: 6 });
  });
});

describe("reading the range back", () => {
  it("joins the selected words the way they read", () => {
    expect(textForRange(WORDS, { start: 1, end: 3 })).toBe("lighthouse stood alone");
  });

  it("is empty with no selection", () => {
    expect(textForRange(WORDS, null)).toBe("");
    expect(rangeLength(null)).toBe(0);
  });

  it("counts both ends of the range", () => {
    expect(rangeLength({ start: 1, end: 3 })).toBe(3);
    expect(rangeLength({ start: 2, end: 2 })).toBe(1);
  });

  it("lights every word between the ends and none outside them", () => {
    const range = { start: 2, end: 4 };
    expect([0, 1, 2, 3, 4, 5].map((i) => isWordInRange(i, range)))
      .toEqual([false, false, true, true, true, false]);
    expect(isWordInRange(3, null)).toBe(false);
  });
});
