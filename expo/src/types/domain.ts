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
/**
 * New drafts may be created in these languages. Existing stories keep theirs.
 *
 * PORTUGUESE IS GONE from the offer. It was in every language picker in the
 * app -- the create brief, the add-phrases sheet -- and nothing behind it was
 * ever built for it: no narration voice, no phrase corpus, none of the prose
 * rules tuned for it. Offering a language the product cannot actually write
 * or speak is a promise broken at the moment somebody takes it up.
 *
 * The TYPE deliberately still admits it, and `normalizeCreationLanguage` still
 * recognises it, because stories and saved phrases already carry it and those
 * rows must keep resolving. It simply cannot be chosen any more.
 */
export type CreationLanguage = "English" | "Portuguese";
export const CREATION_LANGUAGES: readonly CreationLanguage[] = [
  "English",
];
export function normalizeCreationLanguage(value: unknown): CreationLanguage {
  return value === "Portuguese" ? "Portuguese" : "English";
}
export type StoryMode = "standalone" | "series";

/**
 * The story lengths the picker OFFERS.
 *
 * One chapter is a series of one, deliberately, and not the standalone path:
 * a series that has reached its plan can be extended a chapter at a time from
 * the end of the reader, and a standalone cannot. Offering 1 here and routing
 * it to `isSeries: true` is what makes a one-chapter story a story that can
 * grow rather than a story that is over.
 */
export const PLANNED_CHAPTER_COUNT_OFFER = [1, 3, 7, 15] as const;

export type PlannedChapterCountOffer =
  typeof PLANNED_CHAPTER_COUNT_OFFER[number];

/** The ceiling on a stored plan, matching the SQL check added in 00079. */
export const MAX_PLANNED_CHAPTER_COUNT = 15;
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

/**
 * Who picked the direction a chapter was written from
 * (`chapters.direction_chosen_by`, migration 00078).
 *
 * `reader` is a person: a chip tapped or a direction typed. `model` is the
 * direction model choosing in auto mode. `ranking` is auto mode where that
 * choosing call was not made or failed, so the highest-ranked option was
 * taken. The last two stay distinct on purpose -- collapsing them would let a
 * surfaced chip claim a decision that was really a fallback.
 *
 * Absent means nothing was recorded: either no direction was derivable, or the
 * chapter predates the column. Neither is a licence to guess.
 */
export type DirectionChooser = "reader" | "model" | "ranking";

