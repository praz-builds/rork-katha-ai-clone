/**
 * Poll a narration job's status against its durable chapter binding.
 *
 * Every job this function polls was started by `generate-audio` against a
 * `chapter_audio` row, so a job id is never trusted on its own -- it is read
 * off the row for the (chapter, voice) the caller asked about, and that row's
 * RLS policy is what proves the caller may see it. Only a `pending` row with a
 * `provider_job_id` reaches the provider at all.
 *
 * A `ready` row is no longer the end of polling. A chunked narration is
 * playable from chunk 0 while the rest is still at the provider, so the client
 * deliberately keeps polling a narration it has already started playing --
 * this function's answer is the only thing that ever tells it where the later
 * chunks are. What ends the poll is a COMPLETE manifest, or a `failed` row.
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
  type ChapterAudioChunkRow,
  type ChapterAudioRow,
  downloadNarrationParts,
  getChapterAudioRow,
  isNarrationJobStale,
  listChapterAudioChunks,
  listNarrationParts,
  markChapterAudioChunkFailed,
  markChapterAudioChunkReady,
  markChapterAudioChunkStarted,
  markChapterAudioFailed,
  markChapterAudioReady,
  NARRATION_JOB_STALE_MS,
  narrationPartPath,
  pollRunpodNarration,
  type ProviderStatus,
  publicAudioUrl,
  removeNarrationParts,
  stableChapterAudioPath,
  startRunpodNarration,
  stillOwnsNarrationJob,
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

/**
 * One entry per chunk, in playback order, on every single poll.
 *
 * This is the whole point of the change: the client is given each chunk's URL
 * the moment that chunk exists, so it can start playing chunk 0 while chunks 1
 * and 2 are still at the provider. `url` is null for a chunk that is not ready
 * -- never omitted, never a placeholder -- so the array's length is always the
 * chunk count and index `i` is always chunk `i`.
 *
 * `duration_ms` is the measured length of that chunk's own audio, and it is
 * what lets a client bound transcript drift: knowing chunk 0 is 45,120 ms long
 * is what makes "where in the chapter am I" answerable before the stitched
 * file (and its total duration) exists.
 */
interface ChunkManifestEntry {
  index: number;
  url: string | null;
  duration_ms: number | null;
  char_count: number | null;
  ready: boolean;
}

async function chunkManifest(
  serviceClient: SupabaseClient,
  rows: ChapterAudioChunkRow[],
): Promise<ChunkManifestEntry[]> {
  return await Promise.all(
    [...rows]
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map(async (row) => ({
        index: row.chunk_index,
        url: row.status === "ready" && row.storage_path
          ? await publicAudioUrl(serviceClient, row.storage_path)
          : null,
        duration_ms: typeof row.duration_seconds === "number"
          ? Math.round(row.duration_seconds * 1000)
          : null,
        char_count: typeof row.char_count === "number" ? row.char_count : null,
        ready: row.status === "ready",
      })),
  );
}

/**
 * Reconcile a narration whose chunks were all started at once.
 *
 * Every chunk row is polled on every poll, in parallel, and each one that has
 * finished is published to its own staged part immediately -- so the reader
 * gets audio after roughly one chunk's synthesis rather than after all of
 * them plus a stitch. The stitch still runs when the last chunk lands, because
 * `concatenateMp3`'s frame-count check is the only thing in this system that
 * catches a lost seam, but by then the reader is already listening.
 */
