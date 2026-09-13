/**
 * The terminal `done` payload of a first-chapter generation, built once.
 *
 * `generate-story` and `generate-story-stream` answer with the same shape, and
 * the reader depends on it for more than the prose: the chapter-end screen
 * derives its "what happens next" chips from `story.beats`,
 * `story.series_state.open_hooks` / `promised_payoffs` /
 * `next_chapter_pressure` and `chapter.hook_text`. Before this module each
 * handler assembled the object by hand, and the streamed one had quietly
 * stopped carrying `beats` and `themes` - fields that exist on the row and in
 * the schema, and that the client reads - because nothing tied the payload to
 * the schema.
 *
 * `DONE_PAYLOAD_LOCATIONS` is that tie. Every field of
 * `STORY_OUTPUT_JSON_SCHEMA` that the stream does not itself produce must name
 * where it lands in the payload, and the test asserts both that the map is
 * complete against the schema and that the built object actually has a value
 * there. A field added to the schema without an entry here fails the test,
 * which is the point.
 */

import type { VisibilityOutcome } from "./publish.ts";
import { STORY_OUTPUT_JSON_SCHEMA } from "./story_schema.ts";
import type { StoryGenerationOutput, StoryMode } from "./types.ts";
import { EMPTY_SERIES_STATE } from "./types.ts";

/** Fields the stream produces itself; they are not in the metadata call. */
export const STREAMED_STORY_FIELDS: ReadonlySet<string> = new Set([
  "chapter_body",
  "word_count",
]);

/**
 * Where each schema field lives in the `done` payload. `story.*` reads the
 * story object, `chapter.*` the persisted chapter row.
 */
export const DONE_PAYLOAD_LOCATIONS: Readonly<Record<string, string>> = {
  title: "story.title",
  chapter_title: "chapter.title",
  chapter_body: "chapter.content",
  word_count: "chapter.word_count",
  themes: "story.themes",
  first_line: "story.first_line",
  previously_summary: "story.previously_summary",
  series_state: "story.series_state",
  hook_type: "chapter.hook_type",
  hook_text: "chapter.hook_text",
};

export interface StoryDoneInput {
  /** The story row as begun, before completion wrote the title and metadata. */
  story: Record<string, unknown>;
  /** The chapter row `complete_story_generation` returned. */
  chapter: Record<string, unknown>;
  output: StoryGenerationOutput;
  storyMode: StoryMode;
  primaryGenre: string;
  contentRating: string;
  coverStatus: "generating" | "failed";
  words: number;
  beats: readonly string[];
  balance: number;
  model: string;
  timings: Record<string, number>;
  visibility: VisibilityOutcome;
  /**
   * The last chapter an auto story has already paid for, or null.
   *
   * It travels in the payload rather than being left for the client to read
   * back off the row, because the write-ahead starts the moment this lands:
   * a client that had to re-fetch the story first would either wait for a
   * round trip before chapter two or, worse, decide it had no run and fall
   * through to the per-chapter path that buys the chapter a second time.
   *
   * Null means no run was reserved -- an interactive story, or a story
   * written before runs existed. It is NOT the same as a run of zero
   * chapters, which is `from_chapter - 1` and says the balance bought
   * nothing.
   */
  autoRunThroughChapter: number | null;
}

export function buildStoryDonePayload(input: StoryDoneInput) {
  const seriesState = input.storyMode === "series"
    ? input.output.series_state ?? EMPTY_SERIES_STATE
    : EMPTY_SERIES_STATE;
  return {
    story: {
      ...input.story,
      cover_status: input.coverStatus,
      title: input.output.title,
      word_count: input.words,
      status: "complete",
      primary_genre: input.primaryGenre,
      story_mode: input.storyMode,
      series_state: seriesState,
      first_line: input.output.first_line,
      previously_summary: input.output.previously_summary,
      themes: input.output.themes,
      beats: [...input.beats],
      content_rating: input.contentRating,
      is_public: input.visibility.applied === "public",
      auto_run_through_chapter: input.autoRunThroughChapter,
    },
    chapter: input.chapter,
    balance: input.balance,
    model: input.model,
    timings: input.timings,
    visibility: input.visibility,
  };
}

/** Every schema field, so a test can walk the map against the source of truth. */
export function storySchemaFields(): string[] {
  return Object.keys(STORY_OUTPUT_JSON_SCHEMA.properties);
}
