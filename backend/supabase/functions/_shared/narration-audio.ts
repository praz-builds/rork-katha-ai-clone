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
}

const CHAPTER_AUDIO_COLUMNS =
  "id, chapter_id, voice_id, storage_path, duration_seconds, word_count, provider_job_id, status, generated_at, error_code";

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

export async function markChapterAudioJobStarted(
  supabase: SupabaseClient,
  audioId: string,
  jobId: string,
): Promise<void> {
  const { error } = await supabase
    .from("chapter_audio")
    .update({ provider_job_id: jobId, status: "pending" })
    .eq("id", audioId);
  if (error) throw error;
}

export async function markChapterAudioFailed(
  supabase: SupabaseClient,
  audioId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("chapter_audio")
    .update({ status: "failed", provider_job_id: null, error_code: errorCode })
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
        text,
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
    return {
      status,
      errorCode: typeof payload?.error === "string" ? payload.error : null,
    };
  }

  const audioBytes = await bytesFromRunpodOutput(payload?.output);
  if (!audioBytes) {
    return { status: "failed", errorCode: "missing_audio_output" };
  }
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

async function bytesFromRunpodOutput(
  output: unknown,
): Promise<Uint8Array | null> {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;

  const base64 = stringField(record, ["audio_base64", "audio", "mp3_base64"]);
  if (base64) {
    const bytes = decodeBase64Audio(base64);
    if (!bytes) {
      console.error("narration: refusing an oversized base64 audio payload");
    }
    return bytes;
  }

  const url = stringField(record, ["audio_url", "url", "mp3_url"]);
  if (url) {
    // This URL arrives in a provider response, so it is attacker-influenced the
    // moment the provider is compromised, spoofed or simply wrong. Fetching it
    // unchecked let this function be pointed at anything the Edge runtime can
    // reach -- internal addresses and cloud metadata endpoints included -- and
    // at a body of any size. Narration audio is the only thing it is ever meant
    // to retrieve.
    const response = await fetchAllowedAudioUrl(url);
    if (!response || !response.ok) return null;

    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    // The header is a claim, not a guarantee, so the real length is checked too.
    if (bytes.byteLength > MAX_AUDIO_BYTES) return null;
    return bytes;
  }

  return null;
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
async function fetchAllowedAudioUrl(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_AUDIO_REDIRECTS; hop += 1) {
    if (!isAllowedAudioUrl(current)) {
      console.error(
        "narration: refusing to fetch audio from an unexpected host",
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
  const allowed = configured.length
    ? configured
    : ["api.runpod.ai", "runpod.ai"];

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
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
