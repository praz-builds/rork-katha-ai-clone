import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Global preferences: the languages a reader speaks and where they live.
 *
 * Saved to the ACCOUNT (the `profile` function's `preferences` and
 * `set_preferences` actions, table `reader_preferences`, migration 00100),
 * not to the device. A city is personal data, and AsyncStorage is exactly
 * where the security gate says it must not sit; stored server-side it also
 * follows the reader to a new phone. The server reads it itself when a first
 * chapter is written, so nothing here is sent with a story request.
 *
 * It is context, not a language switch: the story is still written in the
 * language the brief asks for. `source-of-truth/STORY_PROMPT_SYSTEM.md`
 * *Reader context* is the contract.
 *
 * The ids are the server's closed list (`SPOKEN_LANGUAGES` in
 * `backend/supabase/functions/_shared/reader-preferences.ts` and the CHECK in
 * 00100). Same ids, same order; a test pins that they match.
 */
export const SPOKEN_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "bn", label: "Bengali" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "mr", label: "Marathi" },
  { id: "gu", label: "Gujarati" },
  { id: "kn", label: "Kannada" },
  { id: "ml", label: "Malayalam" },
  { id: "pa", label: "Punjabi" },
  { id: "ur", label: "Urdu" },
  { id: "es", label: "Spanish" },
  { id: "pt", label: "Portuguese" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "ar", label: "Arabic" },
  { id: "fa", label: "Persian" },
  { id: "tr", label: "Turkish" },
  { id: "ru", label: "Russian" },
  { id: "zh", label: "Chinese" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "id", label: "Indonesian" },
  { id: "fil", label: "Filipino" },
  { id: "vi", label: "Vietnamese" },
  { id: "th", label: "Thai" },
  { id: "sw", label: "Swahili" },
  { id: "yo", label: "Yoruba" },
  { id: "am", label: "Amharic" },
] as const;

export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number]["id"];

export const MAX_SPOKEN_LANGUAGES = 3;
export const HOME_PLACE_MAX = 60;

/** The server's rule, for an answer while typing. The server's copy decides. */
const HOME_PLACE_PATTERN = /^[\p{L}\p{M}\p{N} .,'’()\-]+$/u;

const KNOWN: ReadonlySet<string> = new Set(SPOKEN_LANGUAGES.map((l) => l.id));

export function isSpokenLanguage(value: unknown): value is SpokenLanguage {
  return typeof value === "string" && KNOWN.has(value);
}

export type ReaderPreferences = {
  spokenLanguages: SpokenLanguage[];
  homePlace: string | null;
};

export const EMPTY_READER_PREFERENCES: ReaderPreferences = {
  spokenLanguages: [],
  homePlace: null,
};

/** Null when the place is fine (or empty), otherwise what to say beside it. */
export function homePlaceProblem(value: string): string | null {
  const place = value.replace(/\s+/g, " ").trim();
  if (place.length === 0) return null;
  if (place.length > HOME_PLACE_MAX) {
    return `Keep it under ${HOME_PLACE_MAX} characters.`;
  }
  if (!HOME_PLACE_PATTERN.test(place)) {
    return "Use letters, numbers, spaces and . , ' ( ) - only.";
  }
  return null;
}

/**
 * Tap a language: on if off, off if on, in tap order. At the cap a new pick
 * is refused (the list is returned unchanged) rather than silently dropping
 * the oldest, which would take away something the reader chose.
 */
export function toggleSpokenLanguage(
  current: readonly SpokenLanguage[],
  id: SpokenLanguage,
): SpokenLanguage[] {
  if (current.includes(id)) return current.filter((entry) => entry !== id);
  if (current.length >= MAX_SPOKEN_LANGUAGES) return [...current];
  return [...current, id];
}

/** The row's subtitle on You. */
export function readerPreferencesSummary(prefs: ReaderPreferences): string {
  const languages = prefs.spokenLanguages
    .map((id) => SPOKEN_LANGUAGES.find((l) => l.id === id)?.label)
    .filter(Boolean)
    .join(", ");
  const place = prefs.homePlace?.trim();
  if (languages && place) return `${languages} · ${place}`;
  if (languages) return languages;
  if (place) return place;
  return "Add the languages you speak and your city";
}

function fromResponse(data: unknown): ReaderPreferences | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const languages = Array.isArray(record.spokenLanguages)
    ? record.spokenLanguages.filter(isSpokenLanguage)
    : [];
  const place = typeof record.homePlace === "string" && record.homePlace.trim()
    ? record.homePlace
    : null;
  return { spokenLanguages: languages, homePlace: place };
}

/** The saved preferences, or null when they could not be read. */
export async function fetchReaderPreferences(): Promise<ReaderPreferences | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "preferences" },
    });
    if (error) return null;
    return fromResponse(data);
  } catch {
    return null;
  }
}

/**
 * Save both fields. Returns what the server stored, or null when the write
 * did not happen -- the caller keeps the sheet open and says so rather than
 * showing a value that was never saved.
 */
export async function saveReaderPreferences(
  prefs: ReaderPreferences,
): Promise<ReaderPreferences | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: {
        action: "set_preferences",
        spokenLanguages: prefs.spokenLanguages,
        homePlace: prefs.homePlace?.trim() ? prefs.homePlace.trim() : null,
      },
    });
    if (error) return null;
    return fromResponse(data);
  } catch {
    return null;
  }
}
