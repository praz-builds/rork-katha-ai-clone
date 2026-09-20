/**
 * The client half of narration: ask for a chapter to be read aloud, then watch
 * the job until it lands.
 *
 * Two edge functions back this, and they are deliberately asymmetric:
 *
 * - `generate-audio` (POST) is the *request*. It answers `COMPLETED` straight
 *   away when the (chapter, voice) has already been narrated -- cached
 *   narration is free and never reaches RunPod -- and `PENDING` (HTTP 202) when
 *   it has just claimed the row and started a job. It is also where every
 *   refusal lives: `canGenerateNarration` (`_shared/narration-entitlement.ts`)
 *   is the single gate, and it answers 503 with `NARRATION_REFUSAL` when fresh
 *   narration is not available to this reader. **That gate defaults CLOSED
 *   today** (`NARRATION_GENERATION_ENABLED` is not set), so `unavailable` is
 *   the honest, expected answer in production right now -- not an error.
 * - `audio-status` (GET) is the *poll*. It reads the durable `chapter_audio`
 *   row for the (chapter, voice) and only reaches the provider while that row
 *   says `pending`. It returns `FAILED` for a provider failure and for a job
 *   that went stale, so a stuck job terminates rather than polling forever.
 *
 * Everything here returns a `NarrationOutcome` rather than throwing. The Listen
 * screen has to render every one of these states as a screen, not as an alert,
 * so a thrown error would only have to be caught and re-shaped one layer up.
 */
import {
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";
import { bootstrapUser } from "@/lib/session";
import type { VoiceId } from "@/data/voices";

/**
 * One synthesized piece of a chapter.
 *
 * The server splits a chapter into chunks and synthesizes them in parallel, so
 * chunk 0 is playable long before the whole chapter is. `durationMs` is the
 * server's own measurement of that piece; the client prefers the duration
 * expo-av reports once the piece is actually loaded and falls back to this.
 * `charCount` is what anchors the transcript to the chunk (see
 * `buildChunkAnchoredCues`) and what estimates the tail of a chapter whose
 * later pieces do not exist yet.
 */
export type NarrationChunk = {
  index: number;
  url: string;
  durationMs: number | null;
  charCount: number;
};

/**
 * A piece that is not synthesized yet, and the one thing known about it.
 *
 * The server sends `char_count` on unready manifest entries for exactly this
 * purpose: a chapter's total duration is unknowable until every piece exists,
 * but the *prose* is all there from the first poll, so the tail can be
 * estimated from its length. Without these the provisional total covers only
 * the pieces that exist, so the scrubber reaches 100% of "~10:12" at the end
 * of chunk 0 and then jumps to "~20:00" when chunk 1 lands -- a total that
 * grows under a reader is the thing the provisional flag exists to avoid.
 */
export type NarrationChunkEstimate = {
  index: number;
  charCount: number;
};

/**
 * The manifest as it stands at this poll.
 *
 * `chunks` is how many pieces the chapter has in total, `entries` only the ones
 * that can be played right now -- so `entries.length < chunks` is precisely
 * "more is still being synthesized", which is what keeps the screen polling
 * after it has already started playing. `pending` is what is known about the
 * rest: their index and how much prose they hold.
 */
export type NarrationManifest = {
  chunks: number;
  entries: NarrationChunk[];
  pending: NarrationChunkEstimate[];
};

export type NarrationOutcome =
  /** Narration exists and can be played now. */
  | {
    kind: "ready";
    audioUrl: string;
    cached: boolean;
    /** Present when the server sent one; ignored for a cached playthrough. */
    manifest?: NarrationManifest;
  }
  /**
   * A job is running. Keep polling.
   *
   * `manifest` is what makes the wait shorter than the job: the moment its
   * first entry has a url, that piece is playable and the reader stops waiting
   * for the rest of the chapter.
   */
  | { kind: "pending"; manifest?: NarrationManifest }
  /** The provider failed, or the job went stale server-side. Retryable. */
  | { kind: "failed"; errorCode: string | null }
  /**
   * The reader may not start fresh narration: the entitlement gate said no
   * (503), or they may not read this chapter at all (403). Not an error and
   * not retryable -- retrying produces the same answer.
   */
  | { kind: "unavailable"; message: string }
  /**
   * `audio-status` has no row for this (chapter, voice). Only reachable when
   * the request was never made, or the row was cleaned up under us; the caller
   * re-requests rather than polling a job that does not exist.
   */
  | { kind: "missing" }
  /** The device could not reach the server at all. */
  | { kind: "offline" };

export type NarrationRequest = {
  storyId: string;
  chapterId: string;
  voiceId: VoiceId;
  /**
   * Why this narration is being asked for.
   *
   * `"prefetch"` means nobody is waiting on it: the reader is still listening
   * to the previous chapter and this is speculative spend. The server refuses
   * it with 503 unless its own flag is set, and that refusal must stay
   * invisible -- a dropped prefetch costs the reader a loader at the chapter
   * boundary and nothing else.
   *
   * The names are the server's own (`canGenerateNarration`'s `purpose`), minus
   * `"preview"`, which is a voice sample and never comes through here.
   * `generate-audio` reads anything that is not `"prefetch"` as `"chapter"`,
   * so omitting this is the same as asking for a chapter.
   */
  purpose?: "chapter" | "prefetch";
};

/**
 * The refusal the server sends for a closed entitlement gate. Matched loosely
 * (the server owns the exact wording) but kept here so the screen can tell a
 * "not available yet" apart from a genuine failure without reading HTTP codes
 * a second time.
 */
export const NARRATION_UNAVAILABLE_MESSAGE =
  "Narration is not available for this chapter yet.";

/** HTTP status carried on a Supabase FunctionsHttpError's `context` Response. */
function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: { status?: unknown } }).context;
  const status = context?.status;
  return typeof status === "number" ? status : null;
}

