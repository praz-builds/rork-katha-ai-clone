/**
 * The JSON schema every generation must conform to.
 *
 * The prompt already describes this shape in prose (`buildOutputSchema()`), but
 * prose is a request, not a guarantee. Live runs showed the model returning
 * syntactically valid JSON in the wrong shape - `chapter_body` missing or not a
 * string - which failed `parseStructuredOutput`, fell through to the plain-text
 * parser, and persisted a chapter with a placeholder `hook_type: "none"` and an
 * empty `series_state`. The series then could not continue, and the credit was
 * still spent.
 *
 * Passing this schema to the provider makes the shape enforced rather than
 * requested: Anthropic via `output_config.format`, OpenAI via
 * `response_format: { type: "json_schema", strict: true }`.
 *
 * Both providers require `additionalProperties: false` and every property listed
 * in `required` for strict mode, so optional-in-spirit fields are declared here
 * and allowed to be empty rather than omitted.
 */

import { HOOK_TYPE_VALUES } from "./types.ts";

const stringList = {
  type: "array",
  items: { type: "string" },
} as const;

export const STORY_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "chapter_title",
    "chapter_body",
    "word_count",
    "themes",
    "first_line",
    "previously_summary",
    "series_state",
    "hook_type",
    "hook_text",
  ],
  properties: {
    title: { type: "string", description: "Story title." },
    chapter_title: {
      type: "string",
      description: "Chapter title, e.g. 'Chapter 1' or a creative name.",
    },
    chapter_body: {
      type: "string",
      description: "The full story text, paragraphs separated by \\n\\n.",
    },
    word_count: { type: "integer" },
    themes: { ...stringList, description: "3-5 thematic tags." },
    first_line: { type: "string" },
    previously_summary: {
      type: "string",
      description: "A two-sentence summary for continuation context.",
    },
    series_state: {
      type: "object",
      additionalProperties: false,
      required: [
        "central_conflict",
        "protagonist_want",
        "relationship_state",
        "open_hooks",
        "resolved_hooks",
        "promised_payoffs",
        "world_facts",
        "character_changes",
        "next_chapter_pressure",
      ],
      properties: {
        central_conflict: { type: "string" },
        protagonist_want: { type: "string" },
        relationship_state: { type: "string" },
        open_hooks: stringList,
        resolved_hooks: stringList,
        promised_payoffs: stringList,
        world_facts: stringList,
        character_changes: stringList,
        next_chapter_pressure: {
          type: "string",
          description:
            "What drives the NEXT chapter. Empty for a standalone story or a finale.",
        },
      },
      description:
        "Continuity state AFTER this chapter. For a continuation this is the updated state, never a copy of the state supplied in the prompt.",
    },
    hook_type: {
      type: "string",
      // Derived, not duplicated: the schema, the runtime HOOK_TYPES set and the
      // chapters_hook_type_check constraint must not drift apart.
      enum: HOOK_TYPE_VALUES,
    },
    hook_text: {
      type: "string",
      description: "Empty for a standalone story or a finale.",
    },
  },
} as const;

/** Anthropic Messages API `output_config.format`. */
export const ANTHROPIC_OUTPUT_FORMAT = {
  type: "json_schema",
  schema: STORY_OUTPUT_JSON_SCHEMA,
} as const;

/** OpenAI chat-completions `response_format`. */
export const OPENAI_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "katha_story_output",
    strict: true,
    schema: STORY_OUTPUT_JSON_SCHEMA,
  },
} as const;
