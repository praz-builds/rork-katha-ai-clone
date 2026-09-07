import { cleanWord, sentenceAroundWord } from "@/lib/sentence";

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
