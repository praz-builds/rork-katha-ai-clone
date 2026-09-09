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
import { logError } from "./errors.ts";
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
  /**
   * Called with the classification outcome, success or failure, before the
   * cards are built.
   *
   * `ResolvedGrounding` cannot carry it: this function fails open by design
   * and collapses every failure into an empty result, which is right for the
   * prompt and is exactly the ambiguity the publish decision must not inherit.
   * A caller that needs to tell "named nobody" from "never answered" - to log
   * it, or to decide whether a pre-generation warning means anything - asks
   * for it here rather than reading it out of an empty array.
   */
  onClassification?: (outcome: ClassificationOutcome) => void;
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

/**
 * Classification's own budget on the generation paths, and the number that
 * makes the entity visibility gate a real control rather than a decoration.
 *
 * Measured against the live models on 2026-09-09 with a classification-shaped
 * prompt ("Taylor Swift secretly moves into a flat above a struggling Mumbai
 * record shop..."):
 *
 * | model                            | observed |
 * |----------------------------------|----------|
 * | meta/muse-spark-1.3-contributor  | 23.4s    |
 * | meta/muse-spark-1.3              | 25.5s    |
 *
 * Both returned the right answer - `Taylor Swift / living_public_figure` and
 * `Mumbai / real_place`. Neither had a chance of returning it inside
 * `GENERATION_GROUNDING_DEADLINE_MS`, which reached the leading model as a few
 * seconds at best, so the gate saw an empty classification on every request
 * ever made and every story published as though its idea named nobody.
 *
 * 40s is the 25.5s measurement plus room for a slow day, not a target. It buys
 * no latency, because this call no longer sits in front of the prose: it is
 * started before `begin_story_generation` and awaited only when the chapter is
 * persisted 55-100s later, so the answer is already waiting by the time
 * anything needs it. What it does buy is the difference between a safety check
 * that runs and one that times out.
 *
 * It is deliberately NOT the budget for grounding cards. Cards are prompt
 * enrichment and must be in the prompt before the first token, so they keep
 * `GENERATION_GROUNDING_DEADLINE_MS` and keep failing open.
 */
export const CLASSIFICATION_DEADLINE_MS = 40_000;

const CLASSIFY_SHARE = 0.35;
const CLASSIFY_MAX_TOKENS = 900;
const CARD_MAX_TOKENS = 1_400;

/**
 * Why a classification produced no verdict. Never the idea, never a name -
 * this short enum is the whole vocabulary, and it is what reaches
 * `error_events`.
 */
export type ClassificationFailure =
  | "provider_failed"
  | "unparseable"
  | "not_attempted";

/**
 * The outcome for a classification that was never made - the caller's
 * per-user fallback rate limit refused the claim, or the guard itself was
 * unreachable.
 *
 * It is a *failure*, not an empty verdict, and that is the whole point: a
 * rate-limited request still gets its story, but it does not get to publish
 * on the strength of a check that was skipped to save money.
 */
export const CLASSIFICATION_NOT_ATTEMPTED: ClassificationOutcome = {
  status: "failed",
  entities: [],
  failure: "not_attempted",
  elapsedMs: 0,
};

/**
 * The result of asking the classifier what an idea names.
 *
 * `status` exists because `entities: []` is ambiguous and the ambiguity is
 * exactly what went wrong here. "The idea names nobody" and "we never got an
 * answer" both used to arrive as an empty array, and the publish decision read
 * that array and let the story out. They are now different values, and only
 * `"ok"` is a verdict.
 */
export interface ClassificationOutcome {
  status: "ok" | "failed";
  entities: EntityMention[];
  failure?: ClassificationFailure;
  /** The provider's own failure code, when there was one. Never free text. */
  code?: string;
  /** Wall clock spent, for the telemetry row. */
  elapsedMs: number;
}

/** The signature of `generateFastStructuredText`, injectable for tests. */
export type FastStructuredGenerator = typeof generateFastStructuredText;

export interface ClassifyIdeaInput {
  idea: string;
  characterNames?: string[];
  deadlineMs?: number;
  /** Test seam. Defaults to the real provider chain. */
  generate?: FastStructuredGenerator;
}

/**
 * Classify an idea's real-world entities. Never throws.
 *
 * Split out of `resolveGrounding` on 2026-09-09. The two halves of grounding
 * answer to different owners: the cards are enrichment the writer never asked
 * for and must never slow prose down, while the classification is the input to
 * a publish decision. Sharing one budget meant the safety half inherited the
 * enrichment half's "give up quickly, say nothing" posture, and that is how a
 * gate stays inert for weeks without anybody noticing.
 */
