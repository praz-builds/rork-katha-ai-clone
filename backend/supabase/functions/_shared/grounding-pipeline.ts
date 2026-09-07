/**
 * The grounding pipeline: idea in, validated fact cards out.
 *
 * This is the only module that sequences the three moving parts - the
 * classifier, the per-entity cache, and the card call - so the two callers
 * (`shape-story`, and `generate-story` when shaping was skipped) cannot
 * disagree about the order or about what a failure means.
 *
 * Everything here is best-effort by construction. Grounding is scaffolding, and
 * the product rule from `STORY_GENERATION_FLOW.md` section 6 applies to it
 * exactly as it applies to shaping: a convenience the user did not explicitly
 * request must never surface an error to them, and must never fail the paid
 * generation standing behind it. Every failure path in this file returns an
 * empty result, which renders as an ungrounded prompt - the behaviour every
 * story had before this module existed.
 *
 * Cost shape, and why the cache is the whole design. Entities repeat across
 * users far more heavily than ideas do: Shivaji Maharaj, Taylor Swift and
 * Leonardo da Vinci will each be asked for thousands of times, and a card for
 * a dead 17th-century king does not change between requests. So the expensive
 * work is keyed on the entity rather than on the story, and at steady state the
 * common path is a single indexed read.
 */
import {
  buildEntityClassifyPrompt,
  ENTITY_CLASSIFY_OUTPUT_SCHEMA,
  ENTITY_CLASSIFY_SYSTEM_PROMPT,
  parseEntityClassification,
  selectGroundingCandidates,
} from "./entity-classify.ts";
import {
  buildGroundingCardPrompt,
  buildGroundingExtractPrompt,
  GROUNDING_CARD_OUTPUT_SCHEMA,
  GROUNDING_CARD_SYSTEM_PROMPT,
  GROUNDING_EXTRACT_SYSTEM_PROMPT,
  parseGroundingCard,
  validateGroundingCards,
} from "./grounding-card.ts";
import {
  createSearchProvider,
  isGroundingSearchEnabled,
  searchEntity,
} from "./grounding-search.ts";
import {
  boundedText,
  ENTITY_CLASSES,
  type EntityClass,
  type EntityMention,
  type GroundingCard,
  MAX_CLASSIFIED_ENTITIES,
  MAX_ENTITY_NAME_LENGTH,
  MAX_GROUNDING_CARDS,
  MAX_REASON_LENGTH,
  MIN_GROUNDING_CONFIDENCE,
  SEARCHABLE_ENTITY_CLASSES,
} from "./grounding-types.ts";
import { generateFastStructuredText } from "./llm.ts";

/**
 * The narrowest thing this module needs from Supabase.
 *
 * Declared structurally rather than importing `SupabaseClient` so the cache
 * can be exercised in tests with an object literal, and so a caller that has
 * no service client at all can pass `null` and simply get uncached behaviour.
 */
export interface GroundingCacheClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ResolveGroundingInput {
  idea: string;
  /**
   * The writer's own cast. Load-bearing, not decorative: these names are
   * forced to `private_individual` by the parser, which is what stops a user's
   * daughter from being treated as a public entity and, downstream, from
   * becoming a search query.
   */
  characterNames?: string[];
  cache?: GroundingCacheClient | null;
  /** Total wall-clock budget for classification and every card call. */
  deadlineMs?: number;
}

export interface ResolvedGrounding {
  cards: GroundingCard[];
  /** What the classifier saw, stored on the story for later publish decisions. */
  entities: EntityMention[];
}

export const EMPTY_RESOLVED_GROUNDING: ResolvedGrounding = {
  cards: [],
  entities: [],
};

