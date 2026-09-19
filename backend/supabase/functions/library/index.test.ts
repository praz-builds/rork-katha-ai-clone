// `?scope=mine` is what makes a writer's own work reachable.
//
// Before it, no endpoint anywhere returned a story that was not public: the
// library query is `is_public OR is_curated`, and a fresh story is private
// by column default unless its writer asked for public. Stories were
// persisted and then unreachable — the interface forgot them on reload while
// the rows sat safe in Postgres, stories the writer had paid credits for.
//
// The rule this file guards is that `scope=mine` is scoped by the RESOLVED
// user and never by the parameter. A caller who simply asks for "mine" without
// a usable token must get the public library, not somebody's drafts.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  method: string;
  url: string;
}

/**
 * Run one library request against a stubbed network and return the PostgREST
 * calls it made. `authenticated` decides whether the auth endpoint resolves a
 * user, which is the only thing that should ever unlock `scope=mine`.
 */
async function get(
  query: string,
  options: { authenticated: boolean } = { authenticated: true },
): Promise<{ status: number; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    requests.push({ method: request.method, url: request.url });

    if (request.url.includes("/auth/v1/user")) {
      if (!options.authenticated) {
        return new Response(JSON.stringify({}), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: USER_ID,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Every other call is the stories/engagement read.
    return new Response("[]", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": "0-0/0",
      },
    });
  }) as typeof fetch;

  const before = setTestEnv();
  try {
    const response = await handleRequest(
      new Request(`https://katha.test/library${query}`, {
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    return { status: response.status, requests };
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(before);
  }
}

/** The PostgREST read against `stories`, which is where the scope shows up. */
function storiesQuery(requests: Recorded[]): string | undefined {
  return requests.find((r) => r.url.includes("/rest/v1/stories"))?.url;
}

Deno.test("scope=mine reads the caller's own stories, whatever their visibility", async () => {
  const { requests } = await get("?scope=mine");
  const query = storiesQuery(requests);
  assert(query, "no stories query was issued");

  assert(
    query.includes(`author_id=eq.${USER_ID}`),
    `expected an author filter, got ${query}`,
  );
  // The two filters that exist to shape a PUBLIC browse must be absent. A
  // writer sees their own private draft, and refusing to show someone the
  // story they wrote because of how it was rated is not a safety measure.
  // Matched as FILTERS, not as substrings: `content_rating` also appears in
  // the select column list, so a bare `includes` would assert nothing.
  assert(
    !query.includes("is_public.eq.true"),
    "a writer's own drafts were filtered out",
  );
  assert(
    !query.includes("content_rating=neq."),
    "a writer was refused their own story by its rating",
  );
});

Deno.test("scope=mine from an unusable token returns the public library, not drafts", async () => {
  // The parameter is a request, never an authorisation. This is the case that
  // would leak somebody else's unpublished work if the scope were trusted.
  const { requests } = await get("?scope=mine", { authenticated: false });
  const query = storiesQuery(requests);
  assert(query, "no stories query was issued");

  assert(
    !query.includes("author_id=eq."),
    "an unauthenticated caller was scoped to an author",
  );
  assert(query.includes("is_public.eq.true"), "the public filter was dropped");
});

Deno.test("the default browse is unchanged", async () => {
  // Everything that existed before this parameter must behave exactly as it
  // did: public or curated, complete, nothing explicit.
  const { requests } = await get("?page=1&limit=20");
  const query = storiesQuery(requests);
  assert(query);
  assert(query.includes("is_public.eq.true"));
  assert(query.includes("content_rating=neq."));
  assert(!query.includes("author_id=eq."));
});

Deno.test("an unrecognised scope is refused rather than guessed at", async () => {
  const { status } = await get("?scope=everyone");
  assertEquals(status, 400);
});

Deno.test("scope=public is accepted and behaves as the default", async () => {
  const { status, requests } = await get("?scope=public");
  assertEquals(status, 200);
  const query = storiesQuery(requests);
  assert(query);
  assert(query.includes("is_public.eq.true"));
  assert(!query.includes("author_id=eq."));
});

// ---------------------------------------------------------------------------
// Environment
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
