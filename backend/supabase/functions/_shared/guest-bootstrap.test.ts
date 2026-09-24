import {
  assertEquals,
  assertMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anonymousGrantScope,
  expandIpv6,
  GUEST_BOOTSTRAP_CREDITS,
  GUEST_BOOTSTRAP_WINDOW_LIMIT,
  guestBootstrapOperationKey,
  hashAnonymousGrantScope,
  isAnonymousUser,
  readGuestClaimToken,
  runBootstrapReads,
} from "./guest-bootstrap.ts";

Deno.test("guest bootstrap constants and operation key stay canonical", () => {
  assertEquals(GUEST_BOOTSTRAP_CREDITS, 3);
  assertEquals(GUEST_BOOTSTRAP_WINDOW_LIMIT, 3);
  assertEquals(
    guestBootstrapOperationKey("00000000-0000-4000-8000-000000000001"),
    "guest_bootstrap:00000000-0000-4000-8000-000000000001",
  );
});

Deno.test("guest bootstrap scopes forwarded networks coarsely", () => {
  assertEquals(
    anonymousGrantScope(
      new Request("https://example.test", {
        headers: { "fly-client-ip": "203.0.113.42" },
      }),
    ),
    "ipv4:203.0.113.0/24",
  );
  assertEquals(
    anonymousGrantScope(
      new Request("https://example.test", {
        headers: { "cf-connecting-ip": "2001:db8:85a3:8a2e:370:7334::" },
      }),
    ),
    "ipv6:2001:db8:85a3:8a2e::/64",
  );
  assertEquals(
    anonymousGrantScope(new Request("https://example.test")),
    null,
  );
  assertEquals(
    anonymousGrantScope(
      new Request("https://example.test", {
        headers: { "x-forwarded-for": "203.0.113.42" },
      }),
    ),
    null,
  );
});

Deno.test("ipv6 expansion fills the elided hextets before the prefix is taken", () => {
  assertEquals(
    expandIpv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
    ["2001", "db8", "85a3", "0", "0", "8a2e", "370", "7334"],
  );
  assertEquals(
    expandIpv6("2001:db8::1"),
    ["2001", "db8", "0", "0", "0", "0", "0", "1"],
  );
  assertEquals(expandIpv6("::"), ["0", "0", "0", "0", "0", "0", "0", "0"]);
  assertEquals(expandIpv6("::1"), ["0", "0", "0", "0", "0", "0", "0", "1"]);
  assertEquals(
    expandIpv6("2001:DB8::A"),
    ["2001", "db8", "0", "0", "0", "0", "0", "a"],
  );

  // Too few hextets, too many, a doubled elision, an over-wide hextet, and the
  // IPv4-mapped form all have to fail closed rather than produce a prefix.
  assertEquals(expandIpv6("2001:db8:85a3"), null);
  assertEquals(expandIpv6("1:2:3:4:5:6:7:8:9"), null);
  assertEquals(expandIpv6("1:2:3:4:5:6:7:8::"), null);
  assertEquals(expandIpv6("1::2::3"), null);
  assertEquals(expandIpv6("2001:db8:85a3:0:0:8a2e:0370:73345"), null);
  assertEquals(expandIpv6("::ffff:192.0.2.1"), null);
  assertEquals(expandIpv6("not-an-address"), null);
  assertEquals(expandIpv6(""), null);
});

Deno.test("compressed ipv6 addresses on one /64 share a grant scope", () => {
  const scopeFor = (ip: string) =>
    anonymousGrantScope(
      new Request("https://example.test", {
        headers: { "cf-connecting-ip": ip },
      }),
    );

  // The whole point of the /64: two devices behind one household prefix must
  // draw on one grant budget. Slicing the literal text gave them one each.
  assertEquals(scopeFor("2001:db8::1"), "ipv6:2001:db8:0:0::/64");
  assertEquals(scopeFor("2001:db8::2"), scopeFor("2001:db8::1"));
  assertEquals(
    scopeFor("2001:0db8:0000:0000:0000:0000:0000:0009"),
    scopeFor("2001:db8::1"),
  );
  // A different /64 still gets its own budget.
  assertEquals(scopeFor("2001:db8:1::1"), "ipv6:2001:db8:1:0::/64");

  // Malformed input fails closed, exactly as a missing header does.
  assertEquals(scopeFor("1::2::3"), null);
  assertEquals(scopeFor("::ffff:192.0.2.1"), null);
  assertEquals(scopeFor(":::"), null);
});