async function reconcileChunkedNarration(input: {
  serviceClient: SupabaseClient;
  userId: string;
  row: ChapterAudioRow;
  chunkRows: ChapterAudioChunkRow[];
  storyId: string;
  chapterId: string;
  voiceId: string;
  chapterText: string;
  respond: (body: unknown, status?: number) => Response;
}): Promise<Response> {
  const {
    serviceClient,
    userId,
    row,
    storyId,
    chapterId,
    voiceId,
    respond,
  } = input;
  let chunkRows = input.chunkRows;
  const ids = {
    story_id: storyId,
    chapter_id: chapterId,
    voice_id: voiceId,
  };
  const pending = async (extra: Record<string, unknown> = {}) =>
    respond({
      status: "PENDING",
      ...ids,
      chunks: chunkRows.length,
      chunk_manifest: await chunkManifest(serviceClient, chunkRows),
      ...extra,
    });

  const failNarration = async (
    errorCode: string,
    error: unknown,
    severity: ErrorSeverity = "high",
    extraContext: Record<string, unknown> = {},
  ): Promise<Response> => {
    await markChapterAudioFailed(serviceClient, row.id!, errorCode);
    // Every sibling still running is spend nothing will collect: this
    // narration is over, and a retry starts a fresh set of jobs.
    for (const chunk of chunkRows) {
      if (chunk.status === "pending" && chunk.provider_job_id) {
        await cancelRunpodNarration(chunk.provider_job_id);
      }
    }
    // The parts go on the failure path, as they always have: a retry must
    // rebuild from chunk 0 rather than resume onto a different revision of
    // the prose.
    await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
    await reportError({
      bucket: "generation.audio",
      severity,
      errorCode,
      error,
      userId,
      context: {
        story_id: storyId,
        chapter_id: chapterId,
        chunks: chunkRows.length,
        ...extraContext,
      },
    });
    return respond({ status: "FAILED", ...ids, error_code: errorCode });
  };

  const voice = await getVoiceRecord(serviceClient, voiceId);
  if (voice?.provider !== "runpod_minimax") {
    // No poller is wired for this voice's provider; report pending rather
    // than guessing at a status we cannot verify.
    return await pending();
  }

  // The chunk list is re-derived from the stored chapter, exactly as before,
  // because a chunk whose start has to be retried needs its TEXT and nothing
  // stores that. `splitNarrationText` is pure, so this is the same split
  // `generate-audio` made -- and if it is not, the prose changed underneath a
  // narration in flight and the run must not be assembled from two revisions.
  const chunks = splitNarrationText(input.chapterText, NARRATION_CHUNK_CHARS);
  if (chunks.length !== chunkRows.length) {
    return await failNarration(
      "narration_text_changed",
      new Error(
        `${chunkRows.length} chunk rows for a ${chunks.length} chunk chapter`,
      ),
      "high",
      { rows: chunkRows.length },
    );
  }

  // --- 1. Every chunk needs a job before it can be polled -------------------
  //
  // A row left `pending` with no job id is a chunk `generate-audio` could not
  // start (a transient provider 500 on chunk 2 while chunk 0 went through).
  // It gets exactly one retry here; a second failure ends the narration.
  const skip = new Set<string>();
  for (const chunk of chunkRows) {
    if (chunk.status !== "pending" || chunk.provider_job_id) continue;

    // Chunk 0's id also lives on the parent row. If the chunk row's own copy
    // never got written, adopt the parent's rather than starting a second job
    // for audio that is already being synthesised and billed.
    if (chunk.chunk_index === 0 && row.provider_job_id) {
      const adopted = await markChapterAudioChunkStarted(
        serviceClient,
        chunk.id,
        row.provider_job_id,
      );
      if (adopted) chunk.provider_job_id = row.provider_job_id;
      else skip.add(chunk.id);
      continue;
    }

    let jobId: string;
    try {
      jobId = await startRunpodNarration({
        text: chunks[chunk.chunk_index],
        voice,
      });
    } catch (startError) {
      await markChapterAudioChunkFailed(
        serviceClient,
        chunk.id,
        "narration_chunk_start_failed",
      );
      chunk.status = "failed";
      return await failNarration(
        "narration_chunk_start_failed",
        startError,
        "high",
        { chunk: chunk.chunk_index },
      );
    }
    const recorded = await markChapterAudioChunkStarted(
      serviceClient,
      chunk.id,
      jobId,
    );
    if (recorded) chunk.provider_job_id = jobId;
    else {
      // An overlapping poll started this chunk first. Its job is the one the
      // row points at; ours is spend nobody will collect.
      await cancelRunpodNarration(jobId);
      skip.add(chunk.id);
    }
  }

  // --- 2. Poll every in-flight chunk, together ------------------------------
  const inFlight = chunkRows.filter((chunk) =>
    chunk.status === "pending" && chunk.provider_job_id && !skip.has(chunk.id)
  );
  const polls = await Promise.all(
    inFlight.map(async (chunk): Promise<ProviderStatus> => {
      try {
        return await pollRunpodNarration(chunk.provider_job_id!);
      } catch (pollError) {
        // One chunk's transient status-call failure must not fail a chapter
        // whose other chunks are fine. The job is still running; the next
        // poll reads it again.
        console.error(
          `narration: could not poll chunk ${chunk.chunk_index}`,
          pollError,
        );
        return { status: "pending" };
      }
    }),
  );

  const failedAt = polls.findIndex((poll) =>
    poll.status === "failed" || (poll.status === "ready" && !poll.audioBytes)
  );
  if (failedAt >= 0) {
    const chunk = inFlight[failedAt];
    const errorCode = polls[failedAt].errorCode ?? "provider_failed";
    await markChapterAudioChunkFailed(serviceClient, chunk.id, errorCode);
    // Locally too, so the sibling cancellation below does not try to cancel
    // the job the provider has already finished failing.
    chunk.status = "failed";
    return await failNarration(
      errorCode,
      new Error(`RunPod job ${chunk.provider_job_id} failed`),
      "high",
      { chunk: chunk.chunk_index },
    );
  }

  // --- 3. Publish whatever finished, each to its own part --------------------
  const finished = inFlight
    .map((chunk, at) => ({ chunk, poll: polls[at] }))
    .filter((entry) => entry.poll.status === "ready" && entry.poll.audioBytes);

  let advanced = false;
  if (finished.length) {
    // Still ours? A claim left `pending` for ten minutes is re-claimable, so a
    // fresh run may have cleared the staging and restarted while this poll was
    // in flight. Writing into that run's staging area would leave it holding a
    // part from a different attempt.
    const stillOurs = row.provider_job_id
      ? await stillOwnsNarrationJob(
        serviceClient,
        row.id!,
        row.provider_job_id,
      )
      : true;
    if (!stillOurs) return await pending();

    for (const { chunk, poll } of finished) {
      const partPath = narrationPartPath(
        storyId,
        chapterId,
        voiceId,
        chunk.chunk_index,
      );
      await uploadNarrationPart(
        serviceClient,
        storyId,
        chapterId,
        voiceId,
        chunk.chunk_index,
        poll.audioBytes!,
      );
      // Compare-and-swap on (id, job, still pending), so two overlapping polls
      // that both saw this chunk finish cannot both advance it.
      const won = await markChapterAudioChunkReady(
        serviceClient,
        chunk.id,
        chunk.provider_job_id!,
        partPath,
        measuredDuration(poll.audioBytes!) ?? poll.durationSeconds ?? null,
      );
      if (won) advanced = true;
    }
  }

  // Re-read rather than trust the local copies: an overlapping poll may have
  // published a chunk this one never saw, and "are we done" must be answered
  // from the rows, not from this request's view of them.
  if (advanced || finished.length) {
    chunkRows = await listChapterAudioChunks(serviceClient, row.id!);
  }

  if (!chunkRows.every((chunk) => chunk.status === "ready")) {
    // Nothing moved and the claim has been sitting for ten minutes: this is
    // the same abandonment check the single-chunk path makes, and it is the
    // only thing that ever resolves a run whose isolate died.
    if (!advanced && isNarrationJobStale(row.updated_at)) {
      // A timeout is a failure and has to clean up like one. On the legacy
      // single-chunk path there was one job and no parts, so marking the row
      // failed was the whole of it; here there are up to three jobs and a
      // staging prefix, and leaving them would leak the siblings' spend and
      // let a retry resume onto parts from a different attempt -- the exact
      // two things `failNarration` exists to prevent.
      for (const chunk of chunkRows) {
        if (chunk.status === "pending" && chunk.provider_job_id) {
          await cancelRunpodNarration(chunk.provider_job_id);
        }
      }
      await removeNarrationParts(serviceClient, storyId, chapterId, voiceId);
      return respond(
        await timedOutResponsePayload(
          serviceClient,
          userId,
          row,
          storyId,
          chapterId,
          voiceId,
        ),
      );
    }
    return await pending();
  }

  // --- 4. Every chunk is in: stitch, verify, publish -------------------------
  let assembled;
  try {
    const parts = await downloadNarrationParts(
      serviceClient,
      storyId,
      chapterId,
      voiceId,
      chunkRows.length,
    );
    // Kept deliberately. It re-reads the joined bytes and refuses if the frame
    // count is not the sum of the parts', so a seam that lost or invented
    // audio fails here rather than reaching the reader as a chapter that skips
    // a paragraph. It is no longer on the critical path -- the reader has been
    // listening since chunk 0 -- which makes it cheap to keep, not safe to
    // drop.
    assembled = concatenateMp3(parts);
  } catch (assemblyError) {
    // Did somebody else already finish this? Two polls can both see the last
    // chunk complete. Marking the row failed here would flip a `ready` row to
    // `failed` and take a working narration away from the reader.
    const current = await getChapterAudioRow(serviceClient, chapterId, voiceId);
    if (current?.status === "ready" && current.storage_path) {
      return respond({
        status: "COMPLETED",
        ...ids,
        audio_url: await publicAudioUrl(serviceClient, current.storage_path),
        cached: true,
        chunks: chunkRows.length,
        chunk_manifest: await chunkManifest(serviceClient, chunkRows),
      });
    }
    const errorCode = assemblyError instanceof Error &&
        assemblyError.message.startsWith("narration_part_missing")
      ? "narration_part_missing"
      : "narration_assembly_failed";
    // Every chunk has been generated and billed by now, so failing at the join
    // wastes the whole cost of the narration rather than one request's worth.
    return await failNarration(errorCode, assemblyError, "critical");
  }

  const storagePath = row.storage_path ??
    stableChapterAudioPath(storyId, chapterId, voiceId);
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
  // **The staged parts are NOT deleted here any more.** They used to be, the
  // moment the stitched file existed, because they were dead weight. They are
  // not dead weight now: a reader who started on chunk 0 is still playing
  // those exact URLs at this instant, and deleting them would cut off the
  // person this whole change exists to serve. They die with the
  // `chapter_audio` row instead -- see the follow-up on
  // `record_orphaned_audio_object()` in `backend/build-log.md`.
  return respond({
    status: "COMPLETED",
    ...ids,
    audio_url: audioUrl,
    cached: false,
    chunks: chunkRows.length,
    chunk_manifest: await chunkManifest(serviceClient, chunkRows),
  });
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

    // Does this narration have chunk rows? That single question decides which
    // of the two pipelines below finishes it, and it is asked of the database
    // rather than of the chapter's length, because the answer must be "the
    // function that STARTED this run", not "what a function would do with this
    // chapter today". A run started by the pre-00095 deploy has no chunk rows
    // and must keep finishing on the path it started on.
    const chunkRows = await listChapterAudioChunks(serviceClient, row.id!);

    if (row.status === "ready" && row.storage_path) {
      return respond({
        status: "COMPLETED",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        audio_url: await publicAudioUrl(serviceClient, row.storage_path),
        cached: true,
        // A replay gets the manifest for free, because the parts survive the
        // stitch now. **Today's client does not use it**: a playthrough
        // commits to its source, and a `COMPLETED` answer is the stitched
        // file, so the reducer's `ready` case keeps `manifest: null` and the
        // transcript falls back to the whole-chapter estimate (see the header
        // of `lib/narration.ts`, which says the same). It is sent because it
        // costs one query on a path that is already reading the rows, and
        // because a client that wants per-chunk durations for a replay should
        // not have to have been present for the original generation.
        ...(chunkRows.length
          ? {
            chunks: chunkRows.length,
            chunk_manifest: await chunkManifest(serviceClient, chunkRows),
          }
          : {}),
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

    // `pending`, with chunk rows: every chunk was started at once, so this
    // poll reconciles all of them and answers with a manifest the client can
    // start playing from.
    if (chunkRows.length) {
      return await reconcileChunkedNarration({
        serviceClient,
        userId: user.id,
        row,
        chunkRows,
        storyId,
        chapterId,
        voiceId,
        chapterText: chapter.content ?? "",
        respond,
      });
    }

    // =========================================================================
    // LEGACY: one chunk per poll.
    //
    // Reached only by a `chapter_audio` row with NO chunk rows, which is one
    // of exactly two things: a single-chunk chapter (the ordinary short
    // narration, which never needed chunk rows and still does not), or a
    // multi-chunk job started by the deploy before migration 00095, still in
    // flight while this version was rolling out. The second is what makes the
    // deploy window safe, and it is why `audio-status` must be deployed
    // BEFORE `generate-audio`: this function has to understand chunk rows
    // before anything starts writing them.
    //
    // **The multi-chunk part of this branch is deletable** once no pre-00095
    // run can still be in flight -- a `pending` row goes stale in ten minutes
    // (`NARRATION_JOB_STALE_MS`), so an hour after the deploy there are none.
    // The single-chunk path below it stays.
    // =========================================================================

    // Nothing to poll until the request that claimed this row has
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

    // A listing that could not be made is not an empty listing. Treating it as
    // one would write this chunk's audio over part 0 and restart the pipeline
    // partway through, producing a chapter that repeats its opening and loses
    // its middle -- published as `ready`, with nothing reporting a problem.
    // The job stays COMPLETED at the provider, so doing nothing and letting
    // the next poll re-read it loses only a few seconds.
    if (staged === null) {
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        chunks: chunks.length,
      });
    }

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

    // Still ours? A claim left `pending` for ten minutes is re-claimable, so
    // `generate-audio` may have cleared the staging and started a fresh run at
    // chunk 0 while this poll was in flight. Writing a part into that run's
    // staging area would push every later chunk one slot too high and publish
    // a chapter that repeats its opening. Checked atomically, and if we have
    // lost the row we change nothing at all -- the run that owns it now is
    // already doing the work.
    if (
      !await stillOwnsNarrationJob(serviceClient, row.id!, row.provider_job_id)
    ) {
      return respond({
        status: "PENDING",
        story_id: storyId,
        chapter_id: chapterId,
        voice_id: voiceId,
        chunks: chunks.length,
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
      // Did somebody else already finish this? Two polls can both see the last
      // chunk complete; the winner assembles, publishes and deletes the staged
      // parts, and the loser -- still downloading those same parts -- then gets
      // a 404. Marking the row failed here would flip a `ready` row to
      // `failed` and take a narration that exists and plays away from the
      // reader. So the row is re-read before any failure is recorded, and a
      // published narration is reported as what it is.
      const current = await getChapterAudioRow(
        serviceClient,
        chapterId,
        voiceId,
      );
      if (current?.status === "ready" && current.storage_path) {
        return respond({
          status: "COMPLETED",
          story_id: storyId,
          chapter_id: chapterId,
          voice_id: voiceId,
          audio_url: await publicAudioUrl(serviceClient, current.storage_path),
          cached: true,
        });
      }

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
