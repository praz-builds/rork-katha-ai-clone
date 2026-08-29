import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { AllProvidersFailedError, classifyLlmError } from "./llm.ts";
import {
  ANTHROPIC_OUTPUT_FORMAT,
  OPENAI_RESPONSE_FORMAT,
  STORY_OUTPUT_JSON_SCHEMA,
} from "./story_schema.ts";

// ---------------------------------------------------------------------------
// Output schema
//
// Both providers reject a strict schema unless every property is listed in
// `required` and `additionalProperties` is false. A mismatch here fails at
// request time, in production, on every generation - so it is worth pinning.
// ---------------------------------------------------------------------------

Deno.test("story schema is valid for strict mode", () => {
  const props = Object.keys(STORY_OUTPUT_JSON_SCHEMA.properties);
  assertEquals(props.length, STORY_OUTPUT_JSON_SCHEMA.required.length);
  assertEquals(STORY_OUTPUT_JSON_SCHEMA.additionalProperties, false);
  for (const key of props) {
    assert(
      (STORY_OUTPUT_JSON_SCHEMA.required as readonly string[]).includes(key),
      `${key} must be in required for strict mode`,
    );
  }
});

Deno.test("series_state schema is valid for strict mode", () => {
  const ss = STORY_OUTPUT_JSON_SCHEMA.properties.series_state;
  const props = Object.keys(ss.properties);
  assertEquals(props.length, ss.required.length);
  assertEquals(ss.additionalProperties, false);
});

Deno.test("schema covers every field parseStructuredOutput reads", () => {
  const props = Object.keys(STORY_OUTPUT_JSON_SCHEMA.properties);
  for (
    const field of [
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
    ]
  ) {
    assert(props.includes(field), `schema is missing ${field}`);
  }
});

Deno.test("hook_type enum matches the persisted CHECK constraint", () => {
  assertEquals(STORY_OUTPUT_JSON_SCHEMA.properties.hook_type.enum, [
    "none",
    "revelation",
    "reversal",
    "decision",
    "arrival",
    "betrayal",
    "danger",
    "unanswered_question",
    "emotional_rupture",
  ]);
});

Deno.test("provider format wrappers carry the schema", () => {
  assertEquals(ANTHROPIC_OUTPUT_FORMAT.type, "json_schema");
  assertEquals(ANTHROPIC_OUTPUT_FORMAT.schema, STORY_OUTPUT_JSON_SCHEMA);
  assertEquals(OPENAI_RESPONSE_FORMAT.json_schema.strict, true);
  assertEquals(OPENAI_RESPONSE_FORMAT.json_schema.schema, STORY_OUTPUT_JSON_SCHEMA);
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

Deno.test("classifyLlmError: unknown errors are retryable, not silently dropped", () => {
  const f = classifyLlmError(new Error("something odd"), "anthropic", "m");
  assertEquals(f.code, "unknown");
  assertEquals(f.retryable, true);
  assertEquals(f.provider, "anthropic");
  assertEquals(f.model, "m");
});

Deno.test("classifyLlmError: an abort is a retryable timeout", () => {
  const f = classifyLlmError(
    new DOMException("aborted", "AbortError"),
    "openai",
    "gpt-4o-mini",
  );
  assertEquals(f.code, "timeout");
  assertEquals(f.retryable, true);
});

Deno.test("classifyLlmError: message is truncated, never unbounded", () => {
  const f = classifyLlmError(new Error("x".repeat(5000)), "anthropic", "m");
  assert(f.message.length <= 500);
});

Deno.test("AllProvidersFailedError: context is identifiers and enums only", () => {
  const err = new AllProvidersFailedError([
    { provider: "anthropic", model: "claude-sonnet-5", code: "rate_limited", status: 429, retryable: true, message: "slow down" },
    { provider: "openai", model: "gpt-4o-mini", code: "not_configured", retryable: false, message: "no key" },
  ]);
  const ctx = err.toContext();

  assertEquals(ctx.attempts, 2);
  assertEquals(ctx.providers, ["anthropic", "openai"]);
  assertEquals(ctx.models, ["claude-sonnet-5", "gpt-4o-mini"]);
  assertEquals(ctx.codes, ["rate_limited", "not_configured"]);
  assertEquals(ctx.statuses, [429, null]);
  assertEquals(ctx.retryable, true);

  // The PII rule for error_events: no free text in context.
  for (const value of Object.values(ctx)) {
    const flat = Array.isArray(value) ? value : [value];
    for (const v of flat) {
      assert(
        typeof v !== "string" || v.length < 64,
        `context must not carry prose: ${String(v).slice(0, 40)}`,
      );
    }
  }
});

Deno.test("AllProvidersFailedError: message names each model and code", () => {
  const err = new AllProvidersFailedError([
    { provider: "anthropic", model: "claude-sonnet-5", code: "auth_failed", status: 401, retryable: false, message: "bad key" },
  ]);
  assert(err.message.includes("claude-sonnet-5"));
  assert(err.message.includes("auth_failed"));
  assertEquals(err.name, "AllProvidersFailedError");
});
