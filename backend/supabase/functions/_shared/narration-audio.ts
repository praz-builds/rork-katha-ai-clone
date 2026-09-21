/**
 * Lazy narration: generate on first play, cache permanently.
 *
 * `chapter_audio` (migration `00048_voice_library.sql`) is one row per
 * (chapter, voice) rather than the single `chapters.audio_url` column it
 * grew out of, so every voice a reader picks gets its own durable cache entry
 * and its own provider job binding instead of landing in storage unlinked.
 * `claim_chapter_audio_generation` is the SQL function that makes "two
 * readers press Listen at once" cost exactly one provider job: it takes an
 * advisory lock keyed on (chapter, voice) plus `select ... for update`, so a
 * second concurrent caller sees the first caller's row and reports
 * `claimed: false` instead of racing it. `claimChapterAudioGeneration` below
 * is a thin wrapper around that RPC -- the atomicity lives in the migration,
 * not here.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_VOICE_ID, VoiceRecord } from "./voices.ts";
import { RUNPOD_ENDPOINT, runpodCancelUrl, runpodStatusUrl } from "./runpod.ts";
import { safeErrorCode } from "./sentry.ts";

export const NARRATION_REFUSAL = "Narration unlock is not available yet";
export const AUDIO_BUCKET = "audio";

export interface ChapterForNarration {
  id: string;
  story_id: string;
  content: string;
  word_count: number | null;
  audio_url?: string | null;
  is_published?: boolean | null;
}

export interface StoryForNarration {
  id?: string;
  author_id: string | null;
  is_public?: boolean | null;
  is_curated?: boolean | null;
}

export interface ChapterAudioRow {
  id?: string;
  chapter_id: string;
  voice_id: string;
  storage_path: string | null;
  duration_seconds?: number | null;
  word_count?: number | null;
  provider_job_id: string | null;
  status: "pending" | "ready" | "failed";
  generated_at?: string | null;
  error_code?: string | null;
  /**
   * Set to `now()` by `claim_chapter_audio_generation` the moment a row is
   * (re)claimed into `pending`, and left untouched thereafter until the row
   * leaves `pending`. Nothing else in this codebase writes it, which is what
   * makes it usable as "how long has this job been pending" -- see
   * `isNarrationJobStale`.
   */
  updated_at?: string | null;
}

const CHAPTER_AUDIO_COLUMNS =
  "id, chapter_id, voice_id, storage_path, duration_seconds, word_count, provider_job_id, status, generated_at, error_code, updated_at";

/**
 * How long a `chapter_audio` row may sit `pending` before `audio-status`
 * treats the job as timed out rather than still in flight.
 *
 * There is no push from RunPod: the only way this system learns a job
 * finished is a reader's client calling `audio-status` again. So "timed out"
 * here means "our own record of this job has been stuck in `pending` longer
 * than any real MiniMax synthesis job plausibly takes" -- not a signal RunPod
 * itself sent us. Ten minutes mirrors `COVER_GENERATING_STALE_MS` in
 * `media.ts`, which exists for the same underlying reason (a background job
 * whose owning isolate may have been reclaimed, deployed over, or simply
 * never polled again): narrating even the longest chapter (the 1,500-word
 * adult standalone ceiling in `wordBandFor()`) should complete in well under
 * a minute of actual synthesis time, so ten minutes is generous headroom for
 * provider cold starts while still being far short of "abandoned."
 */
export const NARRATION_JOB_STALE_MS = 10 * 60 * 1000;

/**
 * Whether a `pending` row has been sitting long enough to call it timed out.
 * `updatedAt` is the row's `updated_at`; `null`/`undefined` (a row from
 * before this column was read, or a malformed timestamp) is never treated as
 * stale -- silence about age must not manufacture a false alarm.
 */
export function isNarrationJobStale(
  updatedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!updatedAt) return false;
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return now - updatedAtMs > NARRATION_JOB_STALE_MS;
}

export interface ProviderJobStarter {
  (input: { text: string; voice: VoiceRecord }): Promise<string>;
}

export interface ProviderStatusPoller {
  (jobId: string): Promise<ProviderStatus>;
}

export interface ProviderStatus {
  status: "pending" | "ready" | "failed";
  audioBytes?: Uint8Array;
  durationSeconds?: number | null;
  errorCode?: string | null;
}

export function normalizeAudioStatus(
  status: unknown,
): ProviderStatus["status"] {
  const value = typeof status === "string" ? status.toUpperCase() : "";
  if (["COMPLETED", "READY", "SUCCEEDED", "SUCCESS"].includes(value)) {
    return "ready";
  }
  if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(value)) {
    return "failed";
  }
  return "pending";
}

export function stableChapterAudioPath(
  storyId: string,
  chapterId: string,
  voiceId = DEFAULT_VOICE_ID,
): string {
  return `${storyId}/${chapterId}/${voiceId}.mp3`;
}

/** Where the finished parts of a multi-request narration are staged. */
export function narrationPartsPrefix(
  storyId: string,
  chapterId: string,
): string {
  return `${storyId}/${chapterId}/parts`;
}

/**
 * Where one completed chunk of a multi-request narration is staged.
 *
 * A chapter over the provider's per-request character limit is narrated as
 * several provider jobs started together, and the isolate that uploads chunk 2
 * is not the isolate that uploaded chunk 1 -- Edge Functions keep nothing
 * between requests. So the finished chunks have to live somewhere durable, and
 * the `audio` bucket is already the durable place this system puts narration
 * audio.
 *
 * These objects are also what the reader actually plays first: `audio-status`
 * hands back a manifest of chunk URLs as each one lands, so playback starts on
 * chunk 0 while later chunks are still synthesising. That is why they now
 * SURVIVE the stitch (see `removeNarrationParts`) -- a client mid-playthrough
 * is holding these URLs.
 *
 * The index is zero-padded so a plain lexicographic listing is also the
 * playback order; getting the order wrong would produce a chapter whose scenes
 * play out of sequence, which is worse than one that does not play at all
 * because nothing would report it as an error.
 */
