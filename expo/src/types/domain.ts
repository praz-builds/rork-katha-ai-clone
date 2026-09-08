/**
 * Every genre value a story can carry, past and present.
 *
 * A genre removed from the UI (see `UI_GENRES`) stays in this list forever,
 * because stories already published with it must keep rendering - a label,
 * a gradient, and a valid `Genre` value, even after nobody can pick it again.
 */
export const GENRES = [
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
  "educational",
  "fanfiction",
  "folktale",
  "sliceOfLife",
] as const;

export type Genre = (typeof GENRES)[number];

/**
 * The genre list the UI actually offers, in the app's fixed display order.
 * Romance is deliberately last. Every picker, filter, and chip row should
 * read from this - not from `GENRES`, which exists only to keep every past
 * and present genre value typed and labeled even after it drops out of here.
 */
export const UI_GENRES = [
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
] as const satisfies readonly Genre[];

/**
 * The genres offered in kids mode, named one by one.
 *
 * An ALLOWLIST, deliberately, and it is the one place in this file where that
 * is the right shape. Everywhere else a blocklist is safer, because a genre
 * added later should appear rather than silently go missing.
 *
 * Kids mode inverts that. Here the failure of forgetting is not a genre quietly
 * absent from a picker, it is a genre inappropriate for a child quietly
 * PRESENT in one. A missing genre is a papercut someone reports; an unsuitable
 * one shipped to a child is not. So a new genre stays out of kids mode until
 * somebody adds it here on purpose, and the test below fails the moment
 * `UI_GENRES` grows without that decision being made.
 */
const KIDS_ALLOWED_GENRES: ReadonlySet<Genre> = new Set([
  "adventure",
  "comedy",
  "educational",
  "fanfiction",
  "folktale",
  "historical",
  "scifi",
  "fantasy",
  "mystery",
  "sliceOfLife",
]);

/** Whether `genre` is offered in kids mode. See `KIDS_ALLOWED_GENRES`. */
export function isKidsGenre(genre: Genre): boolean {
  return KIDS_ALLOWED_GENRES.has(genre);
}

/** The kids-mode subset of `UI_GENRES`, in the same fixed display order. */
export const KIDS_UI_GENRES: readonly Genre[] = UI_GENRES.filter(isKidsGenre);

export type AudienceMode = "adult" | "kids";
export type SpiceLevel = "sweet" | "steamy";
export type IdentityLens = "queer";
/** New drafts may be created in these languages. Existing stories keep theirs. */
export type CreationLanguage = "English" | "Portuguese";
export const CREATION_LANGUAGES: readonly CreationLanguage[] = [
  "English",
  "Portuguese",
];
export function normalizeCreationLanguage(value: unknown): CreationLanguage {
  return value === "Portuguese" ? "Portuguese" : "English";
}
export type StoryMode = "standalone" | "series";
export type ChapterRole =
  | "standalone"
  | "series_opening"
  | "mid_series"
  | "finale";
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
/**
 * The tab bar. `home` is editorial (curated rows, no filters), `explore` is
 * browse (search, genre strip, filters, one long list). They are deliberately
 * two tabs: folding browse into home is what left a single screen carrying a
 * search field, a chip row, rails AND a vertical list at once, with no way to
 * tell a reader which of those was the point of the screen.
 */
export type TabKey = "home" | "explore" | "create" | "library" | "profile";

export type Author = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  followers: number;
  followingCount: number;
  storyCount: number;
  isVerified: boolean;
  avatarPaletteIndex: number;
};

export type Chapter = {
  id: string;
  storyId: string;
  title: string;
  paragraphs: string[];
  chapterNumber: number;
  chapterRole?: ChapterRole;
  firstLine?: string;
  previouslySummary?: string;
  hookType?: HookType;
  hookText?: string;
  isPublished: boolean;
  audioUrl?: string;
  audioUrls?: { female?: string; male?: string };
};

export type SeriesState = {
  central_conflict: string;
  protagonist_want: string;
  relationship_state: string;
  open_hooks: string[];
  resolved_hooks: string[];
  promised_payoffs: string[];
  world_facts: string[];
  character_changes: string[];
  next_chapter_pressure: string;
};

