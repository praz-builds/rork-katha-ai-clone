import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { grantCredit } from "../_shared/credits.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
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

    const { story_id, chapter_id, content } = await req.json();
    if (!story_id || !content) {
      return new Response(
        JSON.stringify({ error: "story_id and content are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Insert comment
    const { data: comment, error } = await serviceClient
      .from("comments")
      .insert({
        user_id: user.id,
        story_id,
        chapter_id: chapter_id || null,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    // Check if user already got feedback credit for this story
    const { data: existing } = await serviceClient
      .from("credit_ledger")
      .select("id")
      .eq("user_id", user.id)
      .eq("reason", "feedback")
      .eq("reference_id", story_id)
      .limit(1);

    let creditGranted = false;
    let balance: number | undefined;

    if (!existing || existing.length === 0) {
      balance = await grantCredit(
        serviceClient,
        user.id,
        1,
        "feedback",
        story_id
      );
      creditGranted = true;
    }

    return new Response(
      JSON.stringify({
        comment,
        credit_granted: creditGranted,
        ...(balance !== undefined && { balance }),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("feedback error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
