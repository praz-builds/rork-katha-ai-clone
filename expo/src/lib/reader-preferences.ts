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
  /**
   * Language ids the server holds that THIS build does not know.
   *
   * `SPOKEN_LANGUAGES` is append-only by contract, so a reader who set a
   * language on a newer build and then opens this one would otherwise have it
   * filtered out on read and erased by the next Save -- the read is lenient,
   * the write was not. They are carried through the round trip untouched and
   * counted against the cap, because the server counts them too.
   */
  unrecognisedLanguages: string[];
  homePlace: string | null;
};

export const EMPTY_READER_PREFERENCES: ReaderPreferences = {
  spokenLanguages: [],
  unrecognisedLanguages: [],
  homePlace: null,
};

/** Null when the place is fine (or empty), otherwise what to say beside it. */
export function homePlaceProblem(value: string): string | null {
  const place = value.replace(/\s+/g, " ").trim();
  if (place.length === 0) return null;
  if (place.length > HOME_PLACE_MAX) {
    return `Keep it to ${HOME_PLACE_MAX} characters or fewer.`;
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
  const all = Array.isArray(record.spokenLanguages) ? record.spokenLanguages : [];
  const languages = all.filter(isSpokenLanguage);
  const unrecognised = all.filter(
    (value): value is string => typeof value === "string" && !isSpokenLanguage(value),
  );
  const place = typeof record.homePlace === "string" && record.homePlace.trim()
    ? record.homePlace
    : null;
  return { spokenLanguages: languages, unrecognisedLanguages: unrecognised, homePlace: place };
}

/**
 * The last value read or saved this session, so You draws the row at once on
 * a return visit instead of showing "Loading…" for something that changes
 * about once ever. Memory only (a city never goes to the device), and
 * `clearReaderPreferencesCache` drops it whenever the account changes --
 * `clearOwnProfile` and a profile for a different user both call it -- so one
 * account's city is never drawn for the next. `epoch` makes a read started
 * for the previous account land nowhere.
 */
let cache: { prefs: ReaderPreferences; at: number } | null = null;
let epoch = 0;

/** How long a held value is fresh enough to skip the read. */
export const READER_PREFERENCES_FRESH_MS = 5 * 60 * 1000;

export function cachedReaderPreferences(): ReaderPreferences | null {
  return cache?.prefs ?? null;
}

export function clearReaderPreferencesCache(): void {
  cache = null;
  epoch += 1;
}

/**
 * The saved preferences, or null when they could not be read. A value held
 * for less than `maxAgeMs` is returned without asking the server.
 */
export async function fetchReaderPreferences(
  { maxAgeMs = 0 }: { maxAgeMs?: number } = {},
): Promise<ReaderPreferences | null> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.prefs;
  if (!isSupabaseConfigured) return null;
  const startedIn = epoch;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "preferences" },
    });
    if (error) return null;
    const prefs = fromResponse(data);
    // A profile/account switch while this request was in flight makes both
    // the cache write AND this answer stale. Returning the old value would
    // still let a newly mounted Profile draw another account's city.
    if (startedIn !== epoch) return null;
    if (prefs) cache = { prefs, at: Date.now() };
    return prefs;
  } catch {
    return null;
  }
}

/** What a save came back with. */
export type SaveReaderPreferencesResult =
  | { saved: ReaderPreferences }
  /** The server refused it, and said why in words the reader can act on. */
  | { refused: string }
  /** Nothing came back: the network, or a server that did not answer. */
  | { failed: true }
  /**
   * The account changed while the save was in flight. The answer belongs to
   * the account that left, so it is reported to nobody -- the read's rule.
   */
  | { stale: true };

/**
 * Reader copy for each refusal code (`PreferencesRefusalReason` in the
 * function). The server's `error` text is for logs and is never shown: it
 * names JSON fields. A code this build does not know gets the generic line.
 */
export const REFUSAL_COPY: Record<string, string> = {
  unknown_language:
    "One of these languages is not available yet. Remove the one you added last and try again.",
  too_many_languages: `Pick up to ${MAX_SPOKEN_LANGUAGES} languages.`,
  place_too_long: `Keep your city to ${HOME_PLACE_MAX} characters or fewer.`,
  place_invalid:
    "Use letters, numbers, spaces and . , ' ( ) - for your city.",
  account_deleted:
    "This account has been deleted, so nothing can be saved to it.",
  invalid_request: "That could not be saved. Check your choices and try again.",
};
/**
 * A 400 with no code: a deployed `profile` older than the codes, which is
 * what production runs between this client shipping and the functions
 * deploying.
 */
export const REFUSAL_FALLBACK =
  "That could not be saved. Check your choices and try again.";

/**
 * Reader copy for a refusal, or null when the answer was not one. A 400 is a
 * refusal whatever its body; a 404 only when the body carries
 * `account_deleted` -- a gateway 404 for an unrouted function has no reason,
 * and telling that reader their account is gone would be false.
 */
async function refusalMessage(error: unknown): Promise<string | null> {
  const context = error && typeof error === "object"
    ? (error as {
      context?: { status?: number; json?: () => Promise<unknown> };
    }).context
    : undefined;
  const status = context?.status;
  if (status !== 400 && status !== 404) return null;
  let reason: unknown;
  try {
    const body = typeof context?.json === "function"
      ? await context.json() as { reason?: unknown } | null
      : null;
    reason = body?.reason;
  } catch {
    reason = undefined;
  }
  if (status === 404) {
    return reason === "account_deleted" ? REFUSAL_COPY.account_deleted : null;
  }
  return (typeof reason === "string" && REFUSAL_COPY[reason]) ||
    REFUSAL_FALLBACK;
}

/**
 * Save both fields. A refusal carries the server's reason -- a language this
 * build offers that the deployed function does not know yet reads as that,
 * not as "check your connection" -- and only a missing answer is `failed`.
 */
export async function saveReaderPreferences(
  prefs: ReaderPreferences,
): Promise<SaveReaderPreferencesResult> {
  if (!isSupabaseConfigured) return { failed: true };
  const startedIn = epoch;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: {
        action: "set_preferences",
        // The ids this build does not know go back exactly as they came.
        spokenLanguages: [...prefs.spokenLanguages, ...prefs.unrecognisedLanguages],
        homePlace: prefs.homePlace?.trim() ? prefs.homePlace.trim() : null,
      },
    });
    if (startedIn !== epoch) return { stale: true };
    if (error) {
      const refused = await refusalMessage(error);
      return refused ? { refused } : { failed: true };
    }
    const saved = fromResponse(data);
    if (!saved) return { failed: true };
    cache = { prefs: saved, at: Date.now() };
    return { saved };
  } catch {
    return { failed: true };
  }
}
