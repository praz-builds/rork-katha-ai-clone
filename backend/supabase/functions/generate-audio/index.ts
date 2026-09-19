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
  cancelRunpodNarration,
  canReadChapter,
  claimChapterAudioGeneration,
  findReadyChapterAudio,
  markChapterAudioFailed,
  markChapterAudioJobStarted,
  markChapterAudioReady,
  NARRATION_REFUSAL,
  publicAudioUrl,
  removeNarrationParts,
  stableChapterAudioPath,
  startRunpodNarration,
  uploadAudio,
} from "../_shared/narration-audio.ts";
import {
  MAX_NARRATION_CHARS,
  NARRATION_CHUNK_CHARS,
  NARRATION_MAX_CHUNKS,
  NARRATION_PROVIDER_CHAR_LIMIT,
  splitNarrationText,
} from "../_shared/narration-chunks.ts";

/**
 * The length ceiling and the chunk size both live in
 * `_shared/narration-chunks.ts`, next to the measurement that sets them and to
 * the splitter that enforces them, because `audio-status` needs exactly the
 * same numbers to finish what this function starts.
 *
 * What used to be here was a bare `const MAX_NARRATION_CHARS = 40_000` whose
 * comment reasoned only from the 50 MB response ceiling in
 * `narration-audio.ts`. It had no knowledge of the provider's own per-request
 * limit -- which is 10,000 characters -- so it was four times too high, and
 * 37.6% of the published library was accepted here, billed at RunPod, and then
 * handed back to the reader as "Try again", forever. See the long note on
 * `MAX_NARRATION_CHARS` for how the two ceilings are now reconciled.
 */

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

    // Cut the chapter to the provider's size, and refuse before spending.
    //
    // A chapter is no longer one provider request. MiniMax `speech-02-hd`
    // refuses anything over ~10,000 characters and a normal full-length
    // chapter is 9,000-13,000, so `splitNarrationText` cuts the prose at
    // paragraph (then sentence) boundaries into pieces the provider will
    // actually take. The pieces are narrated one per `audio-status` poll and
    // stitched into a single MP3 at the end; none of that is visible to the
    // caller, which still gets one 202 and then polls exactly as before.
    //
    // Done here, after the cache lookups and the entitlement gate, so a
    // chapter that was narrated before it grew still replays for free; and
    // before the claim, so a refusal does not occupy the (chapter, voice) row.
    const narrationText = chapter.content ?? "";
    const chunks = splitNarrationText(narrationText, NARRATION_CHUNK_CHARS);

    if (chunks.length === 0) {
      // No words at all. This used to be sent to RunPod as an empty `prompt`:
      // a billed job that could only fail, and that failed as an unreadable
      // traceback.
      return respond({
        error: "This chapter has no text to narrate.",
        // Both spellings on purpose. `code` is what this function has always
        // answered with; `error_code` is what the client's `outcomeFromError`
        // actually reads, so without it every refusal on this path reached the
        // reader as a bare "Try again" with the reason discarded on the way.
        code: "chapter_has_no_narratable_text",
        error_code: "chapter_has_no_narratable_text",
      }, 422);
    }

    if (
      narrationText.length > MAX_NARRATION_CHARS ||
      chunks.length > NARRATION_MAX_CHUNKS
    ) {
      await reportError({
        bucket: "generation.audio",
        severity: "low",
        errorCode: "chapter_too_long_to_narrate",
        error: new Error(
          `Chapter is ${narrationText.length} characters in ${chunks.length} chunks, against a ${MAX_NARRATION_CHARS} character / ${NARRATION_MAX_CHUNKS} chunk cap`,
        ),
        userId: user.id,
        // Counts, not text. These are the two numbers whose absence made the
        // production failures undiagnosable: the rows recorded that narration
        // failed and nothing about how long the chapter was.
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          chars: narrationText.length,
          chunks: chunks.length,
        },
      });
      return respond({
        error:
          "This chapter is too long to narrate. Split it into two chapters and try again.",
        code: "chapter_too_long_to_narrate",
        error_code: "chapter_too_long_to_narrate",
      }, 413);
    }

    // The splitter's contract, asserted rather than trusted. A chunk over the
    // provider's limit is the exact defect this whole change exists to end,
    // and refusing one here costs nothing next to billing a job that cannot
    // succeed and handing the reader another "Try again".
    const oversized = chunks.find((chunk) =>
      chunk.length > NARRATION_PROVIDER_CHAR_LIMIT
    );
    if (oversized) {
      await reportError({
        bucket: "generation.audio",
        severity: "high",
        errorCode: "narration_chunk_over_provider_limit",
        error: new Error(
          `A narration chunk is ${oversized.length} characters against the provider's ${NARRATION_PROVIDER_CHAR_LIMIT} limit`,
        ),
        userId: user.id,
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          chars: oversized.length,
        },
      });
      return respond({
        error: "This chapter could not be prepared for narration.",
        code: "narration_chunk_over_provider_limit",
        error_code: "narration_chunk_over_provider_limit",
      }, 500);
    }

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

    // A fresh claim starts the pipeline at chunk 0, so any parts left staged
    // by an abandoned earlier attempt must go first. Resuming onto them would
    // be worse than starting over: if the chapter was edited between the two
    // attempts, the finished file would splice two different revisions of the
    // prose together and nothing would report it. (`edit-story` deletes the
    // `chapter_audio` row on a rewrite but does not know about these staging
    // objects, which is precisely how that could happen.)
    await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);

    let jobId: string;
    try {
      if (voice.provider === "edge_tts") {
        const params = voice.provider_voice_params as { voice?: unknown };
        const edgeVoice = typeof params.voice === "string"
          ? params.voice
          : voice.id;
        const audioBytes = await generateWithEdgeTts(
          narrationText,
          edgeVoice,
        );
        await uploadAudio(serviceClient, storagePath, audioBytes);
        await markChapterAudioReady(serviceClient, claim.id!, storagePath);
        return respond({
          status: "COMPLETED",
          story_id: storyId,
          chapter_id: chapterId,
          voice_id: voiceId,
          audio_url: await publicAudioUrl(serviceClient, storagePath),
          cached: false,
        });
      }
      // Chunk 0 only. `audio-status` derives the same chunk list from the same
      // stored chapter text when this job finishes, and starts chunk 1 then.
      jobId = await startProviderJob(voice, chunks[0]);
    } catch (providerError) {
      // The provider never accepted a job, so there is nothing to reconcile
      // -- this is the ordinary "generation failed to start" path.
      const errorCode = providerErrorCode(providerError);
      await releaseClaim(serviceClient, claim.id!, errorCode, {
        story_id: storyId,
        chapter_id: chapterId,
      });
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
      // How many provider requests this narration will take. Additive and
      // advisory: the client polls the same way whatever the number is, but a
      // four-chunk chapter takes roughly four times as long as a one-chunk
      // chapter and a progress indicator that knows this can stop calling a
      // working narration "slow".
      chunks: chunks.length,
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
    throw new Error("edge_tts_is_synchronous");
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
  if (message.includes("EDGE_TTS_SERVICE_URL is not configured")) {
    return "edge_tts_service_missing";
  }
  if (message.includes("edge_tts_timeout")) {
    return "edge_tts_timeout";
  }
  if (message.includes("edge_tts_bad_response")) {
    return "edge_tts_bad_response";
  }
  const edgeFailure = /edge_tts_failed:(\d{3})/.exec(message);
  if (edgeFailure) {
    const status = Number(edgeFailure[1]);
    return status >= 500 ? "edge_tts_5xx" : "edge_tts_4xx";
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
  if (message.includes("edge_tts_is_synchronous")) {
    return "provider_error";
  }
  if (message.startsWith("unsupported_provider:")) {
    return "unsupported_provider";
  }
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
  return errorCode === "runpod_key_missing" ||
      errorCode === "runpod_start_5xx" ||
      errorCode === "edge_tts_service_missing" ||
      errorCode === "edge_tts_5xx"
    ? "critical"
    : "high";
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
