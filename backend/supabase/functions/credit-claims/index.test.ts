// The two mappings between `comment_credit_claims` / `claim_comment_credit`
// and the wire contract the Credits screen was built against.
//
// Nothing here tests a RULE -- every rule about who may claim what lives in
// SQL and is tested by `00089_..._test.ts` against real Postgres, which is
// the only place it can be tested honestly. What is tested here is the
// translation layer, because a renamed key in it produces a screen full of
// blank rows and a Claim button that does nothing, and no SQL test would ever
// see it.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shapeClaimResult, shapeClaims } from "./index.ts";

Deno.test("a claims payload becomes the contract's camelCase shape", () => {
  const shaped = shapeClaims({
    claims: [
      {
        comment_id: "c1",
        story_id: "s1",
        story_title: "The Lantern",
        excerpt: "A long and thoughtful note",
        created_at: "2026-09-16T10:00:00Z",
        status: "claimable",
        reason: null,
      },
      {
        comment_id: "c2",
        story_id: "s2",
        story_title: "Tides",
        excerpt: "ok",
        created_at: "2026-09-15T10:00:00Z",
        status: "ineligible",
        reason: "too_short",
      },
    ],
    remaining: { today: 1, month: 5 },
  });

  assertEquals(shaped.remaining, { today: 1, month: 5 });
  // A claimable row carries no `reason` key at all, rather than a null one:
  // the client tests for its presence.
  assertEquals(shaped.claims[0], {
    commentId: "c1",
    storyId: "s1",
    storyTitle: "The Lantern",
    excerpt: "A long and thoughtful note",
    createdAt: "2026-09-16T10:00:00Z",
    status: "claimable",
  });
  assertEquals(shaped.claims[1].reason, "too_short");
});

Deno.test("an empty or malformed claims payload is an empty list, not a crash", () => {
  for (const payload of [null, undefined, "", "not json", 7, [], {}]) {
    const shaped = shapeClaims(payload);
    assertEquals(shaped.claims, [], String(payload));
    assertEquals(shaped.remaining, { today: 0, month: 0 });
  }
});

Deno.test("a row with no comment id is dropped rather than rendered blank", () => {
  const shaped = shapeClaims({
    claims: [{ story_id: "s1" }, null, { comment_id: "c1" }],
  });
  assertEquals(shaped.claims.length, 1);
  assertEquals(shaped.claims[0].commentId, "c1");
  // Absent strings become empty strings, which the row renders as nothing.
  // Null would reach the client as the word "null" in a title.
  assertEquals(shaped.claims[0].storyTitle, "");
});

Deno.test("jsonb delivered as a string is still read", () => {
  const shaped = shapeClaims(
    JSON.stringify({
      claims: [{ comment_id: "c1", status: "claimed" }],
      remaining: { today: 0, month: 4 },
    }),
  );
  assertEquals(shaped.claims[0].status, "claimed");
  assertEquals(shaped.remaining.month, 4);
});

Deno.test("an unknown status reads as ineligible", () => {
  const shaped = shapeClaims({
    claims: [{ comment_id: "c1", status: "pending_review" }],
  });
  assertEquals(shaped.claims[0].status, "ineligible");
});

Deno.test("a successful claim reports credits and the new balance", () => {
  assertEquals(
    shapeClaimResult({ ok: true, credits: 1, balance: 7, replayed: false }),
    { ok: true, credits: 1, balance: 7 },
  );
  // A replay is the same event to the person who tapped, so it reads the same.
  assertEquals(
    shapeClaimResult({ ok: true, credits: 1, balance: 7, replayed: true }),
    { ok: true, credits: 1, balance: 7 },
  );
});

Deno.test("every contract refusal is relayed, and nothing else is", () => {
  for (
    const reason of [
      "too_short",
      "own_story",
      "not_read",
      "already_claimed",
      "story_cap",
      "daily_cap",
      "monthly_cap",
      "deleted",
      "reported",
      "tester",
    ]
  ) {
    assertEquals(shapeClaimResult({ ok: false, reason }), {
      ok: false,
      reason,
    });
  }

  // `invalid` is a reason `comment_credit_block_reason` can return for a
  // comment that is not the caller's; the claim path answers that as a 404
  // instead, so it must never arrive here as a verdict.
  for (
    const bad of [
      { ok: false, reason: "invalid" },
      { ok: false },
      {},
      null,
      "x",
    ]
  ) {
    assertEquals(shapeClaimResult(bad), null, JSON.stringify(bad));
  }
});
