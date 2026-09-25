import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  grantMonth,
  type LedgerMonthRow,
  refreshYearlyGrantsPage,
  settleSubscriptionGrant,
  type SubscriptionGrantDeps,
  yearlyGrantCoveredThisMonth,
  type YearlyRefreshDeps,
} from "./subscription-grants.ts";
import { DuplicateCreditOperationError } from "./credits.ts";
import { resolveRevenueCatCredit } from "./revenuecat.ts";

const NOW = new Date("2026-09-26T03:00:00.000Z");
const BOUGHT_YESTERDAY = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const SUBSCRIBED_LAST_YEAR = "7ba7b810-9dad-41d1-80b4-00c04fd430c8";

function fakes(grantedThisMonth: string[]) {
  const refreshed: Array<{ userId: string; credits: number; key: string }> = [];
  const asked: Array<{ userIds: string[]; monthStart: string }> = [];
  const deps: YearlyRefreshDeps = {
    grantedSince: (userIds, monthStart) => {
      asked.push({ userIds, monthStart });
      return Promise.resolve(
        new Set(userIds.filter((id) => grantedThisMonth.includes(id))),
      );
    },
    refresh: (userId, credits, _referenceId, operationKey) => {
      refreshed.push({ userId, credits, key: operationKey });
      return Promise.resolve(credits);
    },
  };
  return { deps, refreshed, asked };
}

Deno.test("the grant month starts at midnight UTC on the first", () => {
  assertEquals(grantMonth(NOW), {
    yearMonth: "2026-09",
    monthStart: "2026-09-01T00:00:00.000Z",
  });
});

/**
 * THE DOUBLE GRANT. Somebody buys a year on the 25th; the webhook grants 50
 * under `rc:<event id>`. The cron runs at 03:00 on the 26th and, keyed only on
 * its own `subscription:<user>:2026-09`, used to see nothing and reset the
 * grant bucket to 50 -- refilling whatever was spent on day one.
 */
Deno.test("a yearly subscriber already granted this month is not refilled", async () => {
  const { deps, refreshed, asked } = fakes([BOUGHT_YESTERDAY]);
  const tally = await refreshYearlyGrantsPage(
    [
      { user_id: BOUGHT_YESTERDAY, product_id: "ai.katha.sub.yearly" },
      { user_id: SUBSCRIBED_LAST_YEAR, product_id: "ai.katha.sub.yearly" },
    ],
    NOW,
    deps,
  );
  assertEquals(asked, [{
    userIds: [BOUGHT_YESTERDAY, SUBSCRIBED_LAST_YEAR],
    monthStart: "2026-09-01T00:00:00.000Z",
  }]);
  assertEquals(refreshed, [{
    userId: SUBSCRIBED_LAST_YEAR,
    credits: 50,
    key: `subscription:${SUBSCRIBED_LAST_YEAR}:2026-09`,
  }]);
  assertEquals(tally, { refreshed: 1, alreadyGranted: 1, failures: {} });
});

Deno.test("a ledger that cannot be read grants nobody, and says so", async () => {
  const { refreshed } = fakes([]);
  const tally = await refreshYearlyGrantsPage(
    [{ user_id: SUBSCRIBED_LAST_YEAR, product_id: "ai.katha.sub.yearly" }],
    NOW,
    {
      grantedSince: () => Promise.reject(new Error("timeout")),
      refresh: () => Promise.resolve(0),
    },
  );
  assertEquals(refreshed, []);
  assertEquals(tally.failures, { ledger_read_failed: 1 });
});

Deno.test("a non-yearly or unknown product is reported, never granted", async () => {
  const { deps, refreshed } = fakes([]);
  const tally = await refreshYearlyGrantsPage(
    [
      { user_id: SUBSCRIBED_LAST_YEAR, product_id: "ai.katha.sub.monthly" },
      { user_id: BOUGHT_YESTERDAY, product_id: "ai.katha.sub.reader.yearly" },
    ],
    NOW,
    deps,
  );
  assertEquals(refreshed, []);
  assertEquals(tally.failures, { unknown_product: 2 });
});

Deno.test("a refresh already committed counts as done, a failed one is retried tomorrow", async () => {
  const tally = await refreshYearlyGrantsPage(
    [
      { user_id: SUBSCRIBED_LAST_YEAR, product_id: "ai.katha.sub.yearly" },
      { user_id: BOUGHT_YESTERDAY, product_id: "ai.katha.sub.yearly" },
    ],
    NOW,
    {
      grantedSince: () => Promise.resolve(new Set()),
      refresh: (userId) =>
        userId === SUBSCRIBED_LAST_YEAR
          ? Promise.reject(new DuplicateCreditOperationError())
          : Promise.reject(new Error("rpc down")),
    },
  );
  assertEquals(tally, {
    refreshed: 1,
    alreadyGranted: 0,
    failures: { refresh_failed: 1 },
  });
});

