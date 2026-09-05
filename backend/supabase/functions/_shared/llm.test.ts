import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  AllProvidersFailedError,
  classifyLlmError,
  editParagraph,
  GEMINI_MODEL,
  geminiRequestShape,
  generateFastStructuredText,
  generateStoryText,
  isProviderDisabled,
  OPENAI_MODEL,
  OPENAI_MODELS,
  openAIKeyForTest,
  openAIRequestShape,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_FREE_MODELS,
  OPENROUTER_MODEL,
  OPENROUTER_MODELS,
  openRouterRequestShape,
  openRouterTokenBudget,
  PHASE_END_SHARE,
  ProviderHttpError,
  ProviderMalformedResponseError,
  ProviderNotConfiguredError,
  requireUsableStoryOutput,
} from "./llm.ts";
import {
  HOOK_TYPE_VALUES,
  HOOK_TYPES,
  type HookType,
  wordBandFor,
} from "./types.ts";
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

  // OpenRouter still routes to models that only understand `max_tokens`, so it
  // must keep the legacy contract rather than share the OpenAI reasoning shape.
  // It carries reasoning headroom of its own, because the Muse Spark models
  // reason *inside* `max_tokens`.
  const r = openRouterRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(r.max_tokens, 32_000);
  assertEquals(r.temperature, 0.8);
  assertEquals(r.reasoning, { effort: "minimal" });
  // The schema gap that would appear the moment OpenRouter leads: it must send
  // the same strict story schema the Gemini path sends via `responseSchema`.
  assertEquals(r.response_format, OPENAI_RESPONSE_FORMAT);

  // The direct OpenAI model is a reasoning model: it rejects `max_tokens` and
  // ignores `temperature`, and its reasoning tokens are counted inside
  // `max_completion_tokens`, so the budget carries headroom above the visible
  // story length.
  const o = openAIRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(o.max_completion_tokens, 32_000);
  assert(!("max_tokens" in o), "a reasoning model rejects max_tokens");
  assert(!("temperature" in o), "a reasoning model does not take temperature");
  assertEquals(o.reasoning_effort, "low");
  assertEquals(o.response_format, OPENAI_RESPONSE_FORMAT);
});

Deno.test("compact structured requests carry their own strict schema", () => {
  const output = {
    name: "story_shape",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "string" } },
    },
  } as const;
  const request = openAIRequestShape({
    maxTokens: 64,
    constrainToStorySchema: false,
    deadlineMs: 1_000,
    structuredOutput: output,
  });
  const responseFormat = request.response_format as {
    json_schema: { name: string; strict: boolean; schema: unknown };
  };
  assertEquals(responseFormat.json_schema.name, "story_shape");
  assertEquals(responseFormat.json_schema.strict, true);
  assertEquals(responseFormat.json_schema.schema, output.schema);
  assert(typeof generateFastStructuredText === "function");
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
  // Floored, not doubled: 2,000 * 2 is 4,000, and a 1,200-token budget was
  // measured spending 1,197 tokens on reasoning and returning empty content.
  assertEquals(r.max_tokens, 8_000);
  assertEquals(r.reasoning, { effort: "minimal" });
  assert(!("response_format" in r), "an edit must not request JSON");

  const o = openAIRequestShape(EDIT_OPTS) as Record<string, unknown>;
  assertEquals(o.max_completion_tokens, 4_000);
  assert(!("max_tokens" in o), "a reasoning model rejects max_tokens");
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
      // series_state present but missing its required keys: this is the branch
      // of hasCompleteStoryShape that gates persistence, and nothing else here
      // reaches it.
      JSON.stringify({
        title: "T",
        chapter_title: "C",
        chapter_body: "Non-empty body",
        word_count: 3,
        themes: [],
        first_line: "N",
        previously_summary: "",
        series_state: { central_conflict: "" },
        hook_type: "none",
        hook_text: "",
      }),
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
    ...OPENROUTER_MODELS.map(() => "openrouter"),
    "gemini",
    ...OPENAI_MODELS.map(() => "openai"),
    ...OPENROUTER_FREE_MODELS.map(() => "openrouter"),
  ]);
  assertEquals(
    error.failures.map((f) => f.code),
    // both Muse Sparks + gemini + every OpenAI model + the free tier
    new Array(
      OPENROUTER_MODELS.length + 1 + OPENAI_MODELS.length +
        OPENROUTER_FREE_MODELS.length,
    ).fill("not_configured"),
  );
});

