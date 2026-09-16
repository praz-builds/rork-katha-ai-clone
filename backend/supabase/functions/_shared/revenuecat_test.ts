import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  constantTimeEquals,
  isStoreRefundCancellation,
  resolveRevenueCatCredit,
  REVENUECAT_PRODUCT_MAP,
  settleStoreRefund,
} from "./revenuecat.ts";
import { DuplicateCreditOperationError } from "./credits.ts";

const USER_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

Deno.test("RevenueCat authorization comparison requires an exact value", () => {
  assertEquals(constantTimeEquals("secret", "secret"), true);
  assertEquals(constantTimeEquals("secret", "Secret"), false);
  assertEquals(constantTimeEquals("secret", "secret-extra"), false);
});

Deno.test("each configured RevenueCat SKU resolves from a matching event", () => {
  for (const [productId, product] of Object.entries(REVENUECAT_PRODUCT_MAP)) {
    const eventType = product.kind === "pack"
      ? "NON_RENEWING_PURCHASE"
      : "RENEWAL";
    const operation = resolveRevenueCatCredit({
      id: `event-${productId}`,
      type: eventType,
      app_user_id: USER_ID,
      product_id: productId,
      period_type: "NORMAL",
      transaction_id: `transaction-${productId}`,
    });
    assertEquals(operation?.credits, product.credits);
    assertEquals(
      operation?.reason,
      product.kind === "pack" ? "purchase" : "subscription",
    );
    assertEquals(operation?.subscription?.tier ?? null, product.tier);
  }
});

Deno.test("a trial grants ten on every interval, never more than the period it precedes", () => {
  for (
    const productId of [
      "ai.katha.sub.weekly",
      "ai.katha.sub.monthly",
      "ai.katha.sub.yearly",
    ]
  ) {
    assertEquals(
      resolveRevenueCatCredit({
        id: `trial-${productId}`,
        type: "INITIAL_PURCHASE",
        app_user_id: USER_ID,
        product_id: productId,
        period_type: "TRIAL",
      })?.credits,
      10,
      productId,
    );
  }
});

/**
 * THE RETIRED SKUS ARE GONE, NOT REMAPPED.
 *
 * Nothing was ever sold under the reader/writer ladder or the t-shirt packs,
 * so an event naming one is a store misconfiguration. "Unknown product" makes
 * that visible; a silent remap onto the new plan would pay credits for a
 * purchase we cannot account for.
 */
Deno.test("the retired reader/writer and small/medium/large SKUs are unknown", () => {
  for (
    const productId of [
      "ai.katha.sub.reader.weekly",
      "ai.katha.sub.reader.monthly",
      "ai.katha.sub.reader.yearly",
      "ai.katha.sub.reader.yearly.offer",
      "ai.katha.sub.writer.weekly",
      "ai.katha.sub.writer.monthly",
      "ai.katha.sub.writer.yearly",
      "ai.katha.credits.small",
      "ai.katha.credits.medium",
      "ai.katha.credits.large",
    ]
  ) {
    assertThrows(
      () =>
        resolveRevenueCatCredit({
          id: "retired",
          type: "RENEWAL",
          app_user_id: USER_ID,
          product_id: productId,
        }),
      Error,
      "Unknown product",
      productId,
    );
  }
});

/** Every pack is named for the number of credits it actually pays. */
Deno.test("each pack SKU pays the number in its id", () => {
  for (const credits of [2, 10, 50, 200, 1000]) {
    assertEquals(
      resolveRevenueCatCredit({
        id: `pack-${credits}`,
        type: "NON_RENEWING_PURCHASE",
        app_user_id: USER_ID,
        product_id: `ai.katha.credits.${credits}`,
        transaction_id: `t-${credits}`,
      })?.credits,
      credits,
    );
  }
});

Deno.test("PRODUCT_CHANGE and non-credit lifecycle events never grant", () => {
  assertEquals(
    resolveRevenueCatCredit({
      id: "change",
      type: "PRODUCT_CHANGE",
      app_user_id: USER_ID,
      product_id: "ai.katha.sub.monthly",
    }),
    null,
  );
  assertEquals(
    resolveRevenueCatCredit({
      id: "cancel",
      type: "CANCELLATION",
      app_user_id: USER_ID,
      product_id: "ai.katha.sub.monthly",
    }),
    null,
  );
});

