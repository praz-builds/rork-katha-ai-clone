import type { Story } from "@/types/domain";
// Imported, not mirrored. These were local literals with a comment saying they
// mirrored `pricing-limits.ts` -- which is a duplicated price, and a duplicated
// price is one edit away from Home telling a writer a story costs three while
// the brief charges them something else.
import {
  CHAPTER_ART_CREDITS,
  CHAPTER_TEXT_CREDITS as CHAPTER_CREDITS,
  STORY_START_CREDITS,
} from "@/lib/pricing-limits";
import { formatCredits } from "@/lib/pricing";

/**
 * What the Home invitation should say, given what the reader is in the middle of.
 *
 * The card used to say "Write another story" to everyone, forever. It is the
 * only thing on Home that asks the reader to make something, and saying the
 * same sentence to someone who has a chapter being written right now, someone
 * with a half-finished series, and someone with no credits is three wasted
 * opportunities and one lie.
 *
 * FIVE STATES, STRICTLY ORDERED. First match wins. The order is the design:
 *
 *   1. `writing`  — a generation is in flight. This is the only state that is
 *      a fact about this second, and offering a second story here costs three
 *      more credits and splits the writer across two live sessions.
 *   2. `finish`   — a series is part-written and they can afford the next
 *      chapter. Work already paid for, one credit to advance, and the ONLY
 *      way to reach it from Home: a rail tap lands on the story page, which
 *      has no write-next control.
 *   3. `draft`    — a brief was saved and never generated. Reachable already
 *      (Create restores it on mount), so this state is a label, not a new
 *      capability — which is exactly why it sits below the one that is.
 *   4. `paywall`  — they cannot afford to start. Real, but a paywall is the
 *      least useful thing you can offer somebody, so it only wins when
 *      nothing else is true.
 *   5. `new`      — everything they started is finished. The default.
 *
 * The credit checks live INSIDE states 2 and 3 rather than as one gate at the
 * top, because there are two thresholds: three credits to start a story, one
 * per chapter. A writer with two credits can finish a series and cannot start
 * one, and a single gate cannot express that.
 */


export type HomeCtaState =
  | { kind: "writing"; storyId: string }
  | {
    kind: "finish";
    storyId: string;
    title: string;
    written: number;
    planned: number;
  }
  | { kind: "draft"; genreLabel: string | null }
  | { kind: "paywall"; credits: number }
  | { kind: "new"; firstEver: boolean };

export type HomeCtaCopy = {
  heading: string;
  support: string;
  /**
   * Loud states are offers and get the gradient. Quiet ones are a status, a
   * reminder and a paywall door -- none of which should look like the most
   * exciting thing on the page, and the last of which would be a dark pattern
   * if it did.
   */
  tone: "loud" | "quiet";
};

/** How many chapters of this story actually exist. */
export function chaptersWritten(story: Story): number {
  const chapters = story.chapters ?? [];
  if (chapters.length === 0) return 0;
  return chapters.reduce(
    (highest, chapter) => Math.max(highest, chapter.chapterNumber ?? 0),
    0,
  );
}

/**
 * Resolve the state. Pure, so the ordering is testable without a screen.
 *
 * `liveStoryIds` are the stories a generation session is currently writing.
 * They must be excluded from the `finish` search: the app inserts a
 * provisional story into the shelf as soon as the first prose reveals, and
 * that row carries a planned chapter count with exactly one chapter written --
 * which is, to the letter, the shape of "part-written series". Without this
 * the card would tell somebody to finish the story they are watching being
 * written.
 */
export function resolveHomeCta(input: {
  stories: readonly Story[];
  credits: number;
  /** Null while the reader's own shelf is still loading, or if it failed. */
  shelfLoaded: boolean;
  writingStoryId: string | null;
  liveStoryIds: readonly string[];
  savedDraftGenre: string | null | undefined;
}): HomeCtaState {
  if (input.writingStoryId) {
    return { kind: "writing", storyId: input.writingStoryId };
  }

  {
    const live = new Set(input.liveStoryIds);
    /*
      THE PRICE IS PER STORY, NOT PER CHAPTER-IN-GENERAL.

      This was one `credits >= CHAPTER_CREDITS` gate around the whole search.
      Since migration 00077 a chapter of an illustrated story costs two, so a
      reader holding one credit was being invited to finish a series whose next
      chapter the server would refuse — the card offering the one thing on Home
      that costs money, for a price it had quoted wrong.

      Asking per story also finds the RIGHT story: a reader with one credit and
      two unfinished series can still be offered the un-illustrated one, where a
      single gate would have shown them the paywall instead.
    */
    const unfinished = input.stories.find((story) => {
      if (live.has(story.id)) return false;
      if (story.storyMode === "standalone") return false;
      const planned = story.plannedChapterCount ?? 0;
      if (planned <= 0) return false;
      const cost = CHAPTER_CREDITS +
        (story.illustrateChapters ? CHAPTER_ART_CREDITS : 0);
      if (input.credits < cost) return false;
      const written = chaptersWritten(story);
      return written > 0 && written < planned;
    });
    if (unfinished) {
      return {
        kind: "finish",
        storyId: unfinished.id,
        title: unfinished.title,
        written: chaptersWritten(unfinished),
        planned: unfinished.plannedChapterCount ?? 0,
      };
    }
  }

  if (input.credits >= STORY_START_CREDITS && input.savedDraftGenre !== undefined) {
    if (input.savedDraftGenre !== null) {
      return { kind: "draft", genreLabel: input.savedDraftGenre };
    }
  }

  if (input.credits < STORY_START_CREDITS) {
    return { kind: "paywall", credits: input.credits };
  }

  // `firstEver` is a CLAIM, so it is only made when the shelf is known to be
  // empty. `fetchMyStories` turns every failure into an empty array, so a
  // writer with three stories and a bad connection would otherwise be told to
  // start their first one.
  return {
    kind: "new",
    firstEver: input.shelfLoaded && input.stories.length === 0,
  };
}

/** The words for a state. Separated so copy can be reviewed without logic. */
export function homeCtaCopy(state: HomeCtaState): HomeCtaCopy {
  switch (state.kind) {
    case "writing":
      return {
        heading: "Katha is writing",
        support: "Your chapter is still being written.",
        tone: "quiet",
      };
    case "finish":
      return {
        heading: "Finish your story",
        // Interpolated, never hardcoded: a planned count is 3, 7 or 15, and
        // writing any of them into the copy makes the other two wrong.
        support: `${state.title} · ${state.written} of ${state.planned} chapters.`,
        tone: "loud",
      };
    case "draft":
      return {
        heading: "Pick up your draft",
        support: state.genreLabel
          ? `Your ${state.genreLabel} idea is saved, not written yet.`
          : "Your idea is saved, not written yet.",
        tone: "quiet",
      };
    case "paywall":
      return {
        heading: "Not enough credits",
        support: `A new story costs ${formatCredits(STORY_START_CREDITS)}. You have ${state.credits}.`,
        tone: "quiet",
      };
    case "new":
      return state.firstEver
        ? {
          heading: "Start your first story",
          support: "Genre, characters, your idea. Katha brings it to life.",
          tone: "loud",
        }
        : {
          heading: "Write another story",
          support: "A genre, a name, one idea. Katha writes the rest.",
          tone: "loud",
        };
  }
}
