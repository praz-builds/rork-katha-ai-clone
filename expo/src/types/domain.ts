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
export type StoryMode = "standalone" | "series";
export type ChapterRole = "standalone" | "series_opening" | "mid_series" | "finale";
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

export type TabKey = "home" | "create" | "library";

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
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  tropeModules: TropeModule[];
  seed: string;
  language: string;
  characters: { name: string; description: string; isHero: boolean }[];
  isSeries?: boolean;
};

export type Screen =
  | { name: "tabs" }
  | { name: "intro" }
  | { name: "onboarding" }
  | { name: "reader"; storyId: string }
  | { name: "author"; authorId: string }
  | { name: "credits" }
  | { name: "paywall" }
  | { name: "profile" };
