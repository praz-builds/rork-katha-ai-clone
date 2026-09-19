/**
 * Poll a narration job's status against its durable chapter binding.
 *
 * Every job this function polls was started by `generate-audio` against a
 * `chapter_audio` row, so a job id is never trusted on its own -- it is read
 * off the row for the (chapter, voice) the caller asked about, and that row's
 * RLS policy is what proves the caller may see it. Polling stops as soon as
 * the row says `ready` or `failed`; only a `pending` row with a
 * `provider_job_id` reaches the provider at all.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { parseUuid } from "../_shared/uuid.ts";
import { type ErrorSeverity, logError } from "../_shared/errors.ts";
import { reportError } from "../_shared/sentry.ts";
import {
  DEFAULT_VOICE_ID,
  getVoiceRecord,
  isKnownVoiceId,
} from "../_shared/voices.ts";
import {
  advanceNarrationJob,
  cancelRunpodNarration,
  canReadChapter,
  type ChapterAudioRow,
  downloadNarrationParts,
  getChapterAudioRow,
  isNarrationJobStale,
  listNarrationParts,
  markChapterAudioFailed,
  markChapterAudioReady,
  NARRATION_JOB_STALE_MS,
  pollRunpodNarration,
  publicAudioUrl,
  removeNarrationParts,
  stableChapterAudioPath,
  startRunpodNarration,
  uploadAudio,
  uploadNarrationPart,
} from "../_shared/narration-audio.ts";
import {
  NARRATION_CHUNK_CHARS,
  splitNarrationText,
} from "../_shared/narration-chunks.ts";
import { concatenateMp3, readMp3Audio } from "../_shared/narration-mp3.ts";

/**
 * A single job's provider-reported failure ("high") vs a sign that narration
 * generation is stuck for more than just this one chapter ("critical").
 *
 * The signal is a direct count, not a guess: `idx_chapter_audio_pending`
 * already indexes `(status, updated_at) where status = 'pending'` for
 * exactly this query, so asking "how many other jobs are also stuck right
 * now" costs one indexed lookup, not a scan.
 */
async function classifyTimeoutSeverity(
  serviceClient: SupabaseClient,
): Promise<ErrorSeverity> {
  const staleBefore = new Date(Date.now() - NARRATION_JOB_STALE_MS)
    .toISOString();
  const { count, error } = await serviceClient
    .from("chapter_audio")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("updated_at", staleBefore);
  if (error || count === null) return "high";
  // This row is itself one of the rows the count includes, so more than one
  // means at least one other job is stuck at the same moment.
  return count > 1 ? "critical" : "high";
}

/**
 * Mark a stale-`pending` row failed and report the timeout once. Callers
 * reach this only from the `pending` branches below, and once the row is
 * `failed` every later poll returns from the `row.status === "failed"`
 * branch above the provider call -- so this fires exactly once per job, not
 * on every poll that finds it still stuck.
 */
async function timedOutResponsePayload(
  serviceClient: SupabaseClient,
  userId: string,
  row: ChapterAudioRow,
  storyId: string,
  chapterId: string,
  voiceId: string,
): Promise<Record<string, unknown>> {
  const errorCode = "generation_timed_out";
  // Counted BEFORE this row is marked failed, not after.
  //
  // `classifyTimeoutSeverity` counts stale `pending` rows and reads "more than
  // one" as systemic, because this row is meant to be one of the rows it
  // counts. Marking the row failed first took it out of the count, so the
  // reading was always one short: two jobs stuck at the same moment counted as
  // one and reported `high`, and the `critical` branch needed three. The exact
  // case the severity split exists to catch -- narration breaking for everyone
  // rather than for one chapter -- was the case it under-reported.
  const severity = await classifyTimeoutSeverity(serviceClient);
  await markChapterAudioFailed(serviceClient, row.id!, errorCode);
  await reportError({
    bucket: "generation.audio",
    severity,
    errorCode,
    error: new Error(
      `chapter_audio row ${row.id} pending beyond ${NARRATION_JOB_STALE_MS}ms`,
    ),
    userId,
    context: {
      story_id: storyId,
      chapter_id: chapterId,
      job_id: row.provider_job_id ?? undefined,
    },
  });
  return {
    status: "FAILED",
    story_id: storyId,
    chapter_id: chapterId,
    voice_id: voiceId,
    error_code: errorCode,
  };
}

