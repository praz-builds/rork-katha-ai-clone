/**
 * The sub-line under "Get free credits".
 *
 * WHY THIS HAS A TEST OF ITS OWN. It is the one place on the Credits screen
 * that turns two server numbers into a sentence, and every way of getting it
 * wrong is silent: a stale count, a negative "-1 left this month", or a
 * confident figure invented while the request is still in flight. The caps
 * themselves are the server's and are tested in SQL; what is under test here
 * is only the sentence.
 */
import type { CreditClaimsResult } from "@/lib/api";
import { freeCreditsSubtitle } from "@/components/credits/SecondaryActions";

function result(
  overrides: Partial<CreditClaimsResult> = {},
): CreditClaimsResult {
  return { claims: [], remaining: { today: 1, month: 5 }, ...overrides };
}

const claimable = (id: string) => ({
  commentId: id,
  storyId: "s1",
  storyTitle: "A Story",
  excerpt: "Something worth forty characters, easily.",
  createdAt: "2026-09-27T00:00:00.000Z",
  status: "claimable" as const,
});

it("names the ways rather than a number while the list is unavailable", () => {
  // Null is both "still loading" and "could not be read". Neither is a moment
  // to quote a figure at somebody.
  expect(freeCreditsSubtitle(null)).toBe("Comment, keep a streak, invite a friend");
});

// The failure this guards: `remaining` used to default to {today: 0, month: 0}
// when the server did not send it, which is indistinguishable from a real
// zero. A degraded response -- an older deploy, or the shape moving -- then
// told a brand-new account that had never claimed anything that it had
// "Claimed every one this month". A missing number is not a zero.
it("says nothing exact when the server answered but did not count", () => {
  expect(freeCreditsSubtitle(result({ remaining: null })))
    .toBe("Comment, keep a streak, invite a friend");
  expect(freeCreditsSubtitle(result({ claims: [claimable("a")], remaining: null })))
    .toBe("Comment, keep a streak, invite a friend");
});

// `comment_credit_claims` computes `greatest(1 - v_today, 0)`, so
// `remaining.today` is only ever 1 or 0 and the ready count can never read
// higher than 1 in production. The fixtures say 1 rather than an invented 2:
// a test that pins a shape the server cannot return proves nothing about the
// screen and quietly becomes the documentation for a contract that is wrong.
it("leads with what is ready to claim", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [claimable("a"), claimable("b")],
      remaining: { today: 1, month: 5 },
    }),
  );
  expect(subtitle).toBe("1 ready to claim · 5 left this month");
});

// The daily cap is one, so three qualifying comments are not three credits.
// A button promising three and paying one is worse than one promising nothing.
it("never promises more than the caps will actually pay", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [claimable("a"), claimable("b"), claimable("c")],
      remaining: { today: 1, month: 5 },
    }),
  );
  expect(subtitle).toBe("1 ready to claim · 5 left this month");
});

// EVERY "nothing ready" CASE IS THE SAME SENTENCE, and it is the ways rather
// than a number. The fallback used to be `${left} left to claim this month`,
// which is cap HEADROOM and not claimable comments -- so an account with
// nothing eligible was told "5 left to claim this month" in a CTA above the
// fold, with none of the per-comment reasons that sit beside the same count
// further down the screen. Today that is every account, because no client
// records a read and every claim answers `not_read`; it was wrong for an
// ordinary established reader too.
it("names the ways when the daily cap is spent", () => {
  expect(freeCreditsSubtitle(
    result({
      claims: [claimable("a"), claimable("b")],
      remaining: { today: 0, month: 4 },
    }),
  )).toBe("Comment, keep a streak, invite a friend");
});

it("names the ways at the monthly cap", () => {
  expect(freeCreditsSubtitle(
    result({ claims: [claimable("a")], remaining: { today: 1, month: 0 } }),
  )).toBe("Comment, keep a streak, invite a friend");
});

it("names the ways when there is headroom but nothing eligible", () => {
  // The shape every account is in today: the caps allow five, and not one
  // comment can be claimed.
  expect(freeCreditsSubtitle(result({ remaining: { today: 1, month: 5 } })))
    .toBe("Comment, keep a streak, invite a friend");
  expect(freeCreditsSubtitle(
    result({
      claims: [{ ...claimable("a"), status: "ineligible" as const, reason: "not_read" }],
      remaining: { today: 1, month: 5 },
    }),
  )).toBe("Comment, keep a streak, invite a friend");
});

it("counts only the claimable ones", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [
        claimable("a"),
        { ...claimable("b"), status: "claimed" as const },
        { ...claimable("c"), status: "ineligible" as const, reason: "too_short" },
      ],
      remaining: { today: 1, month: 4 },
    }),
  );
  expect(subtitle).toBe("1 ready to claim · 4 left this month");
});

it("never shows a number the reader cannot act on", () => {
  // No branch may quote `remaining.month` on its own: it is how many claims
  // the caps would still allow, which says nothing about whether a single
  // comment qualifies.
  for (const remaining of [
    { today: 0, month: 3 },
    { today: 1, month: 5 },
    { today: 1, month: 0 },
    { today: 0, month: 0 },
  ]) {
    const subtitle = freeCreditsSubtitle(
      result({
        claims: [{ ...claimable("a"), status: "ineligible" as const, reason: "monthly_cap" }],
        remaining,
      }),
    );
    expect(subtitle).toBe("Comment, keep a streak, invite a friend");
  }
});