/**
 * Budgets.
 *
 * The classifier is a short, highly-constrained schema over one sentence, so it
 * is the cheapest call in the system; the card call writes 5-8 details and 3-5
 * pitfalls and is closer in size to the shaping call. The split below gives the
 * classifier a third and lets the card calls, which run concurrently, share the
 * rest.
 *
 * These sit inside `shape-story`'s own deadline on the warm path, which is why
 * the default total is well under it - see the deadline note in that function
 * for why an under-budgeted fast call fails silently and looks like a missing
 * deploy rather than a timeout.
 */
export const GROUNDING_DEADLINE_MS = 20_000;

/**
 * The paid path's budget, well under the shaping call's and for a different
 * reason: during shaping the writer is editing chips and the latency is free,
 * during generation they are watching a spinner they paid for. Most of it is
 * spent concurrently with the opening database round trip. Shared by both
 * generation transports so the buffered and streamed paths cannot drift.
 */
export const GENERATION_GROUNDING_DEADLINE_MS = 9_000;
const CLASSIFY_SHARE = 0.35;
const CLASSIFY_MAX_TOKENS = 900;
const CARD_MAX_TOKENS = 1_400;

/**
 * Classify an idea, then produce a fact card for each entity worth grounding.
 *
 * Never throws and never rejects.
 */
export async function resolveGrounding(
  input: ResolveGroundingInput,
): Promise<ResolvedGrounding> {
  const idea = input.idea?.trim();
  if (!idea) return EMPTY_RESOLVED_GROUNDING;

  const started = Date.now();
  const totalBudget = input.deadlineMs ?? GROUNDING_DEADLINE_MS;

  let entities: EntityMention[];
  try {
    const classifyDeadline = Math.floor(totalBudget * CLASSIFY_SHARE);
    const result = await generateFastStructuredText(
      ENTITY_CLASSIFY_SYSTEM_PROMPT,
      buildEntityClassifyPrompt({
        idea,
        characterNames: input.characterNames,
      }),
      {
        name: "entity_classification",
        schema: ENTITY_CLASSIFY_OUTPUT_SCHEMA,
      },
      CLASSIFY_MAX_TOKENS,
      classifyDeadline,
    );
    const classification = parseEntityClassification(result.text, {
      // The prompt half of the cast rule is guidance the model may ignore.
      // This half is enforcement, and it is the one that matters.
      privateNames: input.characterNames,
    });
    if (!classification) return EMPTY_RESOLVED_GROUNDING;
    entities = classification.entities;
  } catch {
    // A provider outage, a deadline, or unparseable output. All three mean the
    // same thing to the reader: a story written from model knowledge.
    return EMPTY_RESOLVED_GROUNDING;
  }

  const candidates = selectGroundingCandidates(
    { entities },
    MIN_GROUNDING_CONFIDENCE,
  ).slice(0, MAX_GROUNDING_CARDS);

  // "A dragon and a princess" lands here, and it is the common case: the
  // classification is kept for the story row, and nothing further is spent.
  if (!candidates.length) return { cards: [], entities };

  const remaining = totalBudget - (Date.now() - started);
  if (remaining <= 0) return { cards: [], entities };

  // Concurrent, not sequential. At most `MAX_GROUNDING_CARDS` of them, each
  // independent, and the writer is waiting: run serially and three entities
  // cost three round trips of the one budget they have to share.
  const settled = await Promise.all(
    candidates.map((entity) => cardFor(entity, input.cache ?? null, remaining)),
  );

  return {
    cards: validateGroundingCards(
      settled.filter((c): c is GroundingCard => c !== null),
    ),
    entities,
  };
}

/**
 * One entity's card: cache, then model, then give up quietly.
 */
