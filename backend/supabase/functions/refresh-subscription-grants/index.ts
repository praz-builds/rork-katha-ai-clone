import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEquals } from "../_shared/revenuecat.ts";
import { refreshSubscriptionGrant } from "../_shared/credits.ts";
import {
  grantMonth,
  refreshYearlyGrantsPage,
  type YearlyRefreshTally,
  type YearlySubscriptionRow,
} from "../_shared/subscription-grants.ts";

const CRON_SECRET = Deno.env.get("SUBSCRIPTION_GRANT_CRON_SECRET");
const PAGE_SIZE = 250;

serve(async (req) => {
  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }
  if (!CRON_SECRET) return response({ error: "Cron is not configured" }, 503);
  const authorization = req.headers.get("Authorization") ?? "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;
  if (!constantTimeEquals(suppliedSecret, CRON_SECRET)) {
    return response({ error: "Unauthorized" }, 401);
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = new Date();
  const { yearMonth } = grantMonth(now);
  let scanned = 0;
  let cursor: string | null = null;
  const tally: YearlyRefreshTally = {
    refreshed: 0,
    alreadyGranted: 0,
    failures: {},
  };

  while (true) {
    let query = serviceClient
      .from("revenuecat_subscriptions")
      .select("user_id, product_id")
      .eq("interval", "yearly")
      .eq("is_active", true)
      .eq("period_type", "NORMAL")
      .gt("expires_at", now.toISOString())
      .order("user_id", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) query = query.gt("user_id", cursor);
    const { data: subscriptions, error } = await query;
    if (error) return response({ error: "Unable to read subscriptions" }, 500);

    const page = (subscriptions ?? []) as YearlySubscriptionRow[];
    scanned += page.length;
    await refreshYearlyGrantsPage(page, now, {
      // A positive subscription grant this calendar month, from the webhook
      // (the month of purchase or trial conversion) or from an earlier run.
      grantedSince: async (userIds, monthStart) => {
        if (userIds.length === 0) return new Set();
        const { data, error: ledgerError } = await serviceClient
          .from("credit_ledger")
          .select("user_id")
          .in("user_id", userIds)
          .eq("reason", "subscription")
          .gt("amount", 0)
          .gte("created_at", monthStart);
        if (ledgerError) throw new Error(ledgerError.message);
        return new Set(
          (data ?? []).map((row: { user_id: string }) => row.user_id),
        );
      },
      refresh: (userId, credits, referenceId, operationKey) =>
        refreshSubscriptionGrant(
          serviceClient,
          userId,
          credits,
          referenceId,
          operationKey,
        ),
    }, tally);
    if (page.length < PAGE_SIZE) break;
    cursor = page.at(-1)?.user_id ?? null;
    if (!cursor) break;
  }
  const failed = Object.values(tally.failures).reduce(
    (total, count) => total + count,
    0,
  );
  return response({
    ok: true,
    scanned,
    refreshed: tally.refreshed,
    already_granted: tally.alreadyGranted,
    failed,
    failure_reasons: tally.failures,
    month: yearMonth,
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
