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
  /**
   * The story's cast as persisted in `characters` (name + the brief's
   * detail). Optional because seed stories and older library rows carry no
   * roster; the Reimagine sheet degrades to "no named characters found"
   * rather than guessing names out of the prose.
   */
  characters?: StoryCharacter[];
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
   * The story this one is a private copy OF.
   *
   * Set on the fork `reimagine-chapter` makes for a reader who does not own
   * the story they rewrote (`stories.forked_from_story_id`). Absent on every
   * original. The reader is moved onto the copy when it appears, and this is
   * how the app recognises which story the copy replaced.
   */
  forkedFromStoryId?: string;
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
  /**
   * Whether the story is readable by everyone. Mirrors `stories.is_public`.
   *
   * Optional because the list queries that hydrate a `Story` do not all select
   * it yet; absent reads as "not known", and nothing that renders a "Public"
   * marker may do so on an absent value.
   */
  isPublic?: boolean;
  focalX?: number; // 0-1, default 0.5
  focalY?: number; // 0-1, default 0.5
  /**
   * Whether anyone else can read this.
   *
   * Set by the "Make it public" toggle in the brief and applied once chapter
   * one exists; there is no separate publish step any more. Absent means
   * private, which is what the `stories.is_public` column defaults to.
   */
  visibility?: "private" | "public";
};

/** Mirrors the `stories_cover_status_check` constraint (migration 00029). */
export type CoverStatus = "pending" | "generating" | "ready" | "failed";

/** One member of a story's persisted cast. */
export type StoryCharacter = {
  id?: string;
  name: string;
  /** Role, age, who they are - the brief's `description`. */
  role?: string;
  background?: string;
  appearance?: string;
  portraitUrl?: string;
  isHero?: boolean;
};

/**
 * A character in the user's reusable library (`saved_characters`, migration
 * 00057). Owned by the user, not by any one story: the same person can be
 * dropped into a new brief with one tap, or swapped into someone else's
 * chapter through Reimagine.
 */
export type SavedCharacter = {
  id: string;
  name: string;
  /** Role, age, who they are. Maps to the brief's `description`. */
  role?: string;
  background?: string;
  appearance?: string;
  portraitUrl?: string;
  /** The story this character was first written for, when known. */
  sourceStoryId?: string;
  createdAt: string;
};

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
    /**
     * A photo the writer attached to steer this character's look, as a `data:`
     * URL. Never persisted with the story and never sent to story generation:
     * it exists only long enough to condition the portrait image.
     *
     * It is a STYLE reference, not a likeness target. The backend states that
     * to the model explicitly (`STYLE_REFERENCE_CLAUSE` in `_shared/image.ts`),
     * the base Safety Rules forbid real people, and a real person's name typed
     * into a cast is reclassified `private_individual` and locks the story
     * private (migration 00050). Three layers, because prompt text alone is
     * the weakest of them.
     */
    referenceImage?: string;
    /**
     * The `user_characters` row this character came from, when the writer
     * picked them out of their saved-character library instead of writing a
     * new one (migration 00057).
     *
     * The client still sends every field, because the writer may edit them for
     * this story and a story's cast is its own. The id is what lets the server
     * fill in a field the sheet left blank, carry over a portrait that was
     * paid for once, and link the story's `characters` row back to the saved
     * one. An id the caller does not own is dropped server-side rather than
     * failing the generation - see `_shared/saved-characters.ts`.
     *
     * On the client it also identifies the row exactly, so tapping the same
     * saved-character chip a second time removes the one it added.
     */
    savedCharacterId?: string;
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
  /**
   * The full-screen narration player (`ListenScreen`). Reached from the reader's
   * Listen control and from the story page's Listen button; both hand it the
   * chapter to open on and where to go back to.
   */
  | {
    name: "listen";
    storyId: string;
    chapterIndex?: number;
    /** Which screen Close returns to, so Listen never strands the reader. */
    returnTo: "story" | "reader" | "tabs";
  }
  | { name: "author"; authorId: string }
  | { name: "credits" }
  | { name: "paywall" }
  | { name: "practice" };
