import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import {
  DEFAULT_VOICES_BY_LANGUAGE,
  EDGE_TTS_VOICES,
  generateWithEdgeTts,
} from "../_shared/edge-tts.ts";

// Public endpoint — no deployment needed, pay per use
const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/chatterbox-turbo";

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
    const story_id = typeof body.story_id === "string" ? body.story_id : "";
    const chapter_id = typeof body.chapter_id === "string" ? body.chapter_id : "";
    const text = typeof body.text === "string" ? body.text : "";
    const language = typeof body.language === "string" ? body.language : "en";

    if (!story_id || !chapter_id || !text) {
      return respond(
        { error: "story_id, chapter_id, and text are required" },
        400,
      );
    }

    if (text.length > 50000) {
      return respond({ error: "Text too long (max 50,000 characters)" }, 400);
    }

    // Verify ownership: user must be the story author
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: story, error: storyErr } = await serviceClient
      .from("stories")
      .select("author_id")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) return respond({ error: "Story not found" }, 404);
    if (story.author_id !== user.id) {
      return respond({ error: "Not authorized" }, 403);
    }

    // Resolve the default voice pair for this language.
    const defaultPair = DEFAULT_VOICES_BY_LANGUAGE[language] ??
      DEFAULT_VOICES_BY_LANGUAGE["en"];
    const voiceIds: string[] = body.voice_id
      ? [String(body.voice_id)]
      : [...defaultPair];

    // ─── Route by language ────────────────────────────────────────────────
    if (language === "en") {
      // English: submit to RunPod (VibeVoice 1.5B)
      return await handleRunPod(req, respond, {
        story_id,
        chapter_id,
        text,
        language,
        voiceIds,
      });
    }

    // Non-English: attempt edge-tts synthesis
    return await handleEdgeTts(respond, {
      story_id,
      chapter_id,
      text,
      language,
      voiceIds,
    });
  } catch (error) {
    console.error("generate-audio error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

// ─── English: RunPod (Chatterbox Turbo — public endpoint) ────────────────────

interface AudioJobParams {
  story_id: string;
  chapter_id: string;
  text: string;
  language: string;
  voiceIds: string[];
}

async function handleRunPod(
  req: Request,
  respond: (body: unknown, status?: number) => Response,
  params: AudioJobParams,
): Promise<Response> {
  const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
  if (!runpodApiKey) {
    return respond({ error: "Audio generation is not configured" }, 503);
  }

  // Submit one RunPod job per voice (both run in parallel on separate workers)
  const jobs: { voice_id: string; job_id: string }[] = [];

  for (const voiceId of params.voiceIds) {
    const runpodResponse = await fetch(`${RUNPOD_ENDPOINT}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runpodApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: params.text,
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
    return respond(
      { error: "All audio generation jobs failed to start" },
      502,
    );
  }

  return respond({
    jobs,
    story_id: params.story_id,
    chapter_id: params.chapter_id,
    language: params.language,
    status: "IN_QUEUE",
    message:
      `${jobs.length} audio generation job(s) started. Poll /audio-status for each.`,
  });
}

// ─── Non-English: edge-tts (pending implementation) ───────────────────────────

async function handleEdgeTts(
  respond: (body: unknown, status?: number) => Response,
  params: AudioJobParams,
): Promise<Response> {
  const pending: { voice_id: string; edge_tts_voice: string }[] = [];

  for (const voiceId of params.voiceIds) {
    const edgeVoice = EDGE_TTS_VOICES[voiceId];
    if (!edgeVoice) {
      console.warn(
        `[edge-tts] No edge-tts mapping for voice "${voiceId}" in language "${params.language}"`,
      );
      continue;
    }

    // Attempt synthesis (currently returns null — placeholder)
    const audioBytes = await generateWithEdgeTts(params.text, edgeVoice);

    if (audioBytes) {
      // TODO: Upload audioBytes to Supabase Storage and return the URL.
      console.log(
        `[edge-tts] Synthesised ${audioBytes.length} bytes for voice "${voiceId}"`,
      );
    }

    pending.push({ voice_id: voiceId, edge_tts_voice: edgeVoice });
  }

  if (pending.length === 0) {
    return respond(
      {
        error:
          `No supported voices found for language "${params.language}". Supported: ${Object.keys(EDGE_TTS_VOICES).join(", ")}`,
      },
      400,
    );
  }

  // Return a structured response indicating that audio synthesis for this
  // language is not yet available. The client can handle this gracefully.
  return respond({
    jobs: [],
    pending_voices: pending,
    story_id: params.story_id,
    chapter_id: params.chapter_id,
    language: params.language,
    status: "PENDING_IMPLEMENTATION",
    message:
      `Audio narration for language "${params.language}" is coming soon. Voices: ${pending.map((p) => p.voice_id).join(", ")}.`,
  });
}
