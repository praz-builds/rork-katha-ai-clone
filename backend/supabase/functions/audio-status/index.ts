import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import { parseUuid } from "../_shared/uuid.ts";
import { runpodStatusUrl } from "../_shared/runpod.ts";
import { DEFAULT_VOICE_ID, isValidVoiceId } from "../_shared/voices.ts";

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
    const rawVoiceId = url.searchParams.get("voice_id") ?? DEFAULT_VOICE_ID;
    const voiceId = isValidVoiceId(rawVoiceId) ? rawVoiceId : DEFAULT_VOICE_ID;

    if (!jobId) return respond({ error: "job_id is required" }, 400);
    // Reject before the key is attached, not after: the fetch below carries
    // RUNPOD_API_KEY, so an id that steers the path is a signed request to an
    // arbitrary RunPod API on our account.
    const statusUrl = runpodStatusUrl(jobId);
    if (!statusUrl) return respond({ error: "Invalid job_id" }, 400);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);
    if (!chapterId) return respond({ error: "Invalid chapter_id" }, 400);

    const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
    if (!runpodApiKey) return respond({ error: "Not configured" }, 503);

    // Check RunPod job status
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${runpodApiKey}` },
    });

    if (!statusResponse.ok) {
      // An unknown or expired job is not an upstream fault. Answering 502
      // tells the client "retry, the gateway is broken", so a poller spins
      // forever on a job id that will never resolve. 404 lets it stop.
      if (statusResponse.status === 404) {
        return respond({ error: "Job not found", job_id: jobId }, 404);
      }
      // Anything else is a genuine upstream failure. Carry the status so the
      // cause is visible in logs instead of being flattened to one string.
      console.error(
        `RunPod status check failed: HTTP ${statusResponse.status}`,
      );
      return respond(
        {
          error: "Failed to check job status",
          upstream_status: statusResponse.status,
        },
        502,
      );
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
      if (audioUrl && chapterId && voiceId === DEFAULT_VOICE_ID) {
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
      message: statusResult.status === "IN_QUEUE"
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
