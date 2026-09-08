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
  canReadChapter,
  type ChapterAudioRow,
  getChapterAudioRow,
  isNarrationJobStale,
  markChapterAudioFailed,
  markChapterAudioReady,
  NARRATION_JOB_STALE_MS,
  pollRunpodNarration,
  publicAudioUrl,
  stableChapterAudioPath,
  uploadAudio,
} from "../_shared/narration-audio.ts";

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
    const audioUrl = await uploadAudio(
      serviceClient,
      storagePath,
      poll.audioBytes,
    );
    await markChapterAudioReady(
      serviceClient,
      row.id!,
      storagePath,
      poll.durationSeconds,
    );
    return respond({
      status: "COMPLETED",
      story_id: storyId,
      chapter_id: chapterId,
      voice_id: voiceId,
      audio_url: audioUrl,
      cached: false,
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
