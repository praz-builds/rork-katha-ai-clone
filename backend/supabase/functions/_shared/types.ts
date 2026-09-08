/**
 * Shared types and constants for the v7 story taxonomy.
 *
 * 19 primary genres (12 in UI, 7 DB-only), audience modes,
 * identity lenses and spice levels.
 */
import type { EntityMention, GroundingCard } from "./grounding-types.ts";

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
  | "poetry"
  | "educational"
  | "fanfiction"
  | "folktale"
  | "sliceOfLife";

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
  "educational",
  "fanfiction",
  "folktale",
  "sliceOfLife",
]);

/**
 * 12 genres shown in the UI, per the v7 product decision (2026-09-08).
 *
 * `romantasy`, `darkRomance`, `paranormalRomance`, `cozyFantasy`, `poetry`,
 * `thriller` and `contemporary` are removed from the creation surface but stay
 * valid `PrimaryGenre` members: existing stories carry these values, and a
 * removed genre must keep reading, continuing and rendering forever. Only
 * `normalizeGenre` in `validation.ts` treats them differently now, mapping a
 * NEW submission down to the surviving genre in `GENRE_MIGRATION_MAP` below.
 * A stored story keeps its own value and its own genre voice module.
 */
export const UI_GENRES: ReadonlySet<string> = new Set<PrimaryGenre>([
  "romance",
  "fantasy",
  "scifi",
  "mystery",
  "horror",
  "historical",
  "adventure",
  "comedy",
  "educational",
  "fanfiction",
  "folktale",
  "sliceOfLife",
]);

/**
 * The 12 UI genres in the product owner's exact display order (2026-09-08).
 *
 * `UI_GENRES` is a membership set; this is the ordering contract for whatever
 * surface renders the creation shelf. Romance is deliberately last — it is the
 * highest-volume genre, and the product decision is to lead with breadth
 * (Adventure, Comedy) rather than the obvious choice.
 */
export const UI_GENRE_ORDER: readonly PrimaryGenre[] = [
  "adventure",
  "comedy",
  "educational",
  "fanfiction",
  "folktale",
  "historical",
  "scifi",
  "fantasy",
  "mystery",
  "horror",
  "sliceOfLife",
  "romance",
];

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

/**
 * The heat tiers a story can be generated at.
 *
 * `explicit` was retired on 2026-09-07 by product decision: depicted sex acts
 * and crude anatomical vocabulary are out of the product entirely, at every
 * tier. It was never reachable — no entry in `GENRE_ALLOWED_SPICE` ever
 * contained it and validation refused it outright — so removing it from the
 * union costs no shipped behaviour. What replaces it is not silence: the two
 * remaining tiers carry craft direction for writing intimacy well (see
 * `buildSpiceRules` in story-prompts.ts), because a prohibition on its own
 * produces timid, flat romance, which is the worse product.
 */
export type SpiceLevel = "sweet" | "steamy";

export const SPICE_LEVELS: ReadonlySet<string> = new Set<SpiceLevel>([
  "sweet",
  "steamy",
]);

/**
 * Heat tiers that exist in stored rows but can never be generated again.
 *
 * `stories.spice_level` and `stories.content_rating` are `text` columns whose
 * CHECK constraints (migrations 00008 and 00014) still admit `'explicit'`, and
 * the feed and library queries still filter on `content_rating <> 'explicit'`.
 * Narrowing those constraints would be a destructive migration against rows
 * nobody has audited, and would break the one query that depends on the value
 * surviving. So the retirement is enforced in code on the write path, and every
 * read path maps the legacy value forward instead of rejecting it — a stored
 * `explicit` row must still open, continue and render.
 */
export type LegacySpiceLevel = "explicit";

/** What a row can hold: a live tier, or a retired one written before 2026-09-07. */
export type StoredSpiceLevel = SpiceLevel | LegacySpiceLevel;

/**
 * Where a retired tier lands when it is read back or replayed.
 *
 * Down, never up, and never an error. A client holding a stale build, a
 * retried request body or a `continue-story` call on a legacy row all arrive
 * here, and 400-ing any of them would orphan stories their authors can still
 * see. `steamy` is the nearest surviving tier; the crude-language floor in the
 * prompt layer binds it regardless.
 */
export const RETIRED_SPICE_LEVELS: Readonly<Record<string, SpiceLevel>> = {
  explicit: "steamy",
};

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
  educational: "sweet",
  fanfiction: "sweet",
  // Oral-tradition register, same low-heat default as the poetry slot it
  // replaces for new submissions (GENRE_MIGRATION_MAP.poetry).
  folktale: "sweet",
  // Inherits contemporary's old profile: it absorbed the Slice of Life
  // register before this genre existed on its own (see
  // source-of-truth/STORY_PROMPT_SYSTEM.md).
  sliceOfLife: "sweet",
};

