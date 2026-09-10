import AsyncStorage from "@react-native-async-storage/async-storage";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * The narration voices, as the SERVER lists them.
 *
 * WHY NOT `src/data/voices.ts`. That file is a hand-written catalogue of eight
 * voices, four of which — luna, zara, ravi and leo — have never existed in the
 * `voices` table. Any picker built from it offers them, and choosing one is a
 * `400 Unknown voice_id` at the moment somebody presses Listen. The registry
 * is the database's, and the two have been allowed to disagree because nothing
 * in the app had ever read the endpoint.
 *
 * This reads it. The list is therefore always exactly what can be spoken:
 * deactivated voices are absent, and so are voices whose provider is not
 * configured in this deployment — which is how the Spanish pair correctly
 * disappears while there is no edge-tts worker, rather than being offered and
 * failing.
 */

export type NarrationVoice = {
  id: string;
  displayName: string;
  language: string;
  gender: string;
  tier: string;
  previewUrl: string | null;
};

const PREFERRED_VOICE_KEY = "katha.voice.v1";

/**
 * Every voice this deployment can actually speak with, or null on failure.
 *
 * Null rather than an empty array on an error, and the difference matters: an
 * empty list is a real answer meaning "nothing is available", and the picker
 * says so; null means we could not ask, and the picker says that instead.
 */
export async function fetchNarrationVoices(
  language?: string,
): Promise<NarrationVoice[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const query = language ? `?language=${encodeURIComponent(language)}` : "";
    const { data, error } = await supabase.functions.invoke(
      `voices${query}`,
      { method: "GET" },
    );
    if (error || !Array.isArray(data?.voices)) return null;
    return (data.voices as Record<string, unknown>[])
      .map((voice) => ({
        id: typeof voice.id === "string" ? voice.id : "",
        displayName: typeof voice.display_name === "string"
          ? voice.display_name
          : "",
        language: typeof voice.language === "string" ? voice.language : "",
        gender: typeof voice.gender === "string" ? voice.gender : "",
        tier: typeof voice.tier === "string" ? voice.tier : "standard",
        previewUrl: typeof voice.preview_url === "string"
          ? voice.preview_url
          : null,
      }))
      .filter((voice) => voice.id.length > 0);
  } catch {
    return null;
  }
}

/**
 * The voice this reader prefers, remembered on the device.
 *
 * Device-local rather than on the account, because it is a preference about
 * this phone's listening rather than a fact about the person, and because the
 * alternative is another column and another endpoint for a value that costs
 * nothing to re-pick.
 */
export async function preferredVoiceId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(PREFERRED_VOICE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function setPreferredVoiceId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFERRED_VOICE_KEY, id);
  } catch {
    // A preference that cannot be saved is re-picked next time. Nothing else
    // depends on it.
  }
}
