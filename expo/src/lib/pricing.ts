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
 * THESE ARE NO LONGER CONTRACTED. They are what the backend charges.
 *
 * The name is kept because every call site reads it, and a rename is a
 * mechanical change that would bury the fact underneath it — but the fact is
 * the important part, so it is stated here rather than in a commit message:
 *
 *   * Starting a story is 1, reserved by `begin_story_generation` -- a bundle
 *     of the cast, chapter one's words and chapter one's art, which becomes
 *     the cover. It was 3, one per action; the product owner settled the
 *     long-standing disagreement with `source-of-truth/CREDITS_AND_PRICING.md`
 *     §Summary in the document's favour on 2026-09-14 (migration 00087).
 *   * Each further chapter is 1, or **2 when the story illustrates its
 *     chapters** — reserved by `reserve_generation_operation` since migration
 *     00077, which takes the illustrated flag from `stories.illustrate_chapters`
 *     rather than from the caller.
 *
 * So `contractedCreditsForNextChapter` now returns a LIVE price and may be
 * rendered to a user. The separation this module exists to keep is still real
 * for anything else on the roadmap; it stopped being real for these.
 */
export const CONTRACTED_CREDITS_TO_START_STORY = 1;

/** Each chapter after the first. Live. */
export const CONTRACTED_CREDITS_PER_CHAPTER = 1;

/** A chapter's art, when the story illustrates its chapters. Live. */
export const CONTRACTED_CREDITS_PER_CHAPTER_ART = 1;

/**
 * What one Continue costs, given whether the story illustrates chapters.
 *
 * Live as of migration 00077, and safe to render. It must be given the story's
 * OWN `illustrateChapters`: passing `false` for an illustrated story quotes 1
 * for a chapter the server will reserve 2 for, which is the reader being told
 * a price they are not charged.
 */
export function contractedCreditsForNextChapter(
  illustrateChapters: boolean,
): number {
  return CONTRACTED_CREDITS_PER_CHAPTER +
    (illustrateChapters ? CONTRACTED_CREDITS_PER_CHAPTER_ART : 0);
}

/**
 * Total to take a story from nothing to `chapterCount` chapters.
 *
 * For any surface that must state a total before the user commits to it. (The
 * review screen it was written for is retired; the *Write the rest* confirm and
 * the brief's own totals still need this.)
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

/** "1 credit" / "2 credits", for button labels and sheet headers. */
export function formatCredits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}
