import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeEquals,
  eventDate,
  type RevenueCatEvent,
  type RevenueCatWebhookPayload,
  REVENUECAT_PRODUCT_MAP,
  resolveRevenueCatCredit,
} from "../_shared/revenuecat.ts";
import {
  deductCredit,
  grantCredit,
  lapseCredits,
  refreshSubscriptionGrant,
} from "../_shared/credits.ts";

const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
const ALLOW_SANDBOX = Deno.env.get("REVENUECAT_ALLOW_SANDBOX") === "true";

serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!WEBHOOK_SECRET) {
    console.error("REVENUECAT_WEBHOOK_SECRET is not configured");
    return jsonResponse({ error: "Webhook is not configured" }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;
  if (!constantTimeEquals(suppliedSecret, WEBHOOK_SECRET)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let event: RevenueCatEvent | undefined;
  let rawBody = "";
  try {
    rawBody = await req.text();
    if (!rawBody.trim()) return jsonResponse({ ok: true });
    event = (JSON.parse(rawBody) as RevenueCatWebhookPayload).event;
    if (!event?.type) return jsonResponse({ ok: true, ignored: "missing event" });
    if (event.environment?.toUpperCase() === "SANDBOX" && !ALLOW_SANDBOX) {
      console.warn(`Rejected RevenueCat sandbox event ${event.id ?? "without-id"}`);
      return jsonResponse({ ok: true, ignored: "sandbox" });
    }

    const eventType = event.type.toUpperCase();
    const serviceClient = createServiceClient();
    if (eventType === "EXPIRATION") {
      const operation = resolveRevenueCatCreditForLifecycle(event);
      await recordSubscription(serviceClient, event, false, false);
      const balance = await lapseCredits(
        serviceClient,
        operation.userId,
        `revenuecat:expiration:${operation.productId}`,
        `rc:${operation.eventId}`,
      );
      return jsonResponse({ ok: true, balance });
    }
    if (eventType === "CANCELLATION") {
      // Cancellation means the subscription remains active until EXPIRATION.
      await recordSubscription(serviceClient, event, true, false);
      return jsonResponse({ ok: true, acknowledged: "will not renew" });
    }
    if (eventType === "PRODUCT_CHANGE" || eventType === "UNCANCELLATION") {
      // These events update subscription state but never mint a second grant.
      await recordSubscription(serviceClient, event, true, true);
      return jsonResponse({ ok: true, acknowledged: eventType.toLowerCase() });
    }
    if (eventType === "SUBSCRIPTION_PAUSED") {
      // A paused subscription is not an expiration event: preserve its credit
      // history, but exclude it from future annual grant refreshes.
      await recordSubscription(serviceClient, event, false, false);
      return jsonResponse({ ok: true, acknowledged: "paused" });
    }
    if (eventType === "BILLING_ISSUE") {
      // Keep the current entitlement record until RevenueCat emits EXPIRATION.
      await recordSubscription(serviceClient, event, true, true);
      return jsonResponse({ ok: true, acknowledged: "billing issue" });
    }

    const operation = resolveRevenueCatCredit(event);
    if (!operation) {
      console.log(`Ignoring RevenueCat event: ${eventType}`);
      return jsonResponse({ ok: true, ignored: eventType });
    }

    let balance: number;
    if (operation.reason === "chargeback") {
      balance = await deductCredit(
        serviceClient,
        operation.userId,
        operation.credits,
        "chargeback",
        operation.transactionId,
        `rc:${operation.eventId}`,
      );
    } else if (operation.reason === "subscription") {
      balance = await refreshSubscriptionGrant(
        serviceClient,
        operation.userId,
        operation.credits,
        operation.transactionId,
        `rc:${operation.eventId}`,
      );
      await recordSubscription(serviceClient, event, true, true);
    } else {
      balance = await grantCredit(
        serviceClient,
        operation.userId,
        operation.credits,
        "purchase",
        operation.transactionId,
        `rc:${operation.eventId}`,
      );
    }
    return jsonResponse({ ok: true, balance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if ([
      "Missing or invalid app_user_id",
      "Unknown product",
      "Missing RevenueCat event ID",
      "Missing transaction identifier",
      "Subscription received non-renewing purchase event",
      "Pack received subscription event",
    ].includes(message)) {
      const backlogError = await persistPaymentEventBacklog(event, rawBody, message);
      if (backlogError) console.error("RevenueCat rejected-event backlog failed:", backlogError);
      return jsonResponse({ error: message }, 422);
    }
    console.error("revenuecat-webhook error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

function resolveRevenueCatCreditForLifecycle(event: RevenueCatEvent) {
  // EXPIRATION does not grant or refund, but it must identify an authenticated
  // profile and a SKU before it can zero that profile's balance.
  const operation = resolveRevenueCatCredit({ ...event, type: "REFUND" });
  if (!operation) throw new Error("Invalid RevenueCat lifecycle event");
  return operation;
}

function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function recordSubscription(
  serviceClient: ReturnType<typeof createServiceClient>,
  event: RevenueCatEvent,
  isActive: boolean,
  willRenew: boolean,
) {
  const operation = resolveRevenueCatCreditForLifecycle(event);
  const product = REVENUECAT_PRODUCT_MAP[operation.productId];
  if (product.kind !== "subscription" || !product.entitlement || !product.tier || !product.interval) {
    throw new Error("Lifecycle event received for a non-subscription product");
  }
  const { error } = await serviceClient.rpc("record_revenuecat_subscription", {
    p_user_id: operation.userId,
    p_product_id: operation.productId,
    p_entitlement_id: product.entitlement,
    p_tier: product.tier,
    p_interval: product.interval,
    p_period_type: event.period_type === "TRIAL" ? "TRIAL" : "NORMAL",
    p_is_active: isActive,
    p_will_renew: willRenew,
    p_expires_at: eventDate(event),
    p_event_id: operation.eventId,
    p_event_at: new Date(event.event_timestamp_ms ?? Date.now()).toISOString(),
  });
  if (error) throw new Error(`Failed to record RevenueCat subscription: ${error.message}`);
}

async function persistPaymentEventBacklog(
  event: RevenueCatEvent | undefined,
  rawBody: string,
  message: string,
): Promise<string | null> {
  if (!event?.type || !event.id) return "Payment event payload is unavailable";
  const { error } = await createServiceClient().from("payment_event_backlog").upsert(
    {
      provider: "revenuecat",
      event_id: event.id,
      event_type: event.type,
      payload: event,
      status: "pending",
      last_error: message,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,event_id", ignoreDuplicates: true },
  );
  return error?.message ?? null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
