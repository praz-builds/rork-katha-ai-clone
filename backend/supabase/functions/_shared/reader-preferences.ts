/**
 * Reader context: the languages a reader speaks and the place they call home.
 *
 * Set once on You (Global preferences), stored per account in
 * `reader_preferences` (migration 00100), and read by the server at the moment
 * a first chapter is written -- never taken from the generation request, so a
 * client cannot put somebody else's context, or text of its own, into a
 * prompt through this path.
 *
 * WHAT IT IS NOT: an output language. The story's language is the `language`
 * field on the brief and nothing here changes it. Somebody who speaks Hindi
 * and English and reads in English gets English prose, with the culture those
 * languages carry available to the story; see `buildReaderContextBlock` in
 * story-prompts.ts for the exact instruction.
 *
 * `source-of-truth/STORY_PROMPT_SYSTEM.md` *Reader context* is the contract.
 */

/**
 * The closed list. Ids are ISO 639 codes and are stable: never rename one,
 * only append. The same ids are in the migration's CHECK and in
 * `expo/src/lib/reader-preferences.ts`; a test on each side pins the set.
 */
export const SPOKEN_LANGUAGES = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ar: "Arabic",
  fa: "Persian",
  tr: "Turkish",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  id: "Indonesian",
  fil: "Filipino",
  vi: "Vietnamese",
  th: "Thai",
  sw: "Swahili",
  yo: "Yoruba",
  am: "Amharic",
} as const;

export type SpokenLanguage = keyof typeof SPOKEN_LANGUAGES;

/** At most three: enough for a multilingual household, short for a prompt. */
export const MAX_SPOKEN_LANGUAGES = 3;

/** Characters, after trimming and collapsing whitespace. Mirrors the CHECK. */
export const HOME_PLACE_MAX = 60;

/**
 * Letters and marks in any script, digits, spaces, and the punctuation place
 * names actually use: "St. John's", "Rio de Janeiro", "Pune (Kothrud)",
 * "Winston-Salem". No angle brackets, braces, backticks, quotes or newlines,
 * so a place cannot close a fence or open a new line of instruction. The
 * value is still fenced as untrusted text when it reaches a prompt; this is
 * the first lock, not the only one.
 */
const HOME_PLACE_PATTERN = /^[\p{L}\p{M}\p{N} .,'’()\-]+$/u;

/**
 * Why a save was refused, as a stable code beside the developer message.
 * The client words its own copy from `reason` and never shows `error`, so the
 * message can stay precise for logs while the reader sees something they can
 * act on. `account_deleted` is the tombstone's 404 (00100), and it is the
 * only 404 that carries a reason: a gateway 404 has none.
 */
export type PreferencesRefusalReason =
  | "unknown_language"
  | "too_many_languages"
  | "place_too_long"
  | "place_invalid"
  /** A body no client of ours sends: `spokenLanguages` is not a list. */
  | "invalid_request"
  | "account_deleted";

export type PreferencesRefusal = {
  error: string;
  reason: PreferencesRefusalReason;
};

export function isSpokenLanguage(value: unknown): value is SpokenLanguage {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SPOKEN_LANGUAGES, value);
}

export type ReaderContext = {
  spokenLanguages: SpokenLanguage[];
  homePlace?: string;
};

/**
 * A place as it will be stored, or null for "none", or an error for a value
 * that is not a place. Whitespace runs collapse to one space.
 */
export function normalizeHomePlace(
  value: unknown,
): { place: string | null } | PreferencesRefusal {
  if (value === undefined || value === null) return { place: null };
  if (typeof value !== "string") {
    return { error: "place must be text", reason: "place_invalid" };
  }
  const place = value.replace(/\s+/g, " ").trim();
  if (place.length === 0) return { place: null };
  if (place.length > HOME_PLACE_MAX) {
    return {
      error: `place must be ${HOME_PLACE_MAX} characters or fewer`,
      reason: "place_too_long",
    };
  }
  if (!HOME_PLACE_PATTERN.test(place)) {
    return {
      error: "place may use letters, numbers, spaces and . , ' ( ) -",
      reason: "place_invalid",
    };
  }
  return { place };
}

/**
 * The write, validated. Languages must be known ids and are de-duplicated in
 * the order given (the first is the one the reader reached for first). An
 * unknown id is REFUSED here rather than dropped: this is somebody saving a
 * setting, and silently saving less than they chose would read as a bug.
 */
export function normalizeReaderPreferences(
  body: Record<string, unknown>,
):
  | { spokenLanguages: SpokenLanguage[]; homePlace: string | null }
  | PreferencesRefusal {
  const raw = body.spokenLanguages ?? [];
  if (!Array.isArray(raw)) {
    return {
      error: "spokenLanguages must be a list",
      reason: "invalid_request",
    };
  }
  const spokenLanguages: SpokenLanguage[] = [];
  for (const entry of raw) {
    if (!isSpokenLanguage(entry)) {
      return {
        error: "spokenLanguages has an unknown language",
        reason: "unknown_language",
      };
    }
    if (!spokenLanguages.includes(entry)) spokenLanguages.push(entry);
  }
  if (spokenLanguages.length > MAX_SPOKEN_LANGUAGES) {
    return {
      error: `pick up to ${MAX_SPOKEN_LANGUAGES} languages`,
      reason: "too_many_languages",
    };
  }
  const place = normalizeHomePlace(body.homePlace);
  if ("error" in place) return place;
  return { spokenLanguages, homePlace: place.place };
}

/**
 * A stored row, as prompt input. Lenient where the write was strict: a row is
 * data from a previous deploy, so an id this build no longer knows is dropped
 * rather than failing a generation, and a place that no longer passes is
 * left out. Undefined when nothing is left -- the prompt then carries no
 * block at all, byte-identical to a story from before the preference.
 */
export function readerContextFromRow(row: unknown): ReaderContext | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  const languages = Array.isArray(record.spoken_languages)
    ? record.spoken_languages.filter(isSpokenLanguage)
    : [];
  const spokenLanguages = [...new Set(languages)].slice(
    0,
    MAX_SPOKEN_LANGUAGES,
  );
  const place = normalizeHomePlace(record.home_place);
  const homePlace = "place" in place && place.place ? place.place : undefined;
  if (spokenLanguages.length === 0 && !homePlace) return undefined;
  return { spokenLanguages, ...(homePlace ? { homePlace } : {}) };
}

type PreferencesReader = {
  from(table: "reader_preferences"): {
    select(columns: string): {
      eq(column: "user_id", value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * The caller's context, for a prompt. NEVER THROWS and never blocks a story:
 * a failed read is a story written without the preference, which is how
 * every story was written before it existed. The failure is the caller's to
 * log if it wants to; here it is just "no context".
 */
export async function loadReaderContext(
  client: unknown,
  userId: string,
): Promise<ReaderContext | undefined> {
  try {
    const { data, error } = await (client as PreferencesReader)
      .from("reader_preferences")
      .select("spoken_languages, home_place")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return undefined;
    return readerContextFromRow(data);
  } catch {
    return undefined;
  }
}
