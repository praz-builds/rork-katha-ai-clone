import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { story_id, chapter_id, content } = await req.json();
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    if (!story_id || !normalizedContent) {
      return jsonResponse({ error: "story_id and content are required" }, 400);
    }
    if (normalizedContent.length > 2000) {
      return jsonResponse({
        error: "Feedback must be 2000 characters or fewer",
      }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await serviceClient.rpc("create_feedback", {
      p_user_id: user.id,
      p_story_id: story_id,
      p_chapter_id: chapter_id || null,
      p_content: normalizedContent,
    });
    if (error) {
      if (error.message.includes("Story not found")) {
        return jsonResponse({ error: "Story not found" }, 404);
      }
      if (error.message.includes("Chapter not found")) {
        return jsonResponse({ error: "Chapter not found" }, 404);
      }
      throw error;
    }

    return jsonResponse(data);
  } catch (error) {
    console.error("feedback error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

/** Return a JSON response with the shared CORS headers. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
