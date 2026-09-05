/**
 * Shared types and constants for the v6 story taxonomy.
 *
 * 15 primary genres (13 in UI, 2 DB-only), audience modes,
 * identity lenses and spice levels.
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

/** A shaped brief can offer a primary shelf plus two editable secondary tags. */
export const MAX_STORY_GENRES = 3;

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

/**
 * Canonical hook values, in one place.
 *
 * The `HookType` union, the story JSON schema, the runtime `HOOK_TYPES` set and
 * the chapters_hook_type_check constraint in migration 00010 must all agree.
 * The first three are derived from this array; the database constraint is the
 * one remaining copy and is pinned against this list in llm.test.ts.
 */
export const HOOK_TYPE_VALUES = [
  "none",
  "revelation",
  "reversal",
  "decision",
  "arrival",
  "betrayal",
  "danger",
  "unanswered_question",
  "emotional_rupture",
] as const;

export type HookType = typeof HOOK_TYPE_VALUES[number];

export const HOOK_TYPES: ReadonlySet<string> = new Set<string>(
  HOOK_TYPE_VALUES,
);

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
// Story shape: planned length, chapter length, cast size
// ---------------------------------------------------------------------------

/**
 * The lengths a story may be planned to.
 *
 * This is a planned length, not a batch size: the user still advances one
 * chapter at a time. It drives pacing and finale derivation.
 */
export const PLANNED_CHAPTER_COUNTS = [3, 7, 15] as const;

export type PlannedChapterCount = typeof PLANNED_CHAPTER_COUNTS[number];

export const PLANNED_CHAPTER_COUNT_SET: ReadonlySet<number> = new Set<number>(
  PLANNED_CHAPTER_COUNTS,
);

export const DEFAULT_PLANNED_CHAPTER_COUNT: PlannedChapterCount = 3;

export type ChapterLength = "short" | "standard" | "long";

export const CHAPTER_LENGTHS: ReadonlySet<string> = new Set<ChapterLength>([
  "short",
  "standard",
  "long",
]);

export const DEFAULT_CHAPTER_LENGTH: ChapterLength = "standard";

/**
 * Maximum characters in a cast, and the number one credit buys.
 *
 * Three, not four. A product bound rather than a margin one - four portraits
 * still clear the floor on the blended basis CREDITS_AND_PRICING.md uses - but
 * three matches the set-of-three costing in that file and keeps the cast
 * legible. See source-of-truth/STORY_GENERATION_FLOW.md section 14 item 1.
 */
export const MAX_CAST_SIZE = 3;

/**
 * Maximum beats a user may pin, per source-of-truth/STORY_GENERATION_FLOW.md
 * section 5. Past roughly five, moments compete for room inside a chapter and
 * the model returns a checklist instead of a story.
 */
export const MAX_MOMENTS = 5;

/** Free-text craft fields are bounded so a prompt cannot be stuffed. */
export const MAX_BRIEF_FIELD_LENGTH = 300;

/**
 * The story plan: one beat per planned chapter, shown on the blueprint screen
 * before the user pays and then used as the brief for each chapter.
 *
 * Distinct from `moments`. A moment is unordered and the model schedules it
 * wherever the pacing allows; a beat is positional and owns exactly one
 * chapter. Bounded by the largest planned length so a plan can never promise a
 * beat that no chapter reaches.
 */
export const MAX_PLAN_BEATS = 15;

/** A single beat is a line, not a chapter. */
export const MAX_BEAT_LENGTH = 200;

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
  /** Primary first; the rest are creator-visible secondary genre tags. */
  genres: PrimaryGenre[];
  storyMode: StoryMode;
  audienceMode: AudienceMode;
  identityLenses: IdentityLens[];
  spiceLevel: SpiceLevel;
  seed: string;
  characters: CharacterInput[];
  requestId: string;
  language?: string;
  /** World and era, inferred from the idea and editable as a chip. */
  whereAndWhen?: string;
  /** Beats the user pinned. One entry is one schedulable beat. */
  moments: string[];
  /**
   * The ordered chapter plan. Beat N briefs chapter N; the remainder is
   * forward context. Empty means no plan was made and the model paces itself,
   * which is how every story generated before the blueprint existed behaves.
   */
  beats: string[];
  /** Kids mode only: what the story teaches. */
  storyValues: string[];
  /** Free text, sanitised: craft direction, never an author to imitate. */
  writingStyle?: string;
  /** Free text: a topic to keep out. */
  avoid?: string;
  chapterLength: ChapterLength;
  plannedChapterCount: PlannedChapterCount;
  /** Whether chapters 2..N get art. Chapter 1's is compulsory regardless. */
  illustrateChapters: boolean;
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

/**
 * The chapter length contract, in one place.
 *
 * The prompt states this band and the provider chain enforces it. Before both
 * read from here the band lived only in prose inside the prompt, nothing checked
 * the result, and a model that ignored the ceiling reached the database: a
 * `gpt-5-mini` chapter came back at 2,026 words against a 500-1500 band and was
 * persisted and charged for. Over-length chapters distort reading-time
 * estimates, narration cost, and the reader UI.
 *
 * The selected chapter length controls every generated chapter. Audience mode
 * changes safety and voice, not the amount of prose a creator selected.
 */
export interface WordBand {
  min: number;
  max: number;
}

export function wordBandFor(
  storyMode: StoryMode,
  audienceMode: AudienceMode,
  chapterLength: ChapterLength = DEFAULT_CHAPTER_LENGTH,
): WordBand {
  void storyMode;
  void audienceMode;
  switch (chapterLength) {
    case "short":
      return { min: 600, max: 900 };
    case "long":
      return { min: 2000, max: 2600 };
    default:
      return { min: 1200, max: 1600 };
  }
}

/**
 * How far past the stated band a generation may drift before it is rejected.
 *
 * The band is a writing instruction, not a hard contract a model can hit
 * exactly, so enforcing it literally would throw away good stories. These
 * bounds catch runaway generation only - the observed 2,026-word failure
 * against a 1,500 ceiling sits well outside 1.25x, while the natural spread
 * seen in production (846-1,353 words on a 500-1,500 band, 905-945 on a
 * 600-900 band) sits comfortably inside.
 */
export const WORD_BAND_FLOOR_TOLERANCE = 0.75;
export const WORD_BAND_CEILING_TOLERANCE = 1.25;

export function wordBandBounds(band: WordBand): WordBand {
  return {
    min: Math.floor(band.min * WORD_BAND_FLOOR_TOLERANCE),
    max: Math.ceil(band.max * WORD_BAND_CEILING_TOLERANCE),
  };
}

/** Counted the way every persistence path counts it. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