// ---------------------------------------------------------------------------
// The webhook's grant, and the yearly anniversary
// ---------------------------------------------------------------------------

function yearlyRenewal(id: string) {
  const event = {
    id,
    type: "RENEWAL",
    app_user_id: SUBSCRIBED_LAST_YEAR,
    product_id: "ai.katha.sub.yearly:yearly",
    period_type: "NORMAL",
    transaction_id: `GPA.${id}`,
  };
  const operation = resolveRevenueCatCredit(event);
  if (!operation) throw new Error("fixture did not resolve");
  return { event, operation };
}

function grantFakes(rows: LedgerMonthRow[]) {
  const refreshed: string[] = [];
  const deps: SubscriptionGrantDeps = {
    ledgerThisMonth: () => Promise.resolve(rows),
    refresh: (_userId, credits, _ref, key) => {
      refreshed.push(`${key}:${credits}`);
      return Promise.resolve(credits);
    },
  };
  return { deps, refreshed };
}

/**
 * Month 13. The cron topped the yearly plan up on the 1st; the store's
 * yearly RENEWAL lands on the 15th and used to reset the bucket to 50 again:
 * up to 100 credits in the anniversary month.
 */
Deno.test("a yearly renewal in a month the cron already paid does not refill", async () => {
  const { event, operation } = yearlyRenewal("anniversary");
  const { deps, refreshed } = grantFakes([
    { reason: "subscription", amount: -12, created_at: "2026-09-01T03:00:00Z" },
    { reason: "subscription", amount: 50, created_at: "2026-09-01T03:00:01Z" },
  ]);
  const settled = await settleSubscriptionGrant(operation, event, NOW, deps);
  assertEquals(settled, { balance: null, alreadyGranted: true });
  assertEquals(refreshed, []);
});

Deno.test("a yearly renewal pays when this month has no grant yet", async () => {
  const { event, operation } = yearlyRenewal("first-of-month");
  const { deps, refreshed } = grantFakes([]);
  const settled = await settleSubscriptionGrant(operation, event, NOW, deps);
  assertEquals(settled, { balance: 50, alreadyGranted: false });
  assertEquals(refreshed, ["rc:first-of-month:50"]);
});

/** A trial's 10 is not this month's grant: the conversion must still pay 50. */
Deno.test("a trial converting to yearly this month still gets its 50", async () => {
  const { event, operation } = yearlyRenewal("conversion");
  const { deps, refreshed } = grantFakes([
    { reason: "subscription", amount: 10, created_at: "2026-09-20T10:00:00Z" },
  ]);
  await settleSubscriptionGrant(operation, event, NOW, deps);
  assertEquals(refreshed, ["rc:conversion:50"]);
});

/** A grant a lapse has since voided does not count: a recovered plan is paid. */
Deno.test("a yearly renewal after a lapse this month pays", async () => {
  const { event, operation } = yearlyRenewal("recovered");
  const { deps, refreshed } = grantFakes([
    { reason: "subscription", amount: 50, created_at: "2026-09-01T03:00:00Z" },
    { reason: "lapse", amount: -41, created_at: "2026-09-10T00:00:00Z" },
  ]);
  await settleSubscriptionGrant(operation, event, NOW, deps);
  assertEquals(refreshed, ["rc:recovered:50"]);
});

/** Weekly and monthly renewals ARE their plan's refill; the ledger is not asked. */
Deno.test("weekly and monthly renewals, and first purchases, always pay", async () => {
  for (
    const [type, productId] of [
      ["RENEWAL", "ai.katha.sub.weekly:weekly"],
      ["RENEWAL", "ai.katha.sub.monthly:monthly"],
      ["INITIAL_PURCHASE", "ai.katha.sub.yearly:yearly"],
    ]
  ) {
    const event = {
      id: `${type}-${productId}`,
      type,
      app_user_id: SUBSCRIBED_LAST_YEAR,
      product_id: productId,
      period_type: "NORMAL",
      transaction_id: "GPA.x",
    };
    const operation = resolveRevenueCatCredit(event)!;
    let asked = false;
    const settled = await settleSubscriptionGrant(operation, event, NOW, {
      ledgerThisMonth: () => {
        asked = true;
        return Promise.resolve([
          {
            reason: "subscription",
            amount: 50,
            created_at: "2026-09-01T00:00:00Z",
          },
        ]);
      },
      refresh: (_u, credits) => Promise.resolve(credits),
    });
    assertEquals(settled.alreadyGranted, false, productId);
    assertEquals(asked, false, productId);
  }
});

Deno.test("coverage is decided by the latest event this month", () => {
  assertEquals(yearlyGrantCoveredThisMonth([], 50), false);
  assertEquals(
    yearlyGrantCoveredThisMonth([
      { reason: "lapse", amount: -3, created_at: "2026-09-02T00:00:00Z" },
      {
        reason: "subscription",
        amount: 50,
        created_at: "2026-09-03T00:00:00Z",
      },
    ], 50),
    true,
  );
});
