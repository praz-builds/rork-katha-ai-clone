import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

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
    const storyId = url.searchParams.get("story_id");
    const chapterId = url.searchParams.get("chapter_id");

    if (!jobId) return respond({ error: "job_id is required" }, 400);

    const runpodApiKey = Deno.env.get("RUNPOD_API_KEY");
    if (!runpodApiKey) return respond({ error: "Not configured" }, 503);

    // Check RunPod job status
    const statusResponse = await fetch(`${RUNPOD_ENDPOINT}/status/${jobId}`, {
      headers: { "Authorization": `Bearer ${runpodApiKey}` },
    });

    if (!statusResponse.ok) {
      return respond({ error: "Failed to check job status" }, 502);
    }

    const statusResult = await statusResponse.json();

    if (statusResult.status === "COMPLETED" && statusResult.output) {
      // Job completed — save audio to Supabase Storage
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      let audioUrl = null;

      // If output contains base64 audio data
      if (statusResult.output.audio_base64) {
        const audioBytes = decode(statusResult.output.audio_base64);
        const filePath = `audio/${storyId}/${chapterId}.mp3`;

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
        }
      } else if (statusResult.output.audio_url) {
        // If output contains a direct URL
        audioUrl = statusResult.output.audio_url;
      }

      // Update chapter with audio URL
      if (audioUrl && chapterId) {
        await serviceClient
          .from("chapters")
          .update({ audio_url: audioUrl })
          .eq("id", chapterId);
      }

      return respond({
        status: "COMPLETED",
        audio_url: audioUrl,
      });
    }

    // Still processing
    return respond({
      status: statusResult.status,
      message: statusResult.status === "IN_QUEUE" ? "Waiting for GPU worker" :
               statusResult.status === "IN_PROGRESS" ? "Generating audio..." :
               statusResult.status === "FAILED" ? "Audio generation failed" :
               statusResult.status,
    });
  } catch (error) {
    console.error("audio-status error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
