// `save_phrase` (migration 00047) returns the `saved_phrases` row, whose
// primary key is `id` -- the id `unsave-phrase` deletes by (see that
// function's own test file). That row also carries its own `phrase_id`
// column (a foreign key into `phrase_corpus`, often null, and a different
// thing entirely). Before this fix the endpoint nested the whole row under
// `phrase` and never exposed `id` as `phrase_id` at the response root, so
// the client (`expo/src/lib/phrases.ts`'s `savePhrase`) always fell back to
// its own random local id, and a later `unsave-phrase` targeted a row the
// server had never heard of.
//
// This file and `unsave-phrase/index.test.ts` do not call each other's
// handler directly: both modules call `serve()` unconditionally at import
// time (not gated behind `import.meta.main`), so importing both in one test
// file means two listeners racing for the same port. The round trip is
// instead proven by the two files' contracts agreeing on the same id: this
// one asserts `phrase_id` in the response is the saved_phrases row's `id`;
// `unsave-phrase/index.test.ts` asserts a delete targets exactly the `id` it
// is given.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORY_ID = "22222222-2222-4222-8222-222222222222";
const CHAPTER_ID = "33333333-3333-4333-8333-333333333333";
// The saved_phrases primary key -- deliberately different from the corpus
// `phrase_id` column below, so a test that accidentally reads the wrong
// field fails loudly instead of passing by coincidence.
const SAVED_PHRASES_ROW_ID = "44444444-4444-4444-8444-444444444444";
const CORPUS_PHRASE_ID = "55555555-5555-4555-8555-555555555555";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchStub(): typeof fetch {
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

    if (url.pathname === "/rest/v1/rpc/save_phrase") {
      // `save_phrase` returns a single `saved_phrases` composite row, not a
      // set -- PostgREST hands that back as one JSON object, not an array.
      return json({
        id: SAVED_PHRASES_ROW_ID,
        user_id: USER_ID,
        phrase_id: CORPUS_PHRASE_ID,
        phrase_text: "lighthouse",
        phrase_key: "lighthouse",
        language: "English",
        story_id: STORY_ID,
        chapter_id: CHAPTER_ID,
        sentence: "The old lighthouse stood alone.",
        saved_at: new Date().toISOString(),
      });
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

async function callSave(): Promise<
  { status: number; json: Record<string, unknown> }
> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub();
  try {
    const response = await handleRequest(
      new Request("https://katha.test/save-phrase", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phrase: "lighthouse",
          storyId: STORY_ID,
          chapterId: CHAPTER_ID,
          sentence: "The old lighthouse stood alone.",
        }),
      }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("save-phrase exposes the saved_phrases row id as phrase_id at the response root", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body } = await callSave();
    assertEquals(status, 200);
    assertEquals(body.phrase_id, SAVED_PHRASES_ROW_ID);
    // Never the corpus phrase_id column, which is a different id entirely.
    assertEquals(body.phrase_id === CORPUS_PHRASE_ID, false);
    // The full row is still there for anything richer that wants it.
    assertEquals((body.phrase as { id: string }).id, SAVED_PHRASES_ROW_ID);
  } finally {
    restoreEnv(env);
  }
});
