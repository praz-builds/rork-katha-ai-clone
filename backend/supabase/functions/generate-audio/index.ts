/**
 * Lazy narration lookup and generation.
 *
 * Cached narration is free to replay for any reader who can already read the
 * chapter. A miss never reaches RunPod on its own: `canGenerateNarration`
 * (`_shared/narration-entitlement.ts`) is asked first, and today that gate
 * defaults to closed, so this function's production behaviour is unchanged
 * until `NARRATION_GENERATION_ENABLED` is turned on. When it is on, the
 * (chapter, voice) row is claimed through `claim_chapter_audio_generation`
 * before RunPod is ever called, so two readers pressing Listen at the same
 * moment start exactly one job -- the loser sees `claimed: false` and simply
 * reports the job the winner already started.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { readJsonObject } from "../_shared/operations.ts";
import { parseUuid } from "../_shared/uuid.ts";
import { type ErrorSeverity, logError } from "../_shared/errors.ts";
import { reportError } from "../_shared/sentry.ts";
import { canGenerateNarration } from "../_shared/narration-entitlement.ts";
import {
  DEFAULT_VOICE_ID,
  getVoiceRecord,
  isKnownVoiceId,
  VoiceRecord,
} from "../_shared/voices.ts";
import { generateWithEdgeTts } from "../_shared/edge-tts.ts";
import {
  canReadChapter,
  claimChapterAudioGeneration,
  findReadyChapterAudio,
  markChapterAudioFailed,
  markChapterAudioJobStarted,
  NARRATION_REFUSAL,
  publicAudioUrl,
  stableChapterAudioPath,
  startRunpodNarration,
} from "../_shared/narration-audio.ts";

export async function handleRequest(req: Request): Promise<Response> {
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

    const voiceId = body.voice_id === undefined || body.voice_id === null
      ? DEFAULT_VOICE_ID
      : body.voice_id;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Asked of the registry, not of the ids compiled into this build. Gating on
    // the static list rejected every voice added to `public.voices` after
    // deploy, which makes the table pointless as a registry, and accepted ones
    // an administrator had deactivated.
    if (
      typeof voiceId !== "string" ||
      !(await isKnownVoiceId(serviceClient, voiceId))
    ) {
      return respond({ error: "Unknown voice_id" }, 400);
    }

    const [storyResult, chapterResult] = await Promise.all([
      serviceClient.from("stories").select("author_id, is_public, is_curated")
        .eq("id", storyId).single(),
      serviceClient.from("chapters").select(
        "id, story_id, content, word_count, audio_url, is_published",
      ).eq("id", chapterId).eq("story_id", storyId).single(),
    ]);

    if (storyResult.error || chapterResult.error) {
      return respond({ error: "Chapter not found" }, 404);
    }
    const story = storyResult.data;
    const chapter = chapterResult.data;
    if (!canReadChapter(user.id, story, chapter)) {
      return respond({ error: "Not authorized" }, 403);
    }

    // Cached narration is free to replay and cannot trigger provider spend.
    const ready = await findReadyChapterAudio(
      serviceClient,
      chapterId,
      voiceId,
    );
    if (ready?.storage_path) {
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        audio_url: await publicAudioUrl(serviceClient, ready.storage_path),
        cached: true,
      });
    }

    // Rows written before the `chapter_audio` backfill still have the legacy
    // column. Treat it as cached rather than asking the provider to redo work
    // that already exists on disk.
    if (voiceId === DEFAULT_VOICE_ID && chapter.audio_url) {
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        audio_url: chapter.audio_url,
        cached: true,
      });
    }

    const entitlement = canGenerateNarration({
      userId: user.id,
      storyId,
      chapterId,
      voiceId,
      purpose: "chapter",
    });
    if (!entitlement.allowed) {
      return respond({ error: NARRATION_REFUSAL }, 503);
    }

    const voice = await getVoiceRecord(serviceClient, voiceId);
    if (!voice) return respond({ error: "Unknown voice_id" }, 400);

    const storagePath = stableChapterAudioPath(storyId, chapterId, voiceId);
    const claim = await claimChapterAudioGeneration(
      serviceClient,
      chapter,
      voiceId,
      storagePath,
    );

    if (!claim.claimed) {
      // Someone else's request is already generating this (chapter, voice),
      // or won the race and finished first between our read above and here.
      if (claim.status === "ready" && claim.storage_path) {
        return respond({
          status: "COMPLETED",
          story_id: storyId,
          chapter_id: chapterId,
          voice_id: voiceId,
          audio_url: await publicAudioUrl(serviceClient, claim.storage_path),
          cached: true,
        });
      }
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        cached: false,
      }, 202);
    }

    try {
      const jobId = await startProviderJob(voice, chapter.content);
      await markChapterAudioJobStarted(serviceClient, claim.id!, jobId);
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        job_id: jobId,
        cached: false,
      }, 202);
    } catch (providerError) {
      const errorCode = providerErrorCode(providerError);
      await markChapterAudioFailed(serviceClient, claim.id!, errorCode);
      await reportError({
        bucket: "generation.audio",
        severity: classifyStartFailureSeverity(errorCode),
        errorCode,
        error: providerError,
        userId: user.id,
        context: { story_id: storyId, chapter_id: chapterId },
      });
      return respond({ error: "Narration generation failed to start" }, 502);
    }
  } catch (error) {
    console.error("generate-audio error:", error);
    await logError({
      bucket: "generation.audio",
      severity: "high",
      errorCode: "unhandled",
      error,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

/** Start a provider job for a voice's configured backend, or throw. */
async function startProviderJob(
  voice: VoiceRecord,
  text: string,
): Promise<string> {
  if (voice.provider === "runpod_minimax") {
    return await startRunpodNarration({ text, voice });
  }
  if (voice.provider === "edge_tts") {
    // `generateWithEdgeTts` always returns null today -- it is a documented
    // placeholder (see `_shared/edge-tts.ts`), not a job-starting API. Calling
    // through to it and surfacing a typed failure keeps this branch ready for
    // when a real backend lands, instead of silently claiming a job started.
    const params = voice.provider_voice_params as { voice?: unknown };
    const edgeVoice = typeof params.voice === "string"
      ? params.voice
      : voice.id;
    await generateWithEdgeTts(text, edgeVoice);
    throw new Error("edge_tts_not_implemented");
  }
  throw new Error(`unsupported_provider:${voice.provider}`);
}