async function bodyOf(error: unknown): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: { json?: () => Promise<unknown> } })
    .context;
  if (typeof context?.json !== "function") return null;
  try {
    const parsed = await context.json();
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Turn a failed `functions.invoke` into an outcome.
 *
 * 503 and 403 are the two the reader is allowed to see as an explanation
 * rather than as a fault: the first is the entitlement gate, the second is a
 * chapter they cannot read. Everything else -- 500, a transport failure, a
 * body that will not parse -- is a failure they may retry.
 */
async function outcomeFromError(error: unknown): Promise<NarrationOutcome> {
  const status = statusOf(error);
  if (status === null) return { kind: "offline" };
  if (status === 404) return { kind: "missing" };
  if (status === 503 || status === 403) {
    const body = await bodyOf(error);
    const message = typeof body?.error === "string" && body.error.trim()
      ? body.error
      : NARRATION_UNAVAILABLE_MESSAGE;
    return { kind: "unavailable", message };
  }
  const body = await bodyOf(error);
  const errorCode = typeof body?.error_code === "string"
    ? body.error_code
    : null;
  return { kind: "failed", errorCode };
}

/**
 * Read a `chunk_manifest` out of a response, defensively.
 *
 * Every part of this is optional on the wire and the client must survive all of
 * it: an older deployment sends no manifest at all (the legacy stitched-file
 * path), a chunk that has not been synthesized yet has a null url, and nothing
 * promises the array arrives in index order. Entries with no url are dropped
 * rather than carried as "not ready", because a piece that cannot be played is
 * the same thing as a piece that is not there to every consumer here -- and
 * `chunks` still says how many are coming.
 *
 * Returns `undefined` -- not an empty manifest -- when there is no usable
 * manifest, so callers can tell "this server does not chunk" apart from "no
 * chunk is ready yet" without a second flag.
 *
 * An entry with no url is dropped from `entries` -- a piece that cannot be
 * played is the same thing as a piece that is not there, to everything that
 * plays -- but its `char_count` is kept in `pending`, because that is what
 * makes the provisional total span the whole chapter rather than only the part
 * of it that exists.
 */
export function parseChunkManifest(
  payload: Record<string, unknown>,
): NarrationManifest | undefined {
  const raw = payload.chunk_manifest;
  if (!Array.isArray(raw)) return undefined;
  const entries: NarrationChunk[] = [];
  const pending: NarrationChunkEstimate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const index = entry.index;
    const url = entry.url;
    if (typeof index !== "number" || !Number.isFinite(index)) continue;
    const charCount = typeof entry.char_count === "number" &&
        Number.isFinite(entry.char_count) && entry.char_count > 0
      ? entry.char_count
      : 0;
    if (typeof url !== "string" || url.length === 0) {
      // Not playable, but its length is known and that is what estimates the
      // tail of the chapter.
      if (charCount > 0) pending.push({ index, charCount });
      continue;
    }
    const durationMs = typeof entry.duration_ms === "number" &&
        Number.isFinite(entry.duration_ms) && entry.duration_ms > 0
      ? entry.duration_ms
      : null;
    entries.push({ index, url, durationMs, charCount });
  }
  entries.sort((a, b) => a.index - b.index);
  pending.sort((a, b) => a.index - b.index);
  const chunks = typeof payload.chunks === "number" &&
      Number.isFinite(payload.chunks) && payload.chunks > 0
    ? payload.chunks
    : raw.length;
  if (chunks <= 0) return undefined;
  return { chunks, entries, pending };
}

