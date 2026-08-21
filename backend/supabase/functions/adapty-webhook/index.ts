import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { grantCredit } from "../_shared/credits.ts";

const ADAPTY_WEBHOOK_SECRET = Deno.env.get("ADAPTY_WEBHOOK_SECRET");

// Credit amounts per product
const CREDIT_MAP: Record<string, number> = {
  "starter_pack": 3,
  "value_pack": 10,
  "power_pack": 25,
  "monthly_sub": 20,
  "yearly_sub": 25,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify webhook signature
    if (ADAPTY_WEBHOOK_SECRET) {
      const signature = req.headers.get("x-adapty-signature");
      // TODO: Implement HMAC verification with ADAPTY_WEBHOOK_SECRET
      if (!signature) {
        return new Response("Missing signature", { status: 401 });
      }
    }

    const event = await req.json();
    const { event_type, profile_id, product_id, transaction_id } = event;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Map Adapty profile_id to our user_id
    // Adapty profile_id should be set to Supabase user ID during SDK init
    const userId = profile_id;

    switch (event_type) {
      case "subscription_started":
      case "subscription_renewed": {
        const credits = CREDIT_MAP[product_id] || 20;
        await grantCredit(
          serviceClient,
          userId,
          credits,
          "subscription",
          transaction_id
        );
        break;
      }

      case "non_subscription_purchase": {
        const credits = CREDIT_MAP[product_id] || 0;
        if (credits > 0) {
          await grantCredit(
            serviceClient,
            userId,
            credits,
            "purchase",
            transaction_id
          );
        }
        break;
      }

      case "subscription_cancelled":
      case "subscription_expired":
        // No credit action needed — just log
        console.log(`Subscription ${event_type} for user ${userId}`);
        break;

      default:
        console.log(`Unhandled Adapty event: ${event_type}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("adapty-webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
