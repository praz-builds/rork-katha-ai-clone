import { parseUuid } from "./uuid.ts";
import { isDuplicateCreditOperationError } from "./credits.ts";

export type SubscriptionTier = "katha";
export type RevenueCatProduct = {
  kind: "subscription" | "pack";
  entitlement: "katha" | null;
  tier: SubscriptionTier | null;
  interval: "weekly" | "monthly" | "yearly" | null;
  credits: number;
  trialCredits: number | null;
};

/**
 * Canonical server-side product map. Product credits and entitlement tiers are
 * deliberately co-located so a SKU can never be granted for the wrong tier.
 *
 * ONE PLAN, FIVE PACKS (2026-09-16). The two-tier ladder
 * (`ai.katha.sub.reader.*` / `ai.katha.sub.writer.*`, entitlements
 * `katha_reader` / `katha_writer`) and the three t-shirt-sized packs
 * (`small`/`medium`/`large`) are gone. What replaced them is a single
 * subscription at three billing intervals sharing one entitlement, `katha`,
 * and five packs named for exactly the number of credits they contain --
 * which is the whole reason for the rename: `ai.katha.credits.50` cannot
 * quietly come to mean a different number of credits the way `medium` did.
 *
 * The retired ids are absent rather than mapped to the new ones. A webhook
 * naming one throws "Unknown product" and is reported, which is the honest
 * outcome: nothing was ever sold under them (the store listing had not gone
 * live), so an event carrying one is a misconfiguration to be seen, not a
 * purchase to be honoured.
 *
 * Credits per interval are the doc's (`CREDITS_AND_PRICING.md` §3): 20 a week,
 * 50 a month, 50 a month on the yearly plan. Trial credits are 10 on every
 * interval -- a trial must never be worth more than the period it precedes,
 * and `creditAmountForEvent` clamps it to `credits` in any case.
 */
export const REVENUECAT_PRODUCT_MAP: Readonly<
  Record<string, RevenueCatProduct>
> = {
  "ai.katha.sub.weekly": {
    kind: "subscription",
    entitlement: "katha",
    tier: "katha",
    interval: "weekly",
    credits: 20,
    trialCredits: 10,
  },
  "ai.katha.sub.monthly": {
    kind: "subscription",
    entitlement: "katha",
    tier: "katha",
    interval: "monthly",
    credits: 50,
    trialCredits: 10,
  },
  "ai.katha.sub.yearly": {
    kind: "subscription",
    entitlement: "katha",
    tier: "katha",
    interval: "yearly",
    credits: 50,
    trialCredits: 10,
  },
  "ai.katha.credits.2": {
    kind: "pack",
    entitlement: null,
    tier: null,
    interval: null,
    credits: 2,
    trialCredits: null,
  },
  "ai.katha.credits.10": {
    kind: "pack",
    entitlement: null,
    tier: null,
    interval: null,
    credits: 10,
    trialCredits: null,
  },
  "ai.katha.credits.50": {
    kind: "pack",
    entitlement: null,
    tier: null,
    interval: null,
    credits: 50,
    trialCredits: null,
  },
  "ai.katha.credits.200": {
    kind: "pack",
    entitlement: null,
    tier: null,
    interval: null,
    credits: 200,
    trialCredits: null,
  },
  "ai.katha.credits.1000": {
    kind: "pack",
    entitlement: null,
    tier: null,
    interval: null,
    credits: 1000,
    trialCredits: null,
  },
};

export type RevenueCatEvent = {
  id?: string;
  type?: string;
  app_user_id?: string | null;
  product_id?: string;
  environment?: string;
  period_type?: "TRIAL" | "NORMAL" | string;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  event_timestamp_ms?: number | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  cancel_reason?:
    | "CUSTOMER_SUPPORT"
    | "DEVELOPER_INITIATED"
    | "UNSUBSCRIBE"
    | "BILLING_ERROR"
    | "PRICE_INCREASE"
    | "UNKNOWN"
    | "SUBSCRIPTION_PAUSED"
    | string
    | null;
};

