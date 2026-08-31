import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  isEmptySeriesState,
  mergeSeriesState,
  parseGeneratedStoryText,
  parseSeriesState,
  parseStructuredOutput,
  providedSeriesStateKeys,
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

Deno.test("mergeSeriesState: a partial update never blanks stored continuity", () => {
  const prior = parseSeriesState({
    central_conflict: "keep the lighthouse lit",
    protagonist_want: "prove the light still works",
    relationship_state: "wary of the inspector",
    open_hooks: ["who sent the letter?"],
    world_facts: ["the lamp runs on whale oil"],
    next_chapter_pressure: "the inspector arrives at dawn",
  });
  // A finale that fills resolutions but leaves the conflict blank.
  const partial = parseSeriesState({
    resolved_hooks: ["the letter was from the keeper's brother"],
    character_changes: ["the keeper forgave him"],
    next_chapter_pressure: "",
  });
  const merged = mergeSeriesState(prior, partial);

  assertEquals(merged.central_conflict, "keep the lighthouse lit");
  assertEquals(merged.protagonist_want, "prove the light still works");
  assertEquals(merged.world_facts, ["the lamp runs on whale oil"]);
  assertEquals(merged.resolved_hooks, [
    "the letter was from the keeper's brother",
  ]);
  assertEquals(merged.character_changes, ["the keeper forgave him"]);
  // Pressure is not carried over: a finale clears it deliberately.
  assertEquals(merged.next_chapter_pressure, "");
});

Deno.test("mergeSeriesState: a full update wins over stored values", () => {
  const prior = parseSeriesState({
    central_conflict: "old",
    open_hooks: ["old hook"],
  });
  const next = parseSeriesState({
    central_conflict: "new",
    open_hooks: ["new hook"],
  });
  const merged = mergeSeriesState(prior, next);
  assertEquals(merged.central_conflict, "new");
  assertEquals(merged.open_hooks, ["new hook"]);
});

Deno.test("mergeSeriesState: an explicitly emptied open_hooks clears", () => {
  const prior = parseSeriesState({
    open_hooks: ["who sent it?"],
    central_conflict: "the letter",
  });
  const next = parseSeriesState({
    open_hooks: [],
    resolved_hooks: ["the brother sent it"],
  });
  const merged = mergeSeriesState(
    prior,
    next,
    new Set(["open_hooks", "resolved_hooks"]),
  );
  // A finale that resolves everything must be able to empty the live set.
  assertEquals(merged.open_hooks, []);
  assertEquals(merged.resolved_hooks, ["the brother sent it"]);
  assertEquals(merged.central_conflict, "the letter");
});

Deno.test("mergeSeriesState: an omitted open_hooks keeps the prior list", () => {
  const prior = parseSeriesState({ open_hooks: ["who sent it?"] });
  const next = parseSeriesState({ resolved_hooks: ["something else"] });
  const merged = mergeSeriesState(prior, next, new Set(["resolved_hooks"]));
  assertEquals(merged.open_hooks, ["who sent it?"]);
});

Deno.test("mergeSeriesState: history accumulates instead of replacing", () => {
  const prior = parseSeriesState({
    world_facts: ["the valley shifts at night"],
    character_changes: ["Lira doubts her instruments"],
  });
  const next = parseSeriesState({
    world_facts: ["the compass spins near the ridge"],
    character_changes: ["Lira trusts Ovin"],
  });
  const merged = mergeSeriesState(
    prior,
    next,
    new Set(["world_facts", "character_changes"]),
  );
  assertEquals(merged.world_facts, [
    "the valley shifts at night",
    "the compass spins near the ridge",
  ]);
  assertEquals(merged.character_changes, [
    "Lira doubts her instruments",
    "Lira trusts Ovin",
  ]);
});

Deno.test("providedSeriesStateKeys: reports which keys the model sent", () => {
  assertEquals(
    providedSeriesStateKeys({ open_hooks: [], world_facts: ["x"] }).has(
      "open_hooks",
    ),
    true,
  );
  assertEquals(
    providedSeriesStateKeys({ world_facts: ["x"] }).has("open_hooks"),
    false,
  );
  assertEquals(providedSeriesStateKeys(null).size, 0);
  assertEquals(providedSeriesStateKeys([1, 2]).size, 0);
});

Deno.test("parseStructuredOutput: flags whether the structured parse succeeded", () => {
  const good = parseStructuredOutput(
    JSON.stringify({ chapter_body: "A line.", hook_type: "decision" }),
    "Untitled",
  );
  assertEquals(good.structured, true);
  assertEquals(good.hook_type, "decision");

  // Valid JSON, wrong shape: chapter_body is not a string. This is the case a
  // live run hit - the text fallback then supplies placeholder hook_type
  // "none" and an empty series_state, which must not be mistaken for output.
  const wrongShape = parseStructuredOutput(
    JSON.stringify({ chapter: { body: "A line." } }),
    "Untitled",
  );
  assertEquals(wrongShape.structured, false);
  assertEquals(wrongShape.hook_type, "none");

  const notJson = parseStructuredOutput(
    "Just prose, no JSON at all.",
    "Untitled",
  );
  assertEquals(notJson.structured, false);
});
