import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anonymousGrantScope,
  GUEST_BOOTSTRAP_CREDITS,
  GUEST_BOOTSTRAP_WINDOW_LIMIT,
  guestBootstrapOperationKey,
  hashAnonymousGrantScope,
  isAnonymousUser,
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

Deno.test("guest bootstrap hashes scopes and recognizes verified guest users", async () => {
  const first = await hashAnonymousGrantScope("ipv4:203.0.113.0/24", "secret");
  const second = await hashAnonymousGrantScope("ipv4:203.0.113.0/24", "secret");
  assertEquals(first, second);
  assertMatch(first, /^[a-f0-9]{64}$/);
  assertEquals(isAnonymousUser({ id: "guest", is_anonymous: true }), true);
  assertEquals(isAnonymousUser({ id: "member", is_anonymous: false }), false);
});
