/**
 * The narration voice registry.
 *
 * Migration `00048_voice_library.sql` created `public.voices` as the runtime
 * catalogue -- tier, language, gender, provider parameters and preview path
 * all live there now, so a new voice or a re-tiering ships as a migration
 * rather than a deploy. This module is the single place that reads it: every
 * caller on the audio path (`generate-audio`, `audio-status`, the `voices`
 * endpoint, `seed-voice-previews`) goes through `listVoices` / `getVoiceRecord`
 * rather than querying the table directly, so the database fallback below is
 * applied in exactly one place.
 *
 * `STATIC_VOICES` mirrors the table's seed rows. It exists so a database
 * outage narrows the voice picker to today's defaults instead of taking
 * narration down entirely -- the same 8 ids `generate-audio` and
 * `audio-status` already accepted before this table existed. Keep it in sync
 * with the `insert` in `00048_voice_library.sql` by hand; nothing enforces
 * that automatically, which is why the migration test asserts they agree.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type VoiceTier = "standard" | "premium";
export type VoiceGender = "female" | "male" | "neutral";

export interface VoiceRecord {
  id: string;
  display_name: string;
  language: string;
  gender: VoiceGender;
  tier: VoiceTier;
  provider: string;
  provider_voice_params: Record<string, unknown>;
  preview_path: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Today's 8 voices, in the order the migration seeds them. */
export const STATIC_VOICES: readonly VoiceRecord[] = [
  {
    id: "aria",
    display_name: "Aria",
    language: "en",
    gender: "female",
    tier: "standard",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "aria" },
    preview_path: "voice-previews/aria.mp3",
    sort_order: 10,
    is_active: true,
  },
  {
    id: "kai",
    display_name: "Kai",
    language: "en",
    gender: "male",
    tier: "standard",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "kai" },
    preview_path: "voice-previews/kai.mp3",
    sort_order: 20,
    is_active: true,
  },
  {
    id: "elvira",
    display_name: "Elvira",
    language: "es",
    gender: "female",
    tier: "standard",
    provider: "edge_tts",
    provider_voice_params: { voice: "es-ES-ElviraNeural" },
    preview_path: "voice-previews/elvira.mp3",
    sort_order: 30,
    is_active: true,
  },
  {
    id: "alvaro",
    display_name: "Alvaro",
    language: "es",
    gender: "male",
    tier: "standard",
    provider: "edge_tts",
    provider_voice_params: { voice: "es-ES-AlvaroNeural" },
    preview_path: "voice-previews/alvaro.mp3",
    sort_order: 40,
    is_active: true,
  },
  {
    id: "onyx",
    display_name: "Onyx",
    language: "en",
    gender: "male",
    tier: "premium",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "onyx" },
    preview_path: "voice-previews/onyx.mp3",
    sort_order: 50,
    is_active: true,
  },
  {
    id: "nova",
    display_name: "Nova",
    language: "en",
    gender: "female",
    tier: "premium",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "nova" },
    preview_path: "voice-previews/nova.mp3",
    sort_order: 60,
    is_active: true,
  },
  {
    id: "echo",
    display_name: "Echo",
    language: "en",
    gender: "male",
    tier: "premium",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "echo" },
    preview_path: "voice-previews/echo.mp3",
    sort_order: 70,
    is_active: true,
  },
  {
    id: "fable",
    display_name: "Fable",
    language: "en",
    gender: "neutral",
    tier: "premium",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "fable" },
    preview_path: "voice-previews/fable.mp3",
    sort_order: 80,
    is_active: true,
  },
];

/** Every id `STATIC_VOICES` lists. */
export const VALID_VOICE_IDS = new Set(
  STATIC_VOICES.map((voice) => voice.id),
);

/** The voice used when a caller names none, and the only one the pre-library code wrote back to the chapter row. */
export const DEFAULT_VOICE_ID = "aria";

export function isValidVoiceId(value: unknown): value is string {
  return typeof value === "string" && VALID_VOICE_IDS.has(value);
}

const VOICE_COLUMNS =
  "id, display_name, language, gender, tier, provider, provider_voice_params, preview_path, sort_order, is_active";

/**
 * Active voices, optionally filtered by language, ordered the way the voice
 * picker displays them. Falls back to `STATIC_VOICES` on a missing client, a
 * query error, or an empty result, so an outage on this table narrows the
 * picker instead of breaking it.
 */
export async function listVoices(
  supabase: SupabaseClient | null,
  language?: string,
): Promise<VoiceRecord[]> {
  const fallback = STATIC_VOICES.filter((voice) =>
    !language || voice.language === language
  );
  if (!supabase) return fallback;

  try {
    let query = supabase.from("voices").select(VOICE_COLUMNS).eq(
      "is_active",
      true,
    );
    if (language) query = query.eq("language", language);
    const { data, error } = await query.order("sort_order", {
      ascending: true,
    });
    if (error || !data || data.length === 0) return fallback;
    return data as VoiceRecord[];
  } catch {
    return fallback;
  }
}

/** One active voice by id, falling back to the static list on a miss, a missing client, or an outage. */
export async function getVoiceRecord(
  supabase: SupabaseClient | null,
  voiceId: string,
): Promise<VoiceRecord | null> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("voices")
        .select(VOICE_COLUMNS)
        .eq("id", voiceId)
        .eq("is_active", true)
        .maybeSingle();
      if (!error && data) return data as VoiceRecord;
    } catch {
      // Fall through to the static list below.
    }
  }
  return STATIC_VOICES.find((voice) => voice.id === voiceId) ?? null;
}
