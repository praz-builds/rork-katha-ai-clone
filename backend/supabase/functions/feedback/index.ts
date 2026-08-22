import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";

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

    const body = await readJsonObject(req);
    if (!body) return jsonResponse({ error: "Invalid JSON request body" }, 400);
    const story_id = parseUuid(body.story_id);
    const chapter_id = body.chapter_id === null || body.chapter_id === undefined
      ? null
      : parseUuid(body.chapter_id);
    const { content, request_id } = body;
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    if (!story_id) return jsonResponse({ error: "Invalid story_id" }, 400);
    if (
      body.chapter_id !== null && body.chapter_id !== undefined && !chapter_id
    ) {
      return jsonResponse({ error: "Invalid chapter_id" }, 400);
    }
    if (!normalizedContent) {
      return jsonResponse({ error: "content is required" }, 400);
    }
    if (normalizedContent.length > 2000) {
      return jsonResponse({
        error: "Feedback must be 2000 characters or fewer",
      }, 400);
    }
    const requestId = parseRequestId(request_id);
    if (!requestId) return jsonResponse({ error: "Invalid request_id" }, 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await serviceClient.rpc("create_feedback", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_story_id: story_id,
      p_chapter_id: chapter_id,
      p_content: normalizedContent,
    });
    if (error) {
      if (error.message.includes("Story not found")) {
        return jsonResponse({ error: "Story not found" }, 404);
      }
      if (error.message.includes("Chapter not found")) {
        return jsonResponse({ error: "Chapter not found" }, 404);
      }
      if (error.message.includes("Feedback request belongs to another story")) {
        return jsonResponse({ error: error.message }, 409);
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
