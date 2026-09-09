import type { StoryGatingReason } from "@/lib/api";

/**
 * The client half of the entity visibility gate.
 *
 * The server decides (`_shared/entity-visibility-gate.ts`): a story whose idea
 * names a `living_public_figure` or a `private_individual` is forced private
 * whatever the writer asked for, and migration 00050 makes a public row with a
 * gate reason invalid outright. Nothing here can change that decision. What
 * this module does is let the create screen SAY it before a credit is spent,
 * using the classification `shape-story` already returned for free, so the
 * writer is told "this one can't be public" while they can still change their
 * idea rather than after the chapter exists.
 *
 * Two inputs are honoured, in order:
 *
 *   1. `gating_reason` on the shape response - the server's own verdict, once
 *      `shape-story` returns it (in flight on the backend branch). Preferred,
 *      because it is the same function the generation path will run.
 *   2. The raw `grounding_entities` list, read the way the server reads it:
 *      `private_individual` outranks `living_public_figure`, and every other
 *      class (historical figures, places, events, organisations, canon and
 *      fictional characters) is not a reason. Mirrored rather than imported
 *      because the client cannot import Deno modules; the test pins both
 *      sides to the same three cases.
 *
 * The entity list is typed `unknown[]` on the client on purpose (see
 * `StoryShape` in `lib/api.ts`), so the class is read defensively under the
 * three spellings it could plausibly arrive in. Anything unreadable is "not
 * gated": the server is the backstop, and a false "can't be public" here would
 * talk a writer out of a story that was fine.
 */

const GATING_CLASSES = new Set<StoryGatingReason>([
  "living_public_figure",
  "private_individual",
]);

export function parseGatingReason(value: unknown): StoryGatingReason | null {
  return typeof value === "string" && GATING_CLASSES.has(value as StoryGatingReason)
    ? (value as StoryGatingReason)
    : null;
}

function entityClassOf(entity: unknown): string | null {
  if (!entity || typeof entity !== "object") return null;
  const record = entity as Record<string, unknown>;
  const candidate = record.entityClass ?? record.entity_class ?? record.class;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * The gating reason implied by a classified entity list, or null.
 *
 * Same precedence as the server: a private individual wins over a living
 * public figure when both are present, because it is the more sensitive of
 * the two - though either alone already forces the story private.
 */
export function deriveGatingReasonFromEntities(
  entities: readonly unknown[] | undefined | null,
): StoryGatingReason | null {
  if (!Array.isArray(entities) || entities.length === 0) return null;
  const classes = entities.map(entityClassOf);
  if (classes.includes("private_individual")) return "private_individual";
  if (classes.includes("living_public_figure")) return "living_public_figure";
  return null;
}

/**
 * The reason a public request would be refused, from whatever the shape call
 * left on the draft. `gatingReason` is the server's verdict when present;
 * the entity list is the fallback for a shape response from before
 * `shape-story` returned one.
 */
export function pendingGatingReason(input: {
  gatingReason?: unknown;
  groundingEntities?: readonly unknown[] | null;
}): StoryGatingReason | null {
  return parseGatingReason(input.gatingReason) ??
    deriveGatingReasonFromEntities(input.groundingEntities);
}
