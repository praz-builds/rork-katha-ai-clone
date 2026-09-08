// `record-practice`'s OUTCOMES set has to agree with the client's wire
// vocabulary and with the `record_phrase_practice` SQL check constraint
// (migration `00047`) it forwards to. This proves the literal value the
// real client puts on the wire (`expo/src/lib/phrases.ts`'s
// `PRACTICE_OUTCOME_WIRE_VALUE` mapping) is accepted end to end by this
// endpoint, not just by a client-side unit test mocking the network away.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PHRASE_ID = "22222222-2222-4222-8222-222222222222";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Calls {
  rpcOutcomes: string[];
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

    if (url.pathname === "/rest/v1/rpc/record_phrase_practice") {
      const body = await request.json() as { p_outcome: string };
      calls.rpcOutcomes.push(body.p_outcome);
      return json({
        id: "practice-1",
        user_id: USER_ID,
        saved_phrase_id: PHRASE_ID,
        outcome: body.p_outcome,
        interval_days: 1,
        ease: 2.5,
        due_at: new Date().toISOString(),
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

async function run(
  calls: Calls,
  outcome: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(calls);
  try {
    const response = await handleRequest(
      new Request("https://katha.test/record-practice", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phraseId: PHRASE_ID, outcome }),
      }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// The client's wire mapping sends "good" for its "know" (got it) answer and
// "again" for its "again" (still learning) answer -- see
// `PRACTICE_OUTCOME_WIRE_VALUE` in `expo/src/lib/phrases.ts`. Both must be
// accepted, end to end, not silently rejected the way the old unmapped
// "know" was on every single successful answer.
Deno.test("the client's mapped outcome for a successful answer ('good') is accepted end to end", async () => {
  const env = setTestEnv();
  const calls: Calls = { rpcOutcomes: [] };
  try {
    const { status, json: body } = await run(calls, "good");
    assertEquals(status, 200);
    assertEquals(calls.rpcOutcomes, ["good"]);
    assertEquals((body.practice as { outcome: string }).outcome, "good");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("the client's mapped outcome for 'still learning' ('again') is accepted end to end", async () => {
  const env = setTestEnv();
  const calls: Calls = { rpcOutcomes: [] };
  try {
    const { status } = await run(calls, "again");
    assertEquals(status, 200);
    assertEquals(calls.rpcOutcomes, ["again"]);
  } finally {
    restoreEnv(env);
  }
});

// The literal string the client used to send before the fix -- this must
// stay rejected, so a future change to the wire mapping cannot silently
// regress back to it.
Deno.test("the client's old unmapped 'know' literal stays rejected", async () => {
  const env = setTestEnv();
  const calls: Calls = { rpcOutcomes: [] };
  try {
    const { status, json: body } = await run(calls, "know");
    assertEquals(status, 400);
    assertEquals(body.error, "Invalid outcome");
    assertEquals(calls.rpcOutcomes, []);
  } finally {
    restoreEnv(env);
  }
});
