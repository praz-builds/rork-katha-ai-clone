import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ADAPTY_CREDIT_MAP,
  constantTimeEquals,
  resolveAdaptyCredit,
  resolveAdaptyEventId,
} from "./adapty.ts";

const ADAPTY_SKU_CASES = [
  [
    "ai.katha.credits.starter",
    3,
    "non_subscription_purchase",
    "purchase",
    false,
  ],
  [
    "ai.katha.credits.value",
    10,
    "non_subscription_purchase",
    "purchase",
    false,
  ],
  [
    "ai.katha.credits.power",
    25,
    "non_subscription_purchase",
    "purchase",
    false,
  ],
  [
    "ai.katha.subscription.monthly",
    20,
    "subscription_renewed",
    "subscription",
    false,
  ],
  ["ai.katha.subscription.yearly", 25, "trial_converted", "subscription", true],
] as const;

Deno.test("webhook authorization comparison requires an exact value", () => {
  assertEquals(constantTimeEquals("secret", "secret"), true);
  assertEquals(constantTimeEquals("secret", "Secret"), false);
  assertEquals(constantTimeEquals("secret", "secret-extra"), false);
});

Deno.test("valid purchase resolves customer, product, and transaction", () => {
  assertEquals(
    resolveAdaptyCredit({
      customer_user_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      event_type: "non_subscription_purchase",
      profile_event_id: "event-1",
      event_properties: {
        transaction_id: "transaction-1",
        vendor_product_id: "ai.katha.credits.value",
      },
    }),
    {
      userId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      credits: 10,
      reason: "purchase",
      transactionId: "transaction-1",
    },
  );
});

Deno.test("non-credit lifecycle events are ignored", () => {
  assertEquals(
    resolveAdaptyCredit({ event_type: "subscription_cancelled" }),
    null,
  );
});

Deno.test("refund events fail closed until clawbacks are implemented", () => {
  assertThrows(
    () =>
      resolveAdaptyCredit({
        event_type: "non_subscription_purchase_refunded",
      }),
    Error,
    "Refund event requires clawback processing",
  );
});

Deno.test("refund backlog event IDs are deterministic", async () => {
  const event = { event_type: "subscription_refunded" };
  const first = await resolveAdaptyEventId(event, '{"event":"refund"}');
  const replay = await resolveAdaptyEventId(event, '{"event":"refund"}');
  assertEquals(first, replay);
  assertEquals(first.startsWith("sha256:"), true);
  assertEquals(
    await resolveAdaptyEventId({ ...event, profile_event_id: "event-1" }, "x"),
    "event-1",
  );
});

Deno.test("credit events reject unknown products and invalid users", () => {
  assertThrows(
    () =>
      resolveAdaptyCredit({
        customer_user_id: "not-a-uuid",
        event_type: "subscription_renewed",
        vendor_product_id: "ai.katha.subscription.monthly",
        transaction_id: "transaction-1",
      }),
    Error,
    "Missing or invalid customer_user_id",
  );

  assertThrows(
    () =>
      resolveAdaptyCredit({
        customer_user_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
        event_type: "subscription_renewed",
        vendor_product_id: "unknown_product",
        transaction_id: "transaction-1",
      }),
    Error,
    "Unknown product",
  );
});

assertEquals(
  ADAPTY_SKU_CASES.map(([productId]) => productId).sort(),
  Object.keys(ADAPTY_CREDIT_MAP).sort(),
);

for (
  const [productId, credits, eventType, reason, blocked] of ADAPTY_SKU_CASES
) {
  Deno.test(
    blocked
      ? `configured Adapty SKU ${productId} fails closed pending allocation`
      : `configured Adapty SKU ${productId} grants ${credits} credits`,
    () => {
      if (blocked) {
        assertThrows(
          () =>
            resolveAdaptyCredit({
              customer_user_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
              event_type: eventType,
              vendor_product_id: productId,
              transaction_id: `transaction-${credits}`,
            }),
          Error,
          "Annual subscription allocation is not configured",
        );
        return;
      }
      const operation = resolveAdaptyCredit({
        customer_user_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
        event_type: eventType,
        vendor_product_id: productId,
        transaction_id: `transaction-${credits}`,
      });
      assertEquals(operation?.credits, credits);
      assertEquals(operation?.reason, reason);
    },
  );
}