export function narrationPartPath(
  storyId: string,
  chapterId: string,
  voiceId: string,
  index: number,
): string {
  const padded = String(index).padStart(2, "0");
  return `${narrationPartsPrefix(storyId, chapterId)}/${voiceId}.${padded}.mp3`;
}

/** Pull the chunk index back out of a staged part's file name. */
function partIndexFromName(name: string, voiceId: string): number | null {
  const match = new RegExp(
    `^${escapeForRegExp(voiceId)}\\.(\\d{2,})\\.mp3$`,
  ).exec(name);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The chunk indices already staged for this (chapter, voice), in order.
 *
 * This is the whole of the pipeline's persistent state, and it is deliberately
 * derived rather than stored: `chapter_audio` has one `provider_job_id`
 * column with a CHECK constraint that admits exactly one job id, so "which
 * chunk are we on" cannot be written there without a migration, and a column
 * added for it would be a second source of truth that could disagree with
 * what is actually on disk. Counting the parts cannot disagree with the parts.
 *
 * **`null` means "could not ask", and is not the same as `[]`.** Collapsing a
 * failed listing into an empty one would be the worst bug available on this
 * path: a transient storage error while parts 0 and 1 are staged would read as
 * "no parts yet", so chunk 2's audio would be written over part 0 and the
 * pipeline would restart from chunk 1 -- ending in a chapter that repeats its
 * opening, skips its middle, and is published as `ready` with nothing
 * anywhere reporting a problem. The caller must treat `null` as "ask again
 * next poll" and change nothing.
 */
export async function listNarrationParts(
  supabase: SupabaseClient,
  storyId: string,
  chapterId: string,
  voiceId: string,
): Promise<number[] | null> {
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .list(narrationPartsPrefix(storyId, chapterId), { limit: 100 });
  if (error || !data) {
    console.error("narration: could not list staged parts", error);
    return null;
  }
  const indices = data
    .map((entry) => partIndexFromName(entry.name, voiceId))
    .filter((index): index is number => index !== null);
  return indices.sort((a, b) => a - b);
}

/**
 * Fetch staged parts 0..count-1 in order.
 *
 * A gap or a missing part throws: a chapter assembled from parts 0 and 2 is a
 * chapter with a scene silently cut out of the middle, and a reader would have
 * no way to tell. Better to fail the narration and let the retry rebuild it.
 */
export async function downloadNarrationParts(
  supabase: SupabaseClient,
  storyId: string,
  chapterId: string,
  voiceId: string,
  count: number,
): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = narrationPartPath(storyId, chapterId, voiceId, index);
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .download(path);
    if (error || !data) {
      throw new Error(`narration_part_missing:${index}`);
    }
    parts.push(new Uint8Array(await data.arrayBuffer()));
  }
  return parts;
}

/** Upload one finished chunk to its staging path. */
export async function uploadNarrationPart(
  supabase: SupabaseClient,
  storyId: string,
  chapterId: string,
  voiceId: string,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(narrationPartPath(storyId, chapterId, voiceId, index), bytes, {
      contentType: "audio/mpeg",
      // Upsert, because two readers polling at the same instant can both see
      // the same chunk finish and both upload it. The bytes are identical, so
      // the second write is a no-op in content; refusing it would turn a
      // harmless race into a failed narration.
      upsert: true,
    });
  if (error) throw error;
}

/**
 * Delete every staged part for this (chapter, voice). Never throws.
 *
 * **Not called on the success path any more.** The parts used to be deleted
 * the moment the stitched file was published, because they were pure dead
 * weight in a bucket billed by the gigabyte. They are no longer dead weight:
 * `audio-status` publishes each part's URL in its manifest as it lands, so a
 * reader who started on chunk 0 is still playing these objects at the instant
 * the stitch finishes. Deleting them there would cut off the person the whole
 * change exists to serve.
 *
 * Still called on failure and on a fresh claim, where the reason was never
 * about storage cost: a retry must rebuild from chunk 0 and never resume onto
 * the debris of an abandoned attempt, because if the chapter text changed in
 * between, resuming would splice two different revisions of the prose
 * together.
 *
 * The lifetime of a successful run's parts is therefore now the lifetime of
 * its `chapter_audio` row. `record_orphaned_audio_object()` (migration 00062)
 * records only the parent row's `storage_path` when that row is deleted, so
 * the parts prefix wants adding to the sweep -- noted as a follow-up in
 * `backend/build-log.md`.
 *
 * Failing to clean up costs storage; failing the request over it costs the
 * reader their chapter, so this swallows.
 */
export async function removeNarrationParts(
  supabase: SupabaseClient,
  storyId: string,
  chapterId: string,
  voiceId: string,
): Promise<void> {
  try {
    const indices = await listNarrationParts(
      supabase,
      storyId,
      chapterId,
      voiceId,
    );
    if (!indices?.length) return;
    const paths = indices.map((index) =>
      narrationPartPath(storyId, chapterId, voiceId, index)
    );
    await supabase.storage.from(AUDIO_BUCKET).remove(paths);
  } catch (error) {
    console.error("narration: staged part cleanup failed", error);
  }
}

