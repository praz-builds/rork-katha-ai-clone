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
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { readJsonObject } from "../_shared/operations.ts";
import { parseUuid } from "../_shared/uuid.ts";
import { logError } from "../_shared/errors.ts";
import { canGenerateNarration } from "../_shared/narration-entitlement.ts";
import {
  DEFAULT_VOICE_ID,
  getVoiceRecord,
  isKnownVoiceId,
  VoiceRecord,
} from "../_shared/voices.ts";
import { generateWithEdgeTts } from "../_shared/edge-tts.ts";
import {
  cancelRunpodNarration,
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

    let jobId: string;
    try {
      jobId = await startProviderJob(voice, chapter.content);
    } catch (providerError) {
      // The provider never accepted a job, so there is nothing to reconcile
      // -- this is the ordinary "generation failed to start" path.
      const errorCode = providerErrorCode(providerError);
      await releaseClaim(serviceClient, claim.id!, errorCode, {
        story_id: storyId,
        chapter_id: chapterId,
      });
      await logError({
        bucket: "generation.audio",
        severity: "high",
        errorCode,
        error: providerError,
        userId: user.id,
        context: { story_id: storyId, chapter_id: chapterId },
      });
      return respond({ error: "Narration generation failed to start" }, 502);
    }

    try {
      await markChapterAudioJobStarted(serviceClient, claim.id!, jobId);
    } catch (recordError) {
      // RunPod already accepted `jobId` and is generating on it -- this
      // write is what would have let anything ever learn that id again. A
      // retry now would reclaim this same row and start a second job on top
      // of one already running unseen, exactly the duplicate spend the
      // (chapter, voice) claim exists to prevent. Cancel what we can, then
      // fail the row so a retry gets a clean claim instead of an untracked
      // race.
      await cancelRunpodNarration(jobId);
      await releaseClaim(serviceClient, claim.id!, "job_not_recorded", {
        story_id: storyId,
        chapter_id: chapterId,
      });
      await logError({
        bucket: "generation.audio",
        severity: "critical",
        errorCode: "job_not_recorded",
        error: recordError,
        userId: user.id,
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          provider: voice.provider,
        },
      });
      return respond({ error: "Narration generation failed to start" }, 502);
    }

    return respond({
      status: "PENDING",
      story_id: storyId,
      chapter_id: chapterId,
      voice_id: voiceId,
      job_id: jobId,
      cached: false,
    }, 202);
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

function providerErrorCode(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 96) || "provider_error";
  }
  return "provider_error";
}

/**
 * Mark a claimed `chapter_audio` row failed, and never throw doing it.
 *
 * Both callers are already inside a failure path, and both reach this after
 * something else has gone wrong with the same database connection -- which is
 * precisely when this write is most likely to fail as well. Letting it throw
 * sent the request to the handler's outer catch, which logs `errorCode:
 * "unhandled"`: the specific reason the narration failed (`job_not_recorded`,
 * a provider 4xx) was replaced by the least useful code in the vocabulary, and
 * the alert that should have named the cause named nothing.
 *
 * The row is left `pending` when this fails, which used to strand the
 * (chapter, voice) pair forever. It no longer does: migration 00054 lets
 * `claim_chapter_audio_generation` re-claim a `pending` row that has sat
 * untouched for ten minutes, so the worst case is a delay rather than a
 * chapter that can never be narrated again. That is what makes swallowing this
 * error safe, and it is the only reason it is.
 */
async function releaseClaim(
  serviceClient: SupabaseClient,
  audioId: string,
  errorCode: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await markChapterAudioFailed(serviceClient, audioId, errorCode);
  } catch (releaseError) {
    await logError({
      bucket: "generation.audio",
      severity: "high",
      errorCode: "audio_claim_release_failed",
      error: releaseError,
      context: { ...context, original_error_code: errorCode },
    });
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
