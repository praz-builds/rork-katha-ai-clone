/**
 * Entity grounding: the shared vocabulary, and every bound that is enforced.
 *
 * Katha generates from a sentence the user typed. When that sentence names a
 * real entity the model only half-knows, the failure is not a refusal or a
 * blank - it is confident, fluent, wrong detail. "A story where I meet Shivaji
 * Maharaj" comes back with "Maharaj" used as a surname, Mughal and Maratha
 * chronology shuffled, and an English drawing-room register on a 17th-century
 * Deccan court. A reader who knows the material stops reading; a reader who
 * does not is quietly misinformed. Churchill and Leonardo, by contrast, the
 * model knows cold, and "a dragon and a princess" has nothing to be wrong
 * about.
 *
 * So grounding is targeted, not universal. The pipeline is:
 *
 *   classify entities -> decide which will be got wrong -> build a fact card
 *   -> render the card as a distinct prompt layer
 *
 * Phase 1 (live) builds the card from model knowledge alone: no web search, no
 * new provider, no new secret. That is deliberate. The hypothesis under test is
 * that *forcing the model to commit to a structured card before it writes
 * prose* is what fixes the register and chronology errors - not that the
 * internet knows something the weights do not. If a card the model wrote itself
 * already fixes Shivaji, retrieval is an optimisation rather than the feature.
 *
 * Phase 2 (seams built, off by default) adds search for the narrow subset the
 * classifier flags `needs_grounding`. See `grounding-search.ts`.
 *
 * ---------------------------------------------------------------------------
 * Why every field in this file is capped
 * ---------------------------------------------------------------------------
 * Cards are persisted on `stories.grounding` and reused by `continue-story`, so
 * a card written at chapter 1 is re-sent on every chapter through 7. A client
 * can also hand cards in directly. Neither of those is a trust boundary this
 * module gets to assume away: an uncapped card is an unmetered prompt-budget
 * hole that bills once per chapter, and a caps-free validator would let a
 * 40 KB "era" field crowd out the story engine layer it sits beside. The caps
 * below are the enforcement, and `validateGroundingCards` drops what does not
 * fit rather than trusting a producer to have behaved.
 */

/**
 * What a named entity is, which decides both whether it may be searched and
 * whether it is worth grounding at all.
 *
 * The set is small on purpose. Each member exists because it changes a decision
 * downstream - not because it is a tidy taxonomy:
 *
 *   historical_public_figure  long-tail risk is highest here, and the facts do
 *                             not move, so a cached card stays true for a year.
 *   living_public_figure      facts move; a card goes stale in weeks, and the
 *                             post-cutoff present-day detail is exactly what a
 *                             reader catches.
 *   fictional_character       never grounded. The model knows Spider-Man, and
 *                             this product does not owe anyone canon fidelity.
 *   canon_character           grounded, unlike the class above. Added for
 *                             fanfiction, the one genre that is entirely about
 *                             canon fidelity rather than owing none. A general
 *                             model reliably flattens a specific character's
 *                             voice into generic dialogue, and fame does not
 *                             protect against that failure the way it protects
 *                             a historical figure from a factual one - Draco
 *                             Malfoy is exactly as easy to flatten as a side
 *                             character from an obscure webcomic. See
 *                             entity-classify.ts for the classification rule
 *                             and grounding-card.ts's `voice` field.
 *   real_place                grounded for sensory texture, not for facts.
 *   real_event                chronology risk, same shape as historical.
 *   organization_brand        naming and register risk, plus defamation edge.
 *   private_individual        never searched, ever. See SEARCHABLE_ENTITY_CLASSES.
 */
export type EntityClass =
  | "historical_public_figure"
  | "living_public_figure"
  | "fictional_character"
  | "canon_character"
  | "real_place"
  | "real_event"
  | "organization_brand"
  | "private_individual";

