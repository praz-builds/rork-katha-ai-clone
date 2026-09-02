import { parseUuid } from "./uuid.ts";

export type SubscriptionTier = "reader" | "writer";
export type RevenueCatProduct = {
  kind: "subscription" | "pack";
  entitlement: "katha_reader" | "katha_writer" | null;
  tier: SubscriptionTier | null;
  interval: "weekly" | "monthly" | "yearly" | null;
  credits: number;
  trialCredits: number | null;
};

/**
 * Canonical server-side product map. Product credits and entitlement tiers are
 * deliberately co-located so a SKU can never be granted for the wrong tier.
 */
export const REVENUECAT_PRODUCT_MAP: Readonly<Record<string, RevenueCatProduct>> = {
  "ai.katha.sub.reader.weekly": { kind: "subscription", entitlement: "katha_reader", tier: "reader", interval: "weekly", credits: 5, trialCredits: 5 },
  "ai.katha.sub.reader.monthly": { kind: "subscription", entitlement: "katha_reader", tier: "reader", interval: "monthly", credits: 20, trialCredits: 5 },
  "ai.katha.sub.reader.yearly": { kind: "subscription", entitlement: "katha_reader", tier: "reader", interval: "yearly", credits: 20, trialCredits: 5 },
  "ai.katha.sub.reader.yearly.offer": { kind: "subscription", entitlement: "katha_reader", tier: "reader", interval: "yearly", credits: 20, trialCredits: 5 },
  "ai.katha.sub.writer.weekly": { kind: "subscription", entitlement: "katha_writer", tier: "writer", interval: "weekly", credits: 10, trialCredits: 15 },
  "ai.katha.sub.writer.monthly": { kind: "subscription", entitlement: "katha_writer", tier: "writer", interval: "monthly", credits: 50, trialCredits: 15 },
  "ai.katha.sub.writer.yearly": { kind: "subscription", entitlement: "katha_writer", tier: "writer", interval: "yearly", credits: 50, trialCredits: 15 },
  "ai.katha.credits.small": { kind: "pack", entitlement: null, tier: null, interval: null, credits: 10, trialCredits: null },
  "ai.katha.credits.medium": { kind: "pack", entitlement: null, tier: null, interval: null, credits: 40, trialCredits: null },
  "ai.katha.credits.large": { kind: "pack", entitlement: null, tier: null, interval: null, credits: 90, trialCredits: null },
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

const CREDIT_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"]);

export function resolveRevenueCatCredit(event: RevenueCatEvent): RevenueCatCreditOperation | null {
  const eventType = event.type?.toUpperCase();
  if (!eventType || eventType === "PRODUCT_CHANGE") return null;

  const productId = event.product_id;
  if (!productId || !Object.hasOwn(REVENUECAT_PRODUCT_MAP, productId)) {
    if (isRefundEvent(eventType)) throw new Error("Unknown product");
    return null;
  }
  if (!event.id) throw new Error("Missing RevenueCat event ID");

  const userId = parseUuid(event.app_user_id);
  if (!userId) throw new Error("Missing or invalid app_user_id");

  const product = REVENUECAT_PRODUCT_MAP[productId];
  const transactionId = event.transaction_id ?? event.original_transaction_id ?? event.id;
  if (!transactionId) throw new Error("Missing transaction identifier");

  if (isRefundEvent(eventType)) {
    return { userId, credits: product.credits, reason: "chargeback", productId, eventId: event.id, transactionId, subscription: product.kind === "subscription" ? product : null };
  }
  if (!CREDIT_EVENTS.has(eventType)) return null;
  if (eventType === "NON_RENEWING_PURCHASE" && product.kind !== "pack") {
    throw new Error("Subscription received non-renewing purchase event");
  }
  if (eventType !== "NON_RENEWING_PURCHASE" && product.kind !== "subscription") {
    throw new Error("Pack received subscription event");
  }

  // A trial must never grant more than the paid period it precedes. Trials are
  // offered on yearly plans only (CREDITS_AND_PRICING.md §3), but clamping here
  // means enabling a trial on a shorter interval can never over-grant.
  const credits = product.kind === "subscription" && event.period_type === "TRIAL"
    ? Math.min(product.trialCredits ?? product.credits, product.credits)
    : product.credits;
  return {
    userId,
    credits,
    reason: product.kind === "pack" ? "purchase" : "subscription",
    productId,
    eventId: event.id,
    transactionId,
    subscription: product.kind === "subscription" ? product : null,
  };
}

export function isRefundEvent(eventType: string): boolean {
  return eventType === "REFUND" || eventType.includes("REFUND");
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
  return typeof milliseconds === "number" ? new Date(milliseconds).toISOString() : null;
}
