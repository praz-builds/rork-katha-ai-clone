import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStoryDonePayload,
  DONE_PAYLOAD_LOCATIONS,
  storySchemaFields,
  STREAMED_STORY_FIELDS,
} from "./generation-done.ts";
import { EMPTY_SERIES_STATE } from "./types.ts";

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}

const OUTPUT = {
  title: "Kismat Cafe Reunion",
  chapter_title: "The Corner Table",
  chapter_body: "The bell over the door still sounded wrong.\n\nAarav came in.",
  word_count: 12,
  themes: ["memory", "return"],
  first_line: "The bell over the door still sounded wrong.",
  previously_summary: "Aarav returns to the cafe.",
  series_state: {
    ...EMPTY_SERIES_STATE,
    open_hooks: ["Why is memory chai on the menu"],
    next_chapter_pressure: "Maya has to explain the menu",
  },
  hook_type: "unanswered_question" as const,
  hook_text: "The last line had not been there seven years ago.",
};

function build(storyMode: "series" | "standalone" = "series") {
  return buildStoryDonePayload({
    story: { id: "s1", author_id: "u1", genre: ["romance"] },
    chapter: {
      id: "c1",
      title: OUTPUT.chapter_title,
      content: OUTPUT.chapter_body,
      word_count: 12,
      hook_type: OUTPUT.hook_type,
      hook_text: OUTPUT.hook_text,
      first_line: OUTPUT.first_line,
    },
    output: OUTPUT,
    storyMode,
    primaryGenre: "romance",
    contentRating: "sweet",
    coverStatus: "generating",
    words: 12,
    beats: ["Aarav returns", "Maya explains"],
    balance: 4,
    model: "meta/muse-spark-1.3",
    timings: { total: 100 },
    visibility: { requested: "public", applied: "public", reason: null },
  });
}

Deno.test("every schema field has a home in the done payload, and the map has no strays", () => {
  const fields = storySchemaFields();
  for (const field of fields) {
    assert(
      field in DONE_PAYLOAD_LOCATIONS,
      `schema field ${field} has no location in the done payload`,
    );
  }
  for (const key of Object.keys(DONE_PAYLOAD_LOCATIONS)) {
    assert(fields.includes(key), `${key} is mapped but not in the schema`);
  }
  for (const streamed of STREAMED_STORY_FIELDS) {
    assert(fields.includes(streamed));
  }
});

Deno.test("the built payload carries a value at every mapped location", () => {
  const payload = build();
  for (const [field, path] of Object.entries(DONE_PAYLOAD_LOCATIONS)) {
    const value = readPath(payload, path);
    assert(
      value !== undefined && value !== null,
      `${field} expected at ${path} but found ${String(value)}`,
    );
  }
  assertEquals(payload.story.beats, ["Aarav returns", "Maya explains"]);
  assertEquals(payload.story.themes, ["memory", "return"]);
  assertEquals(payload.story.series_state.open_hooks, [
    "Why is memory chai on the menu",
  ]);
  assertEquals(payload.story.is_public, true);
  assertEquals(payload.visibility.applied, "public");
});

Deno.test("a standalone story carries an empty series state, not the model's", () => {
  const payload = build("standalone");
  assertEquals(payload.story.series_state, EMPTY_SERIES_STATE);
  assertEquals(payload.story.story_mode, "standalone");
});