async function cardFor(
  entity: EntityMention,
  cache: GroundingCacheClient | null,
  deadlineMs: number,
): Promise<GroundingCard | null> {
  const cached = await lookupCard(cache, entity);
  if (cached) return cached;

  try {
    // Phase 2 only, and off unless both env vars are set. When search is
    // disabled `passages` is empty and the model-knowledge prompt runs, which
    // is the entire phase-1 path.
    const passages = isGroundingSearchEnabled()
      ? await searchEntity(entity, createSearchProvider())
      : [];
    const searched = passages.length > 0;

    const result = await generateFastStructuredText(
      searched ? GROUNDING_EXTRACT_SYSTEM_PROMPT : GROUNDING_CARD_SYSTEM_PROMPT,
      searched
        ? buildGroundingExtractPrompt(entity, passages)
        : buildGroundingCardPrompt(entity),
      { name: "grounding_card", schema: GROUNDING_CARD_OUTPUT_SCHEMA },
      CARD_MAX_TOKENS,
      deadlineMs,
    );
    const card = parseGroundingCard(
      result.text,
      entity,
      searched ? "web_extract" : "model_knowledge",
    );
    if (card) await storeCard(cache, card);
    return card;
  } catch {
    return null;
  }
}

async function lookupCard(
  cache: GroundingCacheClient | null,
  entity: EntityMention,
): Promise<GroundingCard | null> {
  if (!cache) return null;
  try {
    const { data, error } = await cache.rpc("entity_grounding_lookup", {
      p_canonical_name: entity.canonicalName,
    });
    if (error || !data) return null;
    // Re-validated on the way out, not trusted because it is ours. A row
    // written by an older build carries an older card shape, and the caps are
    // what keep a stale row from reaching a prompt at an unbounded length.
    const [card] = validateGroundingCards([data]);
    return card ?? null;
  } catch {
    return null;
  }
}

async function storeCard(
  cache: GroundingCacheClient | null,
  card: GroundingCard,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.rpc("entity_grounding_upsert", {
      p_canonical_name: card.canonicalName,
      p_entity_class: card.entityClass,
      p_card: card,
      p_source: card.source,
    });
  } catch {
    // A cache that cannot be written still returns a usable card to this
    // request. The only cost of swallowing this is a repeated card call.
  }
}

/**
 * Re-validate classified entities arriving from a client.
 *
 * The cards are the story's grounding; this list is the story's *record* of
 * what the idea named, and it exists for a decision that has not shipped yet:
 * a story featuring a living public figure may later be held to private
 * publishing. That gate needs to know the class, and a story generated before
 * the gate exists still needs to be classifiable when it arrives - otherwise
 * the feature's first task is a backfill over the whole corpus.
 *
 * Cards alone cannot serve that purpose. A well-known living figure is exactly
 * the case where `needsGrounding` is false - the model knows Taylor Swift
 * perfectly well - so she produces no card while being precisely the entity the
 * gate would care about. The two lists answer different questions.
 */
export function validateEntityMentions(value: unknown): EntityMention[] {
  if (!Array.isArray(value)) return [];
  const out: EntityMention[] = [];
  for (const raw of value.slice(0, MAX_CLASSIFIED_ENTITIES)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const canonicalName = boundedText(
      entry.canonicalName,
      MAX_ENTITY_NAME_LENGTH,
    );
    const entityClass = typeof entry.entityClass === "string" &&
        ENTITY_CLASSES.has(entry.entityClass)
      ? entry.entityClass as EntityClass
      : null;
    if (!canonicalName || !entityClass) continue;

    const confidence = typeof entry.confidence === "number" &&
        Number.isFinite(entry.confidence)
      ? Math.min(1, Math.max(0, entry.confidence))
      : 0;
    out.push({
      surface: boundedText(entry.surface, MAX_ENTITY_NAME_LENGTH) ??
        canonicalName,
      canonicalName,
      entityClass,
      confidence,
      // Derived, never read from the payload. A client that could assert
      // `searchable: true` on a private individual would be able to talk this
      // system into searching for someone's child.
      searchable: SEARCHABLE_ENTITY_CLASSES.has(entityClass),
      needsGrounding: entry.needsGrounding === true &&
        SEARCHABLE_ENTITY_CLASSES.has(entityClass),
      reason: boundedText(entry.reason, MAX_REASON_LENGTH),
    });
  }
  return out;
}
