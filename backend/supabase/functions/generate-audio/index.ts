import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";

const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/euevq9pcv3herw";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    // Parse body
    const body = await req.json();
    const { story_id, chapter_id, voice_id, text } = body;

    if (!story_id || !chapter_id || !text || !voice_id) {
      return respond({ error: "story_id, chapter_id, voice_id, and text are required" }, 400);
    }

    if (text.length > 50000) {
      return respond({ error: "Text too long (max 50,000 characters)" }, 400);
    }

    const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
    if (!runpodApiKey) {
      return respond({ error: "Audio generation is not configured" }, 503);
    }

    // Submit async job to RunPod
    const runpodResponse = await fetch(`${RUNPOD_ENDPOINT}/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${runpodApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          text,
          voice: voice_id,
          language: "en",
        },
      }),
    });

    if (!runpodResponse.ok) {
      const err = await runpodResponse.text();
      console.error("RunPod error:", err);
      return respond({ error: "Audio generation failed to start" }, 502);
    }

    const runpodResult = await runpodResponse.json();
    const jobId = runpodResult.id;

    // Store job reference in DB for polling
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Update chapter with pending audio status
    await serviceClient
      .from("chapters")
      .update({
        audio_url: null,
      })
      .eq("id", chapter_id);

    return respond({
      job_id: jobId,
      status: "IN_QUEUE",
      message: "Audio generation started. Poll /audio-status for progress.",
    });
  } catch (error) {
    console.error("generate-audio error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
