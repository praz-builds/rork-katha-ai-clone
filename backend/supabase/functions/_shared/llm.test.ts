import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  AllProvidersFailedError,
  classifyLlmError,
  GEMINI_MODEL,
  geminiRequestShape,
  generateStoryText,
  OPENAI_MODEL,
  openAIRequestShape,
  OPENROUTER_FREE_MODEL,
  openRouterRequestShape,
  ProviderHttpError,
  ProviderMalformedResponseError,
  ProviderNotConfiguredError,
  requireUsableStoryOutput,
} from "./llm.ts";
import { HOOK_TYPE_VALUES, HOOK_TYPES, type HookType } from "./types.ts";
import {
  OPENAI_RESPONSE_FORMAT,
  STORY_OUTPUT_JSON_SCHEMA,
} from "./story_schema.ts";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

Deno.test("story schema is valid for strict mode", () => {
  const props = Object.keys(STORY_OUTPUT_JSON_SCHEMA.properties);
  const required = STORY_OUTPUT_JSON_SCHEMA.required as readonly string[];
  assertEquals(STORY_OUTPUT_JSON_SCHEMA.additionalProperties, false);
  assertEquals(
    new Set(required).size,
    required.length,
    "duplicate in required",
  );
  for (const key of props) {
    assert(required.includes(key), `${key} must be in required`);
  }
  for (const key of required) {
    assert(props.includes(key), `required lists unknown property ${key}`);
  }
});

