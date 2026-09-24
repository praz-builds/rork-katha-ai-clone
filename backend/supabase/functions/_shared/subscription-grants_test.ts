import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  grantMonth,
  refreshYearlyGrantsPage,
  type YearlyRefreshDeps,
} from "./subscription-grants.ts";
import { DuplicateCreditOperationError } from "./credits.ts";

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
