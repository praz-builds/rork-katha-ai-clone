import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import { parseUuid } from "../_shared/uuid.ts";

const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/minimax-speech-02-hd";
const VALID_VOICE_IDS = new Set(["aria", "kai", "elvira", "alvaro", "onyx", "nova", "echo", "fable"]);

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

    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    const storyId = parseUuid(url.searchParams.get("story_id"));
    const chapterId = parseUuid(url.searchParams.get("chapter_id"));
    const rawVoiceId = url.searchParams.get("voice_id") ?? "aria";
    const voiceId = VALID_VOICE_IDS.has(rawVoiceId) ? rawVoiceId : "aria";

    if (!jobId) return respond({ error: "job_id is required" }, 400);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);
    if (!chapterId) return respond({ error: "Invalid chapter_id" }, 400);

    const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
    if (!runpodApiKey) return respond({ error: "Not configured" }, 503);

    // Check RunPod job status
    const statusResponse = await fetch(`${RUNPOD_ENDPOINT}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${runpodApiKey}` },
    });

    if (!statusResponse.ok) {
      return respond({ error: "Failed to check job status" }, 502);
    }

    const statusResult = await statusResponse.json();

    if (statusResult.status === "COMPLETED" && statusResult.output) {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      let audioUrl: string | null = null;

      // Storage path includes voice ID so each voice is cached separately
      const filePath = `${storyId}/${chapterId}/${voiceId}.mp3`;

      if (statusResult.output.audio_base64) {
        const audioBytes = decode(statusResult.output.audio_base64);

        const { error: uploadError } = await serviceClient.storage
          .from("audio")
          .upload(filePath, audioBytes, {
            contentType: "audio/mpeg",
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = serviceClient.storage
            .from("audio")
            .getPublicUrl(filePath);
          audioUrl = urlData.publicUrl;
        } else {
          console.error("Storage upload error:", uploadError);
        }
      } else if (statusResult.output.audio_url) {
        audioUrl = statusResult.output.audio_url;
      }

      // Update chapter with the default voice audio URL (aria = female default)
      // Verify chapter belongs to the story and the user owns the story
      if (audioUrl && chapterId && voiceId === "aria") {
        const { data: storyRow } = await serviceClient
          .from("stories")
          .select("author_id")
          .eq("id", storyId)
          .single();
        if (storyRow?.author_id === user.id) {
          await serviceClient
            .from("chapters")
            .update({ audio_url: audioUrl })
            .eq("id", chapterId)
            .eq("story_id", storyId);
        }
      }

      return respond({
        status: "COMPLETED",
        voice_id: voiceId,
        audio_url: audioUrl,
      });
    }

    if (statusResult.status === "FAILED") {
      return respond({
        status: "FAILED",
        voice_id: voiceId,
        error: statusResult.error ?? "Audio generation failed",
      });
    }

    return respond({
      status: statusResult.status,
      voice_id: voiceId,
      message:
        statusResult.status === "IN_QUEUE"
          ? "Waiting for GPU worker"
          : statusResult.status === "IN_PROGRESS"
            ? "Generating audio..."
            : statusResult.status,
    });
  } catch (error) {
    console.error("audio-status error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
