/**
 * What a plan gets you, and what it costs when you have no plan.
 *
 * One module so that a price a user reads on a button is derived, never typed.
 * Before this, the reimagine sheet said "1 credit" as a literal string, which
 * was wrong for every subscriber and wrong for the first reimagine of every
 * chapter — and the paywall three screens earlier had just promised both.
 *
 * **Canonical:** `source-of-truth/CREDITS_AND_PRICING.md` for the credit prices
 * these quotes fall back to, and the onboarding brief's plan entitlements for
 * the free allowances.
 *
 * THE CLIENT QUOTES, THE SERVER CHARGES. Nothing here is enforcement. The
 * allowance counters are passed in by the caller from whatever it knows, so a
 * caller with no count quotes the first-use price. The ledger that actually
 * decides whether a reimagine is free lives on the server and is a follow-up
 * (see the `reimaginesUsedOnChapter` prop on `ReimagineSheet`).
 */
import { useEffect, useState } from "react";

import { revenueCatService } from "./revenuecat";

/** Portraits a free account may generate before each one costs a credit. */
export const FREE_PORTRAITS_PER_ACCOUNT = 4;

/** Reimagines a free account may run per chapter, on its own stories. */
export const FREE_REIMAGINES_PER_CHAPTER = 1;

/** What a plan holder sees instead of a price. */
const INCLUDED_LABEL = "Included in your plan";

/** What one paid use of either action costs. */
const PAID_LABEL = "1 credit";

export type EntitlementQuote = {
  /** Whether this next use costs the user nothing. */
  free: boolean;
  /** The line to render on the control that spends it. */
  label: string;
};

/** Whether the user holds any active Katha entitlement right now. */
export function isSubscribed(): boolean {
  return revenueCatService.isPremium;
}

/**
 * `isSubscribed` as a hook, re-rendering when the entitlement changes.
 *
 * A purchase, a restore, an expiry and a `logIn` all arrive through
 * RevenueCat's CustomerInfo listener rather than through a navigation, so a
 * component that read `isSubscribed()` once at mount kept quoting the old price
 * for the rest of the session — most visibly straight after the paywall, which
 * is the one moment the user is watching for the change.
 */
export function useIsSubscribed(): boolean {
  const [subscribed, setSubscribed] = useState(() => revenueCatService.isPremium);
  useEffect(() => {
    // Re-read on mount as well as on change: activation may have completed
    // between the initial state and this effect.
    setSubscribed(revenueCatService.isPremium);
    return revenueCatService.subscribe(() => setSubscribed(revenueCatService.isPremium));
  }, []);
  return subscribed;
}

function freeQuote(remaining: number): EntitlementQuote {
  return { free: true, label: `${remaining} free` };
}

/** What the next reimagine of THIS chapter costs. */
export function reimagineQuote({
  subscribed,
  usedOnChapter,
}: {
  subscribed: boolean;
  usedOnChapter: number;
}): EntitlementQuote {
  if (subscribed) return { free: true, label: INCLUDED_LABEL };
  const remaining = FREE_REIMAGINES_PER_CHAPTER - Math.max(0, usedOnChapter);
  return remaining > 0 ? freeQuote(remaining) : { free: false, label: PAID_LABEL };
}

/** What the next character portrait on THIS account costs. */
export function portraitQuote({
  subscribed,
  usedOnAccount,
}: {
  subscribed: boolean;
  usedOnAccount: number;
}): EntitlementQuote {
  if (subscribed) return { free: true, label: INCLUDED_LABEL };
  const remaining = FREE_PORTRAITS_PER_ACCOUNT - Math.max(0, usedOnAccount);
  return remaining > 0 ? freeQuote(remaining) : { free: false, label: PAID_LABEL };
}
