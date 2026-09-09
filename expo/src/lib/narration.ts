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

export type NarrationOutcome =
  /** Narration exists and can be played now. */
  | { kind: "ready"; audioUrl: string; cached: boolean }
  /** A job is running. Keep polling. */
  | { kind: "pending" }
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
    return { kind: "ready", audioUrl, cached: payload.cached === true };
  }
  if (status === "PENDING") return { kind: "pending" };
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