/** Read the JSON both functions answer with into an outcome. */
function outcomeFromPayload(data: unknown): NarrationOutcome {
  if (!data || typeof data !== "object") return { kind: "failed", errorCode: null };
  const payload = data as Record<string, unknown>;
  const status = typeof payload.status === "string" ? payload.status : "";

  if (status === "COMPLETED") {
    const audioUrl = typeof payload.audio_url === "string"
      ? payload.audio_url
      : "";
    // A COMPLETED with no URL is not something the player can act on; treat it
    // as a failure rather than handing the audio element an empty source.
    if (!audioUrl) return { kind: "failed", errorCode: "missing_audio_url" };
    return {
      kind: "ready",
      audioUrl,
      cached: payload.cached === true,
      manifest: parseChunkManifest(payload),
    };
  }
  if (status === "PENDING") {
    return { kind: "pending", manifest: parseChunkManifest(payload) };
  }
  if (status === "FAILED") {
    return {
      kind: "failed",
      errorCode: typeof payload.error_code === "string"
        ? payload.error_code
        : null,
    };
  }
  return { kind: "failed", errorCode: null };
}

/**
 * Ask for this chapter to be narrated in this voice.
 *
 * Cheap and idempotent by design: the server answers cached narration without
 * touching the provider, and a second caller racing the first is told
 * `PENDING` rather than starting a second job.
 */
export async function requestNarration(
  input: NarrationRequest,
): Promise<NarrationOutcome> {
  if (!isSupabaseConfigured) return { kind: "offline" };
  try {
    await bootstrapUser();
  } catch {
    return { kind: "offline" };
  }

  const { data, error } = await supabase.functions.invoke("generate-audio", {
    body: {
      story_id: input.storyId,
      chapter_id: input.chapterId,
      voice_id: input.voiceId,
      ...(input.purpose ? { purpose: input.purpose } : {}),
    },
  });
  if (error) return outcomeFromError(error);
  return outcomeFromPayload(data);
}

/** Poll a narration job that `requestNarration` already started. */
export async function pollNarration(
  input: NarrationRequest,
): Promise<NarrationOutcome> {
  if (!isSupabaseConfigured) return { kind: "offline" };

  const query = new URLSearchParams({
    story_id: input.storyId,
    chapter_id: input.chapterId,
    voice_id: input.voiceId,
  });
  const { data, error } = await supabase.functions.invoke(
    `audio-status?${query.toString()}`,
    { method: "GET" },
  );
  if (error) return outcomeFromError(error);
  return outcomeFromPayload(data);
}
