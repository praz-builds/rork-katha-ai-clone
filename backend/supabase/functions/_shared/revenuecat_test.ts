import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  constantTimeEquals,
  REVENUECAT_PRODUCT_MAP,
  resolveRevenueCatCredit,
} from "./revenuecat.ts";

const USER_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

Deno.test("RevenueCat authorization comparison requires an exact value", () => {
  assertEquals(constantTimeEquals("secret", "secret"), true);
  assertEquals(constantTimeEquals("secret", "Secret"), false);
  assertEquals(constantTimeEquals("secret", "secret-extra"), false);
});

Deno.test("each configured RevenueCat SKU resolves from a matching event", () => {
  for (const [productId, product] of Object.entries(REVENUECAT_PRODUCT_MAP)) {
    const eventType = product.kind === "pack" ? "NON_RENEWING_PURCHASE" : "RENEWAL";
    const operation = resolveRevenueCatCredit({
      id: `event-${productId}`,
      type: eventType,
      app_user_id: USER_ID,
      product_id: productId,
      period_type: "NORMAL",
      transaction_id: `transaction-${productId}`,
    });
    assertEquals(operation?.credits, product.credits);
    assertEquals(operation?.reason, product.kind === "pack" ? "purchase" : "subscription");
    assertEquals(operation?.subscription?.tier ?? null, product.tier);
  }
});

Deno.test("trials grant the reduced reader and writer allocations", () => {
  assertEquals(
    resolveRevenueCatCredit({
      id: "reader-trial", type: "INITIAL_PURCHASE", app_user_id: USER_ID,
      product_id: "ai.katha.sub.reader.yearly", period_type: "TRIAL",
    })?.credits,
    5,
  );
  assertEquals(
    resolveRevenueCatCredit({
      id: "writer-trial", type: "INITIAL_PURCHASE", app_user_id: USER_ID,
      product_id: "ai.katha.sub.writer.yearly", period_type: "TRIAL",
    })?.credits,
    15,
  );
});

Deno.test("PRODUCT_CHANGE and non-credit lifecycle events never grant", () => {
  assertEquals(
    resolveRevenueCatCredit({ id: "change", type: "PRODUCT_CHANGE", app_user_id: USER_ID, product_id: "ai.katha.sub.writer.monthly" }),
    null,
  );
  assertEquals(
    resolveRevenueCatCredit({ id: "cancel", type: "CANCELLATION", app_user_id: USER_ID, product_id: "ai.katha.sub.writer.monthly" }),
    null,
  );
});

Deno.test("refund-shaped RevenueCat events resolve to clamped chargebacks", () => {
  const operation = resolveRevenueCatCredit({
    id: "refund-1", type: "REFUND", app_user_id: USER_ID,
    product_id: "ai.katha.credits.medium", transaction_id: "transaction-refund",
  });
  assertEquals(operation, {
    userId: USER_ID,
    credits: 40,
    reason: "chargeback",
    productId: "ai.katha.credits.medium",
    eventId: "refund-1",
    transactionId: "transaction-refund",
    subscription: null,
  });
});

Deno.test("RevenueCat webhook resolver rejects malformed credit events", () => {
  assertThrows(
    () => resolveRevenueCatCredit({ id: "bad-user", type: "RENEWAL", app_user_id: "not-a-uuid", product_id: "ai.katha.sub.reader.monthly" }),
    Error,
    "Missing or invalid app_user_id",
  );
  assertThrows(
    () => resolveRevenueCatCredit({ id: "unknown", type: "REFUND", app_user_id: USER_ID, product_id: "unknown" }),
    Error,
    "Unknown product",
  );
  assertThrows(
    () => resolveRevenueCatCredit({ type: "RENEWAL", app_user_id: USER_ID, product_id: "ai.katha.sub.reader.monthly" }),
    Error,
    "Missing RevenueCat event ID",
  );
  assertThrows(
    () => resolveRevenueCatCredit({ id: "wrong-kind", type: "RENEWAL", app_user_id: USER_ID, product_id: "ai.katha.credits.small" }),
    Error,
    "Pack received subscription event",
  );
});
