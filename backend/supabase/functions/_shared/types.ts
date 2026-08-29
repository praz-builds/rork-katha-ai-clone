/**
 * Shared types and constants for the v5.1 story taxonomy.
 *
 * 15 primary genres (13 in UI, 2 DB-only), audience modes,
 * identity lenses, trope modules, and spice levels.
 */

// ---------------------------------------------------------------------------
// Primary Genre
// ---------------------------------------------------------------------------

export type PrimaryGenre =
  | "romance"
  | "romantasy"
  | "darkRomance"
  | "cozyFantasy"
  | "paranormalRomance"
  | "fantasy"
  | "scifi"
  | "thriller"
  | "mystery"
  | "horror"
  | "contemporary"
  | "historical"
  | "adventure"
  | "comedy"
  | "poetry";

export const PRIMARY_GENRES: ReadonlySet<string> = new Set<PrimaryGenre>([
  "romance",
  "romantasy",
  "darkRomance",
  "cozyFantasy",
  "paranormalRomance",
  "fantasy",
  "scifi",
  "thriller",
  "mystery",
  "horror",
  "contemporary",
  "historical",
  "adventure",
  "comedy",
  "poetry",
]);

/** 13 genres shown in the UI (excludes cozyFantasy, paranormalRomance). */
export const UI_GENRES: ReadonlySet<string> = new Set<PrimaryGenre>([
  "romance",
  "romantasy",
  "darkRomance",
  "fantasy",
  "scifi",
  "thriller",
  "mystery",
  "horror",
  "contemporary",
  "historical",
  "adventure",
  "comedy",
  "poetry",
]);

// ---------------------------------------------------------------------------
// Audience Mode
// ---------------------------------------------------------------------------

export type AudienceMode = "adult" | "kids";

export const AUDIENCE_MODES: ReadonlySet<string> = new Set<AudienceMode>([
  "adult",
  "kids",
]);

// ---------------------------------------------------------------------------
// Story mode and chapter role
// ---------------------------------------------------------------------------

export type StoryMode = "standalone" | "series";

export const STORY_MODES: ReadonlySet<string> = new Set<StoryMode>([
  "standalone",
  "series",
]);

export type ChapterRole =
  | "standalone"
  | "series_opening"
  | "mid_series"
  | "finale";

export const CHAPTER_ROLES: ReadonlySet<string> = new Set<ChapterRole>([
  "standalone",
  "series_opening",
  "mid_series",
  "finale",
]);

export type HookType =
  | "none"
  | "revelation"
  | "reversal"
  | "decision"
  | "arrival"
  | "betrayal"
  | "danger"
  | "unanswered_question"
  | "emotional_rupture";

export const HOOK_TYPES: ReadonlySet<string> = new Set<HookType>([
  "none",
  "revelation",
  "reversal",
  "decision",
  "arrival",
  "betrayal",
  "danger",
  "unanswered_question",
  "emotional_rupture",
]);

// ---------------------------------------------------------------------------
// Identity Lens
// ---------------------------------------------------------------------------

export type IdentityLens = "queer";

export const IDENTITY_LENSES: ReadonlySet<string> = new Set<IdentityLens>([
  "queer",
]);

// ---------------------------------------------------------------------------
// Spice Level
// ---------------------------------------------------------------------------

export type SpiceLevel = "sweet" | "steamy" | "explicit";

export const SPICE_LEVELS: ReadonlySet<string> = new Set<SpiceLevel>([
  "sweet",
  "steamy",
  "explicit",
]);

// ---------------------------------------------------------------------------
// Trope Module
// ---------------------------------------------------------------------------

export type TropeModule =
  | "werewolf"
  | "vampire"
  | "enemiesToLovers"
  | "secondChance"
  | "forcedProximity"
  | "smallTown"
  | "fatedMates"
  | "forbiddenLove"
  | "lockedRoom"
  | "secretIdentity";

export const TROPE_MODULES: ReadonlySet<string> = new Set<TropeModule>([
  "werewolf",
  "vampire",
  "enemiesToLovers",
  "secondChance",
  "forcedProximity",
  "smallTown",
  "fatedMates",
  "forbiddenLove",
  "lockedRoom",
  "secretIdentity",
]);

// ---------------------------------------------------------------------------
// Genre-aware defaults and constraints
// ---------------------------------------------------------------------------

export const GENRE_DEFAULT_SPICE: Record<string, SpiceLevel> = {
  romance: "steamy",
  romantasy: "steamy",
  darkRomance: "steamy",
  cozyFantasy: "sweet",
  paranormalRomance: "steamy",
  fantasy: "sweet",
  scifi: "sweet",
  thriller: "sweet",
  mystery: "sweet",
  horror: "sweet",
  contemporary: "sweet",
  historical: "sweet",
  adventure: "sweet",
  comedy: "sweet",
  poetry: "sweet",
};