/**
 * Classify a provider start failure into one of a fixed set of codes.
 *
 * This used to return `error.message` truncated to 96 characters, which made
 * the "code" whatever text happened to be thrown -- and that value is written
 * to `chapter_audio.error_code`, to `error_events`, and now to a Sentry tag.
 * None of the current throw sites interpolate a response *body* (they carry a
 * status number at most), so nothing has leaked; but that is a property of
 * today's call sites rather than of this function, and one future
 * `throw new Error(await response.text())` would have changed it silently.
 *
 * An enumeration also makes the severity split below something other than
 * substring matching against English prose, which would have broken the first
 * time one of those messages was reworded.
 */
function providerErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "provider_error";
  const message = error.message;

  if (message.includes("RUNPOD_API_KEY is not configured")) {
    return "runpod_key_missing";
  }
  if (message.includes("RunPod start returned no job id")) {
    return "runpod_no_job_id";
  }
  const startFailure = /RunPod start failed: (\d{3})/.exec(message);
  if (startFailure) {
    // The status is the part worth keeping, and it is a number, so it can be
    // kept without keeping any text alongside it.
    const status = Number(startFailure[1]);
    return status >= 500 ? "runpod_start_5xx" : "runpod_start_4xx";
  }
  if (message.includes("edge_tts_not_implemented")) {
    return "edge_tts_not_implemented";
  }
  if (message.startsWith("unsupported_provider:")) return "unsupported_provider";
  return "provider_error";
}

/**
 * A single job's failure to start ("high") vs a sign that narration
 * generation is broken for everyone ("critical"). A missing provider
 * credential or a 5xx from RunPod's own `/run` endpoint are
 * configuration/outage shaped -- true regardless of which chapter was being
 * narrated -- unlike a 4xx, a missing job id, or an unimplemented provider,
 * each of which is specific to this one request.
 */
function classifyStartFailureSeverity(errorCode: string): ErrorSeverity {
  return errorCode === "runpod_key_missing" || errorCode === "runpod_start_5xx"
    ? "critical"
    : "high";
}

if (import.meta.main) {
  serve(handleRequest);
}
