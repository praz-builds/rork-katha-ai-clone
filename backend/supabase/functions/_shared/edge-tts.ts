/**
 * edge-tts — placeholder for non-English TTS via Microsoft's free edge-tts protocol.
 *
 * The real edge-tts client uses a WebSocket-based protocol that is complex to
 * implement inside Deno Edge Functions. This module defines the interface and
 * voice registry so the routing layer can reference it today, while the actual
 * synthesis is deferred to a future Cloudflare Workers AI integration or a
 * dedicated edge-tts microservice on RunPod.
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
 * Currently returns `null` to signal that the TTS backend for this language is
 * not yet wired. Callers should treat a `null` return as "audio pending" and
 * include that status in their response.
 *
 * @param text  - Plain text to synthesise.
 * @param voice - Microsoft Neural voice name, e.g. "es-ES-ElviraNeural".
 * @returns Audio bytes or `null` when synthesis is not yet available.
 */
export async function generateWithEdgeTts(
  text: string,
  voice: string,
): Promise<Uint8Array | null> {
  // edge-tts uses a WebSocket protocol that is non-trivial in Deno Edge Functions.
  // TODO: Implement via Cloudflare Workers AI Aura-2-es or a dedicated edge-tts microservice.
  console.log(
    `[edge-tts] Synthesis requested for voice="${voice}", text length=${text.length} chars — not yet implemented, returning null.`,
  );
  return null;
}
