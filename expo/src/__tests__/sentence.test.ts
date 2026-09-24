import { splitWords } from "@/lib/sentence";

describe("splitWords", () => {
  it("tokenises the way the reader renders", () => {
    expect(splitWords("One  two\n\nthree.")).toEqual(["One", "two", "three."]);
    expect(splitWords("   ")).toEqual([]);
  });

  it("keeps attached punctuation on its word", () => {
    expect(splitWords("The ladder creaked. Aaji called.")).toEqual([
      "The",
      "ladder",
      "creaked.",
      "Aaji",
      "called.",
    ]);
  });
});
