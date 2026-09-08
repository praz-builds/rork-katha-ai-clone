// `unsave-phrase` deletes `saved_phrases` by its primary key, `id`. See
// `save-phrase/index.test.ts` for why the round trip is proven across two
// files rather than one call chain: `save_phrase` returns that exact `id`
// as `phrase_id` at its response root, so a delete keyed on the value the
// client got back from a save targets the right row.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SAVED_PHRASES_ROW_ID = "44444444-4444-4444-8444-444444444444";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Calls {
  deletes: Array<{ id: string | null; userId: string | null }>;
}

function makeFetchStub(calls: Calls): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }

    if (
      url.pathname === "/rest/v1/saved_phrases" && request.method === "DELETE"
    ) {
      calls.deletes.push({
        id: url.searchParams.get("id")?.replace(/^eq\./, "") ?? null,
        userId: url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? null,
      });
      return json([]);
    }

    if (url.pathname === "/rest/v1/error_events") return json([]);

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

function setTestEnv(): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(TEST_ENV)) {
    previous[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }
  return previous;
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
}

async function callUnsave(
  calls: Calls,
  phraseId: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(calls);
  try {
    const response = await handleRequest(
      new Request("https://katha.test/unsave-phrase", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phraseId }),
      }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("unsave-phrase deletes the exact saved_phrases id it is given, scoped to the caller", async () => {
  const calls: Calls = { deletes: [] };
  const env = setTestEnv();
  try {
    // The id passed here is exactly the shape `save_phrase`'s response now
    // hands back as `phrase_id` -- the saved_phrases primary key, not the
    // corpus phrase_id column.
    const { status, json: body } = await callUnsave(
      calls,
      SAVED_PHRASES_ROW_ID,
    );

    assertEquals(status, 200);
    assertEquals(body, { unsaved: true, phrase_id: SAVED_PHRASES_ROW_ID });
    assertEquals(calls.deletes, [
      { id: SAVED_PHRASES_ROW_ID, userId: USER_ID },
    ]);
  } finally {
    restoreEnv(env);
  }
});
