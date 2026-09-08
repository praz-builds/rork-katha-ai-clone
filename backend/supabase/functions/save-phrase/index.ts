import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  try {
    if (req.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = authedClient(authHeader);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await readJsonObject(req, 4096);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const phrase = stringField(body.phrase, 160);
    const storyId = parseUuid(body.storyId);
    const chapterId = parseUuid(body.chapterId);
    const sentence = stringField(body.sentence, 600);
    if (!phrase) return respond({ error: "phrase is required" }, 400);
    if (!storyId) return respond({ error: "Invalid storyId" }, 400);
    if (!chapterId) return respond({ error: "Invalid chapterId" }, 400);
    if (!sentence) return respond({ error: "sentence is required" }, 400);

    const { data, error } = await supabase.rpc("save_phrase", {
      p_user_id: user.id,
      p_phrase: phrase,
      p_story_id: storyId,
      p_chapter_id: chapterId,
      p_sentence: sentence,
    });

    if (error) {
      if (error.code === "KTH04") {
        return respond({ error: "Story not found" }, 404);
      }
      if (error.code === "KTH05") {
        return respond({ error: "Chapter not found" }, 404);
      }
      if (error.code === "KTH02" || error.code === "KTH03") {
        return respond({ error: error.message }, 400);
      }
      throw error;
    }

    return respond({ phrase: data });
  } catch (error) {
    console.error("save-phrase error:", error);
    await logError({
      bucket: "phrase.learning",
      severity: "medium",
      errorCode: "save_phrase_failed",
      error,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

serve(handleRequest);

function authedClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
