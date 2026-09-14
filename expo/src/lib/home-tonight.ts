import type { Genre, Story } from "@/types/domain";

/**
 * The Tonight rail: what Home does with the reader's mood.
 *
 * Onboarding asks a reader "what are you in the mood for?" and says, under the
 * question, "Tonight only. It sets the story, and who you'll be in it." That
 * sentence is a promise that the answer goes somewhere, and this is where. The
 * rail sits at the top of the reader's first shelf, above the house picks,
 * because the reader has just said what they want and the shelf that answers
 * it first is the honest one.
 *
 * SESSION ONLY. The answer is not persisted, so the rail is gone after a
 * restart. That is what "tonight" means; a mood pinned to the account for a
 * month would be the opposite of the question.
 *
 * The keys are `MOODS` in `screens/KathaOnboardingFlowV2.tsx`. Two of them do
 * not map to genres: `quick` is a length, so it picks standalones, and
 * `surprise` says "Katha picks based on your genres", so it does exactly that.
 */

export type Mood =
  | "escape"
  | "guessing"
  | "emotional"
  | "quick"
  | "comforting"
  | "surprise";

const MOOD_LABELS: Record<Mood, string> = {
  escape: "Something to escape into",
  guessing: "Something that keeps me guessing",
  emotional: "Something emotional",
  quick: "Something quick",
  comforting: "Something comforting",
  surprise: "Surprise me",
};

/**
 * Which shelves answer which mood. Ordered: the first genre is the one the
 * mood's own copy names ("Mystery, tension, twists" leads with mystery).
 */
const MOOD_GENRES: Record<
  Exclude<Mood, "quick" | "surprise">,
  readonly Genre[]
> = {
  escape: ["fantasy", "adventure", "scifi", "romantasy"],
  guessing: ["mystery", "thriller", "horror"],
  emotional: ["romance", "contemporary", "darkRomance"],
  comforting: ["sliceOfLife", "folktale", "comedy"],
};

export function isMood(value: string | null | undefined): value is Mood {
  return typeof value === "string" && value in MOOD_LABELS;
}

/** The rail's eyebrow: the mood in the reader's own words. */
export function tonightTitle(mood: Mood): string {
  return `Tonight · ${MOOD_LABELS[mood]}`;
}

/**
 * A standalone, or a story with nothing after chapter one, is "quick": it
 * ends when it ends. A series is a commitment, whatever its first chapter's
 * length.
 */
function isQuick(story: Story): boolean {
  if (story.storyMode === "standalone") return true;
  if (story.storyMode === "series") return false;
  return (story.plannedChapterCount ?? story.chapters.length) <= 1;
}

/**
 * The stories for tonight, most read first, at most `limit`.
 *
 * Empty when nothing matches, and the caller draws no row for an empty list:
 * a "Tonight" shelf with nothing on it says the mood was heard and ignored.
 */
export function tonightStories(
  stories: readonly Story[],
  mood: Mood,
  preferredGenres: readonly Genre[],
  limit: number,
): Story[] {
  let picks: Story[];
  if (mood === "quick") {
    picks = stories.filter(isQuick);
  } else {
    const genres = new Set<Genre>(
      mood === "surprise" ? preferredGenres : MOOD_GENRES[mood],
    );
    picks = stories.filter((story) => genres.has(story.genre));
  }
  return [...picks].sort((a, b) => b.views - a.views).slice(0, limit);
}