export async function classifyIdea(
  input: ClassifyIdeaInput,
): Promise<ClassificationOutcome> {
  const started = Date.now();
  const idea = input.idea?.trim();
  // Nothing to classify is a genuine verdict, not a failure: an empty idea
  // names nobody, and a story with no idea behind it cannot be gated by one.
  if (!idea) return { status: "ok", entities: [], elapsedMs: 0 };

  const generate = input.generate ?? generateFastStructuredText;
  try {
    const result = await generate(
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
      input.deadlineMs ?? CLASSIFICATION_DEADLINE_MS,
    );
    const classification = parseEntityClassification(result.text, {
      // The prompt half of the cast rule is guidance the model may ignore.
      // This half is enforcement, and it is the one that matters.
      privateNames: input.characterNames,
    });
    if (!classification) {
      return {
        status: "failed",
        entities: [],
        failure: "unparseable",
        elapsedMs: Date.now() - started,
      };
    }
    return {
      status: "ok",
      entities: classification.entities,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    // A provider outage, a refused key, or a blown deadline. All of them mean
    // the same thing to the gate - no verdict - and all of them are now said
    // out loud rather than collapsed into an empty array.
    return {
      status: "failed",
      entities: [],
      failure: "provider_failed",
      code: providerFailureCode(error),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * A short, PII-free label for whatever the provider chain did.
 *
 * Deliberately not the error message: an `AllProvidersFailedError` carries
 * per-model text from a third party, and this value is written to
 * `error_events`, whose contract is identifiers and enums only. The interesting
 * signal for this failure is which shape it had, not what OpenRouter wrote.
 */
export function providerFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const named = error as { name?: unknown; failures?: unknown };
  if (Array.isArray(named.failures)) {
    const codes = named.failures
      .map((failure) =>
        failure && typeof failure === "object"
          ? (failure as { code?: unknown }).code
          : undefined
      )
      .filter((code): code is string => typeof code === "string");
    if (codes.length) return codes[codes.length - 1];
    return "all_providers_failed";
  }
  if (
    typeof named.name === "string" &&
    /^[A-Za-z0-9_.:/-]{1,64}$/.test(named.name)
  ) {
    return named.name;
  }
  return "unknown";
}

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

  const outcome = await classifyIdea({
    idea,
    characterNames: input.characterNames,
    deadlineMs: Math.floor(totalBudget * CLASSIFY_SHARE),
  });
  input.onClassification?.(outcome);
  // A provider outage, a deadline, or unparseable output. All three mean the
  // same thing to the reader: a story written from model knowledge. This
  // function is the *enrichment* half of grounding and still fails open; the
  // publish decision reads `classifyIdea` directly, where the difference
  // between "nobody" and "no answer" is preserved.
  if (outcome.status !== "ok") return EMPTY_RESOLVED_GROUNDING;
  const entities = outcome.entities;

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
  // An absolute instant, not a duration. `remaining` was previously handed to
  // every card call as a fresh budget, but each call spends wall-clock on a
  // cache lookup and (in phase 2) a search before it reaches the model, so the
  // model call then started its own full timer and the pipeline could overrun
  // the grounding deadline by however long retrieval had taken. A deadline that
  // is a point in time cannot be restarted by accident.
  const deadlineAt = started + totalBudget;
  const settled = await Promise.all(
    candidates.map((entity) =>
      cardFor(entity, input.cache ?? null, deadlineAt)
    ),
  );

  return {
    cards: validateGroundingCards(
      settled.filter((c): c is GroundingCard => c !== null),
    ),
    entities,
  };
}

/** The narrow slice of `logError` this module needs, injectable for tests. */
export type ClassificationLogger = (input: {
  bucket: "grounding";
  severity: "high";
  source: "runtime";
  errorCode: string;
  error: unknown;
  context: Record<string, unknown>;
  userId?: string | null;
}) => Promise<boolean> | void;

/**
 * Say out loud that classification produced no verdict.
 *
 * The root cause of the 2026-09-09 defect was not the deadline. It was that a
 * deadline this badly wrong produced no signal at all: `entity-classify.ts`
 * documents "silent failure is the contract for the whole grounding path", and
 * `catch {}` honoured it. That contract is right for enrichment - a missing
 * fact card is invisible and harmless - and wrong for a safety control, where
 * "nothing happened" and "the check ran and passed" have to look different
 * from the outside or nobody finds out for weeks.
 *
 * PII rule, same as every other `error_events` row and stricter in spirit
 * here: the idea, the surface forms and the canonical names are the whole
 * subject of this call and none of them are written. What goes in the row is
 * the failure shape, the provider's own code, and how long it took.
 */
export async function reportClassificationFailure(input: {
  outcome: ClassificationOutcome;
  feature: string;
  storyId?: string | null;
  userId?: string | null;
  log?: ClassificationLogger;
}): Promise<void> {
  const { outcome } = input;
  if (outcome.status === "ok") return;
  const log = input.log ?? logError;
  await log({
    bucket: "grounding",
    // High, not low. A story that goes public unchecked is the failure this
    // row describes, and it is not a degraded convenience.
    severity: "high",
    source: "runtime",
    errorCode: "entity_classification_unavailable",
    error: new Error(
      `entity classification ${outcome.failure ?? "failed"}`,
    ),
    context: {
      feature: input.feature,
      failure: outcome.failure ?? "unknown",
      code: outcome.code ?? "none",
      elapsed_ms: outcome.elapsedMs,
      ...(input.storyId ? { story_id: input.storyId } : {}),
    },
    userId: input.userId ?? null,
  });
}

/**
 * Cards for a prompt, from a classification that is running on its own clock.
 *
 * This is the generation path's half of the 2026-09-09 split. Classification
 * now gets `CLASSIFICATION_DEADLINE_MS` because the publish decision waits for
 * it at chapter-persist time; the prompt cannot wait that long, because the
 * owner's requirement is that prose appears as fast as possible and the prompt
 * is built before the first token.
 *
 * So the same single classification serves both, and this function takes
 * whatever part of it has arrived inside the short window. If classification
 * has landed - a fast day, or a warm provider - the cards are built from it in
 * whatever is left. If it has not, the prompt goes out ungrounded, which is
 * what every story on this path already got and costs the writer nothing.
 *
 * One classification, two consumers. The alternative considered and rejected
 * was a second short classification call purely for cards: double the spend on
 * every unshaped generation, for a call that is only ever going to time out.
 */
export async function groundingCardsWithin(
  classification: Promise<ClassificationOutcome | null>,
  cache: GroundingCacheClient | null,
  budgetMs: number,
): Promise<GroundingCard[]> {
  const started = Date.now();
  const deadlineAt = started + budgetMs;
  // A sentinel rather than a rejection: `Promise.race` with a rejecting timer
  // would leave the classification promise's own eventual rejection unhandled,
  // and an unhandled rejection can take the isolate down mid-generation.
  const timedOut = Symbol("card_window_elapsed");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: ClassificationOutcome | null | typeof timedOut;
  try {
    outcome = await Promise.race([
      classification,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), Math.max(0, budgetMs));
      }),
    ]);
  } catch {
    return [];
  } finally {
    // Cleared whichever way the race went. A timer left armed keeps the isolate
    // awake for the rest of the window after the work is done.
    if (timer !== undefined) clearTimeout(timer);
  }
  if (outcome === timedOut || !outcome || outcome.status !== "ok") return [];

  const candidates = selectGroundingCandidates(
    { entities: outcome.entities },
    MIN_GROUNDING_CONFIDENCE,
  ).slice(0, MAX_GROUNDING_CARDS);
  if (!candidates.length) return [];
  if (Date.now() >= deadlineAt) return [];

  const settled = await Promise.all(
    candidates.map((entity) => cardFor(entity, cache, deadlineAt)),
  );
  return validateGroundingCards(
    settled.filter((card): card is GroundingCard => card !== null),
  );
}

/**
 * One entity's card: cache, then model, then give up quietly.
 */
async function cardFor(
  entity: EntityMention,
  cache: GroundingCacheClient | null,
  /** Absolute instant the whole grounding attempt must be finished by. */
  deadlineAt: number,
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
    // Retrieval may have eaten the budget outright. Sending a request with no
    // time left just pays for a response nobody will wait for.
    if (Date.now() >= deadlineAt) return null;

    const result = await generateFastStructuredText(
      searched ? GROUNDING_EXTRACT_SYSTEM_PROMPT : GROUNDING_CARD_SYSTEM_PROMPT,
      searched
        ? buildGroundingExtractPrompt(entity, passages)
        : buildGroundingCardPrompt(entity),
      { name: "grounding_card", schema: GROUNDING_CARD_OUTPUT_SCHEMA },
      CARD_MAX_TOKENS,
      // Whatever is genuinely left after the cache read and any search, rather
      // than the budget this call would have had if it were the only work.
      Math.max(0, deadlineAt - Date.now()),
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
      // The class is part of the key. Two entities can share a name and share
      // nothing else -- Washington the person and Washington the place -- and
      // keying on the name alone let one silently answer for the other.
      p_entity_class: entity.entityClass,
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
