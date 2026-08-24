import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";

const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/euevq9pcv3herw";

// The two default voices generated for every published story.
const DEFAULT_VOICES = ["aria", "kai"] as const;

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

    const body = await req.json();
    const { story_id, chapter_id, text } = body;
    // voice_id is optional — if omitted, generates both defaults
    const voiceIds: string[] = body.voice_id
      ? [body.voice_id]
      : [...DEFAULT_VOICES];

    if (!story_id || !chapter_id || !text) {
      return respond(
        { error: "story_id, chapter_id, and text are required" },
        400,
      );
    }

    if (text.length > 50000) {
      return respond({ error: "Text too long (max 50,000 characters)" }, 400);
    }

    const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
    if (!runpodApiKey) {
      return respond({ error: "Audio generation is not configured" }, 503);
    }

    // Submit one RunPod job per voice (both run in parallel on separate workers)
    const jobs: { voice_id: string; job_id: string }[] = [];

    for (const voiceId of voiceIds) {
      const runpodResponse = await fetch(`${RUNPOD_ENDPOINT}/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runpodApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            text,
            voice: voiceId,
            language: "en",
          },
        }),
      });

      if (!runpodResponse.ok) {
        const err = await runpodResponse.text();
        console.error(`RunPod error for voice ${voiceId}:`, err);
        continue;
      }

      const result = await runpodResponse.json();
      jobs.push({ voice_id: voiceId, job_id: result.id });
    }

    if (jobs.length === 0) {
      return respond({ error: "All audio generation jobs failed to start" }, 502);
    }

    return respond({
      jobs,
      story_id,
      chapter_id,
      status: "IN_QUEUE",
      message: `${jobs.length} audio generation job(s) started. Poll /audio-status for each.`,
    });
  } catch (error) {
    console.error("generate-audio error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
