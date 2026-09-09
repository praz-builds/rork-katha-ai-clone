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
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
