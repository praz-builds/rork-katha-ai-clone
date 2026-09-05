/**
 * The narration voice registry, shared by every function on the audio path.
 *
 * Both `generate-audio` and `audio-status` derive storage paths and upstream
 * job parameters from a client-supplied voice id, so the allowlist has to be
 * one list rather than two that can drift apart. `edge-tts.ts` maps the subset
 * of these ids that non-English synthesis can serve; it is a view of this set,
 * not a second source of truth.
 */
export const VALID_VOICE_IDS = new Set([
  "aria",
  "kai",
  "elvira",
  "alvaro",
  "onyx",
  "nova",
  "echo",
  "fable",
]);

/** The voice used when a caller names none, and the only one written back to the chapter row. */
export const DEFAULT_VOICE_ID = "aria";

export function isValidVoiceId(value: unknown): value is string {
  return typeof value === "string" && VALID_VOICE_IDS.has(value);
}
