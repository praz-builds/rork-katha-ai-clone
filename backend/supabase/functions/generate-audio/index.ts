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
  chapterAudioChunkJobId,
  type ChapterAudioChunkRow,
  claimChapterAudioChunks,
  claimChapterAudioGeneration,
  findReadyChapterAudio,
  markChapterAudioChunkStarted,
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
  EDGE_TTS_MAX_NARRATION_CHARS,
  MAX_NARRATION_CHARS,
  NARRATION_CHUNK_CHARS,
  NARRATION_MAX_CHUNKS,
  NARRATION_MAX_CONCURRENT_CHUNKS,
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

    // What this narration is for, which the gate below now reads.
    //
    // Anything other than the one value a client may ask for is treated as a
    // reader pressing Listen, which is the conservative reading: an unknown
    // purpose must never be a way around the prefetch gate, and it must never
    // turn a normal Listen into a 503 either.
    const purpose = body.purpose === "prefetch" ? "prefetch" : "chapter";

    const entitlement = canGenerateNarration({
      userId: user.id,
      storyId,
      chapterId,
      voiceId,
      purpose,
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
    // actually take. Every piece is started below in this same request, and
    // `audio-status` publishes each one as it lands and stitches them into a
    // single MP3 once they are all in. The caller still gets one 202 and then
    // polls exactly as before -- what changed is that its poll now answers
    // with playable chunk URLs long before the stitched file exists.
    //
    // Done here, after the cache lookups and the entitlement gate, so a
    // chapter that was narrated before it grew still replays for free; and
    // before the claim, so a refusal does not occupy the (chapter, voice) row.
    const narrationText = chapter.content ?? "";

    // **Chunking is a MiniMax concern, and so is the ceiling that comes with
    // it.** edge-tts takes the chapter whole in one synchronous call and has
    // no per-request character cap, so handing it a limit derived from
    // MiniMax's would be the same category error this change is correcting --
    // a number justified against the wrong provider. It keeps the ceiling that
    // was always correct for it: the 50 MB response ceiling, expressed as
    // `EDGE_TTS_MAX_NARRATION_CHARS`.
    const chunked = voice.provider === "runpod_minimax";
    const chunks = chunked
      ? splitNarrationText(narrationText, NARRATION_CHUNK_CHARS)
      : (narrationText.trim() ? [narrationText] : []);
    const maxChars = chunked
      ? MAX_NARRATION_CHARS
      : EDGE_TTS_MAX_NARRATION_CHARS;

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
      narrationText.length > maxChars ||
      chunks.length > NARRATION_MAX_CHUNKS
    ) {
      await reportError({
        bucket: "generation.audio",
        severity: "low",
        errorCode: "chapter_too_long_to_narrate",
        error: new Error(
          `Chapter is ${narrationText.length} characters in ${chunks.length} chunks, against a ${maxChars} character / ${NARRATION_MAX_CHUNKS} chunk cap for provider ${voice.provider}`,
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
    const oversized = chunked
      ? chunks.find((chunk) => chunk.length > NARRATION_PROVIDER_CHAR_LIMIT)
      : undefined;
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

    // edge-tts is synchronous: one call, one file, no chunks, no polling.
    if (voice.provider === "edge_tts") {
      try {
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
      } catch (providerError) {
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
    }

    // --- Every chunk starts here, in this request ---------------------------
    //
    // Chunks used to be started one per `audio-status` poll, which meant the
    // reader heard nothing until the last one finished and the parts were
    // stitched: a measured 101.6s on a two-chunk chapter, ~135s on three.
    // Starting them together makes time-to-first-audio one chunk's synthesis
    // (~45s) whatever the chapter's length, because `audio-status` publishes
    // chunk 0's part as soon as it lands and the client plays it while the
    // rest are still at the provider. The stitch still happens and is still
    // verified, but behind a reader who is already listening.
    //
    // Chunk rows are written only for a chapter that actually has more than
    // one chunk, which is the MINORITY of the library: the split happens at
    // `NARRATION_CHUNK_CHARS` (9,000), not at the provider's 10,000, and the
    // median live chapter is 9,112 characters -- so rather more than half of
    // published chapters take two requests. (62% is the share under the
    // *provider* limit, which is a different line and not the one that
    // decides this.) A single-chunk chapter keeps the path it has always had: one job, one upload, straight to the stable
    // path, no staged part and no second object in the bucket. It also keeps
    // `audio-status`'s legacy branch working for it unchanged, which is the
    // same branch that finishes jobs started by the pre-00095 function.
    let chunkRows: ChapterAudioChunkRow[] = [];
    if (chunks.length > 1) {
      try {
        chunkRows = await claimChapterAudioChunks(
          serviceClient,
          claim.id!,
          chunks.map((chunk) => chunk.length),
        );
      } catch (chunkClaimError) {
        // Nothing has been started yet, so this costs no provider spend --
        // but the claim must be released or the (chapter, voice) pair sits
        // `pending` for ten minutes before 00054 lets anyone retry it.
        await releaseClaim(
          serviceClient,
          claim.id!,
          "narration_chunk_claim_failed",
          { story_id: storyId, chapter_id: chapterId },
        );
        await reportError({
          bucket: "generation.audio",
          severity: "high",
          errorCode: "narration_chunk_claim_failed",
          error: chunkClaimError,
          userId: user.id,
          context: {
            story_id: storyId,
            chapter_id: chapterId,
            chunks: chunks.length,
          },
        });
        return respond({ error: "Narration generation failed to start" }, 502);
      }
    }

    const started = await startAllChunks(voice, chunks);
    const startedJobIds = started.flatMap((outcome) =>
      outcome.ok ? [outcome.jobId] : []
    );

    // **Chunk 0 is the only chunk the reader needs in the first 45 seconds**,
    // so it is the only one whose failure to start kills the whole narration.
    // A later chunk that got a transient 500 leaves its row `pending` with no
    // job id; `audio-status` retries that start once on its next poll. Failing
    // a chapter the reader could already be listening to because chunk 3 was
    // unlucky is the worse trade -- it costs them everything, to save a retry.
    const first = started[0];
    if (!first.ok) {
      // Any later chunk that DID start is spend with nothing pointing at it:
      // this claim is about to be released, so cancel them before it is.
      for (const jobId of startedJobIds) await cancelRunpodNarration(jobId);
      const errorCode = providerErrorCode(first.error);
      await releaseClaim(serviceClient, claim.id!, errorCode, {
        story_id: storyId,
        chapter_id: chapterId,
      });
      await reportError({
        bucket: "generation.audio",
        severity: classifyStartFailureSeverity(errorCode),
        errorCode,
        error: first.error,
        userId: user.id,
        context: { story_id: storyId, chapter_id: chapterId },
      });
      return respond({ error: "Narration generation failed to start" }, 502);
    }

    try {
      // Chunk 0's id, on the PARENT row, exactly as before. Everything that
      // reads `chapter_audio.provider_job_id` -- `stillOwnsNarrationJob`,
      // `isNarrationJobStale`, 00054's re-claim -- keeps working untouched
      // because what it finds there has not changed meaning.
      await markChapterAudioJobStarted(serviceClient, claim.id!, first.jobId);
    } catch (recordError) {
      // RunPod already accepted these jobs and is generating on them -- this
      // write is what would have let anything ever learn their ids again. A
      // retry now would reclaim this same row and start more jobs on top of
      // ones already running unseen, exactly the duplicate spend the
      // (chapter, voice) claim exists to prevent. Cancel what we can, then
      // fail the row so a retry gets a clean claim instead of an untracked
      // race.
      for (const jobId of startedJobIds) await cancelRunpodNarration(jobId);
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

    for (let index = 0; index < chunkRows.length; index += 1) {
      const outcome = started[index];
      if (!outcome?.ok) {
        // Left `pending` with no job id on purpose: that is the state
        // `audio-status` recognises as "start this one, once".
        await logError({
          bucket: "generation.audio",
          severity: "low",
          errorCode: "narration_chunk_start_deferred",
          error: outcome?.ok === false ? outcome.error : undefined,
          userId: user.id,
          context: {
            story_id: storyId,
            chapter_id: chapterId,
            chunk: index,
            chunks: chunks.length,
          },
        });
        continue;
      }
      try {
        const recorded = await markChapterAudioChunkStarted(
          serviceClient,
          chunkRows[index].id,
          outcome.jobId,
        );
        // Lost the compare-and-swap -- but "lost" and "somebody already wrote
        // OUR id" look identical from a boolean, and on chunk 0 the second is
        // a real ordering, not a theoretical one: `markChapterAudioJobStarted`
        // above puts this job id on the PARENT row, and a concurrent reader's
        // `audio-status` poll adopts a parent id onto a chunk-0 row that has
        // none. That adoption lands between the two, this swap then fails, and
        // cancelling here would cancel the one job both rows point at --
        // ending a narration two readers are waiting on and billing three jobs
        // for nothing. So ask what the row actually holds, and cancel only
        // when it is genuinely somebody else's.
        if (!recorded) {
          let ownedByUs = false;
          try {
            ownedByUs = await chapterAudioChunkJobId(
              serviceClient,
              chunkRows[index].id,
            ) ===
              outcome.jobId;
          } catch (readError) {
            // Unknowable. Chunk 0's id survives on the parent row either way,
            // so leaving it running costs at most a job `audio-status` will
            // adopt; cancelling it costs the narration. Any later chunk has no
            // second record, so an uncollectable job is the worse outcome.
            ownedByUs = index === 0;
            await logError({
              bucket: "generation.audio",
              severity: "low",
              errorCode: "narration_chunk_owner_unreadable",
              error: readError,
              userId: user.id,
              context: {
                story_id: storyId,
                chapter_id: chapterId,
                chunk: index,
              },
            });
          }
          if (!ownedByUs) await cancelRunpodNarration(outcome.jobId);
        }
      } catch (recordChunkError) {
        // Chunk 0 is recoverable without cancelling anything: the parent row
        // holds its id and `audio-status` adopts it rather than starting a
        // second job. Any later chunk's id is genuinely lost, so the job is
        // cancelled and the row left for the one retry.
        if (index > 0) await cancelRunpodNarration(outcome.jobId);
        await logError({
          bucket: "generation.audio",
          severity: index === 0 ? "medium" : "high",
          errorCode: "narration_chunk_job_not_recorded",
          error: recordChunkError,
          userId: user.id,
          context: {
            story_id: storyId,
            chapter_id: chapterId,
            chunk: index,
            chunks: chunks.length,
          },
        });
      }
    }

    return respond({
      status: "PENDING",
      story_id: storyId,
      chapter_id: chapterId,
      voice_id: voiceId,
      job_id: first.jobId,
      cached: false,
      // How many provider requests this narration will take. Additive and
      // advisory: the client polls the same way whatever the number is, but a
      // progress indicator that knows the number can stop calling a working
      // narration "slow".
      chunks: chunks.length,
      // Additive, and always empty here: nothing can be ready in the same
      // request that started it. It exists so the field's TYPE is present from
      // the first response of a narration rather than appearing partway
      // through, and so a client can hold one shape for the whole lifecycle.
      // `audio-status` fills the real manifest.
      chunks_ready: [] as number[],
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

/** One chunk's attempt to reach the provider: an id, or the reason there is none. */
type ChunkStartOutcome =
  | { ok: true; jobId: string }
  | { ok: false; error: unknown };

/**
 * Start every chunk, together, and report each one's fate separately.
 *
 * `Promise.allSettled` rather than `Promise.all` because one chunk's failure
 * must not discard the others' job ids: those jobs are already running and
 * already being billed, and an id that never comes back is spend nothing can
 * collect or cancel. The caller decides what each failure means -- chunk 0's
 * is fatal, a later chunk's is a retry.
 *
 * Batched at `NARRATION_MAX_CONCURRENT_CHUNKS`, which today equals
 * `NARRATION_MAX_CHUNKS` and so never actually splits a chapter into more than
 * one batch. It is a guard for the day the chunk ceiling rises, not a
 * behaviour anything currently exercises.
 */
async function startAllChunks(
  voice: VoiceRecord,
  chunks: string[],
): Promise<ChunkStartOutcome[]> {
  const outcomes: ChunkStartOutcome[] = [];
  for (
    let at = 0;
    at < chunks.length;
    at += NARRATION_MAX_CONCURRENT_CHUNKS
  ) {
    const batch = chunks.slice(at, at + NARRATION_MAX_CONCURRENT_CHUNKS);
    const settled = await Promise.allSettled(
      batch.map((text) => startProviderJob(voice, text)),
    );
    for (const result of settled) {
      outcomes.push(
        result.status === "fulfilled"
          ? { ok: true, jobId: result.value }
          : { ok: false, error: result.reason },
      );
    }
  }
  return outcomes;
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