/**
 * A narration's true duration, read from its own MPEG frames.
 *
 * Best effort by design: this is only ever used on the single-chunk path,
 * where the audio is published whether or not its length can be measured, and
 * a parser that refuses an unexpected but perfectly playable file must not be
 * what stops a reader hearing their chapter. The multi-chunk path is the
 * opposite case -- there the same parse is load-bearing, because the frames
 * are what the parts are joined on, so there it is allowed to throw.
 */
function measuredDuration(bytes: Uint8Array): number | null {
  try {
    return readMp3Audio(bytes).durationSeconds;
  } catch (error) {
    console.error("narration: could not measure audio duration", error);
    return null;
  }
}

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

    const url = new URL(req.url);
    const storyId = parseUuid(url.searchParams.get("story_id"));
    const chapterId = parseUuid(url.searchParams.get("chapter_id"));
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);
    if (!chapterId) return respond({ error: "Invalid chapter_id" }, 400);

    const requestedVoiceId = url.searchParams.get("voice_id");
    const voiceId = requestedVoiceId === null
      ? DEFAULT_VOICE_ID
      : requestedVoiceId;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Asked of the registry, not of the ids compiled into this build. Gating on
    // the static list rejected every voice added to `public.voices` after
    // deploy, which makes the table pointless as a registry.
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

    const row = await getChapterAudioRow(serviceClient, chapterId, voiceId);

    if (!row) {
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
      return respond(
        { error: "No narration job found for this chapter and voice" },
        404,
      );
    }

    if (row.status === "ready" && row.storage_path) {
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        audio_url: await publicAudioUrl(serviceClient, row.storage_path),
        cached: true,
      });
    }

    if (row.status === "failed") {
      return respond({
        status: "FAILED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        error_code: row.error_code ?? null,
      });
    }

    // `pending`. Nothing to poll until the request that claimed this row has
    // recorded the provider job id -- unless it never did, and the claim
    // itself is now stale (the isolate that claimed it never came back).
    if (!row.provider_job_id) {
      if (isNarrationJobStale(row.updated_at)) {
        return respond(
          await timedOutResponsePayload(
            serviceClient,
            user.id,
            row,
            storyId,
            chapterId,
            voiceId,
          ),
        );
      }
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
      });
    }

    const voice = await getVoiceRecord(serviceClient, voiceId);
    if (voice?.provider !== "runpod_minimax") {
      // No poller is wired for this voice's provider yet; report pending
      // rather than guessing at a status we cannot verify.
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
      });
    }

    const poll = await pollRunpodNarration(row.provider_job_id);

    if (poll.status === "pending") {
      if (isNarrationJobStale(row.updated_at)) {
        return respond(
          await timedOutResponsePayload(
            serviceClient,
            user.id,
            row,
            storyId,
            chapterId,
            voiceId,
          ),
        );
      }
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
      });
    }

    if (poll.status === "failed" || !poll.audioBytes) {
      const errorCode = poll.errorCode ?? "provider_failed";
      await markChapterAudioFailed(serviceClient, row.id!, errorCode);
      // A failed chunk ends the pipeline, so whatever earlier chunks were
      // staged are now unreachable bytes in a billed bucket. The retry starts
      // from chunk 0 (`generate-audio` clears them again on a fresh claim);
      // this is simply the earlier of the two chances to not leave them.
      await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
      // A single job the provider itself reported as failed (GPU OOM, no
      // usable output on a "completed" job, ...) -- one reader's chapter, not
      // a sign generation is broken for everyone. Compare the stale-timeout
      // path above, which escalates to "critical" when several jobs are
      // stuck at once.
      await reportError({
        bucket: "generation.audio",
        severity: "high",
        errorCode,
        error: new Error(`RunPod job ${row.provider_job_id} failed`),
        userId: user.id,
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          job_id: row.provider_job_id,
        },
      });
      return respond({
        status: "FAILED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        error_code: errorCode,
      });
    }

    const storagePath = row.storage_path ??
      stableChapterAudioPath(storyId, chapterId, voiceId);

    // The chunk list is re-derived here rather than stored, from the same
    // chapter text `generate-audio` read. `splitNarrationText` is pure, so the
    // two functions agree without a shared row -- and `edit-story` deletes the
    // `chapter_audio` row whenever it rewrites a body, so a narration in
    // flight can never be reading a different revision of the prose than the
    // one that was split.
    const chunks = splitNarrationText(
      chapter.content ?? "",
      NARRATION_CHUNK_CHARS,
    );

    if (chunks.length <= 1) {
      // The ordinary short chapter: one provider request, straight to the
      // final path, exactly as before. The only change is that the duration
      // is now derived from the audio's own frames -- RunPod does not return
      // one, so `chapter_audio.duration_seconds` has been null on every
      // narration this product has ever made.
      const audioUrl = await uploadAudio(
        serviceClient,
        storagePath,
        poll.audioBytes,
      );
      await markChapterAudioReady(
        serviceClient,
        row.id!,
        storagePath,
        measuredDuration(poll.audioBytes) ?? poll.durationSeconds,
      );
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        audio_url: audioUrl,
        cached: false,
      });
    }

    // --- Multi-request narration -------------------------------------------
    //
    // The chapter is longer than the provider will take in one request, so it
    // is narrated one chunk per poll. The persistent state is the set of
    // staged part objects in the `audio` bucket and nothing else: the number
    // of parts already there IS the index of the chunk that just finished.
    const staged = await listNarrationParts(
      serviceClient,
      storyId,
      chapterId,
      voiceId,
    );

    // Parts must be 0,1,2,... with no gap. A gap means a part was lost, and
    // assembling around it would hand the reader a chapter with a scene
    // silently missing from the middle -- a failure nothing downstream could
    // detect and the reader would blame on the writer. Fail instead, and let
    // the retry rebuild from chunk 0.
    if (staged.some((value, position) => value !== position)) {
      await markChapterAudioFailed(
        serviceClient,
        row.id!,
        "narration_parts_out_of_order",
      );
      await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
      await reportError({
        bucket: "generation.audio",
        severity: "high",
        errorCode: "narration_parts_out_of_order",
        error: new Error(
          `staged narration parts [${staged.join(",")}] are not contiguous`,
        ),
        userId: user.id,
        context: { story_id: storyId, chapter_id: chapterId },
      });
      return respond({
        status: "FAILED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        error_code: "narration_parts_out_of_order",
      });
    }

    const finishedIndex = staged.length;
    if (finishedIndex >= chunks.length) {
      // More parts on disk than the chapter has chunks. The text must have
      // changed under a narration that was already running, which the
      // `chapter_audio` delete in `edit-story` is supposed to make impossible.
      // Refuse to assemble a file from prose that no longer exists.
      await markChapterAudioFailed(
        serviceClient,
        row.id!,
        "narration_text_changed",
      );
      await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
      await reportError({
        bucket: "generation.audio",
        severity: "high",
        errorCode: "narration_text_changed",
        error: new Error(
          `${finishedIndex} parts staged for a ${chunks.length} chunk chapter`,
        ),
        userId: user.id,
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          chunks: chunks.length,
          parts: finishedIndex,
        },
      });
      return respond({
        status: "FAILED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        error_code: "narration_text_changed",
      });
    }

    await uploadNarrationPart(
      serviceClient,
      storyId,
      chapterId,
      voiceId,
      finishedIndex,
      poll.audioBytes,
    );

    const nextIndex = finishedIndex + 1;
    if (nextIndex < chunks.length) {
      // Start the next chunk and hand the row over to it. Still one provider
      // job in flight at a time, so the (chapter, voice) claim keeps meaning
      // exactly what it has always meant.
      let nextJobId: string;
      try {
        nextJobId = await startRunpodNarration({
          text: chunks[nextIndex],
          voice,
        });
      } catch (startError) {
        await markChapterAudioFailed(
          serviceClient,
          row.id!,
          "narration_chunk_start_failed",
        );
        await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
        await reportError({
          bucket: "generation.audio",
          severity: "high",
          errorCode: "narration_chunk_start_failed",
          error: startError,
          userId: user.id,
          context: {
            story_id: storyId,
            chapter_id: chapterId,
            chunk: nextIndex,
            chunks: chunks.length,
          },
        });
        return respond({
          status: "FAILED",
          story_id: storyId,
          chapter_id: chapterId,
          voice_id: voiceId,
          error_code: "narration_chunk_start_failed",
        });
      }

      // Compare-and-swap, because polling is driven by the reader's client and
      // two polls can overlap. Both would see this chunk finish, both would
      // start the next one, and a plain write would leave the loser's job
      // running with nothing pointing at it: spend that is never collected and
      // never cancelled.
      const advanced = await advanceNarrationJob(
        serviceClient,
        row.id!,
        row.provider_job_id,
        nextJobId,
      );
      if (!advanced) await cancelRunpodNarration(nextJobId);

      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        chunks_done: nextIndex,
        chunks: chunks.length,
      });
    }

    // Last chunk. Assemble, verify, publish.
    let assembled;
    try {
      const earlier = await downloadNarrationParts(
        serviceClient,
        storyId,
        chapterId,
        voiceId,
        finishedIndex,
      );
      // `concatenateMp3` re-reads the joined bytes and refuses if the frame
      // count is not the sum of the parts' -- so a seam that lost or invented
      // audio fails here rather than reaching the reader as a chapter that
      // skips a paragraph.
      assembled = concatenateMp3([...earlier, poll.audioBytes]);
    } catch (assemblyError) {
      const errorCode = assemblyError instanceof Error &&
          assemblyError.message.startsWith("narration_part_missing")
        ? "narration_part_missing"
        : "narration_assembly_failed";
      await markChapterAudioFailed(serviceClient, row.id!, errorCode);
      await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
      await reportError({
        bucket: "generation.audio",
        // Every chunk of this chapter has been generated and billed by now, so
        // failing at the join wastes the entire cost of the narration rather
        // than one request's worth. That is worth more than a routine "high".
        severity: "critical",
        errorCode,
        error: assemblyError,
        userId: user.id,
        context: {
          story_id: storyId,
          chapter_id: chapterId,
          chunks: chunks.length,
        },
      });
      return respond({
        status: "FAILED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        error_code: errorCode,
      });
    }

    const audioUrl = await uploadAudio(
      serviceClient,
      storagePath,
      assembled.bytes,
    );
    await markChapterAudioReady(
      serviceClient,
      row.id!,
      storagePath,
      assembled.durationSeconds,
    );
    // Only now: the parts are dead weight the moment the finished file is
    // readable, and not one moment before. Deleting them before the upload
    // would mean an upload failure could not be retried from anything.
    await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);

    return respond({
      status: "COMPLETED",
      story_id: storyId,
      chapter_id: chapterId,
      voice_id: voiceId,
      audio_url: audioUrl,
      cached: false,
      chunks: chunks.length,
    });
  } catch (error) {
    console.error("audio-status error:", error);
    await logError({
      bucket: "generation.audio",
      severity: "high",
      errorCode: "unhandled",
      error,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
