// Stories are private by default, and this file is the proof.
//
// `publish-story` used to read a missing `visibility` field as "public". That
// made the public feed the destination of any caller that simply did not send
// the field -- an older client build, a retry rebuilt from a story id, a future
// integration -- and nothing in the repository would have failed if someone
// flipped the default back, because the default had no test.
//
// index.ts talks to Postgres through PostgREST and to auth through GoTrue, so
// the handler cannot be pointed at a bare database the way the migration tests
// are. What it *can* be pointed at is a stubbed `fetch`: every request the
// handler makes leaves through it, so recording those requests records exactly
// what the endpoint did to the story. A publish that never issues
// `is_public: true` did not publish anything.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest, resolveVisibility } from "./index.ts";

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Run one publish request against a stubbed network and return every request
 * the handler made.
 *
 * The story it answers with is the ordinary happy case: owned by the caller,
 * `status: "complete"`, not yet public, one chapter. Everything that could
 * reject the request before the visibility branch is therefore satisfied, so a
 * story that stays private stayed private *because of the default* and not
 * because some earlier gate refused the call.
 */
async function publish(
  body: Record<string, unknown>,
  storyIsPublic = false,
): Promise<{
  status: number;
  json: Record<string, unknown>;
  requests: Recorded[];
}> {
  const requests: Recorded[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = request.url;
    const text = request.method === "GET" || request.method === "HEAD"
      ? ""
      : await request.text();
    requests.push({
      method: request.method,
      url,
      body: text ? JSON.parse(text) : undefined,
    });

    const json = (value: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });

    if (url.includes("/auth/v1/user")) {
      return json({
        id: AUTHOR_ID,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }
    if (url.includes("/rest/v1/stories")) {
      if (request.method === "PATCH") return json([]);
      return json({
        id: STORY_ID,
        author_id: AUTHOR_ID,
        status: "complete",
        is_public: storyIsPublic,
      });
    }
    if (url.includes("/rest/v1/chapters")) {
      if (request.method === "PATCH") return json([]);
      // The ownership pre-check reads chapter ids with `id=in.(...)` and
      // expects a JSON array back. It is a different query from the count
      // below, and answering it with the count's empty body made every
      // edited chapter look like it belonged to another story.
      if (url.includes("id=in.")) {
        return json([{ id: CHAPTER_ID }]);
      }
      // `select("id", { count: "exact", head: true })` reads the count out of
      // the Content-Range header, not the body.
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": "0-0/1",
        },
      });
    }
    throw new Error(`unexpected request: ${request.method} ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleRequest(
      new Request("https://katha.test/publish-story", {
        method: "POST",
        headers: {
          "Authorization": "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    return {
      status: response.status,
      json: await response.json(),
      requests,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** Did the handler ever ask the database to make this story public? */
function wentPublic(requests: Recorded[]): boolean {
  return requests.some((r) =>
    r.method === "PATCH" &&
    r.url.includes("/rest/v1/stories") &&
    (r.body as Record<string, unknown> | undefined)?.is_public === true
  );
}

Deno.test("a publish call that omits visibility leaves the story private", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { status, json, requests } = await publish({ story_id: STORY_ID });

    assertEquals(status, 200);
    assertEquals(json.published, false);
    assertEquals(json.saved, true);
    assertFalse(
      wentPublic(requests),
      "omitting visibility must never write is_public = true",
    );
    assertFalse(
      requests.some((r) =>
        r.method === "PATCH" && r.url.includes("/rest/v1/chapters")
      ),
      "omitting visibility must never publish the story's chapters either",
    );
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("an explicit public publish still publishes", async () => {
  // The mirror of the test above. Without it, a handler that had simply stopped
  // publishing at all would pass the private test, and the private test would
  // be proving nothing.
  const beforeEnv = setTestEnv();
  try {
    const { status, json, requests } = await publish({
      story_id: STORY_ID,
      visibility: "public",
    });

    assertEquals(status, 200);
    assertEquals(json.published, true);
    assert(wentPublic(requests), "an explicit public publish must go public");
    assert(
      requests.some((r) =>
        r.method === "PATCH" && r.url.includes("/rest/v1/chapters") &&
        (r.body as Record<string, unknown>).is_published === true
      ),
      "chapters must be published alongside the story, never left behind",
    );
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("an explicit private save persists edits without publishing", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { json, requests } = await publish({
      story_id: STORY_ID,
      visibility: "private",
      title: "A quieter title",
    });

    assertEquals(json.saved, true);
    assertEquals(json.published, false);
    assert(
      requests.some((r) =>
        r.method === "PATCH" && r.url.includes("/rest/v1/stories") &&
        (r.body as Record<string, unknown>).title === "A quieter title"
      ),
      "a private save is still a save: the edit must be persisted",
    );
    assertFalse(wentPublic(requests));
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("an unrecognised visibility is rejected rather than guessed at", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { status, requests } = await publish({
      story_id: STORY_ID,
      visibility: "unlisted",
    });
    assertEquals(status, 400);
    assertFalse(wentPublic(requests));
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("resolveVisibility defaults to private and rejects anything else", () => {
  assertEquals(resolveVisibility(undefined), "private");
  assertEquals(resolveVisibility(null), "private");
  assertEquals(resolveVisibility("private"), "private");
  assertEquals(resolveVisibility("public"), "public");
  assertEquals(resolveVisibility("PUBLIC"), null);
  assertEquals(resolveVisibility(true), null);
  assertEquals(resolveVisibility(1), null);
});

// ---------------------------------------------------------------------------
// Environment
//
// The handler builds its Supabase clients from env vars at request time. The
// values only have to be well-formed URLs and non-empty keys; nothing in these
// tests reaches a real project.
// ---------------------------------------------------------------------------

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

// A save against an already-published story used to be answered
// `published: true` and then thrown away.
//
// The handler returned as soon as it saw `is_public`, and that return sat
// *above* the block that persists `edits`. The guard was written to stop a
// stale client retry silently demoting a live story, which is a real risk, but
// it was placed where it also swallowed every edit an author made after
// publishing. The editor kept the text on screen, so nothing looked wrong
// until a refresh.
//
// These tests pin both halves: edits reach the database, and visibility is
// still never demoted by a request that merely omitted the field.

/** Did the handler write this chapter's new content? */
function wroteChapterContent(requests: Recorded[], content: string): boolean {
  return requests.some((r) =>
    r.method === "PATCH" &&
    r.url.includes("/rest/v1/chapters") &&
    (r.body as Record<string, unknown> | undefined)?.content === content
  );
}

/** Did the handler ask the database to make this story private? */
function wentPrivate(requests: Recorded[]): boolean {
  return requests.some((r) =>
    r.method === "PATCH" &&
    r.url.includes("/rest/v1/stories") &&
    (r.body as Record<string, unknown> | undefined)?.is_public === false
  );
}

const CHAPTER_ID = "33333333-3333-4333-8333-333333333333";

Deno.test("an edit to an already-public story is persisted, not silently dropped", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { status, json, requests } = await publish({
      story_id: STORY_ID,
      chapters: [{ id: CHAPTER_ID, content: "The revised opening line." }],
    }, true);

    assertEquals(status, 200);
    assert(
      wroteChapterContent(requests, "The revised opening line."),
      "the edited chapter content never reached the database",
    );
    assertEquals(json.saved, true);
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("a save that omits visibility never demotes a public story", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { status, json, requests } = await publish({
      story_id: STORY_ID,
      chapters: [{ id: CHAPTER_ID, content: "Another revision." }],
    }, true);

    assertEquals(status, 200);
    assertFalse(
      wentPrivate(requests),
      "a save request unpublished a live story",
    );
    assertEquals(json.published, true);
  } finally {
    restoreEnv(beforeEnv);
  }
});

Deno.test("a title edit on an already-public story is persisted", async () => {
  const beforeEnv = setTestEnv();
  try {
    const { status, requests } = await publish({
      story_id: STORY_ID,
      title: "A Better Title",
    }, true);

    assertEquals(status, 200);
    assert(
      requests.some((r) =>
        r.method === "PATCH" &&
        r.url.includes("/rest/v1/stories") &&
        (r.body as Record<string, unknown> | undefined)?.title ===
          "A Better Title"
      ),
      "the edited title never reached the database",
    );
  } finally {
    restoreEnv(beforeEnv);
  }
});
