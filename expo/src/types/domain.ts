export const GENRES = [
  "adventure",
  "comedy",
  "contemporary",
  "drama",
  "fantasy",
  "historical",
  "horror",
  "kids",
  "lgbtq",
  "motivational",
  "mystery",
  "mythology",
  "poetry",
  "romance",
  "scifi",
  "sliceOfLife",
  "spirituality",
  "thriller",
] as const;

export type Genre = (typeof GENRES)[number];

export type TabKey = "home" | "create" | "profile";

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
  isPublished: boolean;
  audioUrl?: string;
};

export type Story = {
  id: string;
  title: string;
  authorId: string;
  genre: Genre;
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
  | "wolf-on-campus.jpg";

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
  genre: Genre;
  seed: string;
  language: string;
  characters: { name: string; description: string; isHero: boolean }[];
};

export type Screen =
  | { name: "tabs" }
  | { name: "intro" }
  | { name: "onboarding" }
  | { name: "reader"; storyId: string }
  | { name: "author"; authorId: string }
  | { name: "credits" }
  | { name: "paywall" }
  | { name: "draftEditor"; storyId: string };
