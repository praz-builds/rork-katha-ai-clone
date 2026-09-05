import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { readJsonObject } from "../_shared/operations.ts";
import { parseUuid } from "../_shared/uuid.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const storyId = parseUuid(body.story_id);
    const chapterId = parseUuid(body.chapter_id);
    if (!storyId || !chapterId) {
      return respond(
        { error: "Valid story_id and chapter_id are required" },
        400,
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const [storyResult, chapterResult] = await Promise.all([
      serviceClient.from("stories").select("author_id").eq("id", storyId)
        .single(),
      serviceClient.from("chapters").select("story_id, audio_url").eq(
        "id",
        chapterId,
      ).eq("story_id", storyId).single(),
    ]);

    if (storyResult.error || chapterResult.error) {
      return respond({ error: "Chapter not found" }, 404);
    }
    if (storyResult.data.author_id !== user.id) {
      return respond({ error: "Not authorized" }, 403);
    }

    // Cached narration is free to replay and cannot trigger provider spend.
    if (chapterResult.data.audio_url) {
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        audio_url: chapterResult.data.audio_url,
        cached: true,
      });
    }

    // Fresh narration stays closed until the one-credit audio-unlock operation
    // is durable and idempotent. Calling RunPod before that exists creates an
    // unmetered paid endpoint and lets retries launch duplicate jobs.
    return respond(
      { error: "Narration unlock is not available yet" },
      503,
    );
  } catch (error) {
    console.error("generate-audio error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