/** One direction that was on the table when a chapter was written. */
export type OfferedDirection = {
  id: string;
  prompt: string;
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
  /**
   * This chapter's own illustration, when the writer asked for illustrated
   * chapters (`stories.illustrate_chapters`, 1 extra credit per chapter --
   * `source-of-truth/CREDITS_AND_PRICING.md` §1).
   *
   * Chapter 1's is the story's cover and is also `story.coverImageUrl`; every
   * later chapter has only this. It is drawn on a background task minutes
   * after the chapter is readable, so it is absent on the chapter the author
   * has just watched being written and present when a reader opens it later.
   * A chapter whose art failed keeps this undefined for good and reads
   * perfectly well without it.
   */
  imageUrl?: string;
  audioUrl?: string;
  audioUrls?: { female?: string; male?: string };
  /**
   * The directions that were on the table when THIS chapter was written, in
   * offer order (`chapters.directions_offered`).
   *
   * They belong to the boundary this chapter came out of -- the end of the
   * chapter before it -- which is where the reader is shown them.
   *
   * Absent for every chapter written before migration 00078, and that absence
   * is rendered as nothing at all rather than an empty state: "no directions
   * were offered" and "nobody recorded what was offered" are different facts,
   * and only the second one is true of those chapters.
   */
  directionsOffered?: OfferedDirection[];
  /**
   * The direction this chapter was actually written from
   * (`chapters.direction_chosen`).
   *
   * Usually one of `directionsOffered`, but not always: a reader who typed
   * their own direction chose something that was never on a card.
   */
  directionChosen?: string;
  /** Who decided. See `DirectionChooser` -- never inferred, only read. */
  directionChosenBy?: DirectionChooser;
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
  /**
   * Who picks the direction between chapters, read from the story row.
   *
   * Absent means `interactive`, which is what every story written before the
   * Story mode picker existed was. The reader consults this at a chapter end;
   * it is on the STORY rather than the request that made it because the
   * chapter end is a different session from the brief, often a different day.
   */
  storyFlow?: StoryFlow;
  /**
   * The last chapter an auto story has ALREADY PAID FOR, or absent.
   *
   * Auto mode pre-buys: when chapter one lands, `reserve_auto_chapter_run`
   * reserves every remaining planned chapter the balance can afford, in one
   * transaction, and records the last of them on the row. The write-ahead then
   * runs to this number and stops -- it consults this rather than the live
   * balance, because the balance says what the writer can spend NEXT and this
   * says what they have already spent.
   *
   * ABSENT IS NOT ZERO, and the difference decides what happens to every story
   * written before runs existed. Absent means no run was ever reserved, and
   * the write-ahead falls back to the old per-chapter balance check so those
   * stories keep continuing. A run that bought nothing is present and equal to
   * the chapter before it began, which correctly stops the chain.
   */
  autoRunThroughChapter?: number;
  /**
   * How many chapters this story is planned to run: 1..15, or absent.
   *
   * NOT the four values the picker offers. A reader who extends a finished
   * story raises the stored plan by exactly one chapter, so 2, 4, 5 and every
   * other number in range are real rows. Typing this as the offer union made
   * all of them unrepresentable, and the parser below then dropped them --
   * which read to the app as "no plan" and to the reader as a 4-chapter story
   * that thought it was planned for 3.
   */
  plannedChapterCount?: number;
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
   * Whether every chapter of this story gets its own illustration.
   *
   * The brief's *Chapter cover* pick, off `stories.illustrate_chapters`. The
   * reader needs it, not just the generator: chapter art lands on a background
   * task, so a chapter opened before its picture exists must already be
   * holding the space the picture will take. Reserving it only once
   * `chapter.imageUrl` arrives is what reflows page one under a reader who is
   * mid-sentence.
   */
  illustrateChapters?: boolean;
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
  background?: string;
  /**
   * Who they are and what they look like — the Craft sheet's one field.
   *
   * This used to be two: a `role` (the brief called it Description) beside an
   * `appearance`, which meant the same person was typed twice and each half
   * reached a different prompt. For a story written before that merge the
   * server resolves the retired column into this one, so a cast loaded here
   * is never half-empty.
   */
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
  background?: string;
  /**
   * Who they are and what they look like. One field, as in Craft.
   *
   * A character saved before the merge has its text in `user_characters`'
   * retired `description` column; `fromRow` resolves that into this field on
   * read, so the library never shows a saved person as a bare name.
   */
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

/**
 * The look every image in a story is drawn in — its cover, its chapter art and
 * its portraits.
 *
 * `auto` is the default and is NOT a style: it means "the genre decides", which
 * is what every cover did before this control existed (`GENRE_PROMPTS` in
 * `backend/supabase/functions/_shared/cover-prompts.ts` carries a style per
 * genre). Naming it explicitly is what lets a writer go back to it after
 * picking one, rather than the absence of a choice being unreachable once a
 * choice is made.
 *
 * The values are the wire values: they travel as `image_style` in lower case
 * and are read by the backend's own prompt assembly.
 */
export const IMAGE_STYLES = [
  "auto",
  "anime",
  "cinematic",
  "comic",
  "watercolor",
] as const;
export type ImageStyle = typeof IMAGE_STYLES[number];

/**
 * Who picks the direction between chapters.
 *
 * `interactive` is what the app has always done: the chapter ends, the reader
 * is offered direction chips, and nothing is written until one is chosen.
 * `auto` is the same flow with the choice made for them — the model takes the
 * direction it would have suggested and keeps going. It is a decision about
 * WHO CHOOSES, not about what is written, which is why it is one field rather
 * than a separate generation mode.
 */
export type StoryFlow = "interactive" | "auto";

export type CreateDraft = {
  /**
   * The story's title, when somebody chose one. Absent means "name it for me",
   * which is what the Create flow always asks for today -- it has no title
   * input. The field exists for callers that do title a story before it is
   * written (the house library does), because without it the server named
   * every story itself and a chosen title was silently replaced.
   *
   * When sent, the server keeps it over any name the model produces
   * (`validation.ts` bounds it at 120 characters).
   */
  title?: string;
  primaryGenre: Genre;
  /** Primary first. Extra values are editable secondary shelf tags. */
  genres?: Genre[];
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  seed: string;
  language: CreationLanguage;
  /**
   * The brief's "Make it public" toggle. Sent with the generation request and
   * applied by the server the moment chapter one is persisted; absent means
   * private. (The old doc here said "never during generation", from when a
   * separate review step published; that step is gone.)
   */
  visibility?: "private" | "public";
  characters: {
    name: string;
    /** Voice and motivation. Reaches the story prompt only. */
    background?: string;
    /**
     * Who they are and what they look like. Reaches the story prompt, the
     * cover prompt and the portrait image.
     *
     * The sheet used to ask for this twice — a Description for the role and an
     * Appearance for the look — and every prompt downstream then had to pick
     * one or awkwardly join both. It is one field now. Nothing on the client
     * writes `description` any more; the server still reads the retired column
     * so a story written before the change keeps its cast.
     */
    appearance: string;
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
     * and the base Safety Rules forbid real people. More than one layer,
     * because prompt text alone is the weakest of them. (A real name in the
     * cast used to lock the story private too; that gate was removed on
     * 2026-09-18, migration 00091.)
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
  /** What the writer picked in the brief. The picker offers only these four. */
  plannedChapterCount?: PlannedChapterCountOffer;
  illustrateChapters?: boolean;
  /** The look every image in this story is drawn in. Absent means `auto`. */
  imageStyle?: ImageStyle;
  /** Who picks the direction between chapters. Absent means `interactive`. */
  storyFlow?: StoryFlow;
};

/**
 * Why somebody says they are here, asked on the third onboarding screen.
 *
 * All three go through the same character flow now; only the copy branches.
 * Declared here rather than imported from `CharacterOnboarding.tsx` because
 * `Screen` below carries it, and a domain type that imports a screen is how a
 * types file ends up pulling React Native into everything that reads it.
 */
export type OnboardingPurpose = "read" | "write" | "both";

/**
 * What the shared questionnaire collected, handed to the character flow so it
 * can greet the person by name and seed its suggestion chips.
 */
export type CharacterEntryContext = {
  name: string;
  genreInterests: string[];
  otherGenre?: string;
  refine?: string;
  /**
   * The reader's "what are you in the mood for", as a `MOODS` key. Session
   * state only: the question says "tonight", so Home reads it for the
   * Tonight rail and it is not persisted. Absent on the other paths.
   */
  mood?: string;
  moment?: string;
};

export type Screen =
  | { name: "tabs" }
  | { name: "intro" }
  /**
   * Sign-in. `required` marks the one entry that has no way out: the screen
   * reached after signing out or deleting the account, where there is no
   * session to go back to. Every other entry is a reader who chose to sign in
   * and may change their mind, so it keeps its back arrow.
   */
  | { name: "onboarding"; required?: boolean }
  /**
   * The character flow: bridge, who, wait, reveal, plan, email, code, paywall,
   * notify, welcome. It replaced `writer-onboarding` on 2026-09-11, and it is
   * where every purpose goes, not just writers.
   */
  | {
    name: "character-onboarding";
    purpose: OnboardingPurpose;
    initialGenre?: Genre;
    entryContext?: CharacterEntryContext;
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
  /**
   * "Your journey" — the reader's own streak, activity calendar and
   * milestones. A page rather than a section of the profile because the
   * calendar and the milestone list both need room, and a two-line summary of
   * them on the profile would be a second, worse version of the same thing.
   */
  | { name: "journey" }
  /** The narration voice picker, reached from the profile. */
  | { name: "voices" }
  | { name: "credits" }
  | { name: "paywall" }
  | { name: "practice" };
