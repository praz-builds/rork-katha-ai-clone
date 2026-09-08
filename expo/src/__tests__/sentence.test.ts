import { cleanWord, sentenceAroundWord, splitWords } from "@/lib/sentence";

describe("sentenceAroundWord", () => {
  const words = "The old lighthouse stood alone. Waves crashed against the rocks below. Nobody came anymore.".split(" ");
  // ["The","old","lighthouse","stood","alone.","Waves","crashed","against","the","rocks","below.","Nobody","came","anymore."]

  it("returns the sentence containing the tapped word", () => {
    const range = sentenceAroundWord(words, 2); // "lighthouse"
    expect(range.text).toBe("The old lighthouse stood alone.");
  });

  it("returns a different sentence for a word further along", () => {
    const range = sentenceAroundWord(words, 6); // "crashed"
    expect(range.text).toBe("Waves crashed against the rocks below.");
  });

  it("handles the final sentence, with no trailing period boundary after it", () => {
    const range = sentenceAroundWord(words, words.length - 1); // "anymore."
    expect(range.text).toBe("Nobody came anymore.");
  });

  it("falls back to the single word when there are no other words", () => {
    const range = sentenceAroundWord(["Alone."], 0);
    expect(range.text).toBe("Alone.");
  });

  it("returns an empty range for an empty word list rather than throwing", () => {
    expect(sentenceAroundWord([], 0)).toEqual({ start: 0, end: 0, text: "" });
  });

  it("clamps an out-of-range index instead of throwing", () => {
    const range = sentenceAroundWord(words, 999);
    expect(range.text).toBe("Nobody came anymore.");
  });
});

describe("cleanWord", () => {
  it("strips trailing sentence punctuation", () => {
    expect(cleanWord("lighthouse.")).toBe("lighthouse");
    expect(cleanWord("alone?")).toBe("alone");
    expect(cleanWord("crashed!")).toBe("crashed");
  });

  it("strips leading and trailing quotes", () => {
    expect(cleanWord('"hello,"')).toBe("hello");
  });

  it("leaves an internal apostrophe alone", () => {
    expect(cleanWord("Nobody's")).toBe("Nobody's");
  });

  it("returns an empty string for punctuation-only tokens", () => {
    expect(cleanWord("--")).toBe("");
  });
});

// A sentence must not be truncated at a page break.
//
// `renderWord` used to hand phrase capture a PAGE-local index, and the capture
// layer accumulated only the words it had seen rendered. So a sentence running
// across a page boundary was cut at the boundary: long-pressing near the foot of
// a page returned the half that happened to be on screen.
//
// The tokens are now the chapter's, and the index is chapter-absolute.
describe("a sentence spanning a page break", () => {
  const chapter =
    "The ladder creaked under his feet. He climbed toward the attic where the trunk had waited for thirty years. Aaji called from below.";

  it("returns the whole sentence, not the part on one page", () => {
    const words = splitWords(chapter);
    // "toward" sits in the middle of the second sentence, which a page break
    // could easily fall inside.
    const at = words.findIndex((word) => word === "toward");
    expect(at).toBeGreaterThan(0);

    const sentence = sentenceAroundWord(words, at).text;
    expect(sentence).toBe(
      "He climbed toward the attic where the trunk had waited for thirty years.",
    );
  });

  it("splitWords tokenises the way the reader renders", () => {
    expect(splitWords("One  two\n\nthree.")).toEqual(["One", "two", "three."]);
    expect(splitWords("   ")).toEqual([]);
  });

  it("still resolves a sentence at the very start and end of a chapter", () => {
    const words = splitWords(chapter);
    expect(sentenceAroundWord(words, 0).text).toBe(
      "The ladder creaked under his feet.",
    );
    expect(sentenceAroundWord(words, words.length - 1).text).toBe(
      "Aaji called from below.",
    );
  });
});
