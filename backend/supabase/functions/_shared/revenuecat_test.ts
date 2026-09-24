import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalRevenueCatProductId,
  constantTimeEquals,
  isStoreRefundCancellation,
  resolveRevenueCatCredit,
  resolveRevenueCatIdentity,
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

// ---------------------------------------------------------------------------
// Google Play: RevenueCat's `<productId>:<basePlanId>` product ids
// ---------------------------------------------------------------------------

/**
 * RevenueCat names a Google Play subscription `<subscription_id>:<base_plan_id>`
 * in every webhook ("For Google Play products set up in RevenueCat after
 * February 2023", its webhook field reference). The map is keyed by the bare
 * id, so before this every Android subscription event was "Unknown product":
 * charged by Google, answered 422, parked in the backlog, never credited.
 */
Deno.test("an Android subscription event, named with its base plan, grants its plan", () => {
  for (
    const [productId, product] of Object.entries(REVENUECAT_PRODUCT_MAP)
  ) {
    if (product.kind !== "subscription") continue;
    const androidId = `${productId}:${product.basePlanId}`;
    for (const type of ["INITIAL_PURCHASE", "RENEWAL"]) {
      const operation = resolveRevenueCatCredit({
        id: `${type}-${androidId}`,
        type,
        app_user_id: USER_ID,
        product_id: androidId,
        period_type: "NORMAL",
        transaction_id: "GPA.3345-1234-5678-12345..0",
      });
      assertEquals(operation?.productId, productId, androidId);
      assertEquals(operation?.credits, product.credits, androidId);
      assertEquals(operation?.reason, "subscription", androidId);
    }
  }
});

Deno.test("an Android refund, expiration and lifecycle event resolve to the canonical product", () => {
  const refund = resolveRevenueCatCredit({
    id: "android-refund",
    type: "CANCELLATION",
    cancel_reason: "CUSTOMER_SUPPORT",
    app_user_id: USER_ID,
    product_id: "ai.katha.sub.weekly:weekly",
    transaction_id: "GPA.1",
  });
  assertEquals(refund?.reason, "chargeback");
  assertEquals(refund?.credits, 20);
  assertEquals(refund?.productId, "ai.katha.sub.weekly");

  // EXPIRATION, PRODUCT_CHANGE, BILLING_ISSUE and plain CANCELLATION go
  // through the identity resolver; the subscription row must be recorded
  // under the same id the monthly grant job looks up.
  const identity = resolveRevenueCatIdentity({
    id: "android-expiration",
    type: "EXPIRATION",
    app_user_id: USER_ID,
    product_id: "ai.katha.sub.yearly:yearly",
  });
  assertEquals(identity.productId, "ai.katha.sub.yearly");
  assertEquals(identity.product.interval, "yearly");
});

Deno.test("an Android trial on the yearly plan grants the trial amount", () => {
  assertEquals(
    resolveRevenueCatCredit({
      id: "android-trial",
      type: "INITIAL_PURCHASE",
      app_user_id: USER_ID,
      product_id: "ai.katha.sub.yearly:yearly",
      period_type: "TRIAL",
    })?.credits,
    10,
  );
});

/**
 * Only the base plan the catalogue names is honoured. Another base plan on
 * the same subscription could be another price or period; paying this plan's
 * grant for it would be a guess, so it stays visible as "Unknown product".
 */
Deno.test("an unlisted base plan, or a suffix on a pack, is an unknown product", () => {
  for (
    const productId of [
      "ai.katha.sub.yearly:monthly",
      "ai.katha.sub.yearly:",
      "ai.katha.sub.weekly:weekly-intro",
      "ai.katha.credits.10:anything",
      "ai.katha.sub.reader.weekly:weekly",
      ":weekly",
    ]
  ) {
    assertEquals(canonicalRevenueCatProductId(productId), null, productId);
    assertThrows(
      () =>
        resolveRevenueCatCredit({
          id: "bad-base-plan",
          type: "RENEWAL",
          app_user_id: USER_ID,
          product_id: productId,
        }),
      Error,
      "Unknown product",
      productId,
    );
  }
  assertEquals(canonicalRevenueCatProductId(undefined), null);
  assertEquals(
    canonicalRevenueCatProductId("ai.katha.credits.2"),
    "ai.katha.credits.2",
  );
});

