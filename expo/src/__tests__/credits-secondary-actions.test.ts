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

it("leads with what is ready to claim", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [claimable("a"), claimable("b")],
      // Two claimable and two claims left today is the only shape where "2
      // ready" is honest; the default fixture allows one a day.
      remaining: { today: 2, month: 5 },
    }),
  );
  expect(subtitle).toBe("2 ready to claim · 5 left this month");
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

it("promises nothing today once the daily cap is spent", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [claimable("a"), claimable("b")],
      remaining: { today: 0, month: 4 },
    }),
  );
  expect(subtitle).toBe("4 left to claim this month");
});

// The month is the harder ceiling: a claimable comment and a day's headroom
// still pay nothing once five have been taken this month.
it("is bounded by the month as well as the day", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [claimable("a")],
      remaining: { today: 1, month: 0 },
    }),
  );
  expect(subtitle).toBe("Claimed every one this month");
});

it("counts only the claimable ones", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [
        claimable("a"),
        { ...claimable("b"), status: "claimed" as const },
        { ...claimable("c"), status: "ineligible" as const, reason: "too_short" },
      ],
      remaining: { today: 2, month: 4 },
    }),
  );
  expect(subtitle).toBe("1 ready to claim · 4 left this month");
});

it("falls back to the month's headroom when nothing is ready", () => {
  expect(freeCreditsSubtitle(result({ remaining: { today: 0, month: 3 } })))
    .toBe("3 left to claim this month");
});

it("says so plainly at the monthly cap, and never shows a zero as a count", () => {
  const subtitle = freeCreditsSubtitle(
    result({
      claims: [{ ...claimable("a"), status: "ineligible" as const, reason: "monthly_cap" }],
      remaining: { today: 1, month: 0 },
    }),
  );
  expect(subtitle).toBe("Claimed every one this month");
});
