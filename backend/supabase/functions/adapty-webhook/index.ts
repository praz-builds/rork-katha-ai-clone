import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdaptyEvent,
  constantTimeEquals,
  resolveAdaptyCredit,
  resolveAdaptyEventId,
} from "../_shared/adapty.ts";
import { grantCredit } from "../_shared/credits.ts";

const ADAPTY_WEBHOOK_SECRET = Deno.env.get("ADAPTY_WEBHOOK_SECRET");

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!ADAPTY_WEBHOOK_SECRET) {
    console.error("ADAPTY_WEBHOOK_SECRET is not configured");
    return jsonResponse({ error: "Webhook is not configured" }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!constantTimeEquals(authorization, ADAPTY_WEBHOOK_SECRET)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let event: AdaptyEvent | undefined;
  let rawBody = "";
  try {
    rawBody = await req.text();
    if (!rawBody.trim()) return jsonResponse({ ok: true });

    event = JSON.parse(rawBody) as AdaptyEvent;
    const operation = resolveAdaptyCredit(event);
    if (!operation) {
      console.log(
        `Ignoring Adapty event: ${event.event_type ?? "verification"}`,
      );
      return jsonResponse({ ok: true });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const balance = await grantCredit(
      serviceClient,
      operation.userId,
      operation.credits,
      operation.reason,
      operation.transactionId,
      `adapty:${operation.transactionId}`,
    );

    return jsonResponse({ ok: true, balance });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Refund event requires clawback processing"
    ) {
      const backlogError = await persistRefundBacklog(
        event,
        rawBody,
        error.message,
      );
      if (backlogError) {
        console.error(
          "Adapty refund backlog persistence failed:",
          backlogError,
        );
      }
      console.error("Adapty refund was not acknowledged:", error.message);
      return jsonResponse({ error: error.message }, 503);
    }
    if (
      error instanceof Error &&
      [
        "Missing or invalid customer_user_id",
        "Unknown product",
        "Missing transaction identifier",
      ].includes(error.message)
    ) {
      return jsonResponse({ error: error.message }, 422);
    }
    console.error("adapty-webhook error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

async function persistRefundBacklog(
  event: AdaptyEvent | undefined,
  rawBody: string,
  message: string,
): Promise<string | null> {
  if (!event?.event_type) return "Refund event payload is unavailable";

  const eventId = await resolveAdaptyEventId(event, rawBody);
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await serviceClient.from("payment_event_backlog").upsert({
    provider: "adapty",
    event_id: eventId,
    event_type: event.event_type,
    payload: event,
    status: "pending",
    last_error: message,
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider,event_id" });
  return error?.message ?? null;
}

/** Return a JSON webhook response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
