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
 * (see the `repromptsUsedOnChapter` prop on `RepromptSheet`).
 */
import { useEffect, useState } from "react";

import { revenueCatService } from "./revenuecat";

/**
 * Character images ANY account may generate before each one costs a credit.
 *
 * Three, for the life of the account, generations and edits alike -- and the
 * same three whether or not the user pays. (Six until 2026-09-24; the product
 * owner cut it to three, migration 00096.) It is not a free-tier allowance: the
 * subscriber exemption that used to make portraits unlimited on a plan was
 * withdrawn on 2026-09-14, and `CREDITS_AND_PRICING.md` §3 carries the note
 * saying the paywall still sells unlimited while this deployment caps it.
 *
 * The number is duplicated in migration 00096, which is the one that enforces
 * it. This copy exists to QUOTE a price, never to decide one -- see the module
 * note above.
 */
export const FREE_PORTRAITS_PER_ACCOUNT = 3;

/** Reimagines a free account may run per chapter, on its own stories. */
export const FREE_REIMAGINES_PER_CHAPTER = 1;

/** What a plan holder sees instead of a price. */
const INCLUDED_LABEL = "Included in your plan";

/** What one paid use of either action costs. */
/** What a guest is told instead of a price they cannot pay. */
const SIGN_IN_LABEL = "Sign in to make more";

const PAID_LABEL = "1 credit";

export type EntitlementQuote = {
  /** Whether this next use costs the user nothing. */
  free: boolean;
  /** The line to render on the control that spends it. */
  label: string;
  /**
   * True when the next one cannot be bought at all, only unlocked by signing
   * in. The caller must disable the control regardless of balance: a guest
   * holding credits still cannot spend them here.
   */
  requiresAccount?: boolean;
};

/**
 * The server-side entitlement override, mirrored on the client.
 *
 * `profiles.entitlement_override` is how a tester account (D11) holds the
 * plan without a receipt: the reviewer signing in with the fixed code, and the
 * owner's own account. It arrives with the profile overview and is set here by
 * `fetchOwnProfile`; sign-out resets it to null. It is deliberately NOT
 * written into `revenueCatService`: that object mirrors the store, and faking
 * a receipt in it would make a restore or a Customer Center visit disagree
 * with what the app believes.
 *
 * The override never bypasses an operational kill switch. It answers "does
 * this account hold the plan", and nothing else.
 */
export type EntitlementOverride = "katha" | null;

let entitlementOverride: EntitlementOverride = null;
const overrideListeners = new Set<() => void>();

export function setEntitlementOverride(value: EntitlementOverride): void {
  const next: EntitlementOverride = value === "katha" ? "katha" : null;
  if (next === entitlementOverride) return;
  entitlementOverride = next;
  overrideListeners.forEach((listener) => listener());
}

export function getEntitlementOverride(): EntitlementOverride {
  return entitlementOverride;
}

/** Whether the user holds any active Katha entitlement right now. */
export function isSubscribed(): boolean {
  return entitlementOverride !== null || revenueCatService.isPremium;
}

/**
 * `isSubscribed` as a hook, re-rendering when the entitlement changes.
 *
 * A purchase, a restore, an expiry and a `logIn` all arrive through
 * RevenueCat's CustomerInfo listener rather than through a navigation, so a
 * component that read `isSubscribed()` once at mount kept quoting the old price
 * for the rest of the session — most visibly straight after the paywall, which
 * is the one moment the user is watching for the change. The override arrives
 * with the profile, which is later still, so the hook listens to both.
 */
export function useIsSubscribed(): boolean {
  const [subscribed, setSubscribed] = useState(() => isSubscribed());
  useEffect(() => {
    // Re-read on mount as well as on change: activation may have completed
    // between the initial state and this effect.
    const refresh = () => setSubscribed(isSubscribed());
    refresh();
    const unsubscribeStore = revenueCatService.subscribe(refresh);
    overrideListeners.add(refresh);
    return () => {
      unsubscribeStore();
      overrideListeners.delete(refresh);
    };
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

/**
 * What the next character image on THIS account costs.
 *
 * `subscribed` is deliberately not a parameter any more. A plan used to buy
 * unlimited portraits, and the server enforced no such thing; since 00088 it
 * enforces six for everybody, so quoting "Included in your plan" to a
 * subscriber would be the client promising something the server will refuse --
 * which is the exact failure this module exists to prevent.
 */
export function portraitQuote({
  usedOnAccount,
  /**
   * Whether this identity may BUY once its free images are gone.
   *
   * An anonymous one may not: the server refuses it outright
   * (`p_may_purchase` is false for a guest, migration 00088) because its
   * credits are the three from `bootstrap_user` and those are for a story.
   * Without this the sheet quoted "1 credit" to a guest holding exactly those
   * three, enabled the button, and the tap failed on the round trip -- the
   * same button-that-cannot-work this quote exists to prevent, just for the
   * other identity.
   */
  isAnonymous = false,
}: {
  usedOnAccount: number;
  isAnonymous?: boolean;
}): EntitlementQuote {
  const remaining = FREE_PORTRAITS_PER_ACCOUNT - Math.max(0, usedOnAccount);
  if (remaining > 0) return freeQuote(remaining);
  return isAnonymous
    ? { free: false, label: SIGN_IN_LABEL, requiresAccount: true }
    : { free: false, label: PAID_LABEL };
}
