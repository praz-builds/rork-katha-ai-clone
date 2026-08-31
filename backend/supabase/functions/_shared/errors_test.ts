import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  logError,
  safeErrorMessage,
  sanitizeErrorContext,
  withErrorLogging,
} from "./errors.ts";

async function withoutServiceCredentials(body: () => Promise<void>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  try {
    await body();
  } finally {
    if (url !== undefined) Deno.env.set("SUPABASE_URL", url);
    if (key !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key);
  }
}

Deno.test("logError resolves false instead of throwing when credentials are absent", async () => {
  await withoutServiceCredentials(async () => {
    const logged = await logError({
      bucket: "generation.story",
      severity: "high",
      error: new Error("boom"),
    });
    assertEquals(logged, false);
  });
});

Deno.test("logError tolerates a non-Error throwable", async () => {
  await withoutServiceCredentials(async () => {
    assertEquals(
      await logError({ bucket: "credits", error: "plain string" }),
      false,
    );
    assertEquals(await logError({ bucket: "credits", error: null }), false);
    assertEquals(
      await logError({ bucket: "credits", error: { odd: true } }),
      false,
    );
  });
});

Deno.test("sanitizeErrorContext tolerates unserializable context values", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assertEquals(
    sanitizeErrorContext({ models: circular, request_id: "abc-123" }),
    { models: "<omitted: invalid>", request_id: "abc-123" },
  );
});

Deno.test("sanitizeErrorContext keeps only allowlisted identifiers and enums", () => {
  assertEquals(
    sanitizeErrorContext({
      story_id: "550e8400-e29b-41d4-a716-446655440000",
      operation_id: "550e8400-e29b-41d4-a716-446655440001",
      provider: "openrouter",
      models: ["gemini-3.1-pro-preview", "openrouter/free"],
      statuses: [429, null],
      retryable: true,
      prompt: "short but still user text",
      title: "short title",
      nested: { text: "not allowed" },
    }),
    {
      story_id: "550e8400-e29b-41d4-a716-446655440000",
      operation_id: "550e8400-e29b-41d4-a716-446655440001",
      provider: "openrouter",
      models: ["gemini-3.1-pro-preview", "openrouter/free"],
      statuses: [429, null],
      retryable: true,
    },
  );
});

Deno.test("sanitizeErrorContext replaces invalid allowlisted values", () => {
  assertEquals(
    sanitizeErrorContext({
      story_id: "not-a-uuid",
      provider: "free prose with spaces",
      context: { text: "not allowed" },
    }),
    {
      story_id: "<omitted: invalid>",
      provider: "<omitted: invalid>",
    },
  );
});

Deno.test("safeErrorMessage stores a bounded diagnostic, not raw prose", () => {
  assertEquals(
    safeErrorMessage(new Error("full provider payload with possible prose")),
    "Error",
  );
  assertEquals(
    safeErrorMessage("literal user-facing text that should not persist"),
    "string_error",
  );
  assertEquals(
    safeErrorMessage(new Error("ignored"), "all_providers_failed"),
    "all_providers_failed",
  );
});

Deno.test("withErrorLogging rethrows the original error", async () => {
  await withoutServiceCredentials(async () => {
    const original = new Error("original failure");

    const thrown = await assertRejects(
      () => withErrorLogging("publishing", () => Promise.reject(original)),
      Error,
    );
    assertEquals(thrown, original);
  });
});

Deno.test("withErrorLogging passes through a successful result untouched", async () => {
  const result = await withErrorLogging("discovery", () => Promise.resolve(42));
  assertEquals(result, 42);
});