export const GENRE_ALLOWED_SPICE: Record<string, ReadonlySet<string>> = {
  romance: new Set(["sweet", "steamy"]),
  romantasy: new Set(["sweet", "steamy"]),
  darkRomance: new Set(["sweet", "steamy"]),
  cozyFantasy: new Set(["sweet"]),
  paranormalRomance: new Set(["sweet", "steamy"]),
  fantasy: new Set(["sweet", "steamy"]),
  scifi: new Set(["sweet", "steamy"]),
  thriller: new Set(["sweet", "steamy"]),
  mystery: new Set(["sweet", "steamy"]),
  horror: new Set(["sweet", "steamy"]),
  contemporary: new Set(["sweet", "steamy"]),
  historical: new Set(["sweet", "steamy"]),
  adventure: new Set(["sweet", "steamy"]),
  comedy: new Set(["sweet"]),
  poetry: new Set(["sweet"]),
};

export const GENRE_ALLOWED_TROPES: Record<string, ReadonlySet<string>> = {
  romance: new Set([
    "enemiesToLovers",
    "secondChance",
    "forcedProximity",
    "smallTown",
    "forbiddenLove",
  ]),
  romantasy: new Set([
    "enemiesToLovers",
    "fatedMates",
    "forbiddenLove",
    "forcedProximity",
  ]),
  darkRomance: new Set([
    "enemiesToLovers",
    "forcedProximity",
    "forbiddenLove",
    "fatedMates",
  ]),
  cozyFantasy: new Set(["smallTown", "secondChance", "forcedProximity"]),
  paranormalRomance: new Set([
    "werewolf",
    "vampire",
    "fatedMates",
    "forbiddenLove",
    "enemiesToLovers",
  ]),
  fantasy: new Set([
    "fatedMates",
    "forbiddenLove",
    "secretIdentity",
    "enemiesToLovers",
  ]),
  scifi: new Set(["secretIdentity", "forcedProximity", "forbiddenLove"]),
  thriller: new Set(["lockedRoom", "secretIdentity", "enemiesToLovers"]),
  mystery: new Set(["lockedRoom", "secretIdentity"]),
  horror: new Set(["lockedRoom", "secretIdentity", "forcedProximity"]),
  contemporary: new Set([
    "enemiesToLovers",
    "secondChance",
    "forcedProximity",
    "smallTown",
    "forbiddenLove",
  ]),
  historical: new Set([
    "forbiddenLove",
    "secretIdentity",
    "enemiesToLovers",
    "forcedProximity",
  ]),
  adventure: new Set([
    "enemiesToLovers",
    "forcedProximity",
    "secretIdentity",
    "fatedMates",
  ]),
  comedy: new Set([
    "enemiesToLovers",
    "forcedProximity",
    "smallTown",
    "secretIdentity",
  ]),
  poetry: new Set([]),
};

// ---------------------------------------------------------------------------
// Genre migration map (old genre names -> new primary genre)
// ---------------------------------------------------------------------------

export const GENRE_MIGRATION_MAP: Record<string, PrimaryGenre> = {
  drama: "contemporary",
  sliceOfLife: "contemporary",
  sliceoflife: "contemporary",
  darkAcademia: "contemporary",
  darkacademia: "contemporary",
  mythology: "fantasy",
  kids: "adventure",
  bedtime: "adventure",
  lgbtq: "contemporary",
  motivational: "contemporary",
  spirituality: "contemporary",
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CharacterInput {
  name: string;
  description?: string;
  background?: string;
  appearance?: string;
  isHero?: boolean;
}

export interface StoryGenerationOutput {
  title: string;
  chapter_title: string;
  chapter_body: string;
  word_count: number;
  themes: string[];
  first_line: string;
  previously_summary: string;
  series_state: SeriesState;
  /** The model's raw series_state, kept so merge can tell omitted from emptied. */
  raw_series_state?: unknown;
  /** False when the JSON parse failed and the text fallback produced this. */
  structured?: boolean;
  hook_type: HookType;
  hook_text: string;
}

export interface ValidatedGenerationParams {
  primaryGenre: PrimaryGenre;
  storyMode: StoryMode;
  audienceMode: AudienceMode;
  identityLenses: IdentityLens[];
  tropeModules: TropeModule[];
  spiceLevel: SpiceLevel;
  seed: string;
  characters: CharacterInput[];
  requestId: string;
  language?: string;
}

export interface SeriesState {
  central_conflict: string;
  protagonist_want: string;
  relationship_state: string;
  open_hooks: string[];
  resolved_hooks: string[];
  promised_payoffs: string[];
  world_facts: string[];
  character_changes: string[];
  next_chapter_pressure: string;
}

export const EMPTY_SERIES_STATE: SeriesState = {
  central_conflict: "",
  protagonist_want: "",
  relationship_state: "",
  open_hooks: [],
  resolved_hooks: [],
  promised_payoffs: [],
  world_facts: [],
  character_changes: [],
  next_chapter_pressure: "",
};
