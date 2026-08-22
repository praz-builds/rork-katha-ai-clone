import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { constantTimeEquals, resolveAdaptyCredit } from "./adapty.ts";

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
        vendor_product_id: "value_pack",
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

Deno.test("credit events reject unknown products and invalid users", () => {
  assertThrows(
    () =>
      resolveAdaptyCredit({
        customer_user_id: "not-a-uuid",
        event_type: "subscription_renewed",
        vendor_product_id: "monthly_sub",
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
