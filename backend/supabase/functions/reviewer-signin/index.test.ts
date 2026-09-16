// The parts of the reviewer sign-in that can be tested without a database:
// the digest, the normalisation, and the refusals that happen before any
// lookup. The lockout arithmetic is SQL's and is tested in
// `00089_..._test.ts`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertNotEquals } from "https://deno.land/std@0.224.0/assert/assert_not_equals.ts";
import {
  clientIp,
  codeMessage,
  handleRequest,
  hmacHex,
  normalizeCode,
  normalizeEmail,
  sha256Hex,
} from "./index.ts";

const PEPPER = "5c0d1f9a4b2e7c8d3a6f0b1e9d4c7a2f";

Deno.test("the digest matches what the column stores, and is stable", async () => {
  const first = await hmacHex(
    PEPPER,
    codeMessage("reviewer@thetractionlabs.com", "421907"),
  );
  const second = await hmacHex(
    PEPPER,
    codeMessage("reviewer@thetractionlabs.com", "421907"),
  );
  assertEquals(first, second);
  assertEquals(first.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(first), true);
});

/**
 * THE ADDRESS IS INSIDE THE MESSAGE.
 *
 * Without it, a digest lifted from one account's row would verify the same
 * code against any other address the table ever gains. With it, the digest is
 * bound to the one account it was issued for.
 */
Deno.test("the same code under a different address is a different digest", async () => {
  const reviewer = await hmacHex(
    PEPPER,
    codeMessage("a@example.com", "421907"),
  );
  const other = await hmacHex(PEPPER, codeMessage("b@example.com", "421907"));
  assertNotEquals(reviewer, other);
});

/** The pepper is what a database dump does not contain. */
Deno.test("a different pepper produces a different digest", async () => {
  const withPepper = await hmacHex(
    PEPPER,
    codeMessage("a@example.com", "421907"),
  );
  const withOther = await hmacHex(
    "other",
    codeMessage("a@example.com", "421907"),
  );
  assertNotEquals(withPepper, withOther);
});

/**
 * The separator rules out the (harmless here, but free to remove) collision
 * between an address ending in a digit and a code missing one.
 */
Deno.test("the separator keeps address and code from running together", () => {
  assertEquals(codeMessage("ab", "123456"), "ab:123456");
  assertNotEquals(codeMessage("ab1", "23456"), codeMessage("ab", "123456"));
});

Deno.test("an address is trimmed and lowercased, as the primary key stores it", () => {
  assertEquals(
    normalizeEmail("  Reviewer@TheTractionLabs.com "),
    "reviewer@thetractionlabs.com",
  );
  assertEquals(normalizeEmail(null), "");
  assertEquals(normalizeEmail(42), "");
});

Deno.test("a code is exactly six digits or it is nothing", () => {
  assertEquals(normalizeCode(" 421907 "), "421907");
  assertEquals(normalizeCode("42190"), "");
  assertEquals(normalizeCode("4219078"), "");
  assertEquals(normalizeCode("42190a"), "");
  assertEquals(normalizeCode("４２１９０７"), "");
  assertEquals(normalizeCode(421907), "");
  assertEquals(normalizeCode(null), "");
});

/**
 * A missing header is null rather than a shared constant. Every caller
 * without one would otherwise land in the same per-IP bucket and lock each
 * other out of an endpoint the store reviewer needs to work first time.
 */
Deno.test("the client IP is the first forwarded hop, or nothing", () => {
  const withHeader = new Request("https://example.com", {
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
  });
  assertEquals(clientIp(withHeader), "203.0.113.7");
  assertEquals(clientIp(new Request("https://example.com")), null);
  assertEquals(
    clientIp(
      new Request("https://example.com", {
        headers: { "x-forwarded-for": "   " },
      }),
    ),
    null,
  );
  assertEquals(
    clientIp(
      new Request("https://example.com", {
        headers: { "x-forwarded-for": "a".repeat(200) },
      }),
    ),
    null,
  );
});