/**
 * The clamp is downward only (see `validateGenerationRequest`), so this table
 * is the last gate a heat tier passes through before it reaches a prompt. Every
 * entry must be a subset of `SPICE_LEVELS`; a retired tier listed here would
 * resurrect itself for that genre. Pinned by a test rather than by types,
 * because the values are plain strings.
 */
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
  educational: new Set(["sweet", "steamy"]),
  fanfiction: new Set(["sweet", "steamy"]),
  // Sweet-only, same register as comedy/cozyFantasy/poetry: an on-page heat
  // scene breaks the family-oral-tradition register a folktale promises.
  folktale: new Set(["sweet"]),
  sliceOfLife: new Set(["sweet", "steamy"]),
};

// ---------------------------------------------------------------------------
// Genre migration map (old genre names -> new primary genre)
// ---------------------------------------------------------------------------

/**
 * Where a genre lands for a NEW submission.
 *
 * Two kinds of key share this table and neither is ever removed once added,
 * because a value dropped from here is a value a stale client, a retry or a
 * replayed request can no longer produce a story from:
 *
 * 1. Names that were never a `PrimaryGenre` (`drama`, `mythology`, `lgbtq`, ...).
 *    These predate the v7 taxonomy change and are unaffected by it.
 * 2. `PrimaryGenre` members removed from the UI in the v7 taxonomy change
 *    (2026-09-08): `romantasy`, `darkRomance`, `paranormalRomance`,
 *    `cozyFantasy`, `poetry`, `thriller`, `contemporary`. These stay valid
 *    `PrimaryGenre` values — a stored story keeps its own value forever, and
 *    `story-prompts.ts`'s own genre lookup resolves them directly, unmigrated,
 *    so an existing series keeps writing in its original genre's voice. Only a
 *    NEW submission (`validateGenerationRequest`) is redirected here, to the
 *    genre the product owner named as its replacement.
 *
 * `normalizeGenre` in `validation.ts` checks this map before treating a raw
 * value as an already-valid genre, so a removed `PrimaryGenre` migrates on a
 * new request rather than passing through unchanged. The lookup is one hop,
 * not chained: `drama` resolves straight to `contemporary`, not on again to
 * `contemporary`'s own replacement, `sliceOfLife`.
 *
 * `sliceOfLife` (and its lowercase alias) is deliberately NOT a key here any
 * more. It used to be an alias for `contemporary`; as of v7 it is a real,
 * independent `PrimaryGenre`, and redirecting it would make the new genre
 * unreachable.
 */
export const GENRE_MIGRATION_MAP: Record<string, PrimaryGenre> = {
  drama: "contemporary",
  darkAcademia: "contemporary",
  darkacademia: "contemporary",
  mythology: "fantasy",
  kids: "adventure",
  bedtime: "adventure",
  lgbtq: "contemporary",
  motivational: "contemporary",
  spirituality: "contemporary",
  // v7 taxonomy (2026-09-08): removed-from-UI genres normalise to their
  // documented replacement for new submissions.
  thriller: "mystery",
  contemporary: "sliceOfLife",
  poetry: "folktale",
  romantasy: "romance",
  darkRomance: "romance",
  paranormalRomance: "romance",
  cozyFantasy: "fantasy",
};

/**
 * `GENRE_MIGRATION_MAP`, re-keyed the way a caller might actually write a genre.
 *
 * The map is keyed in this codebase's camelCase (`darkRomance`), so a
 * lowercased, separator-stripped lookup against it missed every multi-word
 * retired genre: "dark romance" and "Dark Romance" both reduce to
 * `darkromance`, which the map does not contain. Building the index once,
 * here beside the map it derives from, keeps the map readable and gives every
 * caller that has to migrate a raw string the same total lookup -- there are
 * two of them (`validation.ts` for a request, `story-shape.ts` for a model
 * response) and they used to disagree.
 */
export const GENRE_MIGRATION_BY_NORMALIZED_KEY: Record<string, PrimaryGenre> =
  Object.fromEntries(
    Object.entries(GENRE_MIGRATION_MAP).map((
      [key, value],
    ) => [key.toLowerCase().replace(/[\s_-]/g, ""), value]),
  );

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
  portraitUrl?: string;
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
  /** Whether the author asked to be told when the story is finished. */
  notifyOnReady: boolean;
  /**
   * Validated fact cards for real entities the idea names. Empty is the common
   * case and means "written from model knowledge", not "grounding failed" -
   * the two are indistinguishable here on purpose, because they produce the
   * same prompt and the same story.
   */
  grounding: GroundingCard[];
  /** What the classifier saw. Recorded on the story; never used in a prompt. */
  groundingEntities: EntityMention[];
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
  /**
   * The promised moments that have already landed, across every chapter so far.
   *
   * A moment is unordered and the model schedules it wherever the pacing
   * allows, which is right for a standalone story and wrong for a series:
   * every chapter was handed all five with "each must happen somewhere", so the
   * model either repeated one it had already written or deferred all of them
   * into the finale. Recording what landed is what lets a later chapter be told
   * what it still owes. Entries are echoed verbatim from the supplied moments,
   * never invented, and the set only ever grows.
   */
  delivered_moments: string[];
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
  delivered_moments: [],
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
