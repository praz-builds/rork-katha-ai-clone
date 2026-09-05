import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anonymousGrantScope,
  expandIpv6,
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