/**
 * Redelivery is idempotent because every grant is keyed on the event id
 * (`rc:<event id>`), and the Android form must not change that key: the same
 * event delivered twice resolves to the same operation.
 */
Deno.test("the same Android event resolves identically on redelivery", () => {
  const event = {
    id: "redelivered",
    type: "RENEWAL",
    app_user_id: USER_ID,
    product_id: "ai.katha.sub.monthly:monthly",
    transaction_id: "GPA.9..3",
  };
  assertEquals(resolveRevenueCatCredit(event), resolveRevenueCatCredit(event));
  assertEquals(resolveRevenueCatCredit(event)?.eventId, "redelivered");
});

// ---------------------------------------------------------------------------
// The setup checklist and the pricing source of truth agree with this map
// ---------------------------------------------------------------------------

async function readRepoFile(relative: string): Promise<string> {
  return await Deno.readTextFile(
    new URL(`../../../../${relative}`, import.meta.url),
  );
}

type ChecklistRow = {
  productId: string;
  basePlanId: string | null;
  price: number;
  credits: number;
  entitlement: string | null;
};

async function checklistRows(): Promise<ChecklistRow[]> {
  const doc = await readRepoFile("backend/PLAY_BILLING_SETUP.md");
  const block = doc.split("<!-- catalogue:start -->")[1]
    ?.split("<!-- catalogue:end -->")[0];
  if (!block) throw new Error("PLAY_BILLING_SETUP.md has no catalogue block");
  const cell = (value: string) => value.replaceAll("`", "").trim();
  const orNull = (value: string) => cell(value) === "—" ? null : cell(value);
  return block.split("\n")
    .filter((line) =>
      line.startsWith("| ") && !line.startsWith("| Type") &&
      !line.startsWith("|---")
    )
    .map((line) => {
      const cells = line.split("|").slice(1, -1);
      return {
        productId: cell(cells[1]),
        basePlanId: orNull(cells[2]),
        price: Number(cell(cells[4]).replace("$", "")),
        credits: Number(cell(cells[5]).split(" ")[0]),
        entitlement: orNull(cells[8]),
      };
    });
}

Deno.test("PLAY_BILLING_SETUP.md lists exactly this map's products, base plans, grants and entitlement", async () => {
  const rows = await checklistRows();
  assertEquals(
    rows.map((row) => row.productId).sort(),
    Object.keys(REVENUECAT_PRODUCT_MAP).sort(),
  );
  for (const row of rows) {
    const product = REVENUECAT_PRODUCT_MAP[row.productId];
    assertEquals(
      {
        basePlanId: row.basePlanId,
        credits: row.credits,
        entitlement: row.entitlement,
      },
      {
        basePlanId: product.basePlanId,
        credits: product.credits,
        entitlement: product.entitlement,
      },
      row.productId,
    );
  }
});

Deno.test("PLAY_BILLING_SETUP.md prices every product as CREDITS_AND_PRICING.md does", async () => {
  const doc = await readRepoFile("source-of-truth/CREDITS_AND_PRICING.md");
  const section = doc.split("### Store SKUs")[1]?.split("\n## ")[0] ?? "";
  const prices = new Map<string, number>();
  for (
    const match of section.matchAll(
      /\| `(ai\.katha\.[a-z0-9.]+)` \|[^|]*\$(\d+(?:\.\d+)?)/g,
    )
  ) {
    prices.set(match[1], Number(match[2]));
  }
  assertEquals(
    [...prices.keys()].sort(),
    Object.keys(REVENUECAT_PRODUCT_MAP).sort(),
  );
  for (const row of await checklistRows()) {
    assertEquals(row.price, prices.get(row.productId), row.productId);
  }
});
