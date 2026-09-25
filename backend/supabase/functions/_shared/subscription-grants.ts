import {
  REVENUECAT_PRODUCT_MAP,
  type RevenueCatCreditOperation,
  type RevenueCatEvent,
} from "./revenuecat.ts";
import { isDuplicateCreditOperationError } from "./credits.ts";

// ---------------------------------------------------------------------------
// The webhook's subscription grant, and the yearly anniversary
// ---------------------------------------------------------------------------

/** A `credit_ledger` row this month, as far as the grant rule cares. */
export type LedgerMonthRow = {
  reason: string;
  amount: number;
  created_at: string;
};

/**
 * Whether this month's yearly grant has already been paid and still stands.
 *
 * Covered when the latest thing that happened to the grant this month is a
 * FULL grant (`subscription`, amount at least the plan's credits) rather than
 * a `lapse`. The trial's 10 does not count -- a trial converting this month
 * must still get its 50 -- and neither does a grant a lapse has since voided:
 * a subscription that expired and was recovered must not be left at zero.
 */
export function yearlyGrantCoveredThisMonth(
  rows: LedgerMonthRow[],
  credits: number,
): boolean {
  let covered = false;
  const ordered = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  for (const row of ordered) {
    if (row.reason === "lapse") covered = false;
    if (row.reason === "subscription" && row.amount >= credits) covered = true;
  }
  return covered;
}

export type SubscriptionGrantDeps = {
  /** This user's `subscription` and `lapse` ledger rows since `monthStart`. */
  ledgerThisMonth: (
    userId: string,
    monthStart: string,
  ) => Promise<LedgerMonthRow[]>;
  refresh: (
    userId: string,
    credits: number,
    referenceId: string,
    operationKey: string,
  ) => Promise<number>;
};

/**
 * The webhook's grant for a subscription `INITIAL_PURCHASE`, `RENEWAL` or
 * `REFUND_REVERSED`.
 *
 * THE ANNIVERSARY. A yearly plan is topped up monthly by the cron, on the
 * 1st, and renewed by the store once a year on the purchase date. In the
 * renewal month both used to refill the bucket: the cron on the 1st, then
 * the `RENEWAL` on, say, the 15th -- up to 100 credits that month. A yearly
 * `RENEWAL` now pays only when this month's grant has not already been paid
 * (see `yearlyGrantCoveredThisMonth`). Weekly and monthly renewals ARE their
 * plan's refill and always pay; so does every first purchase.
 */
export async function settleSubscriptionGrant(
  operation: RevenueCatCreditOperation,
  event: RevenueCatEvent,
  now: Date,
  deps: SubscriptionGrantDeps,
): Promise<{ balance: number | null; alreadyGranted: boolean }> {
  const yearlyRenewal = event.type?.toUpperCase() === "RENEWAL" &&
    operation.subscription?.interval === "yearly" &&
    event.period_type !== "TRIAL";
  if (yearlyRenewal) {
    const rows = await deps.ledgerThisMonth(
      operation.userId,
      grantMonth(now).monthStart,
    );
    if (yearlyGrantCoveredThisMonth(rows, operation.credits)) {
      return { balance: null, alreadyGranted: true };
    }
  }
  const balance = await deps.refresh(
    operation.userId,
    operation.credits,
    operation.transactionId,
    `rc:${operation.eventId}`,
  );
  return { balance, alreadyGranted: false };
}

// ---------------------------------------------------------------------------
// The cron
// ---------------------------------------------------------------------------

/**
 * The monthly refresh of a yearly plan's grant, one page of subscribers at a
 * time. `refresh-subscription-grants` runs this daily; it is here, with its
 * database calls passed in, so the rule can be tested without a database.
 *
 * THE RULE: a yearly subscriber receives one 50-credit refresh per calendar
 * month, and the month they bought (or converted from a trial) counts.
 *
 * Before 2026-09-25 the cron's only guard was its own operation key,
 * `subscription:<user>:<YYYY-MM>`. The webhook grants the first 50 under a
 * different key (`rc:<event id>`), so the night after somebody bought a year
 * the cron saw no grant of its own for that month and reset their grant
 * bucket to 50 again -- refilling whatever they had spent on day one. Every
 * new yearly subscriber got up to 100 credits in their first month, and the
 * same happened in the month a trial converted. The yearly plan is the
 * binding constraint in `CREDITS_AND_PRICING.md` §4; a free extra month of
 * grant on every sale is exactly the loss that row exists to prevent.
 *
 * So a user whose ledger already holds a positive `subscription` grant this
 * calendar month -- from the webhook or from an earlier run -- is skipped.
 */
export type YearlySubscriptionRow = { user_id: string; product_id: string };

export type YearlyRefreshDeps = {
  /** User ids, among those given, already granted a subscription credit since `monthStart`. */
  grantedSince: (userIds: string[], monthStart: string) => Promise<Set<string>>;
  refresh: (
    userId: string,
    credits: number,
    referenceId: string,
    operationKey: string,
  ) => Promise<unknown>;
};

export type YearlyRefreshTally = {
  refreshed: number;
  alreadyGranted: number;
  failures: Record<string, number>;
};

/** `2026-09` and `2026-09-01T00:00:00.000Z` for a date. */
export function grantMonth(
  now: Date,
): { yearMonth: string; monthStart: string } {
  const yearMonth = now.toISOString().slice(0, 7);
  return { yearMonth, monthStart: `${yearMonth}-01T00:00:00.000Z` };
}

export async function refreshYearlyGrantsPage(
  page: YearlySubscriptionRow[],
  now: Date,
  deps: YearlyRefreshDeps,
  tally: YearlyRefreshTally = { refreshed: 0, alreadyGranted: 0, failures: {} },
): Promise<YearlyRefreshTally> {
  const { yearMonth, monthStart } = grantMonth(now);
  const fail = (reason: string) => {
    tally.failures[reason] = (tally.failures[reason] ?? 0) + 1;
  };

  let granted: Set<string>;
  try {
    granted = await deps.grantedSince(
      page.map((row) => row.user_id),
      monthStart,
    );
  } catch {
    // Without the check, granting would repeat the double grant this module
    // exists to stop. Skip the page; tomorrow's run retries it.
    for (const _row of page) fail("ledger_read_failed");
    return tally;
  }

  for (const subscription of page) {
    const product = REVENUECAT_PRODUCT_MAP[subscription.product_id];
    if (
      !product || product.kind !== "subscription" ||
      product.interval !== "yearly"
    ) {
      fail("unknown_product");
      continue;
    }
    if (granted.has(subscription.user_id)) {
      tally.alreadyGranted += 1;
      continue;
    }
    try {
      await deps.refresh(
        subscription.user_id,
        product.credits,
        `revenuecat:annual:${subscription.product_id}:${yearMonth}`,
        `subscription:${subscription.user_id}:${yearMonth}`,
      );
      tally.refreshed += 1;
    } catch (error) {
      if (isDuplicateCreditOperationError(error)) {
        tally.refreshed += 1;
        continue;
      }
      // Continue: the per-user operation key makes a later cron retry safe.
      fail("refresh_failed");
    }
  }
  return tally;
}
