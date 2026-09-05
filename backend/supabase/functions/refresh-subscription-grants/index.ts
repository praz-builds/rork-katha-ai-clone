import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeEquals,
  REVENUECAT_PRODUCT_MAP,
} from "../_shared/revenuecat.ts";
import {
  isDuplicateCreditOperationError,
  refreshSubscriptionGrant,
} from "../_shared/credits.ts";

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
  const yearMonth = new Date().toISOString().slice(0, 7);
  let refreshed = 0;
  let scanned = 0;
  let cursor: string | null = null;
  const failures: Record<string, number> = {};

  while (true) {
    let query = serviceClient
      .from("revenuecat_subscriptions")
      .select("user_id, product_id")
      .eq("interval", "yearly")
      .eq("is_active", true)
      .eq("period_type", "NORMAL")
      .gt("expires_at", new Date().toISOString())
      .order("user_id", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) query = query.gt("user_id", cursor);
    const { data: subscriptions, error } = await query;
    if (error) return response({ error: "Unable to read subscriptions" }, 500);

    const page = subscriptions ?? [];
    scanned += page.length;
    for (const subscription of page) {
      const product = REVENUECAT_PRODUCT_MAP[subscription.product_id];
      if (
        !product || product.kind !== "subscription" ||
        product.interval !== "yearly"
      ) {
        failures.unknown_product = (failures.unknown_product ?? 0) + 1;
        continue;
      }
      try {
        await refreshSubscriptionGrant(
          serviceClient,
          subscription.user_id,
          product.credits,
          `revenuecat:annual:${subscription.product_id}:${yearMonth}`,
          `subscription:${subscription.user_id}:${yearMonth}`,
        );
        refreshed += 1;
      } catch (error) {
        if (isDuplicateCreditOperationError(error)) {
          refreshed += 1;
          continue;
        }
        // Continue: the per-user operation key makes a later cron retry safe.
        failures.refresh_failed = (failures.refresh_failed ?? 0) + 1;
      }
    }
    if (page.length < PAGE_SIZE) break;
    cursor = page.at(-1)?.user_id ?? null;
    if (!cursor) break;
  }
  const failed = Object.values(failures).reduce(
    (total, count) => total + count,
    0,
  );
  return response({
    ok: true,
    scanned,
    refreshed,
    failed,
    failure_reasons: failures,
    month: yearMonth,
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
