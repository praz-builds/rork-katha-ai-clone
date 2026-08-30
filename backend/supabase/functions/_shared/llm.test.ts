import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  AllProvidersFailedError,
  anthropicRequestShape,
  classifyLlmError,
  CLAUDE_TOKEN_ENV_VARS,
  claudeAuthToken,
  createClaudeClient,
  generateStoryText,
  openAIRequestShape,
  ProviderHttpError,
  ProviderNotConfiguredError,
} from "./llm.ts";
import { HOOK_TYPE_VALUES, HOOK_TYPES, type HookType } from "./types.ts";
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
  const required = STORY_OUTPUT_JSON_SCHEMA.required as readonly string[];
  assertEquals(STORY_OUTPUT_JSON_SCHEMA.additionalProperties, false);
  assertEquals(
    new Set(required).size,
    required.length,
    "duplicate in required",
  );
  for (const key of props) {
    assert(
      required.includes(key),
      `${key} must be in required for strict mode`,
    );
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
  // Counts alone would pass with a duplicate in `required` and one property
  // missing, which both providers reject at generation time. Check membership
  // both ways.
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

Deno.test("hook_type enum is derived from the canonical list, not copied", () => {
  // The schema enum and the runtime Set now share one source, so they cannot
  // drift from each other.
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
  // The remaining copy lives in migration 00010. It cannot be imported here, so
  // it is pinned: changing the code list without the migration fails this test.
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

Deno.test("provider format wrappers carry the schema", () => {
  assertEquals(ANTHROPIC_OUTPUT_FORMAT.type, "json_schema");
  assertEquals(ANTHROPIC_OUTPUT_FORMAT.schema, STORY_OUTPUT_JSON_SCHEMA);
  assertEquals(OPENAI_RESPONSE_FORMAT.json_schema.strict, true);
  assertEquals(
    OPENAI_RESPONSE_FORMAT.json_schema.schema,
    STORY_OUTPUT_JSON_SCHEMA,
  );
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
    {
      provider: "anthropic",
      model: "claude-sonnet-5",
      code: "rate_limited",
      status: 429,
      retryable: true,
      message: "slow down",
    },
    {
      provider: "openai",
      model: "gpt-4o-mini",
      code: "not_configured",
      retryable: false,
      message: "no key",
    },
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
    {
      provider: "anthropic",
      model: "claude-sonnet-5",
      code: "auth_failed",
      status: 401,
      retryable: false,
      message: "bad key",
    },
  ]);
  assert(err.message.includes("claude-sonnet-5"));
  assert(err.message.includes("auth_failed"));
  assertEquals(err.name, "AllProvidersFailedError");
});

// ---------------------------------------------------------------------------
// Request shaping
//
// The branch that decides whether output is constrained is the difference
// between a story (must be the JSON object) and a paragraph edit (must be
// prose). Constraining an edit would return JSON where the editor expects a
// rewritten paragraph.
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

Deno.test("story requests constrain output on both providers", () => {
  const a = anthropicRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(a.max_tokens, 16_000);
  assertEquals(a.output_config, { format: ANTHROPIC_OUTPUT_FORMAT });

  const o = openAIRequestShape(STORY_OPTS) as Record<string, unknown>;
  assertEquals(o.max_tokens, 16_000);
  assertEquals(o.response_format, OPENAI_RESPONSE_FORMAT);
});

Deno.test("paragraph edits are never constrained to the story schema", () => {
  const a = anthropicRequestShape(EDIT_OPTS) as Record<string, unknown>;
  assertEquals(a.max_tokens, 2_000);
  assert(!("output_config" in a), "an edit must not request the story schema");

  const o = openAIRequestShape(EDIT_OPTS) as Record<string, unknown>;
  assertEquals(o.max_tokens, 2_000);
  assert(
    !("response_format" in o),
    "an edit must not request the story schema",
  );
});

// ---------------------------------------------------------------------------
// Timeout and HTTP status classification
// ---------------------------------------------------------------------------

Deno.test("classifyLlmError: an aborted request is a timeout, not unknown", () => {
  // withAbortTimeout aborts with exactly this reason.
  const f = classifyLlmError(
    new DOMException("Timeout after 30000ms", "AbortError"),
    "openai",
    "gpt-4o-mini",
  );
  assertEquals(f.code, "timeout");
  assertEquals(f.retryable, true);
});

Deno.test("classifyLlmError: a provider HTTP status survives classification", () => {
  const unauthorized = classifyLlmError(
    new ProviderHttpError("OpenAI request failed (401): bad key", 401),
    "openai",
    "gpt-4o-mini",
  );
  assertEquals(unauthorized.status, 401);
  assertEquals(unauthorized.code, "provider_error");
  // A bad credential must not be retried as though it were transient.
  assertEquals(unauthorized.retryable, false);

  const serverError = classifyLlmError(
    new ProviderHttpError("OpenAI request failed (503): busy", 503),
    "openai",
    "gpt-4o-mini",
  );
  assertEquals(serverError.status, 503);
  assertEquals(serverError.code, "provider_5xx");
  assertEquals(serverError.retryable, true);

  const throttled = classifyLlmError(
    new ProviderHttpError("OpenAI request failed (429): slow down", 429),
    "openai",
    "gpt-4o-mini",
  );
  assertEquals(throttled.status, 429);
  assertEquals(throttled.retryable, true);
});

Deno.test("HookType is derived, so the union cannot drift from the values", () => {
  // A compile-time assertion: if HookType stopped deriving from
  // HOOK_TYPE_VALUES, assigning every value to it would stop type-checking.
  const all: HookType[] = [...HOOK_TYPE_VALUES];
  assertEquals(all.length, HOOK_TYPE_VALUES.length);
  assertEquals(new Set(all).size, all.length, "duplicate hook value");
});

// ---------------------------------------------------------------------------
// Claude credential resolution
//
// Generation authenticates with an OAuth bearer token, never a Console API
// key. These tests pin the accepted names and their precedence, because a
// silent miss here means every request falls through to the OpenAI leg and
// the regression is invisible until someone reads a bill.
// ---------------------------------------------------------------------------

function withEnv<T>(vars: Record<string, string | null>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const name of Object.keys(vars)) {
    saved.set(name, Deno.env.get(name));
  }
  try {
    for (const [name, value] of Object.entries(vars)) {
      if (value === null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

const NO_CLAUDE_TOKENS: Record<string, string | null> = Object.fromEntries(
  CLAUDE_TOKEN_ENV_VARS.map((name) => [name, null]),
);

Deno.test("ANTHROPIC_API_KEY is not an accepted credential name", () => {
  assertEquals(
    CLAUDE_TOKEN_ENV_VARS.includes(
      "ANTHROPIC_API_KEY" as typeof CLAUDE_TOKEN_ENV_VARS[number],
    ),
    false,
  );
  // Present but unread: a leftover Console key must not silently authenticate.
  const resolved = withEnv(
    // Deliberately not a realistic key shape: a literal starting "sk-ant-"
    // trips secret scanners and GitHub push protection on every future push.
    { ...NO_CLAUDE_TOKENS, ANTHROPIC_API_KEY: "leftover-console-key" },
    claudeAuthToken,
  );
  assertEquals(resolved, undefined);
});

Deno.test("CLAUDE_CODE_OAUTH_TOKEN wins over both aliases", () => {
  const resolved = withEnv({
    CLAUDE_CODE_OAUTH_TOKEN: "primary",
    ANTHROPIC_AUTH_TOKEN: "alias-a",
    CLAUDE_TOKEN: "alias-b",
  }, claudeAuthToken);
  assertEquals(resolved, "primary");
});

Deno.test("aliases resolve in declared order", () => {
  assertEquals(
    withEnv({
      ...NO_CLAUDE_TOKENS,
      ANTHROPIC_AUTH_TOKEN: "alias-a",
      CLAUDE_TOKEN: "alias-b",
    }, claudeAuthToken),
    "alias-a",
  );
  assertEquals(
    withEnv({ ...NO_CLAUDE_TOKENS, CLAUDE_TOKEN: "alias-b" }, claudeAuthToken),
    "alias-b",
  );
});

Deno.test("a whitespace-only token is treated as absent", () => {
  // Supabase secrets round-trip through a shell; a trailing newline is the
  // common way a "set" secret is in fact empty.
  assertEquals(
    withEnv(
      { ...NO_CLAUDE_TOKENS, CLAUDE_CODE_OAUTH_TOKEN: "   \n  " },
      claudeAuthToken,
    ),
    undefined,
  );
  assertEquals(
    withEnv(
      { ...NO_CLAUDE_TOKENS, CLAUDE_CODE_OAUTH_TOKEN: "  tok  " },
      claudeAuthToken,
    ),
    "tok",
  );
});

Deno.test("no credential resolves to undefined, not a throw", () => {
  assertEquals(withEnv(NO_CLAUDE_TOKENS, claudeAuthToken), undefined);
});

Deno.test("a missing credential is not_configured and never retried", () => {
  const failure = classifyLlmError(
    new ProviderNotConfiguredError(
      "Claude credentials are not configured. Set CLAUDE_CODE_OAUTH_TOKEN.",
    ),
    "anthropic",
    "claude-sonnet-5",
  );
  assertEquals(failure.code, "not_configured");
  assertEquals(failure.retryable, false);
  // Retrying a deployment gap burns the request budget before OpenAI is tried.
  assert(
    !failure.status,
    "a credential that was never sent has no HTTP status",
  );
});

Deno.test("an unconfigured Claude records one failure, not one per model", async () => {
  // Regression: the credential was previously checked inside the per-model
  // helper, so the identical preflight threw on the Sonnet leg and again on
  // the Haiku leg - two `not_configured` rows for a single deployment gap.
  // An occurrence count read later would then show a recurrence that is not one.
  const error = await withEnv(
    { ...NO_CLAUDE_TOKENS, OPENAI_API_KEY: null },
    async () => {
      try {
        await generateStoryText("system", "user");
        return null;
      } catch (e) {
        return e;
      }
    },
  );

  assert(
    error instanceof AllProvidersFailedError,
    "no provider is configured, so the chain must fail",
  );
  const anthropic = error.failures.filter((f) => f.provider === "anthropic");
  assertEquals(
    anthropic.length,
    1,
    `expected a single Claude failure, got ${anthropic.length}: ` +
      anthropic.map((f) => f.model).join(", "),
  );
  assertEquals(anthropic[0].code, "not_configured");
  assertEquals(anthropic[0].retryable, false);
  // The OpenAI leg still reports separately; it is a different provider.
  assertEquals(error.failures.length, 2);
});

Deno.test("a leftover ANTHROPIC_API_KEY never reaches the wire", async () => {
  // The resolver ignoring the name is not enough. The SDK constructor defaults
  // an omitted `apiKey` to readEnv("ANTHROPIC_API_KEY"), and authHeaders()
  // returns [apiKeyAuth(), bearerAuth()] - so without `apiKey: null` a stale
  // Console key in the environment is sent alongside the bearer token and can
  // authenticate and bill traffic this project believes runs on OAuth.
  // Asserted at the request layer, because that is where the bug lived.
  let seen: Headers | undefined;
  const captureFetch: typeof fetch = (input, init) => {
    seen = new Headers(init?.headers ?? (input as Request)?.headers);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };

  await withEnv(
    { ...NO_CLAUDE_TOKENS, ANTHROPIC_API_KEY: "leftover-console-key" },
    async () => {
      const client = createClaudeClient("oauth-bearer-value", captureFetch);
      await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      });
    },
  );

  assert(seen, "the stub fetch was never invoked");
  assertEquals(
    seen.get("x-api-key"),
    null,
    "X-Api-Key must be absent: a leftover Console key must never authenticate",
  );
  assertEquals(seen.get("authorization"), "Bearer oauth-bearer-value");
});
