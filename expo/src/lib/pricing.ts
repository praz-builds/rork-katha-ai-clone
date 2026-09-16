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

// ---------------------------------------------------------------------------
// Credit packs — the one-time purchases (D8, CREDITS_AND_PRICING.md §3)
// ---------------------------------------------------------------------------

/**
 * A credit pack as the store sells it.
 *
 * `usd` is the FALLBACK copy only, rendered when RevenueCat has no package for
 * the SKU (web, or a build with no store configuration). With a package the
 * screen renders the store's own `priceString`, because a hardcoded dollar
 * figure is wrong for every non-US storefront. The unit price and the saving
 * are computed from whichever price is on screen, never typed.
 */
export type CreditPack = {
  credits: number;
  /** The store product identifier, `ai.katha.credits.{n}`. */
  sku: string;
  /** Canonical USD price, the fallback when the store has no package. */
  usd: number;
  /** The fallback display form of `usd`. */
  fallbackPrice: string;
  /** The one pack the sheet marks "Popular". */
  popular?: boolean;
};

/**
 * Five packs, ascending. The 2-pack is the blocked-moment purchase and sets
 * the base rate every other pack's "Save %" is measured against; the 1000 is
 * deliberately close to the yearly rate and is the best value on the sheet.
 * Pack credits never expire.
 */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { credits: 2, sku: "ai.katha.credits.2", usd: 0.99, fallbackPrice: "$0.99" },
  { credits: 10, sku: "ai.katha.credits.10", usd: 3.49, fallbackPrice: "$3.49", popular: true },
  { credits: 50, sku: "ai.katha.credits.50", usd: 15.99, fallbackPrice: "$15.99" },
  { credits: 200, sku: "ai.katha.credits.200", usd: 44.99, fallbackPrice: "$44.99" },
  { credits: 1000, sku: "ai.katha.credits.1000", usd: 119.99, fallbackPrice: "$119.99" },
];

/** The smallest pack's rate: the price every saving is a saving against. */
export function creditPackBaseRate(
  amountFor: (pack: CreditPack) => number = (pack) => pack.usd,
): number {
  const base = CREDIT_PACKS[0];
  return amountFor(base) / base.credits;
}

/** Price per credit for a pack, from the amount actually on screen. */
export function creditPackUnitPrice(pack: CreditPack, amount: number = pack.usd): number {
  return amount / pack.credits;
}

/**
 * "Save N%" against the 2-pack rate, rounded down to a whole percent and
 * never negative. Zero for the base pack itself, which the sheet shows no
 * badge for: a pack cannot save against its own price.
 */
export function creditPackSavingPercent(
  pack: CreditPack,
  amount: number = pack.usd,
  baseRate: number = creditPackBaseRate(),
): number {
  if (!(baseRate > 0)) return 0;
  const unit = creditPackUnitPrice(pack, amount);
  return Math.max(0, Math.floor((1 - unit / baseRate) * 100));
}

/**
 * "$0.35 per credit", in the currency of the price on screen.
 *
 * The symbol is whatever is left of `priceString` once the digits and the
 * separators are gone, placed on the side it was already on -- the same rule
 * the paywall's daily note uses, and for the same reason: RevenueCat gives the
 * amount as a number and the currency only inside the formatted string.
 */
export function formatUnitPrice(unit: number, priceString: string): string {
  const figure = unit < 0.1 ? unit.toFixed(3) : unit.toFixed(2);
  const symbol = priceString.replace(/[\d\s.,  ]/g, "").trim();
  if (!symbol) return `${figure} per credit`;
  const leading = priceString.trimStart().startsWith(symbol);
  return leading ? `${symbol}${figure} per credit` : `${figure}${symbol} per credit`;
}
