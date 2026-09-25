import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeEquals,
  eventDate,
  isStoreRefundCancellation,
  productChangeTarget,
  resolveRevenueCatCredit,
  resolveRevenueCatIdentity,
  REVENUECAT_PRODUCT_MAP,
  type RevenueCatEvent,
  type RevenueCatWebhookPayload,
  settleStoreRefund,
} from "../_shared/revenuecat.ts";
import {
  deductCredit,
  grantCredit,
  isDuplicateCreditOperationError,
  lapseCredits,
  refreshSubscriptionGrant,
} from "../_shared/credits.ts";
import { settleSubscriptionGrant } from "../_shared/subscription-grants.ts";

const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
const ALLOW_SANDBOX = Deno.env.get("REVENUECAT_ALLOW_SANDBOX") === "true";

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
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
    if (!event?.type) {
      return jsonResponse({ ok: true, ignored: "missing event" });
    }
    if (event.environment?.toUpperCase() === "SANDBOX" && !ALLOW_SANDBOX) {
      console.warn(
        `Rejected RevenueCat sandbox event ${event.id ?? "without-id"}`,
      );
      return jsonResponse({ ok: true, ignored: "sandbox" });
    }

    const eventType = event.type.toUpperCase();
    const serviceClient = createServiceClient();
    if (eventType === "EXPIRATION") {
      const identity = resolveRevenueCatIdentity(event);
      await recordSubscription(serviceClient, event, false, false);

      // Only the expiration that actually won gets to zero the balance.
      //
      // `lapse_credits` empties every bucket -- subscription grant, purchased
      // packs and earned credits alike (decision 37, pending App Review) --
      // and it ran on any EXPIRATION at all, keyed only on the event id being
      // new. Two ordinary sequences made that destructive:
      //
      //   * A retry or a straggler. RevenueCat redelivers, and events arrive
      //     out of order. A previous period's EXPIRATION landing seconds
      //     after this period's RENEWAL wiped the grant the renewal had just
      //     paid for, while `record_revenuecat_subscription` -- which IS
      //     ordered, by `last_event_at` -- correctly ignored the same event
      //     and left the subscription showing active. Active tier, zero
      //     credits, no explanation.
      //   * An upgrade. Monthly to yearly is a PRODUCT_CHANGE; when the old
      //     monthly period ends, its EXPIRATION arrives for a product the
      //     user no longer holds, and took the yearly grant with it.
      //
      // The check is the subscription row itself. `record_revenuecat_subscription`
      // updates only when `last_event_at <= excluded.last_event_at`, so that
      // row names whichever subscription event is most recent: if this one is
      // it, the expiration is current and the lapse stands; if the row names
      // something newer, this expiration lost and must not touch the money.
      //
      // The comparison happens INSIDE `lapse_credits`, under the per-user
      // advisory lock every credit operation takes (00068), not out here.
      // Reading the row in this function and then calling the RPC would leave
      // a gap in which a concurrent RENEWAL grants a month of credits that the
      // call then erases -- a smaller version of the bug being fixed.
      const balance = await lapseCredits(
        serviceClient,
        identity.userId,
        `revenuecat:expiration:${identity.productId}`,
        `rc:${identity.eventId}`,
        identity.eventId,
      );
      return jsonResponse({ ok: true, balance });
    }
    if (eventType === "CANCELLATION") {
      if (isStoreRefundCancellation(event)) {
        const operation = resolveRevenueCatCredit(event);
        if (!operation || operation.reason !== "chargeback") {
          throw new Error("Invalid RevenueCat refund cancellation");
        }
        const settlement = await settleStoreRefund(
          () =>
            deductCredit(
              serviceClient,
              operation.userId,
              operation.credits,
              "chargeback",
              operation.transactionId,
              `rc:${operation.eventId}`,
            ),
          operation.subscription
            ? () =>
              recordSubscription(
                serviceClient,
                event as RevenueCatEvent,
                false,
                false,
              )
            : undefined,
        );
        return jsonResponse(
          settlement.deductionAlreadyApplied
            ? { ok: true, acknowledged: "duplicate" }
            : { ok: true, balance: settlement.balance },
        );
      }
      // Plain cancellation means the subscription remains active until EXPIRATION.
      await recordSubscription(serviceClient, event, true, false);
      return jsonResponse({ ok: true, acknowledged: "will not renew" });
    }
    if (eventType === "PRODUCT_CHANGE" || eventType === "UNCANCELLATION") {
      // These events update subscription state but never mint a second grant.
      // A product change is recorded as the product being moved TO
      // (`new_product_id`), not the one being left.
      await recordSubscription(
        serviceClient,
        eventType === "PRODUCT_CHANGE" ? productChangeTarget(event) : event,
        true,
        true,
      );
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
      const settled = await settleSubscriptionGrant(
        operation,
        event,
        new Date(),
        {
          ledgerThisMonth: async (userId, monthStart) => {
            const { data, error: ledgerError } = await serviceClient
              .from("credit_ledger")
              .select("reason, amount, created_at")
              .eq("user_id", userId)
              .in("reason", ["subscription", "lapse"])
              .gte("created_at", monthStart);
            if (ledgerError) throw new Error(ledgerError.message);
            return data ?? [];
          },
          refresh: (userId, credits, referenceId, operationKey) =>
            refreshSubscriptionGrant(
              serviceClient,
              userId,
              credits,
              referenceId,
              operationKey,
            ),
        },
      );
      await recordSubscription(serviceClient, event, true, true);
      if (settled.alreadyGranted) {
        // The yearly anniversary: the cron already paid this month's grant.
        return jsonResponse({
          ok: true,
          acknowledged: "already granted this month",
        });
      }
      balance = settled.balance ?? 0;
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
    if (isDuplicateCreditOperationError(error)) {
      return jsonResponse({ ok: true, acknowledged: "duplicate" });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      [
        "Missing or invalid app_user_id",
        "Unknown product",
        "Missing RevenueCat event ID",
        "Missing transaction identifier",
        "Subscription received non-renewing purchase event",
        "Pack received subscription event",
      ].includes(message)
    ) {
      const backlogError = await persistPaymentEventBacklog(
        event,
        rawBody,
        message,
      );
      if (backlogError) {
        console.error(
          "RevenueCat rejected-event backlog failed:",
          backlogError,
        );
      }
      return jsonResponse({ error: message }, 422);
    }
    console.error("revenuecat-webhook error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

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
  const identity = resolveRevenueCatIdentity(event);
  const product = REVENUECAT_PRODUCT_MAP[identity.productId];
  if (
    product.kind !== "subscription" || !product.entitlement || !product.tier ||
    !product.interval
  ) {
    throw new Error("Lifecycle event received for a non-subscription product");
  }
  const { error } = await serviceClient.rpc("record_revenuecat_subscription", {
    p_user_id: identity.userId,
    p_product_id: identity.productId,
    p_entitlement_id: product.entitlement,
    p_tier: product.tier,
    p_interval: product.interval,
    p_period_type: event.period_type === "TRIAL" ? "TRIAL" : "NORMAL",
    p_is_active: isActive,
    p_will_renew: willRenew,
    p_expires_at: eventDate(event),
    p_event_id: identity.eventId,
    p_event_at: new Date(event.event_timestamp_ms ?? Date.now()).toISOString(),
  });
  if (error) {
    throw new Error(
      `Failed to record RevenueCat subscription: ${error.message}`,
    );
  }
}

async function persistPaymentEventBacklog(
  event: RevenueCatEvent | undefined,
  rawBody: string,
  message: string,
): Promise<string | null> {
  if (!event?.type || !event.id) return "Payment event payload is unavailable";
  const { error } = await createServiceClient().from("payment_event_backlog")
    .upsert(
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
