/**
 * Credit costs, in one place.
 *
 * **`source-of-truth/CREDITS_AND_PRICING.md` is canonical.** This file is the
 * single client-side mirror of the few numbers the UI renders, so a price change
 * lands in one place instead of in every button label. It holds only per-action
 * credit costs — no plan prices, no grants, no SKUs. Those come from RevenueCat
 * at runtime and must never be duplicated here.
 *
 * ## Charged today vs. contracted
 *
 * These are not the same thing yet, and conflating them would put a false price
 * in front of a user. `generate-story` makes exactly one reservation, so a
 * generation costs **one** credit: the cast and chapter 1's art are specified
 * but not built, so nothing charges for them.
 *
 * Anything under "contracted" is the target from the canonical document and is
 * **not yet charged**. Use the "charged today" values for anything a user reads
 * or a button spends, and the contracted values only where the code that
 * implements them lands.
 */

// ---------------------------------------------------------------------------
// Charged today — safe to display
// ---------------------------------------------------------------------------

/** One AI action, one credit. Every priced action in the product. */
export const CREDITS_PER_ACTION = 1;

/** What one generation costs today: one reservation in `generate-story`. */
export const CREDITS_PER_GENERATION = 1;

/** Unlocking a chapter's audio. Re-listening is free, forever. */
export const CREDITS_PER_AUDIO_UNLOCK = 1;

// ---------------------------------------------------------------------------
// Contracted — NOT yet charged. Do not display these as current prices.
// ---------------------------------------------------------------------------

/**
 * Starting a story once the flow is built: the cast, chapter 1's words, and
 * chapter 1's art, which becomes the cover. Three separate reservations.
 *
 * Blocked on the image pipeline (bucket B4) and the character sheet (B6).
 */
export const CONTRACTED_CREDITS_TO_START_STORY = 3;

/** Each chapter after the first, once the per-chapter loop is built. */
export const CONTRACTED_CREDITS_PER_CHAPTER = 1;

/** A chapter's art, when the illustrate toggle is on. */
export const CONTRACTED_CREDITS_PER_CHAPTER_ART = 1;

/** What one Continue will cost, given whether the story illustrates chapters. */
export function contractedCreditsForNextChapter(
  illustrateChapters: boolean,
): number {
  return CONTRACTED_CREDITS_PER_CHAPTER +
    (illustrateChapters ? CONTRACTED_CREDITS_PER_CHAPTER_ART : 0);
}

/**
 * Total to take a story from nothing to `chapterCount` chapters.
 *
 * For the review screen and the *Write the rest* confirm, both of which must
 * state a total before the user commits to it.
 */
export function contractedCreditsForWholeStory(
  chapterCount: number,
  illustrateChapters: boolean,
): number {
  const remaining = Math.max(0, chapterCount - 1);
  return CONTRACTED_CREDITS_TO_START_STORY +
    remaining * contractedCreditsForNextChapter(illustrateChapters);
}

// ---------------------------------------------------------------------------

/** "1 credit" / "3 credits", for button labels and sheet headers. */
export function formatCredits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}