Deno.test("the free tier is the last phase in the chain", async () => {
  const error = await withEnv(
    {
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      OPENAI_API_KEY: null,
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
  // The free router picks a free model at random per request and is capped by
  // free-tier daily limits, so every model whose identity is known in advance
  // must be tried before it.
  assertEquals(error.failures.map((f) => f.model), [
    ...OPENROUTER_MODELS,
    GEMINI_MODEL,
    ...OPENAI_MODELS.map((m) => m.model),
    ...OPENROUTER_FREE_MODELS,
  ]);
  // The blind router must remain last within the free phase: it is the only
  // entry whose model identity is unknown until the response comes back.
  assertEquals(
    OPENROUTER_FREE_MODELS[OPENROUTER_FREE_MODELS.length - 1],
    "openrouter/free",
  );
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

Deno.test("the OpenAI position falls back past an unentitled model", () => {
  // gpt-5.6-luna is granted per OpenAI project. An unentitled project gets
  // `403 does not have access to model`, so a second model has to stand behind
  // it or the whole position is dead for that project.
  assert(OPENAI_MODELS.length >= 2, "the OpenAI position needs a fallback");
  assertEquals(OPENAI_MODELS[0].model, "gpt-5.6-luna");
  assertEquals(OPENAI_MODELS[0].reasoning, true);
  assertEquals(OPENAI_MODEL, OPENAI_MODELS[0].model);

  // The last entry is the safety net and must not itself be entitlement-gated,
  // or an unentitled project has no working OpenAI position at all.
  const last = OPENAI_MODELS[OPENAI_MODELS.length - 1];
  assertEquals(last.model, "gpt-4o-mini");
  assertEquals(last.reasoning, false);
});

Deno.test("each OpenAI model gets the contract its dialect requires", () => {
  const reasoning = openAIRequestShape(STORY_OPTS, {
    model: "gpt-5.6-luna",
    reasoning: true,
  }) as Record<string, unknown>;
  assertEquals(reasoning.max_completion_tokens, 32_000);
  assert(!("max_tokens" in reasoning));
  assert(!("temperature" in reasoning));

  // A non-reasoning model rejects `max_completion_tokens`-only phrasing and
  // still wants a temperature, so it must keep the legacy shape.
  const legacy = openAIRequestShape(STORY_OPTS, {
    model: "gpt-4o-mini",
    reasoning: false,
  }) as Record<string, unknown>;
  assertEquals(legacy.max_tokens, 16_000);
  assertEquals(legacy.temperature, 0.8);
  assert(!("max_completion_tokens" in legacy));
});

// Runs for ~27s by design: it waits out the real slice gpt-5.6-luna is given
// from the edit deadline. That wall-clock wait is the assertion - a shorter
// stub would not prove the fallback survives a genuine stall.
Deno.test("a stalled preferred OpenAI model still leaves room for the fallback", async () => {
  // Regression guard: the OpenAI window is split per model, not shared. With a
  // shared deadline a stalled gpt-5.6-luna spends the whole window and
  // remainingDuration() aborts gpt-4o-mini before fetch() is called, so the
  // fallback that exists for exactly this case never runs.
  const realFetch = globalThis.fetch;
  const attempted: string[] = [];

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const model = body.model ?? "";
    attempted.push(model);
    // Luna never answers; only the abort signal ends it.
    if (model === "gpt-5.6-luna") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: { message: "stub: no fallback content" } }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const error = await withEnv(
      {
        GEMINI_API_KEY: null,
        OPENROUTER_API_KEY: null,
        OPENAI_API_KEY: "test-key",
      },
      async () => {
        try {
          await editParagraph("system", "user");
          return null;
        } catch (e) {
          return e;
        }
      },
    );

    assert(error instanceof AllProvidersFailedError);
    assert(
      attempted.includes("gpt-4o-mini"),
      `the fallback was never sent; attempted: ${attempted.join(", ")}`,
    );
    const luna = error.failures.find((f) => f.model === "gpt-5.6-luna");
    assertEquals(luna?.code, "timeout");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// Chapter length contract
// ---------------------------------------------------------------------------

function storyOf(words: number): string {
  return JSON.stringify({
    title: "T",
    chapter_title: "C",
    chapter_body: new Array(words).fill("word").join(" "),
    // Deliberately wrong: the validator must count the body, not trust this.
    word_count: 700,
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
}

Deno.test("wordBandFor: chapter length controls the band in every mode", () => {
  assertEquals(wordBandFor("series", "adult", "short"), { min: 600, max: 900 });
  assertEquals(wordBandFor("series", "kids", "standard"), {
    min: 1200,
    max: 1600,
  });
  assertEquals(wordBandFor("standalone", "kids", "long"), {
    min: 2000,
    max: 2600,
  });
  assertEquals(wordBandFor("standalone", "adult"), { min: 1200, max: 1600 });
});

Deno.test("a runaway chapter is rejected before persistence", () => {
  const band = wordBandFor("standalone", "adult");
  const opts = { ...STORY_OPTS, wordBand: band };

  // The exact production failure: gpt-5-mini returned 2026 words against a
  // 500-1500 band and the chapter was stored and charged for.
  assertThrows(
    () => requireUsableStoryOutput(storyOf(2026), opts),
    ProviderMalformedResponseError,
  );
  // A stub chapter is just as unusable as a runaway one.
  assertThrows(
    () => requireUsableStoryOutput(storyOf(120), opts),
    ProviderMalformedResponseError,
  );
});

Deno.test("normal length variation is not thrown away", () => {
  const opts = {
    ...STORY_OPTS,
    wordBand: wordBandFor("standalone", "adult"),
  };
  // Standard is usable from 0.75x its 1,200-word floor to 1.25x its
  // 1,600-word ceiling.
  for (const words of [900, 1000, 1279, 1600, 2000]) {
    assertEquals(
      requireUsableStoryOutput(storyOf(words), opts).length > 0,
      true,
    );
  }
  // Drift past the stated band is tolerated up to the bound, not rejected at it.
  assertEquals(
    requireUsableStoryOutput(storyOf(2000), opts).length > 0,
    true,
  );
  assertThrows(
    () => requireUsableStoryOutput(storyOf(2001), opts),
    ProviderMalformedResponseError,
  );
});

Deno.test("series chapters are held to their selected short band", () => {
  const opts = {
    ...STORY_OPTS,
    wordBand: wordBandFor("series", "adult", "short"),
  };
  for (const words of [675, 900, 1125]) {
    assertEquals(
      requireUsableStoryOutput(storyOf(words), opts).length > 0,
      true,
    );
  }
  // A standard-length chapter is out of contract when the creator selected
  // Short, even though the same count would be fine on the standard band.
  assertThrows(
    () => requireUsableStoryOutput(storyOf(1126), opts),
    ProviderMalformedResponseError,
  );
});

Deno.test("a request with no band is not length-checked", () => {
  // Paragraph edits have no chapter contract, and a story request that never
  // supplied a band must not start failing because of one.
  assertEquals(
    requireUsableStoryOutput("plain paragraph", EDIT_OPTS),
    "plain paragraph",
  );
  assertEquals(
    requireUsableStoryOutput(storyOf(9000), STORY_OPTS).length > 0,
    true,
  );
});

Deno.test("story generation prefers its own OpenAI credential", async () => {
  // OPENAI_API_KEY also authenticates DALL-E covers. Setting the dedicated key
  // must take precedence so the two stop sharing a blast radius; leaving it
  // unset must preserve the previous behaviour.
  const dedicated = await withEnv(
    { OPENAI_STORY_API_KEY: "story-key", OPENAI_API_KEY: "shared-key" },
    () => Promise.resolve(openAIKeyForTest()),
  );
  assertEquals(dedicated, "story-key");

  const shared = await withEnv(
    { OPENAI_STORY_API_KEY: null, OPENAI_API_KEY: "shared-key" },
    () => Promise.resolve(openAIKeyForTest()),
  );
  assertEquals(shared, "shared-key");

  const neither = await withEnv(
    { OPENAI_STORY_API_KEY: null, OPENAI_API_KEY: null },
    () => Promise.resolve(openAIKeyForTest()),
  );
  assertEquals(neither, undefined);
});

// ---------------------------------------------------------------------------
// Provider disabling — LLM_DISABLED_PROVIDERS
// ---------------------------------------------------------------------------

Deno.test("isProviderDisabled matches case-insensitively", () => {
  assert(isProviderDisabled("gemini", new Set(["gemini"])));
  assert(isProviderDisabled("GEMINI", new Set(["gemini"])));
  assert(!isProviderDisabled("openai", new Set(["gemini"])));
  assert(!isProviderDisabled("gemini", new Set()));
});

Deno.test("a disabled provider is skipped, not attempted", async () => {
  const error = await withEnv(
    {
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      OPENAI_API_KEY: null,
      OPENAI_STORY_API_KEY: null,
      LLM_DISABLED_PROVIDERS: "gemini",
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
  // Skipped, not failed. A disabled provider must not appear in telemetry as an
  // attempt, or every request would log a failure nobody asked it to make.
  assert(!error.failures.some((f) => f.provider === "gemini"));
  assertEquals(error.failures[0].model, OPENROUTER_MODEL);
  // Gemini is no longer the leader, so disabling it must not shorten the front
  // of the chain: both Muse Sparks still run before OpenAI.
  assertEquals(
    error.failures.slice(0, OPENROUTER_MODELS.length).map((f) => f.model),
    [...OPENROUTER_MODELS],
  );
});

Deno.test("disabling every provider fails cleanly rather than hanging", async () => {
  const error = await withEnv(
    {
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: null,
      OPENAI_API_KEY: null,
      OPENAI_STORY_API_KEY: null,
      LLM_DISABLED_PROVIDERS: "gemini,openrouter,openai",
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
  assertEquals(error.failures.length, 0);
});

Deno.test("an absent or blank disable list disables nothing", async () => {
  for (const value of [null, "", "   "]) {
    const error = await withEnv(
      {
        GEMINI_API_KEY: null,
        OPENROUTER_API_KEY: null,
        OPENAI_API_KEY: null,
        OPENAI_STORY_API_KEY: null,
        LLM_DISABLED_PROVIDERS: value,
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
    assertEquals(error.failures[0].model, OPENROUTER_MODEL);
  }
});

Deno.test("every named free model is a :free variant", () => {
  // Without the suffix OpenRouter bills the paid variant of the same model,
  // silently — the position would stop being free without anything failing.
  for (const model of OPENROUTER_FREE_MODELS.slice(0, -1)) {
    assert(model.endsWith(":free"), `${model} is not a :free variant`);
  }
});

// ---------------------------------------------------------------------------
// The configured default model
// ---------------------------------------------------------------------------

Deno.test("Muse Spark contributor is the configured default, and leads", () => {
  // The product decision, pinned. Story generation, continuation, the paragraph
  // editor and shape-story all read OPENROUTER_MODELS[0] through this constant,
  // so this one assertion covers every generation path.
  assertEquals(OPENROUTER_MODEL, "meta/muse-spark-1.3-contributor");
  assertEquals(OPENROUTER_MODELS[0], OPENROUTER_MODEL);

  // The contributor tier is 404-by-data-policy on this account until the
  // OpenRouter privacy setting is changed, so the standard tier has to stand
  // directly behind it or the leader is simply a dead position.
  assertEquals(OPENROUTER_MODELS[1], "meta/muse-spark-1.3");
  assert(
    OPENROUTER_MODELS.length >= 2,
    "the OpenRouter position needs a fallback",
  );
  // Not a :free variant. The free tier is a separate, later phase.
  for (const model of OPENROUTER_MODELS) {
    assert(!model.endsWith(":free"), `${model} belongs in the free phase`);
  }
});

Deno.test("phase shares are cumulative, ordered, and end at the deadline", () => {
  // These are cumulative fractions, so reordering the chain without reordering
  // them hands the new leader the old leader's slice and starves whoever now
  // runs last. The order here must match the order runProviderChain calls them.
  const shares = [
    PHASE_END_SHARE.openrouter,
    PHASE_END_SHARE.gemini,
    PHASE_END_SHARE.openai,
    PHASE_END_SHARE.openrouterFree,
  ];
  for (const [index, share] of shares.entries()) {
    assert(share > 0 && share <= 1, `share ${index} out of range: ${share}`);
    if (index > 0) {
      assert(
        share > shares[index - 1],
        `share ${index} (${share}) must exceed ${shares[index - 1]}`,
      );
    }
  }
  // The last phase must reach the deadline, or the tail of the budget is unspent.
  assertEquals(PHASE_END_SHARE.openrouterFree, 1);

  // The individual slices, which are what actually starve. Summing them is the
  // check that catches a share edited in isolation.
  const slices = shares.map((share, index) =>
    share - (index === 0 ? 0 : shares[index - 1])
  );
  assertEquals(
    slices.reduce((total, slice) => total + Math.round(slice * 100), 0),
    100,
  );
  // The leader carries the request that is expected to succeed and splits its
  // window across two models, so it must hold the largest slice.
  for (const slice of slices.slice(1)) {
    assert(slices[0] > slice, "the leading phase must hold the largest slice");
  }
});

Deno.test("the OpenRouter budget survives a reasoning model", () => {
  // Measured 2026-09-05: max_tokens 1200 with no effort sent returned
  // finish_reason "length", 1197 reasoning tokens and empty content — HTTP 200
  // carrying nothing. 8000 with effort "minimal" returned valid JSON. So no caller
  // may hand this position a budget its reasoning alone would consume.
  assertEquals(openRouterTokenBudget(16_000), 32_000);
  assertEquals(openRouterTokenBudget(2_000), 8_000);
  assertEquals(openRouterTokenBudget(900), 8_000);
  for (const visible of [1, 100, 900, 2_000, 4_000, 16_000]) {
    assert(
      openRouterTokenBudget(visible) >= 8_000,
      `${visible} fell under the measured floor`,
    );
    assert(
      openRouterTokenBudget(visible) > visible,
      `${visible} left no room for reasoning`,
    );
  }
});

Deno.test("an empty-content 200 falls through instead of being returned", async () => {
  // The exact production shape of the reasoning failure: HTTP 200,
  // finish_reason "length", 1197 reasoning tokens and an empty content string.
  // The paragraph editor is the caller most likely to hit it, and it is the one
  // path with no story schema to reject a blank result downstream — so the
  // rejection has to happen at the provider boundary, in
  // openAICompatibleContent, not in requireUsableStoryOutput.
  assertEquals(
    requireUsableStoryOutput("", EDIT_OPTS),
    "",
    "the edit path has no schema to catch this, so the boundary must",
  );

  const realFetch = globalThis.fetch;
  const attempted: string[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const model = body.model ?? "";
    attempted.push(model);
    if (model === OPENROUTER_MODEL) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model,
            choices: [{ finish_reason: "length", message: { content: "" } }],
            usage: { completion_tokens: 1197, reasoning_tokens: 1197 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model,
          choices: [{
            finish_reason: "stop",
            message: { content: "A rewritten paragraph." },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const result = await withEnv(
      {
        GEMINI_API_KEY: null,
        OPENROUTER_API_KEY: "test-key",
        OPENAI_API_KEY: null,
        OPENAI_STORY_API_KEY: null,
        LLM_DISABLED_PROVIDERS: null,
      },
      () => editParagraph("system", "user"),
    );
    assertEquals(result.text, "A rewritten paragraph.");
    assertEquals(result.model, "meta/muse-spark-1.3");
    assertEquals(attempted, [OPENROUTER_MODEL, "meta/muse-spark-1.3"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("the chain still serves a story when the contributor tier is 404", async () => {
  // The live failure, reproduced: OpenRouter refuses the training-tier endpoint
  // because of the account's privacy setting. The flow must still produce a
  // story from the model immediately behind it, without reaching Gemini,
  // OpenAI, or the free tier.
  const realFetch = globalThis.fetch;
  const attempted: string[] = [];
  const story = {
    title: "T",
    chapter_title: "C",
    chapter_body: new Array(1_300).fill("word").join(" "),
    word_count: 1_300,
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
  };

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      max_tokens?: number;
      reasoning?: unknown;
    };
    const model = body.model ?? "";
    attempted.push(model);

    if (model === "meta/muse-spark-1.3-contributor") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message:
                "0 endpoints out of 1 requested are available matching your " +
                "guardrail restrictions and data policy. Paid model training " +
                "violation (account settings): 1 endpoint excluded",
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      );
    }
    // The standard tier answers, but only because it was sent a survivable
    // budget and an explicit reasoning effort.
    assertEquals(body.reasoning, { effort: "minimal" });
    assertEquals(body.max_tokens, 32_000);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model,
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify(story) },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const result = await withEnv(
      {
        GEMINI_API_KEY: null,
        OPENROUTER_API_KEY: "test-key",
        OPENAI_API_KEY: null,
        OPENAI_STORY_API_KEY: null,
        LLM_DISABLED_PROVIDERS: null,
      },
      () =>
        generateStoryText("system", "user", wordBandFor("standalone", "adult")),
    );

    assertEquals(result.model, "meta/muse-spark-1.3");
    assertEquals(attempted, [
      "meta/muse-spark-1.3-contributor",
      "meta/muse-spark-1.3",
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("the contributor tier serves the moment the account policy allows it", async () => {
  // The counterpart to the 404 test: nothing but the OpenRouter account setting
  // stands between today and the cheap tier serving. No deploy is involved, so
  // this proves the wiring rather than the configuration.
  const realFetch = globalThis.fetch;
  const attempted: string[] = [];
  const shape = JSON.stringify({ value: "ok" });

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    attempted.push(body.model ?? "");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: body.model,
          choices: [{ finish_reason: "stop", message: { content: shape } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    // shape-story is the first generation a new user triggers, and it used to
    // go straight to OpenAI with no fallback at all.
    const result = await withEnv(
      {
        OPENROUTER_API_KEY: "test-key",
        OPENAI_API_KEY: null,
        OPENAI_STORY_API_KEY: null,
        LLM_DISABLED_PROVIDERS: null,
      },
      () =>
        generateFastStructuredText("system", "user", {
          name: "story_shape",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["value"],
            properties: { value: { type: "string" } },
          },
        }),
    );
    assertEquals(result.model, OPENROUTER_MODEL);
    assertEquals(attempted, [OPENROUTER_MODEL]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