export type Story = {
  id: string;
  title: string;
  authorId: string;
  genre: Genre;
  primaryGenre?: Genre;
  storyMode?: StoryMode;
  plannedChapterCount?: 3 | 7 | 15;
  chapterLength?: "short" | "standard" | "long";
  /**
   * The approved chapter plan. Beat N briefs chapter N, so beat `n + 1` is
   * what the next chapter's "What happens next?" box pre-fills with.
   */
  beats?: string[];
  seriesState?: SeriesState;
  audienceMode?: AudienceMode;
  spiceLevel?: SpiceLevel;
  contentRating?: string;
  synopsis: string;
  chapters: Chapter[];
  likes: number;
  bookmarks: number;
  views: number;
  tags: string[];
  publishedOffset: number;
  isFeatured: boolean;
  language: string;
  coverImage?: ImageName;
  /**
   * The generated cover, once there is one.
   *
   * Distinct from `coverImage`, which names a bundled asset and only ever
   * belongs to a seed story. §10.4 makes chapter 1's art the cover, so this is
   * populated tens of seconds after chapter 1 exists - not at publish - and is
   * absent for every draft younger than that.
   */
  coverImageUrl?: string;
  /**
   * What THIS viewer has already done to this story.
   *
   * The engagement endpoints return these alongside the story so a screen can
   * render the correct initial state. Optional because the endpoints that
   * supply them are not deployed everywhere yet; absent means "not engaged",
   * which is the safe reading. Without them every control started at `false`,
   * so a reader who had already liked a story was shown an unfilled heart and
   * their next tap removed the like they could not see.
   */
  viewerHasLiked?: boolean;
  viewerHasBookmarked?: boolean;
  viewerFollowsAuthor?: boolean;
  /**
   * Which of "not attempted", "in flight", "ready" and "failed" the cover is.
   *
   * A null `coverImageUrl` means all four of those things, and the UI owes the
   * writer a different answer for each: a spinner for work that is happening,
   * the concept card for work that never will. Mirrors `stories.cover_status`.
   */
  coverStatus?: CoverStatus;
  /**
   * Delivered regenerations. 0 means the next one is the free retry.
   *
   * Carried so the Regenerate control can state its own price honestly rather
   * than discovering it in a 402.
   */
  coverRegenCount?: number;
  focalX?: number; // 0-1, default 0.5
  focalY?: number; // 0-1, default 0.5
};

/** Mirrors the `stories_cover_status_check` constraint (migration 00029). */
export type CoverStatus = "pending" | "generating" | "ready" | "failed";

export type ImageName =
  | "camp-midnight.jpg"
  | "door-above-the-clouds.jpg"
  | "gallery-shadow.jpg"
  | "garden-of-little-dragons.jpg"
  | "girl-beneath-the-sea.jpg"
  | "library-under-rain.jpg"
  | "maharanis-last-cipher.jpg"
  | "midnight-chai-case-files.jpg"
  | "mockingbird-sky.jpg"
  | "moonlit-train-platform.jpg"
  | "neon-jinn-sector-nine.jpg"
  | "old-sea-boat.jpg"
  | "ravenwick-owl-window.jpg"
  | "rooftop-student.jpg"
  | "saturn-beach-dog.jpg"
  | "wolf-on-campus.jpg"
  | "vanilla-problem-lisbon.jpg"
  | "decimal-point-hardware.jpg"
  | "cien-luces-farolero.jpg";

export type CreditLedgerEntry = {
  id: string;
  amount: number;
  reason:
    | "welcome"
    | "generation"
    | "ad_reward"
    | "feedback"
    | "purchase"
    | "subscription"
    | "reader_earning";
  balanceAfter: number;
  createdAt: string;
  label: string;
};

export type CreateDraft = {
  primaryGenre: Genre;
  /** Primary first. Extra values are editable secondary shelf tags. */
  genres?: Genre[];
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  seed: string;
  language: CreationLanguage;
  /** Applied when the reviewed draft is saved or published, never during generation. */
  visibility?: "private" | "public";
  characters: {
    name: string;
    description: string;
    /** Voice and motivation. Reaches the story prompt only. */
    background?: string;
    /** Physical detail. Reaches the story prompt and the portrait image. */
    appearance?: string;
    /** Draft portrait generated before the story call, when available. */
    portraitUrl?: string;
    /** UI state for the separate character-image call. */
    portraitStatus?: "idle" | "generating" | "ready" | "failed";
    isHero: boolean;
  }[];
  isSeries?: boolean;
  /** World and era — feeds the story prompt and the cover prompt. */
  whereAndWhen?: string;
  /** Beats to hit. Clamped server-side to five. */
  moments?: string[];
  /**
   * The ordered chapter plan shown on the blueprint screen, one line per
   * chapter. Unlike `moments`, which the model schedules wherever the pacing
   * allows, beat N is the brief for chapter N. Clamped server-side to the
   * planned chapter count.
   */
  beats?: string[];
  /**
   * Fact cards and the entity classification behind them, resolved by the free
   * shaping call and carried through to generation untouched. Opaque on the
   * client by design - see the note on `StoryShape` in `lib/api.ts`.
   */
  grounding?: unknown[];
  groundingEntities?: unknown[];
  /** Kids mode only: values explored through the story, never as a lesson. */
  storyValues?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: "short" | "standard" | "long";
  plannedChapterCount?: 3 | 7 | 15;
  illustrateChapters?: boolean;
};

export type WriterEntryContext = {
  name?: string;
  genreInterests?: string[];
  otherGenre?: string;
  format?: string;
  blocker?: string;
};

export type Screen =
  | { name: "tabs" }
  | { name: "intro" }
  | { name: "onboarding" }
  | {
    name: "writer-onboarding";
    initialGenre?: Genre;
    entryContext?: WriterEntryContext;
  }
  /**
   * The story landing page. Series only - see `openStory` in App.tsx for why a
   * standalone skips it.
   */
  | { name: "story"; storyId: string }
  | {
    name: "reader";
    storyId: string;
    chapterIndex?: number;
    /** Set when the reader was opened by Listen, so narration starts on arrival. */
    autoplay?: boolean;
  }
  | { name: "author"; authorId: string }
  | { name: "credits" }
  | { name: "paywall" }
  | { name: "practice" };
