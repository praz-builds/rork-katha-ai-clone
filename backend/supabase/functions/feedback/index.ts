import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import {
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);
    const story_id = parseUuid(body.story_id);
    const chapter_id = body.chapter_id === null || body.chapter_id === undefined
      ? null
      : parseUuid(body.chapter_id);
    const { content, request_id } = body;
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    if (!story_id) return respond({ error: "Invalid story_id" }, 400);
    if (
      body.chapter_id !== null && body.chapter_id !== undefined && !chapter_id
    ) {
      return respond({ error: "Invalid chapter_id" }, 400);
    }
    if (!normalizedContent) {
      return respond({ error: "content is required" }, 400);
    }
    if (normalizedContent.length > 2000) {
      return respond({
        error: "Feedback must be 2000 characters or fewer",
      }, 400);
    }
    const requestId = parseRequestId(request_id);
    if (!requestId) return respond({ error: "Invalid request_id" }, 400);

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
      if (error.code === "KTH03") {
        return respond({ error: "Story not found" }, 404);
      }
      if (error.code === "KTH04") {
        return respond({ error: "Chapter not found" }, 404);
      }
      if (error.code === "KTH05") {
        return respond(
          { error: "Feedback request belongs to another story" },
          409,
        );
      }
      throw error;
    }

    return respond(data);
  } catch (error) {
    console.error("feedback error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

/** Return a JSON response with the shared CORS headers. */
function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
