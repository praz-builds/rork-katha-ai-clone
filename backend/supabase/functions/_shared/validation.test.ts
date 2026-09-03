import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  deriveContentRating,
  validateGenerationRequest,
} from "./validation.ts";

// Helper to build a valid base request
function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    primary_genre: "romance",
    topic:
      "A lighthouse keeper receives a letter from the future warning of a storm",
    request_id: "test-request-123",
    ...overrides,
  };
}

Deno.test("valid adult romance request passes", () => {
  const result = validateGenerationRequest(validRequest());
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "romance");
  assertEquals(result.storyMode, "standalone");
  assertEquals(result.audienceMode, "adult");
  assertEquals(result.spiceLevel, "steamy"); // romance defaults to steamy
});

Deno.test("is_series maps to series story mode", () => {
  const result = validateGenerationRequest(validRequest({ is_series: true }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.storyMode, "series");
});

Deno.test("story_mode accepts explicit series value", () => {
  const result = validateGenerationRequest(
    validRequest({ story_mode: "series" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.storyMode, "series");
});

Deno.test("invalid story_mode rejected", () => {
  const result = validateGenerationRequest(
    validRequest({ story_mode: "serial" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "story_mode must be 'standalone' or 'series'");
});

Deno.test("darkRomance rejected in kids mode", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance", audience_mode: "kids" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "Dark Romance is not available in kids mode");
});

Deno.test("explicit spice rejected (MVP gate)", () => {
  const result = validateGenerationRequest(
    validRequest({ spice_level: "explicit" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "Explicit content is not available yet");
});

Deno.test("poetry allows only sweet", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "poetry", spice_level: "steamy" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet"); // clamped to default
});

Deno.test("darkRomance defaults to steamy", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "steamy");
});

Deno.test("darkRomance with sweet spice stays sweet (not escalated)", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance", spice_level: "sweet" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("old genre 'drama' maps to contemporary", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "drama" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "contemporary");
});

Deno.test("backward compat: genre array extracts first element", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: undefined, genre: ["fantasy"] }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "fantasy");
});

Deno.test("trope 'werewolf' rejected for mystery", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "mystery",
      trope_modules: ["werewolf"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.tropeModules.length, 0);
});

Deno.test("trope 'lockedRoom' accepted for mystery", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "mystery",
      trope_modules: ["lockedRoom"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.tropeModules, ["lockedRoom"]);
});

Deno.test("kids mode strips identity lenses", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "adventure",
      audience_mode: "kids",
      identity_lenses: ["queer"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.identityLenses.length, 0);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("deriveContentRating: kids -> kids", () => {
  assertEquals(deriveContentRating("kids", "sweet"), "kids");
});

Deno.test("deriveContentRating: steamy -> steamy", () => {
  assertEquals(deriveContentRating("adult", "steamy"), "steamy");
});

Deno.test("deriveContentRating: sweet -> sweet", () => {
  assertEquals(deriveContentRating("adult", "sweet"), "sweet");
});

Deno.test("the 40-character seed gate is gone: one character is enough", () => {
  const result = validateGenerationRequest(validRequest({ topic: "a" }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.seed, "a");
});

Deno.test("an empty or whitespace-only seed is still rejected", () => {
  for (const topic of ["", "   ", "\n\t"]) {
    const result = validateGenerationRequest(validRequest({ topic }));
    assertEquals("error" in result, true, `accepted ${JSON.stringify(topic)}`);
  }
});

Deno.test("unknown genre maps to contemporary", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "nonExistentGenre" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "contemporary");
});

Deno.test("case-insensitive genre match", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "FANTASY" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "fantasy");
});

// ---------------------------------------------------------------------------
// The brief — story shape, moments, values, craft fields
// ---------------------------------------------------------------------------

