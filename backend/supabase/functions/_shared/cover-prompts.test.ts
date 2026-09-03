import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildCoverPrompt } from "./cover-prompts.ts";

/**
 * The cover prompt is the one prompt in the system with no schema, no parser
 * and no retry that can tell it went wrong: a bad string produces a plausible
 * image of the wrong thing, and nothing downstream notices. So the invariants
 * worth pinning are the ones about what must *not* appear in it.
 */

Deno.test("a story with no characters gets a well-formed genre cover", () => {
  const prompt = buildCoverPrompt("mystery", "The Empty House", []);
  assert(prompt.includes("Book cover illustration for a mystery story."));
  assert(prompt.includes('Inspired by the story "The Empty House"'));
  assert(!prompt.includes("undefined"));
  assert(!prompt.includes("Feature a character"));
  assert(!prompt.includes("silhouetted figure"));
});

// The Craft character sheet requires only a Name (§4), so a name-only character
// is a shape the product produces, not a malformed input. It used to reach the
// prompt as "a distant silhouetted figure suggesting undefined".
Deno.test("a name-only character never reaches the prompt as 'undefined'", () => {
  const prompt = buildCoverPrompt("mystery", "The Empty House", [], [
    { name: "Elena" },
  ]);
  assert(!prompt.includes("undefined"));
  assert(!prompt.includes("silhouetted figure suggesting ."));
});

Deno.test("a described character is preferred over a name-only one", () => {
  const prompt = buildCoverPrompt("mystery", "The Empty House", [], [
    { name: "Blank" },
    { name: "Elena", description: "a historical restorer, 34" },
  ]);
  assert(prompt.includes("a historical restorer, 34"));
});

Deno.test("a blank description is treated as no description", () => {
  for (const description of ["", "   ", "\n"]) {
    const prompt = buildCoverPrompt("mystery", "The Empty House", [], [
      { name: "Elena", description },
    ]);
    assert(!prompt.includes("silhouetted figure"), JSON.stringify(description));
    assert(
      !prompt.includes("Feature a character"),
      JSON.stringify(description),
    );
    assert(!prompt.includes("undefined"), JSON.stringify(description));
  }
});

// Decision 53 — this is what stops every mystery cover being the same doorway.
Deno.test("where-and-when reaches the scene line", () => {
  const prompt = buildCoverPrompt(
    "mystery",
    "The Empty House",
    ["grief"],
    undefined,
    "A hill town, off-season, present day",
  );
  assert(prompt.includes("set in A hill town, off-season, present day"));
});

Deno.test("an absent or blank where-and-when adds nothing", () => {
  for (const value of [undefined, "", "   "]) {
    const prompt = buildCoverPrompt("mystery", "T", [], undefined, value);
    assert(!prompt.includes("set in"));
  }
});

Deno.test("every prompt forbids text in the image", () => {
  // Titles are composited programmatically; a model that renders its own
  // lettering produces a cover that cannot be reused at three display sizes.
  for (const genre of ["mystery", "romance", "horror", "poetry", "nonsense"]) {
    const prompt = buildCoverPrompt(genre, "T", ["a"]);
    assert(prompt.includes("NO text"), genre);
    assert(prompt.includes("centered composition"), genre);
  }
});

Deno.test("an unknown genre falls back to contemporary, not to a broken prompt", () => {
  const prompt = buildCoverPrompt("nonExistentGenre", "T", []);
  assert(prompt.includes("Book cover illustration for a contemporary story."));
  assert(!prompt.includes("undefined"));
});

Deno.test("themes are capped at four", () => {
  const prompt = buildCoverPrompt("mystery", "T", [
    "one",
    "two",
    "three",
    "four",
    "five",
  ]);
  assert(prompt.includes("one, two, three, four"));
  assert(!prompt.includes("five"));
});

Deno.test("the hero is preferred over the first described character", () => {
  const prompt = buildCoverPrompt("romance", "T", [], [
    { name: "Sidekick", description: "a nervous archivist" },
    // deno-lint-ignore no-explicit-any
    { name: "Hero", description: "a lighthouse keeper", isHero: true } as any,
  ]);
  assert(prompt.includes("a lighthouse keeper"));
  assertEquals(prompt.includes("a nervous archivist"), false);
});

// `media.ts` reads `is_hero` from the database and maps it to `isHero`. If any
// layer between there and here drops it, the cover silently features whoever
// happens to be listed first instead of the story's protagonist — a failure
// with no error and no log.
// Named for what it exercises: `buildCoverPrompt` honouring `isHero`. The path
// from the database through `media.ts` and `image.ts` is covered separately —
// this asserts the contract at the end of it, which is where the regression
// (isHero silently dropped while rebuilding the character objects) surfaced.
Deno.test("buildCoverPrompt selects the hero over the first described character", () => {
  const prompt = buildCoverPrompt("romance", "T", [], [
    { name: "Sidekick", description: "a nervous archivist" },
    { name: "Hero", description: "a lighthouse keeper", isHero: true },
  ]);
  assert(prompt.includes("a lighthouse keeper"));
  assert(!prompt.includes("a nervous archivist"));
});
