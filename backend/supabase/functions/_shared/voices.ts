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

/**
 * A cheap shape check against the ids compiled into this file.
 *
 * This is NOT the authority on whether a voice may be used. The registry lives
 * in `public.voices` and can hold voices this file has never heard of, so a
 * handler that gates on this alone rejects every voice added after deploy.
 * Handlers resolve a voice with `getVoiceRecord`, which asks the table; this
 * stays for the static allowlist and for callers with no database at hand.
 */
export function isValidVoiceId(value: unknown): value is string {
  return typeof value === "string" && VALID_VOICE_IDS.has(value);
}

/**
 * Is this a voice the runtime will accept -- registry first, static list second.
 *
 * Answers `true` for a voice added to `public.voices` since deploy, and `false`
 * for one deliberately deactivated there, which is the pair of behaviours the
 * static-only check got wrong in both directions.
 */
export async function isKnownVoiceId(
  supabase: SupabaseClient | null,
  value: unknown,
): Promise<boolean> {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!supabase) return VALID_VOICE_IDS.has(value);
  return (await getVoiceRecord(supabase, value)) !== null;
}

const VOICE_COLUMNS =
  "id, display_name, language, gender, tier, provider, provider_voice_params, preview_path, sort_order, is_active";

/**
 * Is this voice's provider actually reachable from this deployment?
 *
 * `is_active` says an administrator wants a voice offered. It cannot say
 * whether the machinery behind it exists, and the two have now disagreed in
 * production twice in opposite directions: 00053 deactivated the edge_tts
 * pair because the provider was a stub, and 00059 reactivated them on the
 * expectation of a worker that was never deployed. `EDGE_TTS_SERVICE_URL` is
 * unset, so on 2026-09-10 the picker offered Elvira and Alvaro to every
 * Spanish reader and every tap failed with `edge_tts_service_missing` -- the
 * exact user experience 00053 was written to prevent.
 *
 * A row cannot know this; only the running deployment can. So the runtime
 * answers it, and the registry flag stops being the single point of failure:
 * an operator flipping `is_active` back on cannot re-break narration while
 * the worker is still missing, and the voices reappear on their own the
 * moment the URL is configured. No deploy, no migration, no third flip.
 */
export function isVoiceProviderConfigured(provider: string): boolean {
  if (provider === "edge_tts") {
    return Boolean(Deno.env.get("EDGE_TTS_SERVICE_URL"));
  }
  return true;
}

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
    (!language || voice.language === language) &&
    isVoiceProviderConfigured(voice.provider)
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
    // An empty result is an ANSWER, not an outage. Falling back to the static
    // list here re-exposed every voice an administrator had deliberately
    // deactivated, which is the opposite of what deactivating one is for.
    // Only a failure to reach the table falls back.
    if (error) return fallback;
    if (!data) return fallback;
    return (data as VoiceRecord[]).filter((voice) =>
      isVoiceProviderConfigured(voice.provider)
    );
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
      if (error) {
        // The table could not answer. Degrade to the static list rather than
        // taking narration down with it.
        return staticVoice(voiceId);
      }
      // The table answered. Whatever it said is the truth, including "no row",
      // which is how a disabled or removed voice presents. Falling back here
      // resurrected voices that had been switched off and let generation run on
      // stale provider parameters.
      const record = (data as VoiceRecord | null) ?? null;
      // A voice the picker cannot offer is also a voice generation must not
      // accept, including from a stale client that cached the old list. Same
      // rule as `listVoices`, applied at the point where money gets spent.
      if (record && !isVoiceProviderConfigured(record.provider)) return null;
      return record;
    } catch {
      return staticVoice(voiceId);
    }
  }
  return staticVoice(voiceId);
}

/** The static-list lookup, with the same provider-availability rule applied. */
function staticVoice(voiceId: string): VoiceRecord | null {
  const voice = STATIC_VOICES.find((candidate) => candidate.id === voiceId);
  if (!voice) return null;
  return isVoiceProviderConfigured(voice.provider) ? voice : null;
}