/**
 * Move the row from the chunk that just finished to the chunk that just
 * started, and report whether this caller was the one that did it.
 *
 * A compare-and-swap on `provider_job_id`, not a plain update. Polling is
 * driven by the reader's client, and two polls can overlap: both see chunk N
 * finish, both start chunk N+1, and a plain write would leave one of those two
 * provider jobs running with nothing pointing at it -- spend that is never
 * collected and never cancelled. Whoever's `.eq(provider_job_id, fromJobId)`
 * still matches wins; the loser gets no row back and cancels the job it
 * started.
 */
/**
 * Confirm this poll still owns the row, atomically, before it writes anything
 * into the shared staging area.
 *
 * The race this closes: a claim that has sat `pending` for ten minutes becomes
 * re-claimable (migration 00054), so `generate-audio` can clear the staged
 * parts and start a fresh run at chunk 0 **while an older poll is still in
 * flight**. That older poll then uploads its part into the new run's staging
 * area. Its `advanceNarrationJob` correctly loses and it cancels its own job --
 * but the stale part is already on disk, and the new run counts parts to
 * decide which chunk it is on. One extra part means every later chunk is
 * written one slot too high: the finished chapter repeats its opening and
 * loses its ending, and is published as `ready`.
 *
 * A conditional update is the check, not a read: `provider_job_id` and
 * `status` are matched in the same statement that touches the row, so a
 * reclaim (which nulls `provider_job_id`) cannot slip between a read and its
 * conclusion. Touching `updated_at` is deliberate -- this poll is actively
 * working, so the ten-minute abandonment clock should restart here rather than
 * keep running against a run that is making progress.
 *
 * A window still exists between this returning true and the upload landing.
 * It is milliseconds wide against a condition that needs ten minutes of
 * staleness to arise at all, and closing it completely would need a per-run
 * token on the row -- a migration this change deliberately does without.
 */