Deno.test("cast cap is 3, not 10", () => {
  const cast = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Character ${i + 1}` }));

  const ok = validateGenerationRequest(validRequest({ characters: cast(3) }));
  if ("error" in ok) throw new Error(ok.error);
  assertEquals(ok.characters.length, 3);

  const tooMany = validateGenerationRequest(
    validRequest({ characters: cast(4) }),
  );
  assertEquals("error" in tooMany, true);
});

Deno.test("planned_chapter_count accepts only 3, 7, 15", () => {
  for (const n of [3, 7, 15]) {
    const r = validateGenerationRequest(
      validRequest({ planned_chapter_count: n }),
    );
    if ("error" in r) throw new Error(`${n} rejected: ${r.error}`);
    assertEquals(r.plannedChapterCount, n);
  }
  for (const n of [1, 2, 4, 10, 30, 0, -3, 7.5]) {
    const r = validateGenerationRequest(
      validRequest({ planned_chapter_count: n }),
    );
    assertEquals("error" in r, true, `${n} was accepted`);
  }
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.plannedChapterCount, 3);
});

Deno.test("chapter_length validates and defaults to standard", () => {
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.chapterLength, "standard");

  const long = validateGenerationRequest(
    validRequest({ chapter_length: "long" }),
  );
  if ("error" in long) throw new Error(long.error);
  assertEquals(long.chapterLength, "long");

  assertEquals(
    "error" in validateGenerationRequest(
      validRequest({ chapter_length: "epic" }),
    ),
    true,
  );
});

Deno.test("moments are clamped at 5, not rejected", () => {
  const r = validateGenerationRequest(
    validRequest({
      moments: ["a", "b", "c", "d", "e", "f", "g", "", "   ", 42],
    }),
  );
  if ("error" in r) throw new Error(r.error);
  assertEquals(r.moments, ["a", "b", "c", "d", "e"]);
});

Deno.test("values are kids-only", () => {
  const kids = validateGenerationRequest(
    validRequest({
      primary_genre: "adventure",
      audience_mode: "kids",
      story_values: ["kindness", "courage"],
    }),
  );
  if ("error" in kids) throw new Error(kids.error);
  assertEquals(kids.storyValues, ["kindness", "courage"]);

  const adult = validateGenerationRequest(
    validRequest({ story_values: ["kindness"] }),
  );
  if ("error" in adult) throw new Error(adult.error);
  assertEquals(adult.storyValues, []);
});

Deno.test("illustrate_chapters defaults off and requires a literal true", () => {
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.illustrateChapters, false);

  for (const v of ["true", 1, {}, null]) {
    const r = validateGenerationRequest(
      validRequest({ illustrate_chapters: v }),
    );
    if ("error" in r) throw new Error(r.error);
    assertEquals(
      r.illustrateChapters,
      false,
      `${JSON.stringify(v)} enabled it`,
    );
  }

  const on = validateGenerationRequest(
    validRequest({ illustrate_chapters: true }),
  );
  if ("error" in on) throw new Error(on.error);
  assertEquals(on.illustrateChapters, true);
});

Deno.test("brief free-text fields are bounded", () => {
  const long = "x".repeat(301);
  for (const field of ["where_and_when", "avoid", "writing_style"]) {
    const r = validateGenerationRequest(validRequest({ [field]: long }));
    assertEquals("error" in r, true, `${field} accepted 301 chars`);
  }
  // The accept side of the boundary. Without it, flipping `>` to `>=` in
  // optionalText would still pass this test.
  const atLimit = "x".repeat(300);
  for (const field of ["where_and_when", "avoid"]) {
    const r = validateGenerationRequest(validRequest({ [field]: atLimit }));
    if ("error" in r) {
      throw new Error(`${field} rejected exactly 300: ${r.error}`);
    }
  }

  const ok = validateGenerationRequest(
    validRequest({ where_and_when: "A hill town, off-season, present day" }),
  );
  if ("error" in ok) throw new Error(ok.error);
  assertEquals(ok.whereAndWhen, "A hill town, off-season, present day");
});

Deno.test("writing style keeps the craft and drops the author", () => {
  // [input, exact expected output]
  const cases: [string, string | undefined][] = [
    // Plain craft direction is untouched.
    ["poetic, short sentences", "poetic, short sentences"],
    // An imitation request is removed; anything else the user said survives.
    ["like Colleen Hoover", undefined],
    ["hardboiled, like Raymond Chandler", "hardboiled"],
    ["written by Stephen King", undefined],
    // Non-ASCII names. An ASCII-only pattern stopped at the accent and leaked
    // the rest of the name.
    ["like Gabriel Garc\u00eda M\u00e1rquez", undefined],
    ["lyrical, in the style of Ng\u0169g\u0129 wa Thiong'o", "lyrical"],
    // Initials. An earlier pattern required two characters and stopped at
    // "Ursula", leaking "K Le Guin".
    ["in the style of Ursula K Le Guin, but funnier", "but funnier"],
    ["like J. R. R. Tolkien", undefined],
    // Uncased scripts have no uppercase, so a \p{Lu}-only pattern never matched
    // them and the name passed straight through.
    ["in the style of \u6751\u4e0a\u6625\u6a39", undefined],
    [
      "dreamlike, like \u6751\u4e0a\u6625\u6a39, in short scenes",
      "dreamlike, in short scenes",
    ],
    // Lowercase prose after a trigger is NOT a name. A single case-insensitive
    // regex made \p{Lu} match lowercase, and these were gutted.
    ["like the sea at dusk", "like the sea at dusk"],
    [
      "reads like a diary, short sentences",
      "reads like a diary, short sentences",
    ],
    ["Like a folk tale told badly", "Like a folk tale told badly"],
  ];

  for (const [input, expected] of cases) {
    const result = validateGenerationRequest(
      validRequest({ writing_style: input }),
    );
    if ("error" in result) throw new Error(result.error);
    assertEquals(
      result.writingStyle,
      expected,
      `"${input}" produced ${JSON.stringify(result.writingStyle)}`,
    );
  }
});
