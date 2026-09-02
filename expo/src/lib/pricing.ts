/**
 * Credit costs, in one place.
 *
 * **`source-of-truth/CREDITS_AND_PRICING.md` is canonical.** This file is the
 * single client-side mirror of the few numbers the UI has to render, so a price
 * change lands in one place instead of in every button label. It deliberately
 * holds only per-action credit costs — no plan prices, no grants, no SKUs, no
 * store copy. Those are read from RevenueCat at runtime and must never be
 * duplicated here.
 *
 * If a number here disagrees with that document, that document is right.
 */

/** Cost of one AI action. Every priced action in the product is one credit. */
export const CREDITS_PER_ACTION = 1;

/**
 * Starting a story: the cast, chapter 1's words, and chapter 1's art — which
 * becomes the cover. Charged as three separate actions, so a partial balance
 * still makes progress.
 */
export const CREDITS_TO_START_STORY = 3;

/** Each chapter after the first. */
export const CREDITS_PER_CHAPTER = 1;

/** Art for a chapter after the first, when the illustrate toggle is on. */
export const CREDITS_PER_CHAPTER_ART = 1;

/** Unlocking a chapter's audio. Re-listening is free, forever. */
export const CREDITS_PER_AUDIO_UNLOCK = 1;

/** What one Continue costs, given whether the story illustrates its chapters. */
export function creditsForNextChapter(illustrateChapters: boolean): number {
  return CREDITS_PER_CHAPTER +
    (illustrateChapters ? CREDITS_PER_CHAPTER_ART : 0);
}

/**
 * Total to take a story from nothing to `chapterCount` chapters.
 *
 * Used by the review screen and by the *Write the rest* confirm, both of which
 * must state a total before the user commits to it.
 */
export function creditsForWholeStory(
  chapterCount: number,
  illustrateChapters: boolean,
): number {
  const remaining = Math.max(0, chapterCount - 1);
  return CREDITS_TO_START_STORY +
    remaining * creditsForNextChapter(illustrateChapters);
}

/** "1 credit" / "3 credits", for button labels and sheet headers. */
export function formatCredits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}