export async function stillOwnsNarrationJob(
  supabase: SupabaseClient,
  audioId: string,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chapter_audio")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", audioId)
    .eq("provider_job_id", jobId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function advanceNarrationJob(
  supabase: SupabaseClient,
  audioId: string,
  fromJobId: string,
  toJobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chapter_audio")
    .update({
      provider_job_id: toJobId,
      status: "pending",
      // Restarts the ten-minute staleness clock for the new chunk. Without
      // this the clock would keep running from the FIRST chunk's start, and a
      // four-chunk chapter would be declared abandoned partway through a
      // pipeline that was working perfectly.
      updated_at: new Date().toISOString(),
    })
    .eq("id", audioId)
    .eq("provider_job_id", fromJobId)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Turn a provider-reported failure into one of our own codes, without ever
 * letting the provider's words through.
 *
 * `safeErrorCode` is correct and stays: it passes an identifier through and
 * replaces anything else -- prose, tracebacks, echoed input -- with
 * `unclassified_error`, and that value is written to `chapter_audio.error_code`
 * which every reader of a public story can select. The cost of that
 * correctness was that MiniMax's length refusal, which arrives as an English
 * sentence, was scrubbed down to `unclassified_error` along with everything
 * else, and the single most common narration failure in production became
 * indistinguishable from an unknown one. Five occurrences sat under one
 * fingerprint from 2026-09-15 until they were finally bracketed by hand.
 *
 * The fix is to recognise the condition here and emit OUR enum, so the reason
 * survives without the words surviving. The match is deliberately about
 * length, and deliberately requires two independent signals (a length noun and
 * a limit verb) so an unrelated sentence that happens to contain the word
 * "character" is not mislabelled.
 *
 * This should now be unreachable in normal operation -- `splitNarrationText`
 * guarantees no request exceeds `NARRATION_CHUNK_CHARS`, which is 1,000
 * characters under the smallest refusal ever observed. It is kept as the
 * backstop for the day the provider lowers its limit, which is exactly the day
 * this failure must not become invisible again.
 */
export function classifyProviderAudioError(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  const mentionsLength = /\b(character|char|text|input|prompt|length)s?\b/
    .test(text);
  const mentionsLimit = /\b(limit|exceed(?:s|ed)?|too long|maximum|max|over)\b/
    .test(text);
  if (mentionsLength && mentionsLimit) return "narration_provider_char_limit";
  return safeErrorCode(raw);
}

export function stableVoicePreviewPath(voiceId: string): string {
  return `voice-previews/${voiceId}.mp3`;
}

export function canReadChapter(
  userId: string,
  story: StoryForNarration,
  chapter: ChapterForNarration,
): boolean {
  if (story.author_id === userId) return true;
  return Boolean(
    chapter.is_published && (story.is_public || story.is_curated),
  );
}

export function wordCountAtGeneration(chapter: ChapterForNarration): number {
  if (typeof chapter.word_count === "number" && chapter.word_count >= 0) {
    return Math.trunc(chapter.word_count);
  }
  return chapter.content.trim().split(/\s+/).filter(Boolean).length;
}

export async function findReadyChapterAudio(
  supabase: SupabaseClient,
  chapterId: string,
  voiceId: string,
): Promise<ChapterAudioRow | null> {
  const { data, error } = await supabase
    .from("chapter_audio")
    .select(CHAPTER_AUDIO_COLUMNS)
    .eq("chapter_id", chapterId)
    .eq("voice_id", voiceId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) throw error;
  return data as ChapterAudioRow | null;
}

/**
 * A chapter/voice row in whatever status it currently holds, or `null` if no
 * generation has ever been attempted. Used by `audio-status` to decide
 * whether to poll the provider, report a failure, or say there is nothing to
 * poll -- `findReadyChapterAudio` only ever answers the "is it ready" question.
 */
export async function getChapterAudioRow(
  supabase: SupabaseClient,
  chapterId: string,
  voiceId: string,
): Promise<ChapterAudioRow | null> {
  const { data, error } = await supabase
    .from("chapter_audio")
    .select(CHAPTER_AUDIO_COLUMNS)
    .eq("chapter_id", chapterId)
    .eq("voice_id", voiceId)
    .maybeSingle();
  if (error) throw error;
  return data as ChapterAudioRow | null;
}

export async function claimChapterAudioGeneration(
  supabase: SupabaseClient,
  chapter: ChapterForNarration,
  voiceId: string,
  storagePath: string,
): Promise<ChapterAudioRow & { claimed: boolean }> {
  const { data, error } = await supabase.rpc("claim_chapter_audio_generation", {
    p_chapter_id: chapter.id,
    p_voice_id: voiceId,
    p_storage_path: storagePath,
    p_word_count: wordCountAtGeneration(chapter),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row.audio_id,
    chapter_id: chapter.id,
    voice_id: voiceId,
    storage_path: row.storage_path,
    provider_job_id: row.provider_job_id,
    status: row.status,
    claimed: Boolean(row.claimed),
  };
}

/**
 * The row's `updated_at`, read straight after a claim as the fence a later
 * conditional write compares against.
 *
 * `claim_chapter_audio_generation` (00054) re-claims a `pending` row that has
 * sat untouched for ten minutes, and a re-claim keeps the SAME row id while
 * resetting `provider_job_id` to null -- so "is this still my claim?" cannot be
 * answered from the id or from the job id, both of which look exactly as they
 * did. `updated_at` is what the claim itself moves, so the value this reads is
 * the one thing that identifies WHICH claim is on the row.
 *
 * Read immediately after a successful claim, where a re-claim needs ten
 * minutes of staleness to be possible at all, so what comes back is this
 * caller's own claim and not a race.
 *
 * A read that fails answers null rather than throwing: the caller then falls
 * back to the weaker "still pending, still has no job" condition, which is
 * never worse than the unconditional write this replaced.
 */
export async function chapterAudioClaimFence(
  supabase: SupabaseClient,
  audioId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("chapter_audio")
      .select("updated_at")
      .eq("id", audioId)
      .limit(1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ updated_at?: string | null }>;
    return rows.length ? rows[0].updated_at ?? null : null;
  } catch (error) {
    console.error("narration: could not read the claim fence", error);
    return null;
  }
}

/**
 * Record chunk 0's provider job id on the parent row, and report whether this
 * caller was still the claim it belongs to.
 *
 * A compare-and-swap, not a plain write. Starting the jobs takes seconds and a
 * claim can be re-claimed out from under this request while they are being
 * started; an unconditional write then put the OLD attempt's chunk 0 job id
 * onto the NEW attempt's row, and everything downstream that asks "do I still
 * own this run" -- `stillOwnsNarrationJob`, the ten-minute staleness clock,
 * 00054's re-claim -- would be comparing against a job the new attempt never
 * started. The row would be tracking a job whose audio belongs to a different
 * run of possibly different prose.
 *
 * `fence` is the `updated_at` this caller's claim wrote (see
 * `chapterAudioClaimFence`). Without it the condition falls back to "still
 * pending, still has no job", which catches the case where the replacing
 * attempt has already recorded its own id.
 */
export async function markChapterAudioJobStarted(
  supabase: SupabaseClient,
  audioId: string,
  jobId: string,
  fence?: string | null,
): Promise<boolean> {
  let query = supabase
    .from("chapter_audio")
    // `updated_at` is written explicitly: there is no trigger on
    // `chapter_audio`, and `claim_chapter_audio_generation` (00054) treats a
    // `pending` row untouched for ten minutes as abandoned and re-claimable.
    // Without this, the clock would keep running from the moment of the claim
    // rather than from the moment the job was actually confirmed started.
    .update({
      provider_job_id: jobId,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", audioId)
    .eq("status", "pending")
    .is("provider_job_id", null);
  if (fence) query = query.eq("updated_at", fence);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// Chunk rows (migration 00095)
// ---------------------------------------------------------------------------
//
// One row per provider request of a multi-request narration. The parent
// `chapter_audio` row keeps CHUNK 0's job id, exactly as it always held the
// single in-flight job id, so `stillOwnsNarrationJob`, `isNarrationJobStale`
// and 00054's re-claim path all keep working with no change at all. These rows
// carry every other chunk's id, plus the one thing the old design could not
// record: which index a given part belongs to. That used to be derived by
// counting staged objects, which is only correct while chunks finish in order,
// and they no longer do.

export interface ChapterAudioChunkRow {
  id: string;
  chapter_audio_id?: string;
  chunk_index: number;
  provider_job_id: string | null;
  storage_path: string | null;
  status: "pending" | "ready" | "failed";
  duration_seconds?: number | null;
  char_count?: number | null;
  error_code?: string | null;
}

const CHAPTER_AUDIO_CHUNK_COLUMNS =
  "id, chapter_audio_id, chunk_index, provider_job_id, storage_path, status, duration_seconds, char_count, error_code";

/**
 * Replace this narration's chunk set with `charCounts.length` fresh pending
 * rows. Atomic, advisory-locked on the same (chapter, voice) key the
 * generation claim uses, and always restarting at chunk 0 -- the atomicity
 * lives in the migration, not here.
 */
export async function claimChapterAudioChunks(
  supabase: SupabaseClient,
  audioId: string,
  charCounts: number[],
): Promise<ChapterAudioChunkRow[]> {
  const { data, error } = await supabase.rpc("claim_chapter_audio_chunks", {
    p_audio_id: audioId,
    p_count: charCounts.length,
    p_char_counts: charCounts,
  });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as Array<{
    chunk_id: string;
    chunk_index: number;
    char_count: number | null;
    status: ChapterAudioChunkRow["status"];
  }>;
  return rows
    .map((row) => ({
      id: row.chunk_id,
      chapter_audio_id: audioId,
      chunk_index: Number(row.chunk_index),
      provider_job_id: null,
      storage_path: null,
      status: row.status,
      char_count: row.char_count === null ? null : Number(row.char_count),
    }))
    .sort((a, b) => a.chunk_index - b.chunk_index);
}

/**
 * This narration's chunk rows, in playback order.
 *
 * An empty array is a meaningful answer and not a missing one: it is how
 * `audio-status` recognises a job started by the pre-00095 function, which
 * must keep finishing on the old one-chunk-per-poll path. A failed read throws
 * rather than answering `[]`, because collapsing those two would send a
 * chunked narration down the legacy path and restart it from a part count.
 */
export async function listChapterAudioChunks(
  supabase: SupabaseClient,
  audioId: string,
): Promise<ChapterAudioChunkRow[]> {
  const { data, error } = await supabase
    .from("chapter_audio_chunks")
    .select(CHAPTER_AUDIO_CHUNK_COLUMNS)
    .eq("chapter_audio_id", audioId)
    .order("chunk_index", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ChapterAudioChunkRow[]).map((row) => ({
    ...row,
    chunk_index: Number(row.chunk_index),
    duration_seconds: row.duration_seconds === null ||
        row.duration_seconds === undefined
      ? null
      : Number(row.duration_seconds),
    char_count: row.char_count === null || row.char_count === undefined
      ? null
      : Number(row.char_count),
  }));
}

/**
 * The provider job a chunk row currently points at, or null if it has none.
 *
 * Read only after a lost compare-and-swap, to answer the one question the
 * boolean cannot: did somebody else record a DIFFERENT job for this chunk (so
 * ours is spend nothing will collect), or did somebody else record OURS? The
 * second happens on chunk 0, whose id also lives on the parent row and which
 * `audio-status` adopts onto the chunk row the moment it sees the row has no
 * id of its own. Cancelling on that answer kills the job the narration is
 * built on.
 */
export async function chapterAudioChunkJobId(
  supabase: SupabaseClient,
  chunkId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("chapter_audio_chunks")
    .select("provider_job_id")
    .eq("id", chunkId)
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ provider_job_id: string | null }>;
  return rows.length ? rows[0].provider_job_id ?? null : null;
}

/**
 * Record the provider job a chunk was just started on, and report whether this
 * caller was the one that recorded it.
 *
 * A compare-and-swap on "still pending, still has no job", not a plain write.
 * `audio-status` retries the start of a chunk whose row never got a job id, so
 * two overlapping polls can both start one; whoever's condition still matches
 * wins, and the loser cancels the job it started rather than leaving provider
 * spend with nothing in the database pointing at it.
 */
export async function markChapterAudioChunkStarted(
  supabase: SupabaseClient,
  chunkId: string,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chapter_audio_chunks")
    .update({ provider_job_id: jobId, updated_at: new Date().toISOString() })
    .eq("id", chunkId)
    .eq("status", "pending")
    .is("provider_job_id", null)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Publish one chunk: its staged part exists, so the row moves to `ready`.
 *
 * Also a compare-and-swap, on `(id, provider_job_id, status = 'pending')`.
 * Polling is driven by the reader's client and two polls can overlap; both can
 * see the same chunk finish, and without the condition both would advance it.
 * The loser simply reports what the winner wrote.
 */
export async function markChapterAudioChunkReady(
  supabase: SupabaseClient,
  chunkId: string,
  jobId: string,
  storagePath: string,
  durationSeconds: number | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chapter_audio_chunks")
    .update({
      status: "ready",
      storage_path: storagePath,
      duration_seconds: durationSeconds,
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", chunkId)
    .eq("provider_job_id", jobId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Record a chunk's own failure. The parent row carries the reader-facing one. */
export async function markChapterAudioChunkFailed(
  supabase: SupabaseClient,
  chunkId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("chapter_audio_chunks")
    .update({
      status: "failed",
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", chunkId);
  if (error) throw error;
}

export async function markChapterAudioFailed(
  supabase: SupabaseClient,
  audioId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("chapter_audio")
    .update({
      status: "failed",
      provider_job_id: null,
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", audioId);
  if (error) throw error;
}

export async function markChapterAudioReady(
  supabase: SupabaseClient,
  audioId: string,
  storagePath: string,
  durationSeconds?: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("chapter_audio")
    .update({
      status: "ready",
      storage_path: storagePath,
      duration_seconds: durationSeconds ?? null,
      generated_at: new Date().toISOString(),
      error_code: null,
    })
    .eq("id", audioId);
  if (error) throw error;
}

/**
 * Publish the finished narration, but only if this run still owns it.
 *
 * The same compare-and-swap the per-chunk writes use -- `(id, job, still
 * pending)` -- applied to the write that matters most. `markChapterAudioReady`
 * above is unconditional, and on the chunked path the ownership check happened
 * before the parts were downloaded, joined and uploaded: a re-claim (or an
 * `edit-story`) landing in that window let a superseded poll overwrite the
 * ACTIVE run's stitched file at the stable path and then mark the row ready.
 * Nothing failed; a reader simply got audio from a different run of possibly
 * different prose, cached under the permanent URL, with the row claiming
 * success.
 *
 * Returning false is not an error. The row belongs to somebody else now, and
 * the run that owns it is already doing this work -- so the loser discards
 * what it made and says nothing, exactly as the per-chunk loser does.
 */
export async function markChapterAudioReadyIfOwner(
  supabase: SupabaseClient,
  audioId: string,
  jobId: string | null,
  storagePath: string,
  durationSeconds?: number | null,
): Promise<boolean> {
  let query = supabase
    .from("chapter_audio")
    .update({
      status: "ready",
      storage_path: storagePath,
      duration_seconds: durationSeconds ?? null,
      generated_at: new Date().toISOString(),
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", audioId)
    .eq("status", "pending");
  query = jobId
    ? query.eq("provider_job_id", jobId)
    : query.is("provider_job_id", null);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function publicAudioUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string> {
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const { data } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(
    storagePath,
  );
  return data.publicUrl;
}

export async function uploadAudio(
  supabase: SupabaseClient,
  storagePath: string,
  bytes: Uint8Array,
): Promise<string> {
  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "audio/mpeg",
      upsert: true,
    });
  if (error) throw error;
  return publicAudioUrl(supabase, storagePath);
}

/**
 * Whether an object already sits at `path` in `bucket`.
 *
 * Used to make preview seeding idempotent: `seed-voice-previews` must never
 * regenerate a preview that already exists, because previews are meant to be
 * generated once and reused by every viewer of the voice picker forever.
 */
export async function storageObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const { data, error } = await supabase.storage.from(bucket).list(dir, {
    search: name,
  });
  if (error || !data) return false;
  return data.some((entry) => entry.name === name);
}

export async function startRunpodNarration(
  { text, voice }: { text: string; voice: VoiceRecord },
): Promise<string> {
  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  if (!apiKey) throw new Error("RUNPOD_API_KEY is not configured");

  const response = await fetch(`${RUNPOD_ENDPOINT}/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        // The field is `prompt`, not `text`. The endpoint's handler reads
        // `prompt` and computes its cost from `len(prompt)`, so a request
        // carrying `text` crashed inside RunPod with
        // `object of type 'NoneType' has no len()` and came back as a failed
        // job with a Python traceback in `error_code`. Every narration this
        // product has ever attempted failed exactly that way.
        prompt: text,
        // Sensible neutral defaults. `english_normalization` reads numbers,
        // abbreviations and dates the way a narrator would rather than
        // spelling them out character by character.
        speed: 1,
        volume: 1,
        pitch: 0,
        english_normalization: true,
        // `voice_id` must be one of MiniMax's own voice names; ours are stored
        // per voice row so a new voice needs no code change. Spread last so a
        // row can override any default above.
        //
        // **Bitrate lives here too, and needs no deploy to change.** What
        // comes back today is 128 kbps CBR mono at 32 kHz -- a music bitrate
        // for speech, measured at 1,124 bytes per character of prose, so a
        // 1,700-word chapter is a 10 MB download on a phone. MiniMax's own API
        // takes an `audio_setting` with a `bitrate` (32k/64k/128k/256k), and
        // 48-64 kbps mono is transparent for speech: half to a quarter of the
        // download, for the same audio. Whether *this* RunPod public endpoint
        // forwards that field to the model is NOT verified -- it was not
        // testable without a live `RUNPOD_API_KEY`, and it is one cheap job to
        // find out. If it does, adding it to a voice row's
        // `provider_voice_params` is the whole change. If it does not,
        // re-encoding in this function is a separate piece of work and should
        // not be smuggled into a length fix.
        ...voice.provider_voice_params,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`RunPod start failed: ${response.status}`);
  }
  if (!payload?.id || typeof payload.id !== "string") {
    throw new Error("RunPod start returned no job id");
  }
  return payload.id;
}

export async function pollRunpodNarration(
  jobId: string,
): Promise<ProviderStatus> {
  const url = runpodStatusUrl(jobId);
  if (!url) return { status: "failed", errorCode: "invalid_job_id" };

  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  if (!apiKey) throw new Error("RUNPOD_API_KEY is not configured");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`RunPod status failed: ${response.status}`);
  }

  const status = normalizeAudioStatus(payload?.status);
  if (status !== "ready") {
    // Classified, never echoed. `payload.error` is whatever the worker chose
    // to put there, and for this endpoint that is a raw Python traceback --
    // it is how the `len(prompt)` crash was diagnosed. `audio-status` writes
    // this straight to `chapter_audio.error_code` and returns it in the
    // response body, and RLS lets every reader of a public story select that
    // row, so an unfiltered value publishes worker file paths, library
    // versions and any echoed input to anyone who taps Listen.
    //
    // `classifyProviderAudioError` recognises the one refusal this product has
    // paid to learn the shape of -- the per-request character limit -- and
    // answers with our own enum; everything else falls through to
    // `safeErrorCode` unchanged, so the scrubbing rule is exactly as strict as
    // it has always been and no provider prose has become publishable.
    return {
      status,
      errorCode: typeof payload?.error === "string"
        ? classifyProviderAudioError(payload.error) ?? null
        : null,
    };
  }

  const extracted = await bytesFromRunpodOutput(payload?.output);
  if ("failure" in extracted) {
    return {
      status: "failed",
      errorCode: extracted.detail
        ? `${extracted.failure}:${extracted.detail}`
        : extracted.failure,
    };
  }
  const audioBytes = extracted.bytes;
  return {
    status: "ready",
    audioBytes,
    durationSeconds: numericOrNull(payload?.output?.duration_seconds),
  };
}

/**
 * Best-effort cancellation for a RunPod job this system failed to record.
 *
 * `generate-audio` claims a `chapter_audio` row, starts a provider job, and
 * only then writes the returned job id onto that row. If that last write
 * fails -- RunPod already accepted and is billing the job, but the row that
 * was meant to remember its id never got it -- the job runs with nothing in
 * the database pointing at it: unrecoverable spend, and a retry that
 * reclaims the same row starts a second job on top of it, defeating the
 * one-job-per-(chapter,voice) guarantee that row exists to hold. This cannot
 * undo the request that already left, but a job actually cancelled here
 * never finishes, so at most the retry's job produces real audio. Never
 * throws: the caller has already lost the write it needed to succeed, and
 * this is strictly a best-effort cleanup on top of that failure, not
 * something worth failing louder over.
 */
export async function cancelRunpodNarration(
  jobId: string,
): Promise<{ cancelled: boolean; status: number | null }> {
  const url = runpodCancelUrl(jobId);
  // No endpoint and no key are both "the cancel did not happen", not success.
  if (!url) return { cancelled: false, status: null };
  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  if (!apiKey) return { cancelled: false, status: null };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // A non-2xx is a cancellation that did NOT happen. Treating any answer as
    // success let a job RunPod had accepted keep running and keep billing,
    // while this code believed it had been stopped -- the leak this function
    // exists to prevent, reported as prevented.
    if (!response.ok) {
      console.error(
        `narration: RunPod refused the cancel (${response.status}); job may still be running`,
      );
      return { cancelled: false, status: response.status };
    }
    return { cancelled: true, status: response.status };
  } catch (error) {
    console.error("narration: best-effort RunPod cancel failed", error);
    return { cancelled: false, status: null };
  }
}

/** Why no audio came back, in terms specific enough to act on. */
export type AudioOutputFailure =
  | "no_output_object"
  | "no_audio_field"
  | "base64_unusable"
  | "audio_host_blocked"
  | "audio_fetch_failed"
  | "audio_too_large";

async function bytesFromRunpodOutput(
  output: unknown,
): Promise<
  { bytes: Uint8Array } | { failure: AudioOutputFailure; detail?: string }
> {
  if (!output || typeof output !== "object") {
    return { failure: "no_output_object" };
  }
  // Some RunPod endpoints answer with a single-element array rather than an
  // object. Unwrapping one costs nothing and turns a shape that looks like a
  // hard failure into an ordinary success.
  const unwrapped = Array.isArray(output)
    ? (output.length === 1 && output[0] && typeof output[0] === "object"
      ? output[0]
      : output)
    : output;
  const record = unwrapped as Record<string, unknown>;

  // `result` is what this endpoint actually answers with, beside `cost`, and
  // it is sometimes a URL and sometimes base64. Deciding by CONTENT rather
  // than by key name means neither form is a special case, and a provider
  // that switches between them needs no change here.
  const ambiguous = stringField(record, ["result", "output"]);
  if (ambiguous) {
    if (/^https?:\/\//i.test(ambiguous.trim())) {
      return await audioFromUrl(ambiguous.trim());
    }
    const bytes = decodeBase64Audio(ambiguous);
    if (bytes) return { bytes };
    return { failure: "base64_unusable" };
  }

  const base64 = stringField(record, ["audio_base64", "audio", "mp3_base64"]);
  if (base64) {
    const bytes = decodeBase64Audio(base64);
    if (!bytes) {
      console.error("narration: refusing an oversized base64 audio payload");
      return { failure: "base64_unusable" };
    }
    return { bytes };
  }

  const url = stringField(record, [
    "audio_url",
    "url",
    "mp3_url",
    "audioUrl",
    "output_url",
  ]);
  if (url) return await audioFromUrl(url);

  // Naming the keys the provider DID send turns "no audio" into a one-line
  // diagnosis when a provider changes its response shape. Keys only, never
  // values: an output object can carry a signed URL.
  // The KEYS the provider did send are recorded on the row, not just logged.
  // Edge Function logs are not reachable from the CLI, so a shape change at
  // the provider is otherwise a silent dead end that costs a deploy to
  // diagnose. Keys only, capped, never values: an output object can carry a
  // signed URL, and a signed URL is a credential.
  const keys = Object.keys(record).slice(0, 8).join(",").slice(0, 120);
  console.error(`narration: provider output had no audio field; keys=${keys}`);
  return {
    failure: "no_audio_field",
    detail: keys || (Array.isArray(record) ? "empty_array" : "none"),
  };
}

/**
 * Download narration audio from a provider-supplied URL.
 *
 * This URL arrives in a provider response, so it is attacker-influenced the
 * moment the provider is compromised, spoofed or simply wrong. Fetching it
 * unchecked let this function be pointed at anything the Edge runtime can
 * reach -- internal addresses and cloud metadata endpoints included -- and at
 * a body of any size. Narration audio is the only thing it is ever meant to
 * retrieve.
 */
async function audioFromUrl(
  url: string,
): Promise<
  { bytes: Uint8Array } | { failure: AudioOutputFailure; detail?: string }
> {
  lastBlockedHost = null;
  const response = await fetchAllowedAudioUrl(url);
  if (!response) {
    // The host is recorded on the row, never the URL: the path and query of a
    // download link are a credential. A host is not, and it is the one thing
    // needed to extend NARRATION_AUDIO_HOSTS without a deploy.
    return {
      failure: "audio_host_blocked",
      detail: lastBlockedHost ?? undefined,
    };
  }
  if (!response.ok) {
    console.error(`narration: audio fetch answered ${response.status}`);
    return { failure: "audio_fetch_failed" };
  }

  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return { failure: "audio_too_large" };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  // The header is a claim, not a guarantee, so the real length is checked too.
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { failure: "audio_too_large" };
  return { bytes };
}

/** A URL's host, for logging, or null when it will not parse. */
function hostOf(candidate: string): string | null {
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A redirect chain is capped, not just re-validated, so it cannot be used to hang the request either. */
const MAX_AUDIO_REDIRECTS = 5;

/**
 * Fetch a provider-supplied audio URL, re-validating the host allowlist on
 * every redirect hop rather than only the URL this function was first
 * handed.
 *
 * `fetch` follows redirects on its own by default, and it does so *after*
 * any allowlist check the caller ran on the starting URL -- so an allowed
 * host that responds with a 3xx to an internal address (a compromised or
 * simply misconfigured provider edge) sails straight through: the allowlist
 * only ever saw where the request started, never where it actually landed.
 * `redirect: "manual"` turns every hop into a value this function inspects
 * itself, so `isAllowedAudioUrl` gets a real say at each one instead of
 * being bypassed by the second and every later request in the chain.
 */
/** The host that was refused on the last blocked fetch, for the failure row. */
let lastBlockedHost: string | null = null;

async function fetchAllowedAudioUrl(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_AUDIO_REDIRECTS; hop += 1) {
    if (!isAllowedAudioUrl(current)) {
      // The HOST is named, never the full URL: a signed download link carries
      // its own credential in the query string. Naming it is what makes a
      // blocked provider host a five-second fix instead of a guess -- the
      // allowlist is extended through `NARRATION_AUDIO_HOSTS` with no deploy.
      lastBlockedHost = hostOf(current) ?? "unparseable";
      console.error(
        `narration: refusing audio from unexpected host ${lastBlockedHost} (hop ${hop})`,
      );
      return null;
    }
    const response = await fetch(current, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      try {
        // Resolved against the hop just requested, then looped back so the
        // resolved target is validated before it is ever followed.
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return response;
  }
  console.error(
    "narration: refusing an audio redirect chain that ran on too long",
  );
  return null;
}

/** 50 MB. A narrated chapter is a few MB; anything past this is not our audio. */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/**
 * Hosts the narration provider may hand us a file on.
 *
 * An allowlist rather than a denylist of internal ranges: blocking `169.254.
 * 169.254` and RFC1918 by hand misses DNS names that resolve to them, IPv6
 * forms, and redirects, and it has to be re-derived every time the runtime
 * changes. Naming the two hosts we actually expect cannot be wrong in that
 * direction. `NARRATION_AUDIO_HOSTS` extends it without a deploy if the provider
 * moves.
 */
function isAllowedAudioUrl(candidate: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const configured = (Deno.env.get("NARRATION_AUDIO_HOSTS") ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const allowed = configured.length ? configured : [
    "api.runpod.ai",
    "runpod.ai",
    // RunPod hands back finished audio on its own CloudFront distribution,
    // not on runpod.ai. Measured 2026-09-10: the endpoint's `result` field
    // is a URL on this exact host, and narration failed as
    // `audio_host_blocked` until it was named here.
    //
    // The DISTRIBUTION is allowed, never `cloudfront.net` as a whole:
    // anyone can put a distribution on that domain, so the broad suffix
    // would turn this allowlist back into an open redirect target. If
    // RunPod moves, the failure row now names the new host and
    // `NARRATION_AUDIO_HOSTS` overrides this list with no deploy.
    "d2h7xmz5gqybh9.cloudfront.net",
  ];

  const host = parsed.hostname.toLowerCase();
  return allowed.some((suffix) =>
    host === suffix || host.endsWith(`.${suffix}`)
  );
}

function stringField(
  record: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Base64 expands the original bytes by ~4/3, so this is the same 50 MB
 * ceiling the URL path enforces, expressed in encoded characters.
 */
const MAX_AUDIO_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES / 3) * 4);

/**
 * Decodes a base64 audio payload, or refuses one that is too large to be our
 * audio -- checked against the encoded string length *before* decoding, not
 * against the decoded byte count after. The URL path already has a size cap
 * enforced up front by `content-length` before the body is read; this path
 * carried no equivalent, so a provider response (or one spoofing it) could
 * hand this function an arbitrarily large string and have it fully decoded
 * into memory regardless.
 */
function decodeBase64Audio(value: string): Uint8Array | null {
  const clean = value.replace(/^data:audio\/[^;]+;base64,/, "");
  if (clean.length > MAX_AUDIO_BASE64_CHARS) return null;
  try {
    return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  } catch {
    // `atob` THROWS on anything that is not base64; it does not return null.
    // The caller reaches here whenever `result` is a string that is neither a
    // URL nor audio -- which is exactly the shape a provider uses to report a
    // failure in a field typed as a result, e.g. "Error: voice_id not found".
    // Unguarded, that threw out of the poller, became a 500, and the client
    // showed "failed" and stopped; the row then sat pending until the 10
    // minute stale check relabelled it `generation_timed_out`, which is the
    // wrong diagnosis and hid the real one. Returning null lets the caller
    // record `base64_unusable`, which is the whole point of that code
    // existing. `edge-tts.ts` already guarded the same call; this is the copy
    // that did not.
    return null;
  }
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
