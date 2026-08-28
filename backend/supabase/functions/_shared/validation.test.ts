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

Deno.test("seed under 40 chars rejected", () => {
  const result = validateGenerationRequest(
    validRequest({ topic: "Too short seed text." }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "Story seed must be at least 40 characters");
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