export const ENTITY_CLASSES: ReadonlySet<string> = new Set<EntityClass>([
  "historical_public_figure",
  "living_public_figure",
  "fictional_character",
  "canon_character",
  "real_place",
  "real_event",
  "organization_brand",
  "private_individual",
]);

/**
 * The classifier's legal way to say "nothing here".
 *
 * A model given only real classes and an idea containing no real entities will
 * invent one rather than return an empty array - the same pressure that makes a
 * model answer a question it should decline. Giving "none" a seat in the enum
 * costs one string and removes the incentive. The parser drops these entries,
 * so nothing downstream ever sees the sentinel.
 */
export const ENTITY_CLASS_NONE = "none";

/**
 * Which classes may ever reach an outbound search query.
 *
 * `private_individual` is absent and that absence is the product promise: a
 * Katha story is private by default, and shipping "my ex-boyfriend Daniel from
 * the Bangalore office" to a third-party search API breaks that silently, in a
 * way no user could discover. `fictional_character` is absent for a cheaper
 * reason - it is never worth a request. `canon_character` is absent for the
 * same cheaper reason: a fandom card is about voice and characterisation, not
 * about facts a search engine holds, so phase 1's model-knowledge card is the
 * whole mechanism and there is nothing here for phase 2 to add. Its absence is
 * not a privacy decision the way `private_individual`'s is - nothing about
 * adding a new grounded class may ever narrow that one's exclusion.
 *
 * This is a code-level gate, not prompt guidance. A prompt that says "do not
 * search private people" fails open the first time a model misreads a sentence;
 * `isSearchableEntity` in `grounding-search.ts` reads this set and fails closed.
 */
export const SEARCHABLE_ENTITY_CLASSES: ReadonlySet<string> = new Set<
  EntityClass
>([
  "historical_public_figure",
  "living_public_figure",
  "real_place",
  "real_event",
  "organization_brand",
]);

/** Where a card's content came from. Recorded so a stale-card audit can tell. */
export type GroundingSource = "model_knowledge" | "web_extract";

export const GROUNDING_SOURCES: ReadonlySet<string> = new Set<GroundingSource>([
  "model_knowledge",
  "web_extract",
]);

/**
 * One entity the classifier found, as it decided about it.
 *
 * `surface` is kept beside `canonicalName` because they answer different
 * questions. The surface form is what the user typed and is the only thing that
 * can be matched back against their idea (or against a character sheet, to
 * force a private classification). The canonical name is the only thing that
 * may leave the system: it is the cache key and, in phase 2, the entire search
 * query.
 */
export type EntityMention = {
  /** Exactly as the user typed it. Never sent anywhere; used for matching. */
  surface: string;
  /** The public name of the entity. Cache key, and the whole search query. */
  canonicalName: string;
  entityClass: EntityClass;
  /** 0-1. Low confidence is a reason not to ground, never a reason to guess. */
  confidence: number;
  /** Hard false for `private_individual`, whatever the model claimed. */
  searchable: boolean;
  /** "will the model get this wrong", not "is this famous". */
  needsGrounding: boolean;
  /** One short clause saying why. Kept for telemetry and for tuning the rule. */
  reason?: string;
};

export type EntityClassification = {
  entities: EntityMention[];
};

/** No entity worth grounding. Distinct from a failed classification (null). */
export const EMPTY_ENTITY_CLASSIFICATION: EntityClassification = {
  entities: [],
};

/**
 * The fact card. Authored for a novelist, not for an encyclopedia.
 *
 * Every field earns its place by changing a sentence of prose:
 *
 *   nameForms   the highest-value field in the whole system, and the reason
 *               this module exists. "Maharaj" is an honorific, not a surname;
 *               a character addressing him as "Mr. Maharaj" or "Shivaji, mate"
 *               is the single most embarrassing output the naive path produces.
 *               Register and address are what a reader notices first and what
 *               a general-purpose model gets wrong most reliably.
 *   voice       how the entity speaks - diction, rhythm, verbal tics, what they
 *               would never say. Added for `canon_character`: fanfiction is
 *               read for voice above everything else, and a flattened voice is
 *               the single failure mode that class exists to catch. Useful but
 *               optional for every other class, so it is capped and defaulted
 *               like `era`/`role` rather than required like `nameForms`.
 *   details     5-8 concrete, material, sensory things a writer can put on the
 *               page. Not achievements - textures. "Achievements" produce a
 *               Wikipedia paragraph; "the smell of the forge" produces a scene.
 *   pitfalls    3-5 named errors, so the model is steered off the specific
 *               wrong turn rather than told vaguely to be accurate.
 */
