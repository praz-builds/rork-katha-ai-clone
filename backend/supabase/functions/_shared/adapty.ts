import { parseUuid } from "./uuid.ts";

export const ADAPTY_CREDIT_MAP: Readonly<Record<string, number>> = {
  "ai.katha.credits.starter": 3,
  "ai.katha.credits.value": 10,
  "ai.katha.credits.power": 25,
  "ai.katha.subscription.monthly": 20,
  "ai.katha.subscription.yearly": 25,
};

export type AdaptyEvent = {
  customer_user_id?: string | null;
  event_type?: string;
  profile_event_id?: string;
  transaction_id?: string;
  vendor_product_id?: string;
  product_id?: string;
  event_properties?: {
    transaction_id?: string;
    vendor_product_id?: string;
  };
};

export type AdaptyCreditOperation = {
  userId: string;
  credits: number;
  reason: "subscription" | "purchase";
  transactionId: string;
};

/** Resolve and validate a credit-bearing Adapty event. */
export function resolveAdaptyCredit(
  event: AdaptyEvent,
): AdaptyCreditOperation | null {
  if (!event.event_type) return null;
  if (
    event.event_type === "subscription_refunded" ||
    event.event_type === "non_subscription_purchase_refunded"
  ) {
    throw new Error("Refund event requires clawback processing");
  }

  const reason = getCreditReason(event.event_type);
  if (!reason) return null;

  const userId = parseUuid(event.customer_user_id);
  if (!userId) {
    throw new Error("Missing or invalid customer_user_id");
  }

  const productId = event.event_properties?.vendor_product_id ??
    event.vendor_product_id ??
    event.product_id;
  if (!productId || !Object.hasOwn(ADAPTY_CREDIT_MAP, productId)) {
    throw new Error("Unknown product");
  }
  if (productId === "ai.katha.subscription.yearly") {
    throw new Error("Annual subscription allocation is not configured");
  }

  const transactionId = event.event_properties?.transaction_id ??
    event.transaction_id ??
    event.profile_event_id;
  if (!transactionId) throw new Error("Missing transaction identifier");

  return {
    userId,
    credits: ADAPTY_CREDIT_MAP[productId],
    reason,
    transactionId,
  };
}

/** Compare webhook secrets without returning at the first mismatched byte. */
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

/** Resolve a retry-stable provider event ID, falling back to a body digest. */
export async function resolveAdaptyEventId(
  event: AdaptyEvent,
  rawBody: string,
): Promise<string> {
  const providerId = event.profile_event_id ??
    event.event_properties?.transaction_id ??
    event.transaction_id;
  if (providerId) return providerId;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody),
  );
  return `sha256:${
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

/** Map credit-bearing Adapty lifecycle events to ledger reasons. */
function getCreditReason(
  eventType: string,
): "subscription" | "purchase" | null {
  if (
    eventType === "subscription_initial_purchase" ||
    eventType === "subscription_started" ||
    eventType === "trial_converted" ||
    eventType === "subscription_renewed"
  ) {
    return "subscription";
  }
  if (eventType === "non_subscription_purchase") return "purchase";
  return null;
}
