/**
 * Request validation for v5.1 story generation.
 *
 * Normalizes genres via migration map, enforces genre/spice/audience
 * constraints, and derives server-side content ratings.
 */

import {
  type AudienceMode,
  AUDIENCE_MODES,
  type CharacterInput,
  GENRE_ALLOWED_SPICE,
  GENRE_ALLOWED_TROPES,
  GENRE_DEFAULT_SPICE,
  GENRE_MIGRATION_MAP,
  type IdentityLens,
  IDENTITY_LENSES,
  PRIMARY_GENRES,
  type PrimaryGenre,
  type SpiceLevel,
  SPICE_LEVELS,
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
  } else if (Array.isArray(body.genre) && typeof body.genre[0] === "string" && body.genre[0].trim()) {
    rawGenre = body.genre[0].trim();
  } else if (typeof body.genre === "string" && body.genre.trim()) {
    rawGenre = body.genre.trim();
  } else {
    return { error: "primary_genre is required" };
  }

  const primaryGenre = normalizeGenre(rawGenre);

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
  const rawSeed = body.topic ?? body.seed;
  if (typeof rawSeed !== "string") {
    return { error: "Story seed must be at least 40 characters" };
  }
  const seed = rawSeed.trim();
  if (seed.length < 40) {
    return { error: "Story seed must be at least 40 characters" };
  }
  if (seed.length > 1000) {
    return { error: "Story seed must be 1000 characters or fewer" };
  }

  // --- Characters ---
  const characters: CharacterInput[] = [];
  const rawCharacters = body.characters;
  if (rawCharacters !== undefined) {
    if (!Array.isArray(rawCharacters) || rawCharacters.length > 10) {
      return { error: "characters must contain at most 10 items" };
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

  return {
    primaryGenre,
    audienceMode,
    identityLenses,
    tropeModules,
    spiceLevel,
    seed,
    characters,
    requestId,
    language,
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