export type GroundingCard = {
  canonicalName: string;
  entityClass: EntityClass;
  /** Dates or period, plus place. Chronology is half of what goes wrong. */
  era: string;
  /** What they were, in one line a writer can stage a scene around. */
  role: string;
  /** How they are named and addressed, and in what register. */
  nameForms: string;
  /**
   * How they speak. Empty string, never absent, matching `era`/`role` - a card
   * missing this is still a usable card, unlike one missing `nameForms`.
   */
  voice: string;
  /** Concrete, sensory, stageable. See the note above on why not achievements. */
  details: string[];
  /** Named, specific errors to avoid. */
  pitfalls: string[];
  source: GroundingSource;
};

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * How many entities one idea may carry into the pipeline.
 *
 * The idea field is capped at 1,000 characters (`validation.ts`), which is
 * roughly 150 words - an idea that genuinely names more than six real entities
 * is a list, not a premise. Past this the extra mentions are dropped rather
 * than the request refused, because grounding is optional scaffolding and must
 * never be the reason a paid generation stops.
 */
export const MAX_CLASSIFIED_ENTITIES = 6;

/**
 * How many cards are built, cached, stored and rendered.
 *
 * Below MAX_CLASSIFIED_ENTITIES on purpose. Classification is one cheap call
 * over the whole idea; each card is its own call and its own slice of every
 * subsequent chapter's prompt. Two is the realistic case ("I meet Shivaji
 * Maharaj at Raigad"), three is the ceiling worth paying for, and a fourth card
 * dilutes the layer past the point where the model treats any of it as binding.
 */
export const MAX_GROUNDING_CARDS = 3;

/** A surface form longer than this is a sentence the model mis-segmented. */
export const MAX_ENTITY_NAME_LENGTH = 80;

/** One clause. It is telemetry and prompt-tuning input, never prose. */
export const MAX_REASON_LENGTH = 160;

/** `era` and `role`: one line each, at prose density. */
export const MAX_CARD_FIELD_LENGTH = 240;

/**
 * `nameForms` gets more room than any other single field.
 *
 * It carries several distinct things - the full formal name, what other
 * characters call him, what the narration calls him, what is anachronistic -
 * and squeezing it to a one-liner is what produced the honorific bug in the
 * first place.
 */
export const MAX_NAME_FORMS_LENGTH = 500;

/**
 * `voice` is a paragraph, not a one-liner - diction, rhythm, verbal tics, what
 * they would never say - but it is not `nameForms`: it is optional scaffolding
 * for every class except the one it was added for, so it sits below the name
 * budget rather than beside it.
 */
export const MAX_VOICE_LENGTH = 400;

export const MIN_CARD_DETAILS = 5;
export const MAX_CARD_DETAILS = 8;
export const MAX_DETAIL_LENGTH = 200;

export const MIN_CARD_PITFALLS = 3;
export const MAX_CARD_PITFALLS = 5;
export const MAX_PITFALL_LENGTH = 200;

/**
 * Below this, a classification is treated as a guess and the entity is not
 * grounded.
 *
 * An uncertain classification is worse than none: a card built on a
 * misidentified entity is fluent, structured, cited-looking and wrong, and it
 * is now instructed into the prose as true. Declining to ground leaves the
 * model exactly where it is today, which is the safe direction to fail in.
 */
export const MIN_GROUNDING_CONFIDENCE = 0.6;

