import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  isEmptySeriesState,
  parseGeneratedStoryText,
  parseSeriesState,
  parseStructuredOutput,
} from "./story_text.ts";
import { EMPTY_SERIES_STATE } from "./types.ts";

Deno.test("parseStructuredOutput: valid JSON parses correctly", () => {
  const json = JSON.stringify({
    title: "The Storm",
    chapter_title: "Chapter 1",
    chapter_body:
      "The rain began at noon.\n\nBy three, the streets were rivers.",
    word_count: 12,
    themes: ["weather", "change"],
    first_line: "The rain began at noon.",
    previously_summary: "A storm approaches the coastal town.",
    series_state: {
      central_conflict: "The town must survive the unnatural storm.",
      protagonist_want: "Nia wants to reach the lighthouse.",
      relationship_state: "Nia and Omar are wary allies.",
      open_hooks: ["Who lit the lighthouse before dawn?"],
      resolved_hooks: [],
      promised_payoffs: ["The lighthouse signal will be explained."],
      world_facts: ["The tide moves inland at noon."],
      character_changes: ["Nia chooses to leave shelter."],
      next_chapter_pressure: "The bridge disappears under water.",
    },
    hook_type: "revelation",
    hook_text: "The lighthouse light turns red.",
  });
  const result = parseStructuredOutput(json, "Fallback");
  assertEquals(result.title, "The Storm");
  assertEquals(result.chapter_title, "Chapter 1");
  assertEquals(
    result.chapter_body,
    "The rain began at noon.\n\nBy three, the streets were rivers.",
  );
  assertEquals(result.themes, ["weather", "change"]);
  assertEquals(result.first_line, "The rain began at noon.");
  assertEquals(result.series_state.open_hooks, [
    "Who lit the lighthouse before dawn?",
  ]);
  assertEquals(result.hook_type, "revelation");
  assertEquals(result.hook_text, "The lighthouse light turns red.");
});

Deno.test("parseStructuredOutput: JSON in code fences parses", () => {
  const fenced = "```json\n" + JSON.stringify({
    title: "Fenced Story",
    chapter_title: "Ch 1",
    chapter_body: "Hello world.",
    word_count: 2,
    themes: [],
    first_line: "Hello world.",
    previously_summary: "",
  }) + "\n```";
  const result = parseStructuredOutput(fenced, "Fallback");
  assertEquals(result.title, "Fenced Story");
  assertEquals(result.chapter_body, "Hello world.");
});

Deno.test("parseStructuredOutput: plain text falls back", () => {
  const text =
    "My Great Story\n\nOnce upon a time, there was a castle.\n\nThe end.";
  const result = parseStructuredOutput(text, "Fallback Title");
  assertEquals(result.title, "My Great Story");
  assertEquals(
    result.chapter_body,
    "Once upon a time, there was a castle.\n\nThe end.",
  );
  assertEquals(result.chapter_title, "Chapter 1");
});

Deno.test("parseStructuredOutput: missing chapter_body falls back", () => {
  const json = JSON.stringify({ title: "No Body", themes: ["test"] });
  const result = parseStructuredOutput(json, "Fallback");
  // Should fall back to text parser since chapter_body is missing
  assertEquals(result.chapter_title, "Chapter 1");
});

Deno.test("parseStructuredOutput: invalid JSON falls back", () => {
  const broken = '{"title": "Broken", chapter_body: }';
  const result = parseStructuredOutput(broken, "Fallback");
  assertEquals(result.chapter_title, "Chapter 1");
});

Deno.test("parseGeneratedStoryText: basic title + content split", () => {
  const text = "The Title\n\nFirst paragraph.\n\nSecond paragraph.";
  const result = parseGeneratedStoryText(text, "Fallback");
  assertEquals(result.title, "The Title");
  assertEquals(result.content, "First paragraph.\n\nSecond paragraph.");
});

Deno.test("parseGeneratedStoryText: markdown heading stripped", () => {
  const text = "# Heading Title\n\nContent here.";
  const result = parseGeneratedStoryText(text, "Fallback");
  assertEquals(result.title, "Heading Title");
});

Deno.test("parseGeneratedStoryText: empty text returns fallback", () => {
  const result = parseGeneratedStoryText("", "My Fallback");
  assertEquals(result.title, "My Fallback");
  assertEquals(result.content, "");
});

// ---------------------------------------------------------------------------
// Shared SeriesState normalizer
// ---------------------------------------------------------------------------

Deno.test("parseSeriesState: non-objects fall back to the empty state", () => {
  assertEquals(parseSeriesState(null), EMPTY_SERIES_STATE);
  assertEquals(parseSeriesState("nope"), EMPTY_SERIES_STATE);
  assertEquals(parseSeriesState(42), EMPTY_SERIES_STATE);
  assertEquals(parseSeriesState([1, 2, 3]), EMPTY_SERIES_STATE);
});

Deno.test("parseSeriesState: trims, filters, and bounds every field", () => {
  const state = parseSeriesState({
    central_conflict: "  a rival claims the throne  ",
    protagonist_want: "x".repeat(600),
    relationship_state: 17,
    open_hooks: ["  first  ", "", 5, "second"],
    resolved_hooks: Array.from({ length: 20 }, (_, i) => `hook ${i}`),
    world_facts: "not a list",
    next_chapter_pressure: "the council meets at dawn",
  });

  assertEquals(state.central_conflict, "a rival claims the throne");
  assertEquals(state.protagonist_want.length, 500);
  assertEquals(state.relationship_state, "");
  assertEquals(state.open_hooks, ["first", "second"]);
  assertEquals(state.resolved_hooks.length, 12);
  assertEquals(state.world_facts, []);
  assertEquals(state.next_chapter_pressure, "the council meets at dawn");
});

Deno.test("parseSeriesState: one contract for stored and generated state", () => {
  // The value the continuation flow reads back from the database and the value
  // parsed out of model output must normalize identically.
  const raw = {
    central_conflict: " keep the lighthouse lit ",
    open_hooks: [" the keeper's letter "],
  };
  const fromDatabase = parseSeriesState(raw);
  const fromModel = parseStructuredOutput(
    JSON.stringify({ chapter_body: "body", series_state: raw }),
    "Untitled",
  ).series_state;
  assertEquals(fromDatabase, fromModel);
});

Deno.test("isEmptySeriesState: detects states with no continuity", () => {
  assertEquals(isEmptySeriesState(EMPTY_SERIES_STATE), true);
  assertEquals(isEmptySeriesState(null), true);
  assertEquals(isEmptySeriesState(parseSeriesState({})), true);
  assertEquals(
    isEmptySeriesState(parseSeriesState({ central_conflict: "a duel" })),
    false,
  );
  assertEquals(
    isEmptySeriesState(parseSeriesState({ open_hooks: ["who sent it?"] })),
    false,
  );
});
