import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { grantCredit } from "../_shared/credits.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // Auth
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { type, verification_token } = await req.json();

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (type === "ad_reward") {
      // Check 24hr cooldown
      const { data: recent } = await serviceClient
        .from("ad_rewards")
        .select("id")
        .eq("user_id", user.id)
        .gte("claimed_at", new Date(Date.now() - 86400000).toISOString())
        .limit(1);

      if (recent && recent.length > 0) {
        return new Response(
          JSON.stringify({ error: "Ad reward already claimed in last 24 hours" }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // TODO: Verify AdMob SSV token server-side
      // For now, record the claim
      if (!verification_token) {
        return new Response(
          JSON.stringify({ error: "Missing verification token" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Record ad reward
      await serviceClient.from("ad_rewards").insert({
        user_id: user.id,
        verification_token,
      });

      // Grant 1 credit
      const balance = await grantCredit(
        serviceClient,
        user.id,
        1,
        "ad_reward",
        verification_token
      );

      return new Response(
        JSON.stringify({ balance, message: "Ad reward credited" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown grant type" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("grant-credit error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