Deno.test("store-refund cancellations resolve to clamped chargebacks", () => {
  const operation = resolveRevenueCatCredit({
    id: "refund-1",
    type: "CANCELLATION",
    cancel_reason: "CUSTOMER_SUPPORT",
    app_user_id: USER_ID,
    product_id: "ai.katha.credits.50",
    transaction_id: "transaction-refund",
  });
  assertEquals(operation, {
    userId: USER_ID,
    credits: 50,
    reason: "chargeback",
    productId: "ai.katha.credits.50",
    eventId: "refund-1",
    transactionId: "transaction-refund",
    subscription: null,
  });
});

Deno.test("a trial refund claws back only the trial grant", () => {
  const operation = resolveRevenueCatCredit({
    id: "trial-refund",
    type: "CANCELLATION",
    cancel_reason: "DEVELOPER_INITIATED",
    app_user_id: USER_ID,
    product_id: "ai.katha.sub.yearly",
    period_type: "TRIAL",
  });
  assertEquals(operation?.reason, "chargeback");
  assertEquals(operation?.credits, 10);
});

Deno.test("plain unsubscribe cancellation is not a refund or credit operation", () => {
  const event = {
    id: "unsubscribe",
    type: "CANCELLATION",
    cancel_reason: "UNSUBSCRIBE",
    app_user_id: USER_ID,
    product_id: "ai.katha.sub.monthly",
  } as const;
  assertEquals(isStoreRefundCancellation(event), false);
  assertEquals(resolveRevenueCatCredit(event), null);
});

Deno.test("REFUND_REVERSED re-grants the original product credits", () => {
  const operation = resolveRevenueCatCredit({
    id: "refund-reversed",
    type: "REFUND_REVERSED",
    app_user_id: USER_ID,
    product_id: "ai.katha.credits.50",
    transaction_id: "transaction-reversed",
  });
  assertEquals(operation?.reason, "purchase");
  assertEquals(operation?.credits, 50);
});

Deno.test("a refund retry records a subscription after its deduction already committed", async () => {
  let subscriptionRecorded = false;
  const firstAttempt = settleStoreRefund(
    async () => 0,
    async () => {
      throw new Error("temporary subscription write failure");
    },
  );
  await firstAttempt.catch(() => undefined);

  const retry = await settleStoreRefund(
    async () => {
      throw new DuplicateCreditOperationError();
    },
    async () => {
      subscriptionRecorded = true;
    },
  );

  assertEquals(retry, { balance: null, deductionAlreadyApplied: true });
  assertEquals(subscriptionRecorded, true);
});

Deno.test("RevenueCat webhook resolver rejects malformed credit events", () => {
  assertThrows(
    () =>
      resolveRevenueCatCredit({
        id: "bad-user",
        type: "RENEWAL",
        app_user_id: "not-a-uuid",
        product_id: "ai.katha.sub.monthly",
      }),
    Error,
    "Missing or invalid app_user_id",
  );
  assertThrows(
    () =>
      resolveRevenueCatCredit({
        id: "unknown",
        type: "CANCELLATION",
        cancel_reason: "CUSTOMER_SUPPORT",
        app_user_id: USER_ID,
        product_id: "unknown",
      }),
    Error,
    "Unknown product",
  );
  assertThrows(
    () =>
      resolveRevenueCatCredit({
        type: "RENEWAL",
        app_user_id: USER_ID,
        product_id: "ai.katha.sub.monthly",
      }),
    Error,
    "Missing RevenueCat event ID",
  );
  assertThrows(
    () =>
      resolveRevenueCatCredit({
        id: "wrong-kind",
        type: "RENEWAL",
        app_user_id: USER_ID,
        product_id: "ai.katha.credits.10",
      }),
    Error,
    "Pack received subscription event",
  );
  assertThrows(
    () =>
      resolveRevenueCatCredit({
        id: "wrong-kind-reverse",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: USER_ID,
        product_id: "ai.katha.sub.monthly",
      }),
    Error,
    "Subscription received non-renewing purchase event",
  );
});