Deno.test("a digest is a hex sha256 of exactly what it was given", async () => {
  // The empty string's sha256, so a typo in the encoding shows up as a wrong
  // constant rather than as a self-consistent wrong answer.
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("anything but POST is refused, and OPTIONS is answered", async () => {
  const get = await handleRequest(
    new Request("https://example.com", { method: "GET" }),
  );
  assertEquals(get.status, 405);

  const preflight = await handleRequest(
    new Request("https://example.com", { method: "OPTIONS" }),
  );
  assertEquals(preflight.status, 204);
});

// ---------------------------------------------------------------------------
// The mint, with the network stubbed
// ---------------------------------------------------------------------------
//
// The rule under test: `tester_accounts.user_id` is the account, and the
// address typed at the door is not. GoTrue's magic-link generation SIGNS UP
// an address it cannot find, so a `tester_accounts.email` that has drifted
// away from its auth user's address would otherwise mint a session for a
// brand-new account. Both halves of the fix are asserted here -- the address
// is read back from `auth.users` by id, and the user the link resolves to has
// to be that same id.

const TESTER_USER_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_USER_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
/** What the caller types, and what the (stale) table row holds. */
const TYPED_EMAIL = "reviewer@thetractionlabs.com";
/** What `auth.users` actually holds for `TESTER_USER_ID`. */
const AUTH_EMAIL = "reviewer+real@thetractionlabs.com";
const CODE = "421907";

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  REVIEWER_CODE_PEPPER: PEPPER,
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

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Scenario = {
  /** The address `auth.users` returns for the row's `user_id`. */
  authEmail: string | null;
  /** The user id `generateLink` resolves to -- a sign-up returns a new one. */
  linkUserId: string;
};

type Calls = {
  generateLinkEmail: string | null;
  getUserByIdPath: string | null;
};

function makeFetchStub(scenario: Scenario, calls: Calls): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/rest/v1/rpc/reviewer_signin_locked") {
      return json(false);
    }

    if (url.pathname === "/rest/v1/tester_accounts") {
      // `maybeSingle()` on a GET: PostgREST answers with a row array.
      return json([{
        email: TYPED_EMAIL,
        user_id: TESTER_USER_ID,
        code_hmac: await hmacHex(PEPPER, codeMessage(TYPED_EMAIL, CODE)),
      }]);
    }

    if (url.pathname === "/rest/v1/reviewer_signin_attempts") return json([]);
    if (url.pathname === "/rest/v1/error_events") return json([]);

    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      calls.getUserByIdPath = url.pathname;
      return json({
        id: TESTER_USER_ID,
        ...(scenario.authEmail === null ? {} : { email: scenario.authEmail }),
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }

    if (url.pathname === "/auth/v1/admin/generate_link") {
      const body = await request.json() as { email?: string };
      calls.generateLinkEmail = body.email ?? null;
      return json({
        id: scenario.linkUserId,
        email: body.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
        action_link: "https://project.supabase.test/auth/v1/verify?token=x",
        email_otp: "123456",
        hashed_token: "pkce_deadbeefdeadbeefdeadbeefdeadbeef",
        redirect_to: "https://katha.test/",
        verification_type: "magiclink",
      });
    }

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

async function signIn(
  scenario: Scenario,
  code = CODE,
): Promise<
  { status: number; body: Record<string, unknown>; calls: Calls }
> {
  const calls: Calls = { generateLinkEmail: null, getUserByIdPath: null };
  const env = setTestEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(scenario, calls);
  try {
    const response = await handleRequest(
      new Request("https://katha.test/reviewer-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TYPED_EMAIL, code }),
      }),
    );
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
}

Deno.test("the happy path returns a token_hash, minted for the address auth.users holds", async () => {
  const { status, body, calls } = await signIn({
    authEmail: AUTH_EMAIL,
    linkUserId: TESTER_USER_ID,
  });
  assertEquals(status, 200);
  assertEquals(body.type, "magiclink");
  assertEquals(typeof body.token_hash, "string");
  assertEquals((body.token_hash as string).length > 0, true);
  // Looked up by the row's id, not by the address.
  assertEquals(calls.getUserByIdPath, `/auth/v1/admin/users/${TESTER_USER_ID}`);
  // And the link was minted for what that lookup returned, not for what the
  // caller typed -- this is the half that stops a sign-up from happening.
  assertEquals(calls.generateLinkEmail, AUTH_EMAIL);
  assertNotEquals(calls.generateLinkEmail, TYPED_EMAIL);
});

Deno.test("a link that resolves to any other auth user is refused, with the same generic 401", async () => {
  const { status, body } = await signIn({
    authEmail: AUTH_EMAIL,
    linkUserId: OTHER_USER_ID,
  });
  assertEquals(status, 401);
  assertEquals(body, { error: "invalid" });
  assertEquals("token_hash" in body, false);
});

Deno.test("a tester row whose user_id has no address mints nothing", async () => {
  const { status, body, calls } = await signIn({
    authEmail: null,
    linkUserId: TESTER_USER_ID,
  });
  assertEquals(status, 401);
  assertEquals(body, { error: "invalid" });
  // Refused before the link is generated at all.
  assertEquals(calls.generateLinkEmail, null);
});

Deno.test("a wrong code still fails before any link is generated", async () => {
  const { status, body, calls } = await signIn(
    { authEmail: AUTH_EMAIL, linkUserId: TESTER_USER_ID },
    "000000",
  );
  assertEquals(status, 401);
  assertEquals(body, { error: "invalid" });
  assertEquals(calls.getUserByIdPath, null);
  assertEquals(calls.generateLinkEmail, null);
});
