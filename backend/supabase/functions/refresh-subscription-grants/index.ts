import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEquals, REVENUECAT_PRODUCT_MAP } from "../_shared/revenuecat.ts";
import { refreshSubscriptionGrant } from "../_shared/credits.ts";

const CRON_SECRET = Deno.env.get("SUBSCRIPTION_GRANT_CRON_SECRET");

serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
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
  const { data: subscriptions, error } = await serviceClient
    .from("revenuecat_subscriptions")
    .select("user_id, product_id")
    .eq("interval", "yearly")
    .eq("is_active", true)
    .eq("period_type", "NORMAL")
    .gt("expires_at", new Date().toISOString());
  if (error) return response({ error: `Unable to read subscriptions: ${error.message}` }, 500);

  const yearMonth = new Date().toISOString().slice(0, 7);
  let refreshed = 0;
  for (const subscription of subscriptions ?? []) {
    const product = REVENUECAT_PRODUCT_MAP[subscription.product_id];
    if (!product || product.kind !== "subscription" || product.interval !== "yearly") {
      console.warn("Ignoring yearly subscription with unknown RevenueCat product", subscription.product_id);
      continue;
    }
    await refreshSubscriptionGrant(
      serviceClient,
      subscription.user_id,
      product.credits,
      `revenuecat:annual:${subscription.product_id}:${yearMonth}`,
      `subscription:${subscription.user_id}:${yearMonth}`,
    );
    refreshed += 1;
  }
  return response({ ok: true, refreshed, month: yearMonth });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
