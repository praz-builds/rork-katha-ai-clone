/**
 * edge-tts — Microsoft voice synthesis through our own edge-tts worker.
 *
 * The real edge-tts client uses a WebSocket-based protocol that is complex to
 * implement inside Deno Edge Functions. This module calls a small worker we
 * control instead: the worker runs the unofficial edge-tts client, returns MP3
 * bytes, and this Edge Function handles auth, entitlements, caching and storage.
 *
 * Supported voices are listed here so the backend and client share a single
 * source of truth for non-English voice IDs.
 */

/** Maps a Katha voice ID to the Microsoft edge-tts voice name. */
export const EDGE_TTS_VOICES: Record<string, string> = {
  // Spanish (Spain)
  elvira: "es-ES-ElviraNeural",
  alvaro: "es-ES-AlvaroNeural",
};

/** Default voice pairs per language code (female, male). */
export const DEFAULT_VOICES_BY_LANGUAGE: Record<string, [string, string]> = {
  en: ["aria", "kai"],
  es: ["elvira", "alvaro"],
};

/**
 * Attempt to synthesise audio with edge-tts.
 *
 * `EDGE_TTS_SERVICE_URL` points at a service that accepts
 * `{ text, voice, format: "mp3" }` and returns either `audio/mpeg` bytes or
 * JSON with `audio_base64`, `mp3_base64` or `audio`.
 *
 * @param text  - Plain text to synthesise.
 * @param voice - Microsoft Neural voice name, e.g. "es-ES-ElviraNeural".
 * @returns Audio bytes ready to upload to the permanent cache.
 */
export async function generateWithEdgeTts(
  text: string,
  voice: string,
): Promise<Uint8Array> {
  const serviceUrl = Deno.env.get("EDGE_TTS_SERVICE_URL");
  if (!serviceUrl) throw new Error("EDGE_TTS_SERVICE_URL is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), edgeTtsTimeoutMs());
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "audio/mpeg, application/json",
    };
    const apiKey = Deno.env.get("EDGE_TTS_API_KEY");
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(serviceUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice, format: "mp3" }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`edge_tts_failed:${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => null);
      const base64 = base64AudioFromPayload(payload);
      if (!base64) throw new Error("edge_tts_bad_response");
      const bytes = decodeBase64Audio(base64);
      if (!bytes) throw new Error("edge_tts_bad_response");
      return bytes;
    }

    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_EDGE_TTS_AUDIO_BYTES) {
      throw new Error("edge_tts_bad_response");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_EDGE_TTS_AUDIO_BYTES) {
      throw new Error("edge_tts_bad_response");
    }
    return bytes;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("edge_tts_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const DEFAULT_EDGE_TTS_TIMEOUT_MS = 90_000;
const MAX_EDGE_TTS_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_EDGE_TTS_BASE64_CHARS = Math.ceil((MAX_EDGE_TTS_AUDIO_BYTES / 3) * 4);

function edgeTtsTimeoutMs(): number {
  const configured = Number(Deno.env.get("EDGE_TTS_TIMEOUT_MS") ?? "");
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_EDGE_TTS_TIMEOUT_MS;
}

function base64AudioFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["audio_base64", "mp3_base64", "audio"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function decodeBase64Audio(value: string): Uint8Array | null {
  const clean = value.replace(/^data:audio\/[^;]+;base64,/, "");
  if (clean.length === 0 || clean.length > MAX_EDGE_TTS_BASE64_CHARS) {
    return null;
  }
  try {
    return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