/**
 * How long a cached card stays usable, by class.
 *
 * The split is about how fast the underlying facts move, not about how popular
 * the entity is. A 17th-century figure's dates do not change; a living
 * person's public situation changes in weeks and is precisely the
 * post-cutoff detail a reader catches. Places drift slowly - a street renamed,
 * a building gone.
 *
 * These are mirrored by `entity_grounding_ttl_days()` in migration 00045. If
 * one moves, move both: the database computes `expires_at` on write, so a
 * disagreement here is silently unenforceable rather than loudly wrong.
 */
export const GROUNDING_TTL_DAYS: Record<EntityClass, number> = {
  historical_public_figure: 365,
  living_public_figure: 30,
  real_place: 90,
  real_event: 365,
  organization_brand: 30,
  // Neither is ever cached - they are never grounded - but a total record means
  // a new class cannot be added without a TTL decision being made about it.
  fictional_character: 365,
  private_individual: 0,
  // canon_character IS grounded (see selectGroundingCandidates in
  // entity-classify.ts) but is deliberately not yet cached in
  // `entity_grounding`: that table's class check (migration 00045) only
  // allows the five classes above, so caching a canon character's card is a
  // follow-up that needs its own migration decision, not a silent side effect
  // of adding the class here. Until then every request rebuilds the card from
  // model knowledge, which is correct - just not free. 0 mirrors the "never
  // cached" value already used for the other two ungrounded-or-uncached
  // classes, and `entity_grounding_ttl_days()` in migration 00045 never has to
  // answer for it because the table's check constraint rejects the insert
  // first.
  canon_character: 0,
};

/**
 * The cache key: a canonical name folded to something two spellings agree on.
 *
 * Shivaji and Taylor Swift will each be asked for thousands of times, and
 * "Shivaji Maharaj", "shivaji  maharaj" and "Shivaji Maharaj." must not buy
 * three separate LLM calls and three separate rows. Diacritics are deliberately
 * *not* stripped: "Malmö" and "Malmo" are the same place, but folding accents
 * across the whole Latin range collides names that are genuinely different, and
 * a cache that returns the wrong entity's card is worse than a cache miss.
 *
 * Mirrored by `entity_grounding_key()` in migration 00045, which is the column
 * the unique index is on. Same rule as the TTLs: move both or neither.
 */
export function groundingCacheKey(
  canonicalName: string,
  entityClass: string,
): string {
  const name = canonicalName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // The class is part of the key, not metadata beside it. Washington the person
  // and Washington the place share a name and share nothing else; keying on the
  // name alone let a later classification overwrite an earlier one and answer
  // lookups with facts about the wrong kind of thing. Mirrors
  // `entity_grounding_key(text, text)` in migration 00045.
  return `${name}:${entityClass.trim().toLowerCase()}`;
}

/**
 * Trim to a bound, or report absence. The single string reader for this module.
 *
 * Slicing rather than rejecting is the right failure here for the same reason
 * `parseStoryShape` trims an over-long opening: a card whose `role` runs two
 * words past the cap is still a usable card, and throwing it away to punish a
 * producer costs the writer their grounding for no gain. Anything that is not a
 * string at all is absence, not coercion - `String(value)` on an object yields
 * "[object Object]", which is a field that looks populated and says nothing.
 */
export function boundedText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/**
 * Strip a ``` fence a model wrapped its JSON in.
 *
 * Every structured call in this repo asks for raw JSON and some models still
 * fence it. `parseStoryShape` carries the same helper for the same reason; it
 * is duplicated rather than imported because `story-shape.ts` does not export
 * it, and reaching into another module's private surface to avoid ten lines is
 * a worse dependency than the ten lines.
 */
export function stripJsonCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return "";
  const withoutOpening = trimmed.slice(firstNewline + 1);
  return withoutOpening.endsWith("```")
    ? withoutOpening.slice(0, -3).trim()
    : withoutOpening.trim();
}
