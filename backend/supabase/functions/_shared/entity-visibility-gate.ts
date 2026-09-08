/**
 * The entity visibility gate.
 *
 * Product decision, implemented exactly: a story whose idea names a
 * `living_public_figure` or a `private_individual` is forced private,
 * regardless of what the user selected. Historical figures, real places, real
 * events and organisations do NOT trigger it - a story about Shivaji Maharaj
 * or the Taj Mahal stays publishable, because that is precisely the case the
 * grounding feature exists to serve.
 *
 * `grounding_entities` (migration 00045) already records every classified
 * entity, whether or not it was grounded - that column's own comment says it
 * exists for "a future gate [that] is a WHERE clause instead of a migration
 * that spends real money on an LLM per row." This module is that gate's
 * decision function: it does not classify anything itself, it only reads the
 * classification `resolveGrounding` already produced and turns it into one of
 * three states a story row can be in.
 *
 * The rule is enforced twice, deliberately:
 *
 *   1. Application-level, in `publish-story`, which reads the stored reason
 *      and refuses to publish with a typed, client-renderable error.
 *   2. Database-level, via a CHECK constraint (migration 00050) that makes
 *      `is_public = true` with a gate reason set an invalid row, full stop -
 *      independent of which endpoint, or which future endpoint, attempts the
 *      write. `stories.is_public` sits in the `authenticated` role's own
 *      UPDATE grant (migration 00015) for the editor's local toggle, which
 *      means a client can already reach that column directly through
 *      PostgREST; a check enforced only in one Edge Function's application
 *      code is not a gate on that path. The constraint is what makes it one.
 *
 * This module only ever narrows toward private. It never promotes a story to
 * public, never touches an already-public row, and never runs against a
 * story generated before this existed - `entity_gate_reason` defaults to null,
 * and nothing here retroactively computes it for a row that never got a
 * value. See `publish-story/index.ts` for why an already-public story can
 * never be re-gated by this check.
 */

import type { EntityClass, EntityMention } from "./grounding-types.ts";

/**
 * The two classes that force a story private. Both are about a real,
 * identifiable person and nothing else - not because other classes are safe
 * to publish carelessly, but because privacy is the one risk this gate exists
 * to close automatically, without an editorial review step this product does
 * not have.
 */
export type GatingReason = "living_public_figure" | "private_individual";

export const GATING_REASONS: ReadonlySet<GatingReason> = new Set<
  GatingReason
>([
  "living_public_figure",
  "private_individual",
]);

const GATING_ENTITY_CLASSES: ReadonlySet<EntityClass> = new Set<EntityClass>([
  "living_public_figure",
  "private_individual",
]);

/**
 * Decide the gating reason for a story from its classified entities, or null
 * if none applies.
 *
 * `entities` is the full classification - every entity `resolveGrounding` saw,
 * whether or not a card was ever built for it. That distinction matters here
 * more than anywhere else in the pipeline: a well-known living person is
 * exactly the case where `needsGrounding` is false (the model already writes
 * them accurately), so they produce no grounding card while being precisely
 * the entity this gate cares about. Reading `entities` rather than `cards` is
 * what makes the gate see them at all.
 *
 * `private_individual` outranks `living_public_figure` when a story somehow
 * names both, because it is the more sensitive of the two classes - though in
 * practice either one alone is already sufficient to force the story private,
 * and the caller only needs to know that a reason exists, not which of two
 * simultaneous reasons "won."
 */
export function deriveGatingReason(
  entities: readonly EntityMention[],
): GatingReason | null {
  if (entities.some((entity) => entity.entityClass === "private_individual")) {
    return "private_individual";
  }
  if (
    entities.some((entity) => entity.entityClass === "living_public_figure")
  ) {
    return "living_public_figure";
  }
  return null;
}

/** True when a classified entity would force the story private. */
export function isGatingEntityClass(entityClass: EntityClass): boolean {
  return GATING_ENTITY_CLASSES.has(entityClass);
}

/**
 * Read a gating reason back from an untyped source - a database column, most
 * often. Never throws; anything that is not exactly one of the two reasons is
 * treated as "not gated," which is the safe direction to fail in for a value
 * this narrow (the alternative, treating garbage as gated, would only ever
 * make a story too private, never too public - but a value this cheap to
 * validate has no reason to guess either way).
 */
export function parseGatingReason(value: unknown): GatingReason | null {
  if (typeof value !== "string") return null;
  return GATING_REASONS.has(value as GatingReason)
    ? (value as GatingReason)
    : null;
}

/**
 * The client-facing error code for a refused publish. Stable and typed so the
 * client can render its own copy rather than parse a human sentence, and so a
 * future refusal reason never collides with this one by accident.
 */
export const STORY_GATED_PRIVATE_ERROR_CODE = "story_gated_private";
