/**
 * Generate every voice's preview clip once, idempotently.
 *
 * Previewing a voice in a picker must cost nothing per story: a preview is
 * one short sample per voice, generated once and reused everywhere it is
 * shown. This function is the only writer of preview clips -- `generate-audio`,
 * `audio-status` and `voices` never generate one on a read path -- and it is
 * safe to run repeatedly: a voice whose preview already exists at its stable
 * path is left untouched.
 *
 * Service-role only. There is no per-user reason to call this, and it is the
 * one place in the audio path that starts a provider job without going
 * through `canGenerateNarration` -- previews are operational content, not a
 * user's paid narration, so the entitlement gate does not apply to them.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { constantTimeEquals } from "../_shared/revenuecat.ts";
import { listVoices, VoiceRecord } from "../_shared/voices.ts";
import {
  AUDIO_BUCKET,
  pollRunpodNarration,
  ProviderJobStarter,
  ProviderStatusPoller,
  startRunpodNarration,
  storageObjectExists,
  uploadAudio,
} from "../_shared/narration-audio.ts";

export const VOICE_PREVIEW_TEXT =
  "This is a short sample of this narrator's voice, so you can choose before you listen to a whole chapter.";

const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 1500;

export interface PreviewResult {
  voice_id: string;
  status: "exists" | "generated" | "skipped" | "failed";
  detail?: string;
}

export interface EnsurePreviewDeps {
  exists: (path: string) => Promise<boolean>;
  start: ProviderJobStarter;
  poll: ProviderStatusPoller;
  upload: (path: string, bytes: Uint8Array) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  intervalMs?: number;
}

/**
 * Ensure one voice has a preview clip at its stable path.
 *
 * Existence is checked before anything else, so a voice whose preview already
 * exists never reaches `start` -- the property the acceptance test on this
 * function proves.
 */
export async function ensureVoicePreview(
  voice: VoiceRecord,
  deps: EnsurePreviewDeps,
): Promise<PreviewResult> {
  if (!voice.preview_path) {
    return { voice_id: voice.id, status: "skipped", detail: "no_preview_path" };
  }
  if (voice.provider !== "runpod_minimax") {
    return {
      voice_id: voice.id,
      status: "skipped",
      detail: `provider_not_implemented:${voice.provider}`,
    };
  }
  if (await deps.exists(voice.preview_path)) {
    return { voice_id: voice.id, status: "exists" };
  }

  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? DEFAULT_POLL_ATTEMPTS;
  const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  try {
    const jobId = await deps.start({ text: VOICE_PREVIEW_TEXT, voice });

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await deps.poll(jobId);
      if (result.status === "ready" && result.audioBytes) {
        await deps.upload(voice.preview_path, result.audioBytes);
        return { voice_id: voice.id, status: "generated" };
      }
      if (result.status === "failed") {
        return {
          voice_id: voice.id,
          status: "failed",
          detail: result.errorCode ?? "provider_failed",
        };
      }
      await sleep(intervalMs);
    }
    return { voice_id: voice.id, status: "failed", detail: "timeout" };
  } catch (error) {
    return {
      voice_id: voice.id,
      status: "failed",
      detail: error instanceof Error
        ? error.message.slice(0, 96)
        : "provider_error",
    };
  }
}

/**
 * Two concurrent seedings that both observe a voice's preview as missing
 * would both start a provider job for it -- harmless in outcome (both
 * eventually try to write the same stable path) but wasteful, and this is a
 * service-role, manually/cron-triggered operation with no per-user reason to
 * ever be called twice at once. Requests that land on the same warm function
 * instance share this module's memory, so a second caller for a voice
 * already being generated is handed the first caller's in-flight promise
 * instead of starting its own. A genuinely concurrent cold start on a
 * different instance is not covered by this -- that would need a durable
 * claim (a lock table, mirroring `chapter_audio`'s
 * `claim_chapter_audio_generation`), which is disproportionate for an
 * idempotent-outcome, operator-only endpoint that in practice is called by
 * one process at a time.
 */
const previewsInFlight = new Map<string, Promise<PreviewResult>>();

async function ensureVoicePreviewOnce(
  voice: VoiceRecord,
  deps: EnsurePreviewDeps,
): Promise<PreviewResult> {
  const existing = previewsInFlight.get(voice.id);
  if (existing) return existing;

  const job = ensureVoicePreview(voice, deps).finally(() => {
    previewsInFlight.delete(voice.id);
  });
  previewsInFlight.set(voice.id, job);
  return job;
}

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return respond({ error: "Service role is not configured" }, 503);
  }
  const authorization = req.headers.get("Authorization") ?? "";
  const suppliedKey = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;
  if (!constantTimeEquals(suppliedKey, serviceRoleKey)) {
    return respond({ error: "Unauthorized" }, 401);
  }

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );
    const voices = await listVoices(serviceClient);

    const results: PreviewResult[] = [];
    for (const voice of voices) {
      const result = await ensureVoicePreviewOnce(voice, {
        exists: (path) =>
          storageObjectExists(serviceClient, AUDIO_BUCKET, path),
        start: startRunpodNarration,
        poll: pollRunpodNarration,
        upload: (path, bytes) => uploadAudio(serviceClient, path, bytes),
      });
      results.push(result);
      if (result.status === "failed") {
        await logError({
          bucket: "generation.audio",
          severity: "medium",
          errorCode: `preview_${result.detail ?? "failed"}`,
          error: new Error(`Preview generation failed for voice ${voice.id}`),
        });
      }
    }

    return respond({ results });
  } catch (error) {
    console.error("seed-voice-previews error:", error);
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
