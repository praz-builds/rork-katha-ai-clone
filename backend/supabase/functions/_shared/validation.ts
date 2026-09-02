/**
 * Request validation for v5.1 story generation.
 *
 * Normalizes genres via migration map, enforces genre/spice/audience
 * constraints, and derives server-side content ratings.
 */

import {
  AUDIENCE_MODES,
  type AudienceMode,
  CHAPTER_LENGTHS,
  type ChapterLength,
  type CharacterInput,
  DEFAULT_CHAPTER_LENGTH,
  DEFAULT_PLANNED_CHAPTER_COUNT,
  GENRE_ALLOWED_SPICE,
  GENRE_ALLOWED_TROPES,
  GENRE_DEFAULT_SPICE,
  GENRE_MIGRATION_MAP,
  IDENTITY_LENSES,
  type IdentityLens,
  MAX_BRIEF_FIELD_LENGTH,
  MAX_CAST_SIZE,
  MAX_MOMENTS,
  PLANNED_CHAPTER_COUNT_SET,
  type PlannedChapterCount,
  PRIMARY_GENRES,
  type PrimaryGenre,
  SPICE_LEVELS,
  type SpiceLevel,
  STORY_MODES,
  type StoryMode,
  TROPE_MODULES,
  type TropeModule,
  type ValidatedGenerationParams,
} from "./types.ts";
import { parseRequestId } from "./operations.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateGenerationRequest(
  value: unknown,
): ValidatedGenerationParams | { error: string; status?: number } {
  if (!value || typeof value !== "object") return { error: "Invalid request" };
  const body = value as Record<string, unknown>;

  // --- Genre ---
  let rawGenre: string;
  if (typeof body.primary_genre === "string" && body.primary_genre.trim()) {
    rawGenre = body.primary_genre.trim();
  } else if (
    Array.isArray(body.genre) && typeof body.genre[0] === "string" &&
    body.genre[0].trim()
  ) {
    rawGenre = body.genre[0].trim();
  } else if (typeof body.genre === "string" && body.genre.trim()) {
    rawGenre = body.genre.trim();
  } else {
    return { error: "primary_genre is required" };
  }

  const primaryGenre = normalizeGenre(rawGenre);

  // --- Story Mode ---
  let storyMode: StoryMode = "standalone";
  if (typeof body.story_mode === "string" && body.story_mode.trim()) {
    const mode = body.story_mode.trim();
    if (!STORY_MODES.has(mode)) {
      return { error: "story_mode must be 'standalone' or 'series'" };
    }
    storyMode = mode as StoryMode;
  } else if (body.is_series === true) {
    storyMode = "series";
  }

  // --- Audience Mode ---
  let audienceMode: AudienceMode = "adult";
  if (typeof body.audience_mode === "string") {
    const am = body.audience_mode.trim();
    if (am && !AUDIENCE_MODES.has(am)) {
      return { error: "audience_mode must be 'adult' or 'kids'" };
    }
    audienceMode = (am || "adult") as AudienceMode;
  }

  // Reject darkRomance in kids mode
  if (audienceMode === "kids" && primaryGenre === "darkRomance") {
    return { error: "Dark Romance is not available in kids mode" };
  }

  // --- Spice Level ---
  let spiceLevel: SpiceLevel;
  if (audienceMode === "kids") {
    spiceLevel = "sweet";
  } else if (typeof body.spice_level === "string" && body.spice_level.trim()) {
    const sl = body.spice_level.trim();
    if (!SPICE_LEVELS.has(sl)) {
      return { error: "spice_level must be 'sweet', 'steamy', or 'explicit'" };
    }
    if (sl === "explicit") {
      return {
        error: "Explicit content is not available yet",
        status: 403,
      };
    }
    spiceLevel = sl as SpiceLevel;
  } else {
    spiceLevel = GENRE_DEFAULT_SPICE[primaryGenre] ?? "sweet";
  }

  // Validate spice against genre constraints — only clamp downward, never escalate
  const allowedSpice = GENRE_ALLOWED_SPICE[primaryGenre];
  if (allowedSpice && !allowedSpice.has(spiceLevel)) {
    spiceLevel = "sweet";
  }

  // --- Identity Lenses ---
  let identityLenses: IdentityLens[] = [];
  if (audienceMode !== "kids" && Array.isArray(body.identity_lenses)) {
    identityLenses = body.identity_lenses.filter(
      (l: unknown) => typeof l === "string" && IDENTITY_LENSES.has(l),
    ) as IdentityLens[];
  }

  // --- Trope Modules ---
  let tropeModules: TropeModule[] = [];
  if (Array.isArray(body.trope_modules)) {
    const allowed = GENRE_ALLOWED_TROPES[primaryGenre] ?? new Set();
    tropeModules = body.trope_modules.filter(
      (t: unknown) =>
        typeof t === "string" && TROPE_MODULES.has(t) && allowed.has(t),
    ) as TropeModule[];
  }

  // --- Seed ---
  // The 40-character minimum is removed. It taught padding rather than
  // structure, and source-of-truth/STORY_GENERATION_FLOW.md section 2 replaces
  // it with the slot-based brief-strength meter, in which a one-line idea is a
  // legitimate choice rather than a failure. One non-whitespace character is
  // the floor; the 1000-character ceiling is unchanged.
  const rawSeed = body.topic ?? body.seed;
  if (typeof rawSeed !== "string") {
    return { error: "Tell Katha what your story is about" };
  }
  const seed = rawSeed.trim();
  if (seed.length < 1) {
    return { error: "Tell Katha what your story is about" };
  }
  if (seed.length > 1000) {
    return { error: "Story seed must be 1000 characters or fewer" };
  }

  // --- Characters ---
  const characters: CharacterInput[] = [];
  const rawCharacters = body.characters;
  if (rawCharacters !== undefined) {
    if (!Array.isArray(rawCharacters) || rawCharacters.length > MAX_CAST_SIZE) {
      return {
        error: `A story can have at most ${MAX_CAST_SIZE} characters`,
      };
    }
    for (const character of rawCharacters) {
      if (!character || typeof character !== "object") {
        return { error: "Each character must be an object" };
      }
      const item = character as Record<string, unknown>;
      if (
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 100
      ) {
        return {
          error: "Each character needs a name of 100 characters or fewer",
        };
      }
      for (
        const field of ["description", "background", "appearance"] as const
      ) {
        if (
          item[field] !== undefined &&
          (typeof item[field] !== "string" ||
            (item[field] as string).length > 500)
        ) {
          return {
            error: `Character ${field} must be 500 characters or fewer`,
          };
        }
      }
      if (item.isHero !== undefined && typeof item.isHero !== "boolean") {
        return { error: "Character isHero must be boolean" };
      }
      characters.push({
        name: item.name.trim(),
        description: typeof item.description === "string"
          ? item.description.trim()
          : undefined,
        background: typeof item.background === "string"
          ? item.background.trim()
          : undefined,
        appearance: typeof item.appearance === "string"
          ? item.appearance.trim()
          : undefined,
        isHero: item.isHero === true,
      });
    }
  }

  // --- Request ID ---
  const requestId = parseRequestId(body.request_id);
  if (!requestId) return { error: "Invalid request_id" };

  // --- Language ---
  let language: string | undefined;
  if (typeof body.language === "string") {
    const raw = body.language.trim();
    if (raw && raw.length <= 50) {
      language = raw;
    }
  }

  // --- The brief ---
  const whereAndWhen = optionalText(body.where_and_when);
  if (whereAndWhen === TOO_LONG) {
    return {
      error:
        `Where and when must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }

  const avoid = optionalText(body.avoid);
  if (avoid === TOO_LONG) {
    return {
      error: `Avoid must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }

  const rawStyle = optionalText(body.writing_style);
  if (rawStyle === TOO_LONG) {
    return {
      error:
        `Writing style must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }
  const writingStyle = sanitizeWritingStyle(rawStyle);

  // Moments are clamped rather than rejected. A user who pins a seventh beat
  // has not made an error worth an error message; the cap exists because past
  // roughly five the model returns a checklist instead of a story.
  const moments = stringList(body.moments).slice(0, MAX_MOMENTS);

  // Values are a kids-mode chip slot and have no meaning in adult mode.
  const storyValues = audienceMode === "kids"
    ? stringList(body.story_values ?? body.values).slice(0, MAX_MOMENTS)
    : [];

  let chapterLength: ChapterLength = DEFAULT_CHAPTER_LENGTH;
  if (typeof body.chapter_length === "string" && body.chapter_length.trim()) {
    const cl = body.chapter_length.trim();
    if (!CHAPTER_LENGTHS.has(cl)) {
      return { error: "chapter_length must be 'short', 'standard', or 'long'" };
    }
    chapterLength = cl as ChapterLength;
  }

  let plannedChapterCount: PlannedChapterCount = DEFAULT_PLANNED_CHAPTER_COUNT;
  if (body.planned_chapter_count !== undefined) {
    const n = body.planned_chapter_count;
    if (typeof n !== "number" || !PLANNED_CHAPTER_COUNT_SET.has(n)) {
      return { error: "planned_chapter_count must be 3, 7, or 15" };
    }
    plannedChapterCount = n as PlannedChapterCount;
  }

  const illustrateChapters = body.illustrate_chapters === true;

  return {
    primaryGenre,
    storyMode,
    audienceMode,
    identityLenses,
    tropeModules,
    spiceLevel,
    seed,
    characters,
    requestId,
    language,
    whereAndWhen,
    moments,
    storyValues,
    writingStyle,
    avoid,
    chapterLength,
    plannedChapterCount,
    illustrateChapters,
  };
}

/**
 * Derive a content rating from audience mode and spice level.
 * The content rating is set server-side and stored on the story.
 */
export function deriveContentRating(
  audienceMode: AudienceMode,
  spiceLevel: SpiceLevel,
): string {
  if (audienceMode === "kids") return "kids";
  if (spiceLevel === "explicit") return "explicit";
  if (spiceLevel === "steamy") return "steamy";
  return "sweet";
}

// ---------------------------------------------------------------------------
// Brief helpers
// ---------------------------------------------------------------------------

/** Sentinel for "present but over the limit", distinct from "absent". */
const TOO_LONG = Symbol("too-long");

function optionalText(value: unknown): string | undefined | typeof TOO_LONG {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_BRIEF_FIELD_LENGTH) return TOO_LONG;
  return trimmed;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, MAX_BRIEF_FIELD_LENGTH));
  }
  return out;
}

/**
 * Strip requests to imitate a named writer.
 *
 * The prompt spec is explicit that author touchstones stay in documentation and
 * never reach a runtime prompt: naming a living author invites both a
 * style-imitation complaint and the model's flattest pastiche of that author.
 * A user typing "like Colleen Hoover" wants the craft, so the phrase is removed
 * and the rest of their direction survives rather than the whole field being
 * rejected. What is left - "hardboiled", "poetic", "short sentences" - is
 * exactly what the writing-style layer is for.
 *
 * Name tokens allow bare initials ("Ursula K Le Guin", "J. R. R. Tolkien"),
 * which an earlier version of this pattern stopped at, leaking the surname.
 *
 * **Known over-match, accepted deliberately:** a capitalised phrase that is not
 * a person is stripped too, so "in the style of Gothic Horror" loses its
 * subject. A regex cannot tell "Le Guin" from "Gothic Horror", and dropping a
 * little craft direction is the cheaper error. This is defence in depth, not
 * the only defence - the prompt layer states the craft-traits-not-imitation
 * rule as well.
 */
function sanitizeWritingStyle(
  value: string | undefined | typeof TOO_LONG,
): string | undefined {
  if (typeof value !== "string") return undefined;

  // A name token: an uppercase letter followed by any run of name characters, so
  // "Tolkien", a bare initial "K" or "J.", and non-ASCII names like "García" or
  // "Ngũgĩ" all match. \p{Lu}/\p{L} rather than [A-Z]/\w because an ASCII-only
  // class stops at the first accented character and leaks the rest of the name.
  const NAME = "\\p{Lu}[\\p{L}\\p{M}'\u2019.-]*";
  const PARTICLE = "de|van|von|del|della|da|di|du|la|le|el|bin|ibn|st";
  const TRIGGER =
    "like|in the style of|in the voice of|styled after|modelled after|modeled after|" +
    "written by|channelling|channeling|imitate|imitating|mimic|mimicking|copy|copying|" +
    "sound(?:s|ing)? like|read(?:s|ing)? like";

  const pattern = new RegExp(
    `\\b(?:${TRIGGER})\\s+(?:${NAME})(?:\\s+(?:${NAME}|${PARTICLE}))*`,
    "giu",
  );

  const cleaned = value
    .replace(pattern, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();

  return cleaned.length ? cleaned : undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeGenre(raw: string): PrimaryGenre {
  if (PRIMARY_GENRES.has(raw)) return raw as PrimaryGenre;

  // Case-insensitive match against primary genres
  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  for (const genre of PRIMARY_GENRES) {
    if (genre.toLowerCase() === lower) return genre as PrimaryGenre;
  }

  // Migration map
  const migrated = GENRE_MIGRATION_MAP[raw] ?? GENRE_MIGRATION_MAP[lower];
  if (migrated) return migrated;

  return "contemporary";
}
