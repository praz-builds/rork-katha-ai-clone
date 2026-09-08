import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hashAnonymousGrantScope } from "./guest-bootstrap.ts";
import {
  claimGroundingFallback,
  type GroundingRateLimitClient,
} from "./grounding-rate-limit.ts";

const NAMED_USER = { id: "00000000-0000-4000-8000-000000000901" };
const GUEST_USER = {
  id: "00000000-0000-4000-8000-000000000902",
  is_anonymous: true,
};

function requestWithIp(ip: string | null): Request {
  return new Request("https://example.test", {
    headers: ip ? { "cf-connecting-ip": ip } : {},
  });
}

Deno.test("a signed-in caller is checked with no anonymous scope", async () => {
  let seenParams: Record<string, unknown> | null = null;
  const client: GroundingRateLimitClient = {
    rpc(name, params) {
      seenParams = params;
      return Promise.resolve({
        data: name === "claim_grounding_fallback_request",
        error: null,
      });
    },
  };
  const allowed = await claimGroundingFallback({
    user: NAMED_USER,
    request: requestWithIp(null),
    serviceRoleKey: "secret",
    client,
  });
  assertEquals(allowed, true);
  assertEquals(seenParams, {
    p_user_id: NAMED_USER.id,
    p_anonymous_scope_hash: null,
  });
});

Deno.test("an anonymous caller is checked against a hashed network scope", async () => {
  let seenParams: Record<string, unknown> | null = null;
  const client: GroundingRateLimitClient = {
    rpc(_name, params) {
      seenParams = params;
      return Promise.resolve({ data: true, error: null });
    },
  };
  const allowed = await claimGroundingFallback({
    user: GUEST_USER,
    request: requestWithIp("203.0.113.42"),
    serviceRoleKey: "secret",
    client,
  });
  assertEquals(allowed, true);
  const expectedHash = await hashAnonymousGrantScope(
    "ipv4:203.0.113.0/24",
    "secret",
  );
  assertEquals(seenParams, {
    p_user_id: GUEST_USER.id,
    p_anonymous_scope_hash: expectedHash,
  });
  assertMatch(expectedHash, /^[a-f0-9]{64}$/);
});

Deno.test("an anonymous caller with no trusted network header fails closed", async () => {
  let calls = 0;
  const client: GroundingRateLimitClient = {
    rpc() {
      calls++;
      return Promise.resolve({ data: true, error: null });
    },
  };
  const allowed = await claimGroundingFallback({
    user: GUEST_USER,
    request: requestWithIp(null),
    serviceRoleKey: "secret",
    client,
  });
  assertEquals(allowed, false);
  // Fails closed before ever spending the RPC round trip.
  assertEquals(calls, 0);
});

Deno.test("a database error fails closed rather than open", async () => {
  const client: GroundingRateLimitClient = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: "connection reset" },
      });
    },
  };
  const allowed = await claimGroundingFallback({
    user: NAMED_USER,
    request: requestWithIp(null),
    serviceRoleKey: "secret",
    client,
  });
  assertEquals(allowed, false);
});

Deno.test("a thrown rpc call fails closed and never rejects the caller", async () => {
  const client: GroundingRateLimitClient = {
    rpc() {
      return Promise.reject(new Error("network down"));
    },
  };
  const allowed = await claimGroundingFallback({
    user: NAMED_USER,
    request: requestWithIp(null),
    serviceRoleKey: "secret",
    client,
  });
  assertEquals(allowed, false);
});

Deno.test("a false rpc result is a plain denial, not coerced from truthy junk", async () => {
  const client: GroundingRateLimitClient = {
    rpc() {
      return Promise.resolve({ data: "true", error: null });
    },
  };
  const allowed = await claimGroundingFallback({
    user: NAMED_USER,
    request: requestWithIp(null),
    serviceRoleKey: "secret",
    client,
  });
  // A string "true" is not the boolean true; only an actual boolean grants.
  assertEquals(allowed, false);
});