export type RevenueCatWebhookPayload = { event?: RevenueCatEvent };
export type RevenueCatCreditOperation = {
  userId: string;
  credits: number;
  reason: "purchase" | "subscription" | "chargeback";
  productId: string;
  eventId: string;
  transactionId: string;
  subscription: RevenueCatProduct | null;
};
export type RevenueCatIdentity = {
  userId: string;
  productId: string;
  eventId: string;
  product: RevenueCatProduct;
};

const CREDIT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
]);

export function resolveRevenueCatCredit(
  event: RevenueCatEvent,
): RevenueCatCreditOperation | null {
  const eventType = event.type?.toUpperCase();
  const isRefund = isStoreRefundCancellation(event);
  const isRefundReversed = eventType === "REFUND_REVERSED";
  if (
    !eventType ||
    (!CREDIT_EVENTS.has(eventType) && !isRefund && !isRefundReversed)
  ) return null;

  const { userId, productId, eventId, product } = resolveRevenueCatIdentity(
    event,
  );
  const transactionId = event.transaction_id ?? event.original_transaction_id ??
    eventId;
  if (!transactionId) throw new Error("Missing transaction identifier");

  if (isRefund) {
    return {
      userId,
      credits: creditAmountForEvent(product, event),
      reason: "chargeback",
      productId,
      eventId,
      transactionId,
      subscription: product.kind === "subscription" ? product : null,
    };
  }
  if (
    !isRefundReversed && eventType === "NON_RENEWING_PURCHASE" &&
    product.kind !== "pack"
  ) {
    throw new Error("Subscription received non-renewing purchase event");
  }
  if (
    !isRefundReversed && eventType !== "NON_RENEWING_PURCHASE" &&
    product.kind !== "subscription"
  ) {
    throw new Error("Pack received subscription event");
  }

  return {
    userId,
    credits: creditAmountForEvent(product, event),
    reason: product.kind === "pack" ? "purchase" : "subscription",
    productId,
    eventId,
    transactionId,
    subscription: product.kind === "subscription" ? product : null,
  };
}

/** Resolve lifecycle identity without pretending a lifecycle event is a refund. */
export function resolveRevenueCatIdentity(
  event: RevenueCatEvent,
): RevenueCatIdentity {
  const productId = event.product_id;
  if (!productId || !Object.hasOwn(REVENUECAT_PRODUCT_MAP, productId)) {
    throw new Error("Unknown product");
  }
  if (!event.id) throw new Error("Missing RevenueCat event ID");
  const userId = parseUuid(event.app_user_id);
  if (!userId) throw new Error("Missing or invalid app_user_id");
  return {
    userId,
    productId,
    eventId: event.id,
    product: REVENUECAT_PRODUCT_MAP[productId],
  };
}

/** RevenueCat represents store refunds as CANCELLATION events with these reasons. */
export function isStoreRefundCancellation(event: RevenueCatEvent): boolean {
  return event.type?.toUpperCase() === "CANCELLATION" &&
    (event.cancel_reason === "CUSTOMER_SUPPORT" ||
      event.cancel_reason === "DEVELOPER_INITIATED");
}

/**
 * Complete the non-credit part of a refund even when its credit deduction was
 * already committed by an earlier delivery of the same webhook event.
 */
export async function settleStoreRefund(
  deduct: () => Promise<number>,
  recordSubscription: (() => Promise<void>) | undefined,
): Promise<{ balance: number | null; deductionAlreadyApplied: boolean }> {
  let balance: number | null = null;
  let deductionAlreadyApplied = false;
  try {
    balance = await deduct();
  } catch (error) {
    if (!isDuplicateCreditOperationError(error)) throw error;
    deductionAlreadyApplied = true;
  }

  await recordSubscription?.();
  return { balance, deductionAlreadyApplied };
}

function creditAmountForEvent(
  product: RevenueCatProduct,
  event: RevenueCatEvent,
): number {
  // A trial must never grant or claw back more than the paid period it precedes.
  // This also keeps REFUND_REVERSED symmetric with the original trial grant.
  return product.kind === "subscription" && event.period_type === "TRIAL"
    ? Math.min(product.trialCredits ?? product.credits, product.credits)
    : product.credits;
}

export function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export function eventDate(event: RevenueCatEvent): string | null {
  const milliseconds = event.expiration_at_ms ?? event.purchased_at_ms;
  return typeof milliseconds === "number"
    ? new Date(milliseconds).toISOString()
    : null;
}
