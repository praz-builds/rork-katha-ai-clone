import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  chooseDistinctChapterTitle,
  isDuplicateChapterTitle,
  normalizeChapterTitle,
  titleFromLine,
} from "./chapter-titles.ts";

// The cases are the ones the 2026-09-18 review found in auto-run series:
// "The Spare Keys" twice, three chapters called "The Urdu Newspaper".

Deno.test("normalisation ignores case, punctuation, a leading article and plurals", () => {
  assertEquals(normalizeChapterTitle("The Spare Keys"), "spare key");
  assertEquals(normalizeChapterTitle("spare key."), "spare key");
  assertEquals(normalizeChapterTitle("A Glass of Water"), "glass of water");
  // "Glass" keeps its double s.
  assertEquals(normalizeChapterTitle("Glass"), "glass");
});

Deno.test("same and near-same titles are duplicates", () => {
  assert(isDuplicateChapterTitle("The Spare Keys", ["The Spare Keys"]));
  assert(isDuplicateChapterTitle("Spare Key", ["The Spare Keys"]));
  assert(isDuplicateChapterTitle("The Urdu Newspaper", ["Urdu Newspaper"]));
  assert(
    isDuplicateChapterTitle("The Urdu Newspaper Again", ["The Urdu Newspaper"]),
  );
});

Deno.test("titles that merely share a word are distinct", () => {
  assert(!isDuplicateChapterTitle("Keys", ["The Spare Keys"]));
  assert(
    !isDuplicateChapterTitle("The Newspaper Stand", ["The Urdu Newspaper"]),
  );
  assert(!isDuplicateChapterTitle("The Blue Kettle", []));
});

Deno.test("a distinct candidate is kept as-is", () => {
  const result = chooseDistinctChapterTitle({
    candidates: ["The Blue Kettle"],
    existingTitles: ["The Spare Keys"],
    chapterNumber: 3,
  });
  assertEquals(result, {
    title: "The Blue Kettle",
    source: "candidate",
    replacedDuplicate: false,
  });
});

Deno.test("a duplicate candidate loses to the next distinct one", () => {
  const result = chooseDistinctChapterTitle({
    candidates: ["The Spare Keys", "The Locksmith's Receipt"],
    existingTitles: ["The Spare Keys"],
    chapterNumber: 3,
  });
  assertEquals(result.title, "The Locksmith's Receipt");
  assertEquals(result.replacedDuplicate, true);
});

Deno.test("with no distinct candidate the title is derived from the hook, deterministically", () => {
  const input = {
    candidates: ["The Urdu Newspaper"],
    existingTitles: ["The Urdu Newspaper", "The Urdu Newspaper"],
    chapterNumber: 4,
    hookText: "Someone had been in the flat while she slept.",
    firstLine: "The kettle was still warm.",
  };
  const result = chooseDistinctChapterTitle(input);
  assertEquals(result.title, "Someone Had Been in the Flat");
  assertEquals(result.source, "derived");
  assertEquals(result.replacedDuplicate, true);
  // The same chapter always gets the same fallback.
  assertEquals(chooseDistinctChapterTitle(input).title, result.title);
});

Deno.test("the derivation falls through to the first line, then to numbering", () => {
  assertEquals(
    chooseDistinctChapterTitle({
      candidates: [],
      existingTitles: [],
      chapterNumber: 2,
      hookText: "",
      firstLine: '"Nobody sells kerosene after dark," said the boy.',
    }).title,
    "Nobody Sells Kerosene After Dark",
  );
  assertEquals(
    chooseDistinctChapterTitle({
      candidates: [],
      existingTitles: [],
      chapterNumber: 6,
    }),
    { title: "Chapter 6", source: "numbered", replacedDuplicate: false },
  );
});

Deno.test("a numbering placeholder and the story's own title are never accepted", () => {
  // `parseStructuredOutput` fills in "Chapter 1" when the model sent nothing.
  const placeholder = chooseDistinctChapterTitle({
    candidates: ["Chapter 1"],
    existingTitles: ["The Spare Keys"],
    chapterNumber: 5,
    firstLine: "Rain found every crack in the roof.",
  });
  assertEquals(placeholder.title, "Rain Found Every Crack");
  const echoed = chooseDistinctChapterTitle({
    candidates: ["The Debt at My Door"],
    existingTitles: [],
    storyTitle: "The Debt at My Door",
    chapterNumber: 2,
    hookText: "The landlord's son was waiting on the stairs.",
  });
  assertEquals(echoed.title, "The Landlord's Son Was Waiting");
});

Deno.test("titleFromLine refuses a line too thin to name anything", () => {
  assertEquals(titleFromLine("No."), null);
  assertEquals(titleFromLine(null), null);
});