Deno.test("guest bootstrap hashes scopes and recognizes verified guest users", async () => {
  const first = await hashAnonymousGrantScope("ipv4:203.0.113.0/24", "secret");
  const second = await hashAnonymousGrantScope("ipv4:203.0.113.0/24", "secret");
  assertEquals(first, second);
  assertMatch(first, /^[a-f0-9]{64}$/);
  assertEquals(isAnonymousUser({ id: "guest", is_anonymous: true }), true);
  assertEquals(isAnonymousUser({ id: "member", is_anonymous: false }), false);
});

Deno.test("only a JWS-shaped claim token is worth verifying", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJndWVzdCJ9.c2lnbmF0dXJl";
  assertEquals(readGuestClaimToken({ claim_guest_token: ` ${token} ` }), token);

  // Every absent, wrong-typed or malformed value is simply "no claim": the
  // caller then bootstraps normally instead of spending a round trip on the
  // auth service for a string that cannot be a token.
  assertEquals(readGuestClaimToken(null), null);
  assertEquals(readGuestClaimToken({}), null);
  assertEquals(readGuestClaimToken({ claim_guest_token: 42 }), null);
  assertEquals(readGuestClaimToken({ claim_guest_token: "not.a" }), null);
  assertEquals(readGuestClaimToken({ claim_guest_token: "a.b.c.d" }), null);
  assertEquals(readGuestClaimToken({ claim_guest_token: "a b.c.d" }), null);
  assertEquals(
    readGuestClaimToken({ claim_guest_token: `${"a".repeat(4100)}.b.c` }),
    null,
  );
});

/** A step that records when it started and resolves only when released. */
function gate<T>(name: string, started: string[], value: T) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    run: async () => {
      started.push(name);
      await released;
      return value;
    },
  };
}

Deno.test("bootstrap reads start together rather than one after another", async () => {
  const started: string[] = [];
  const identity = gate("identity", started, undefined);
  const balance = gate("balance", started, 7);
  const free = gate("free", started, 2);

  const pending = runBootstrapReads({
    guest: false,
    ensureIdentity: identity.run,
    grantGuest: () => Promise.reject(new Error("a named account is never granted")),
    readBalance: balance.run,
    readFreeRemaining: free.run,
  });

  // Nothing has resolved, and all three are already in flight. Run in sequence,
  // only the first would have started.
  await Promise.resolve();
  assertEquals(started.sort(), ["balance", "free", "identity"]);

  identity.release();
  balance.release();
  free.release();
  assertEquals(await pending, {
    balance: 7,
    welcomeGranted: false,
    rateLimited: false,
    characterImagesFreeRemaining: 2,
  });
});

Deno.test("a guest's balance is the grant's answer, never the racing ledger read", async () => {
  let identityCalls = 0;
  const result = await runBootstrapReads({
    guest: true,
    ensureIdentity: () => {
      identityCalls += 1;
      return Promise.resolve();
    },
    grantGuest: () =>
      Promise.resolve({ balance: 3, welcomeGranted: true, rateLimited: false }),
    // The read that went out before the grant landed: the pre-grant zero.
    readBalance: () => Promise.resolve(0),
    readFreeRemaining: () => Promise.resolve(null),
  });

  assertEquals(result, {
    balance: 3,
    welcomeGranted: true,
    rateLimited: false,
    characterImagesFreeRemaining: null,
  });
  // A guest is not given a handle or an invite code (D1).
  assertEquals(identityCalls, 0);
});

Deno.test("a rate-limited guest falls back to the ledger balance", async () => {
  const result = await runBootstrapReads({
    guest: true,
    ensureIdentity: () => Promise.resolve(),
    grantGuest: () =>
      Promise.resolve({ balance: null, welcomeGranted: false, rateLimited: true }),
    readBalance: () => Promise.resolve(1),
    readFreeRemaining: () => Promise.resolve(6),
  });
  assertEquals(result.balance, 1);
  assertEquals(result.rateLimited, true);
  assertEquals(result.welcomeGranted, false);
});

Deno.test("a failed balance read still fails the bootstrap", async () => {
  await assertRejects(
    () =>
      runBootstrapReads({
        guest: false,
        ensureIdentity: () => Promise.resolve(),
        grantGuest: () => Promise.reject(new Error("unused")),
        readBalance: () => Promise.reject(new Error("ledger unreachable")),
        readFreeRemaining: () => Promise.resolve(6),
      }),
    Error,
    "ledger unreachable",
  );
});
