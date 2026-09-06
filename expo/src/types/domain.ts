// 13 UI genres (cozyFantasy + paranormalRomance hidden, DB-only)
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
] as const;

export type Genre = (typeof GENRES)[number];

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
  focalX?: number; // 0-1, default 0.5
  focalY?: number; // 0-1, default 0.5
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
  /** Kids mode only: values explored through the story, never as a lesson. */
  storyValues?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: "short" | "standard" | "long";
  plannedChapterCount?: 3 | 7 | 15;
  illustrateChapters?: boolean;
};

export type Screen =
  | { name: "tabs" }
  | { name: "intro" }
  | { name: "onboarding" }
  | { name: "writer-onboarding" }
  /**
   * The story landing page. Series only - see `openStory` in App.tsx for why a
   * standalone skips it.
   */
  | { name: "story"; storyId: string }
  | { name: "reader"; storyId: string; chapterIndex?: number }
  | { name: "author"; authorId: string }
  | { name: "credits" }
  | { name: "paywall" };