Deno.test("series_state schema is valid for strict mode", () => {
  const ss = STORY_OUTPUT_JSON_SCHEMA.properties.series_state;
  const props = Object.keys(ss.properties);
  const required = ss.required as readonly string[];
  assertEquals(ss.additionalProperties, false);
  assertEquals(
    new Set(required).size,
    required.length,
    "duplicate in required",
  );
  for (const key of props) {
    assert(required.includes(key), `${key} must be in series_state.required`);
  }
  for (const key of required) {
    assert(props.includes(key), `required lists unknown property ${key}`);
  }
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

Deno.test("hook_type enum is derived from the canonical list", () => {
  assertEquals(
    STORY_OUTPUT_JSON_SCHEMA.properties.hook_type.enum,
    HOOK_TYPE_VALUES,
  );
  for (const value of HOOK_TYPE_VALUES) {
    assert(HOOK_TYPES.has(value), `${value} missing from HOOK_TYPES`);
  }
  assertEquals(HOOK_TYPES.size, HOOK_TYPE_VALUES.length);
});

Deno.test("canonical hook list matches chapters_hook_type_check", () => {
  assertEquals([...HOOK_TYPE_VALUES], [
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

// ---------------------------------------------------------------------------
// Request shaping
// ---------------------------------------------------------------------------

const STORY_OPTS = {
  maxTokens: 16_000,
  constrainToStorySchema: true,
  deadlineMs: 120_000,
};
const EDIT_OPTS = {
  maxTokens: 2_000,
  constrainToStorySchema: false,
  deadlineMs: 60_000,
};

Deno.test("story requests constrain output on all provider shapes", () => {
  const g = geminiRequestShape(STORY_OPTS).generationConfig as Record<
    string,
    unknown
  >;
  assertEquals(g.maxOutputTokens, 16_000);
  assertEquals(g.responseMimeType, "application/json");
  assert("responseSchema" in g);
  const responseSchema = g.responseSchema as Record<string, unknown>;
  assertEquals(responseSchema.type, "OBJECT");
  assert(!("additionalProperties" in responseSchema));
  assert(!("description" in responseSchema));
  const properties = responseSchema.properties as Record<string, unknown>;
  assertEquals((properties.title as Record<string, unknown>).type, "STRING");
  assertEquals(
    (properties.themes as Record<string, unknown>).type,
    "ARRAY",
  );
  assertEquals(
    ((properties.themes as Record<string, unknown>).items as Record<
      string,
      unknown
    >).type,
    "STRING",
  );
  const seriesState = properties.series_state as Record<string, unknown>;
  assertEquals(seriesState.type, "OBJECT");
  const seriesProperties = seriesState.properties as Record<string, unknown>;
  assertEquals(
    (seriesProperties.open_hooks as Record<string, unknown>).type,
    "ARRAY",
  );

  const r = openRouterRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(r.max_tokens, 16_000);
  assertEquals(r.response_format, OPENAI_RESPONSE_FORMAT);

  const o = openAIRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(o.max_tokens, 16_000);
  assertEquals(o.response_format, OPENAI_RESPONSE_FORMAT);
});

Deno.test("paragraph edits are never constrained to the story schema", () => {
  const g = geminiRequestShape(EDIT_OPTS).generationConfig as Record<
    string,
    unknown
  >;
  assertEquals(g.maxOutputTokens, 2_000);
  assert(!("responseMimeType" in g), "an edit must not request JSON");
  assert(!("responseSchema" in g), "an edit must not request the story schema");

  const r = openRouterRequestShape(EDIT_OPTS) as Record<string, unknown>;
  assertEquals(r.max_tokens, 2_000);
  assert(!("response_format" in r), "an edit must not request JSON");

  const o = openAIRequestShape(EDIT_OPTS) as Record<string, unknown>;
  assertEquals(o.max_tokens, 2_000);
  assert(!("response_format" in o), "an edit must not request JSON");
});

Deno.test("story provider output must contain structured chapter body", () => {
  const valid = JSON.stringify({
    title: "T",
    chapter_title: "C",
    chapter_body: "A paragraph with story content.",
    word_count: 5,
    themes: [],
    first_line: "A",
    previously_summary: "",
    series_state: {
      central_conflict: "",
      protagonist_want: "",
      character_changes: [],
      relationship_state: "",
      open_hooks: [],
      resolved_hooks: [],
      promised_payoffs: [],
      world_facts: [],
      next_chapter_pressure: "",
    },
    hook_type: "none",
    hook_text: "",
  });

  assertEquals(requireUsableStoryOutput(valid, STORY_OPTS), valid);
  assertEquals(
    requireUsableStoryOutput("plain paragraph", EDIT_OPTS),
    "plain paragraph",
  );
});

Deno.test("empty or unparseable story provider output is rejected before persistence", () => {
  for (
    const text of [
      "",
      '```json\n{"ok":true}\n```',
      JSON.stringify({ title: "T", chapter_body: "" }),
      JSON.stringify({ title: "T", chapter_body: "Non-empty body" }),
    ]
  ) {
    assertThrows(
      () => requireUsableStoryOutput(text, STORY_OPTS),
      ProviderMalformedResponseError,
      undefined,
      `expected rejection for ${JSON.stringify(text)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

Deno.test("classifyLlmError: unknown errors are retryable", () => {
  const f = classifyLlmError(new Error("something odd"), "gemini", "m");
  assertEquals(f.code, "unknown");
  assertEquals(f.retryable, true);
  assertEquals(f.provider, "gemini");
  assertEquals(f.model, "m");
});

Deno.test("classifyLlmError: an abort is a retryable timeout", () => {
  const f = classifyLlmError(
    new DOMException("aborted", "AbortError"),
    "openai",
    OPENAI_MODEL,
  );
  assertEquals(f.code, "timeout");
  assertEquals(f.retryable, true);
});

Deno.test("classifyLlmError: message is truncated", () => {
  const f = classifyLlmError(new Error("x".repeat(5000)), "openrouter", "m");
  assert(f.message.length <= 500);
});

Deno.test("classifyLlmError: HTTP statuses map to stable codes", () => {
  const unauthorized = classifyLlmError(
    new ProviderHttpError("OpenRouter request failed (401): bad key", 401),
    "openrouter",
    OPENROUTER_FREE_MODEL,
  );
  assertEquals(unauthorized.status, 401);
  assertEquals(unauthorized.code, "auth_failed");
  assertEquals(unauthorized.retryable, false);

  const serverError = classifyLlmError(
    new ProviderHttpError("Gemini request failed (503): busy", 503),
    "gemini",
    GEMINI_MODEL,
  );
  assertEquals(serverError.status, 503);
  assertEquals(serverError.code, "provider_5xx");
  assertEquals(serverError.retryable, true);

  const throttled = classifyLlmError(
    new ProviderHttpError("OpenAI request failed (429): slow down", 429),
    "openai",
    OPENAI_MODEL,
  );
  assertEquals(throttled.status, 429);
  assertEquals(throttled.code, "rate_limited");
  assertEquals(throttled.retryable, true);
});

Deno.test("classifyLlmError: malformed provider output is retryable", () => {
  const f = classifyLlmError(
    new ProviderMalformedResponseError(
      "Provider returned unparseable story JSON",
    ),
    "openrouter",
    OPENROUTER_FREE_MODEL,
  );
  assertEquals(f.code, "malformed_response");
  assertEquals(f.retryable, true);
});

Deno.test("AllProvidersFailedError: context is identifiers and enums only", () => {
  const err = new AllProvidersFailedError([
    {
      provider: "gemini",
      model: GEMINI_MODEL,
      code: "rate_limited",
      status: 429,
      retryable: true,
      message: "slow down",
    },
    {
      provider: "openrouter",
      model: OPENROUTER_FREE_MODEL,
      code: "not_configured",
      retryable: false,
      message: "no key",
    },
  ]);
  const ctx = err.toContext();

  assertEquals(ctx.attempts, 2);
  assertEquals(ctx.providers, ["gemini", "openrouter"]);
  assertEquals(ctx.models, [GEMINI_MODEL, OPENROUTER_FREE_MODEL]);
  assertEquals(ctx.codes, ["rate_limited", "not_configured"]);
  assertEquals(ctx.statuses, [429, null]);
  assertEquals(ctx.retryable, true);

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
    {
      provider: "gemini",
      model: GEMINI_MODEL,
      code: "auth_failed",
      status: 401,
      retryable: false,
      message: "bad key",
    },
  ]);
  assert(err.message.includes(GEMINI_MODEL));
  assert(err.message.includes("auth_failed"));
  assertEquals(err.name, "AllProvidersFailedError");
});

Deno.test("HookType is derived from the canonical values", () => {
  const all: HookType[] = [...HOOK_TYPE_VALUES];
  assertEquals(all.length, HOOK_TYPE_VALUES.length);
  assertEquals(new Set(all).size, all.length, "duplicate hook value");
});

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

async function withEnv<T>(
  vars: Record<string, string | null>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const name of Object.keys(vars)) {
    saved.set(name, Deno.env.get(name));
  }
  try {
    for (const [name, value] of Object.entries(vars)) {
      if (value === null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("Anthropic and Claude credential names are ignored", async () => {
  const error = await withEnv(
    {
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      OPENAI_API_KEY: null,
      ANTHROPIC_API_KEY: "leftover-console-key",
      CLAUDE_CODE_OAUTH_TOKEN: "leftover-oauth-token",
      ANTHROPIC_AUTH_TOKEN: "leftover-alias",
      CLAUDE_TOKEN: "leftover-alias",
    },
    async () => {
      try {
        await generateStoryText("system", "user");
        return null;
      } catch (e) {
        return e;
      }
    },
  );

  assert(error instanceof AllProvidersFailedError);
  assertEquals(error.failures.map((f) => f.provider), [
    "gemini",
    "openrouter",
    "openai",
  ]);
  assertEquals(error.failures.map((f) => f.code), [
    "not_configured",
    "not_configured",
    "not_configured",
  ]);
});

Deno.test("a missing provider credential is not_configured and never retried", () => {
  const failure = classifyLlmError(
    new ProviderNotConfiguredError("GEMINI_API_KEY is not configured"),
    "gemini",
    GEMINI_MODEL,
  );
  assertEquals(failure.code, "not_configured");
  assertEquals(failure.retryable, false);
  assert(!failure.status);
});
