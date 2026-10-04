/**
 * What a paying member is told about their own plan.
 *
 * The member screens (`MemberSheet` from Profile, the paywall's member state
 * from Home and Credits) used to say the same thing to everybody: "Your plan
 * is active" over the yearly plan's facts. A weekly subscriber read "50
 * credits a month", and a member on the yearly free trial was never told it
 * was a trial or when it ends (2026-10-04, founder: "prepare for the user who
 * has already paid").
 *
 * This reads the plan off RevenueCat's own record of the `katha` entitlement,
 * so the screen says what the store says: which plan, trial or paid, and the
 * date it renews, ends, or turns into a paid year. Pure, so it is tested
 * without the SDK; the screens pass `revenueCatService.profile`.
 *
 * A member with no RevenueCat entitlement (a tester holding the server-side
 * override, or the web build, where RevenueCat is off) gets the general
 * summary: no plan name and no date, because there is no store record to read
 * one from.
 */
import { useEffect, useState } from "react";

import { KATHA_ENTITLEMENT, STORE_SUBSCRIPTIONS, storeProductMatches } from "./store-catalog";

export type MemberPlanId = "weekly" | "monthly" | "yearly";

/** The slice of RevenueCat's `CustomerInfo` this reads. */
export type MemberProfileLike = {
  entitlements?: {
    active?: Record<
      string,
      | {
        productIdentifier: string;
        periodType?: string;
        expirationDate?: string | null;
        willRenew?: boolean;
      }
      | undefined
    >;
  };
} | null | undefined;

export type MemberPlanSummary = {
  /** "Yearly plan", or null when there is no store record to name it from. */
  planLabel: string | null;
  /** One line: trial end, renewal, or end date. */
  status: string;
  /** True while the free trial runs. */
  trial: boolean;
  /** What the plan includes, with the credit grant of THIS plan. */
  facts: string[];
};

const GRANTS: Record<MemberPlanId, string> = {
  weekly: "20 credits a week",
  monthly: "50 credits a month",
  yearly: "50 credits a month",
};

const LABELS: Record<MemberPlanId, string> = {
  weekly: "Weekly plan",
  monthly: "Monthly plan",
  yearly: "Yearly plan",
};

/** The three entitlement facts every paid plan shares (`CREDITS_AND_PRICING.md` §5). */
const SHARED_FACTS = [
  "Unlimited portraits and reimagines",
  "Premium voices",
  "Download as PDF",
] as const;

/** The plan held, from the entitlement's product id; null when unrecognised. */
export function memberPlanId(productIdentifier: string | undefined): MemberPlanId | null {
  if (!productIdentifier) return null;
  const match = STORE_SUBSCRIPTIONS.find((subscription) =>
    storeProductMatches(productIdentifier, subscription.productId)
  );
  return match?.plan ?? null;
}

function formatDate(iso: string, locale?: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

export function memberPlanSummary(
  profile: MemberProfileLike,
  locale?: string,
): MemberPlanSummary {
  const entitlement = profile?.entitlements?.active?.[KATHA_ENTITLEMENT];
  const plan = memberPlanId(entitlement?.productIdentifier);
  const trial = entitlement?.periodType === "TRIAL";
  // The grant row is THIS plan's, and only when we know the plan: an
  // unrecognised product (a retired SKU, an iOS id that differs) states the
  // three facts every plan shares rather than guessing the most generous
  // grant. A trial states what the trial actually granted (10, the
  // backend's `trialCredits`); the full grant is in the status line.
  const grant = !plan ? null : trial ? "10 credits during your trial" : GRANTS[plan];
  const facts = grant ? [grant, ...SHARED_FACTS] : [...SHARED_FACTS];
  if (!entitlement || !plan) {
    return {
      planLabel: null,
      status: "Your plan is active. Here is what it includes.",
      trial: false,
      // No store record at all (a tester override, the web build): the
      // general summary, which is the default plan's four rows.
      facts: entitlement ? facts : [GRANTS.yearly, ...SHARED_FACTS],
    };
  }

  const date = entitlement.expirationDate ? formatDate(entitlement.expirationDate, locale) : null;
  const renews = entitlement.willRenew !== false;
  let status: string;
  if (trial) {
    // A trial's grant is 10 credits; the plan's full grant lands with the
    // first charge (`_shared/revenuecat.ts` trialCredits).
    status = !date
      ? "You're on the free trial, with 10 credits to start."
      : renews
      ? `Free trial until ${date}. Your plan starts then, with its full credits, unless you cancel.`
      : `Free trial until ${date}. It won't continue after that.`;
  } else if (!date) {
    status = "Your plan is active. Here is what it includes.";
  } else {
    status = renews ? `Renews on ${date}.` : `Ends on ${date}. It won't renew.`;
  }
  return { planLabel: LABELS[plan], status, trial, facts };
}

/**
 * The store's profile, kept current. The member screens re-read it whenever
 * RevenueCat pushes an update, so a member who cancels in Play and comes
 * back reads "Ends on …", not the "Renews on …" they left, and a trial that
 * converts while the sheet is open says so. (`useIsSubscribed` holds only a
 * boolean, which does not change on either event.)
 */
export function useStoreProfile<P>(service: {
  profile: P;
  subscribe?: (listener: (profile: P) => void) => () => void;
}): P {
  const [profile, setProfile] = useState(service.profile);
  useEffect(() => {
    setProfile(service.profile);
    return service.subscribe?.((next) => setProfile(next));
  }, [service]);
  return profile;
}
