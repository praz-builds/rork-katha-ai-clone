import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveGatingReason,
  GATING_REASONS,
  isGatingEntityClass,
  parseGatingReason,
  STORY_GATED_PRIVATE_ERROR_CODE,
} from "./entity-visibility-gate.ts";
import type { EntityMention } from "./grounding-types.ts";

function entity(overrides: Partial<EntityMention> = {}): EntityMention {
  return {
    surface: "Shivaji Maharaj",
    canonicalName: "Chhatrapati Shivaji Maharaj",
    entityClass: "historical_public_figure",
    confidence: 0.95,
    searchable: true,
    needsGrounding: true,
    ...overrides,
  };
}

Deno.test("a living public figure forces the gate, a historical one does not", () => {
  assertEquals(
    deriveGatingReason([entity({ entityClass: "living_public_figure" })]),
    "living_public_figure",
  );
  assertEquals(
    deriveGatingReason([entity({ entityClass: "historical_public_figure" })]),
    null,
  );
});

Deno.test("a private individual forces the gate", () => {
  assertEquals(
    deriveGatingReason([entity({ entityClass: "private_individual" })]),
    "private_individual",
  );
});

Deno.test("a real place, a real event, and a fictional character never gate", () => {
  for (
    const entityClass of [
      "real_place",
      "real_event",
      "organization_brand",
      "fictional_character",
      "canon_character",
    ] as const
  ) {
    assertEquals(
      deriveGatingReason([entity({ entityClass })]),
      null,
      entityClass,
    );
  }
});

Deno.test("no entities at all means no gate", () => {
  assertEquals(deriveGatingReason([]), null);
});

Deno.test("a story naming several entities is gated if any one of them qualifies", () => {
  assertEquals(
    deriveGatingReason([
      entity({ entityClass: "historical_public_figure" }),
      entity({ entityClass: "real_place", canonicalName: "Raigad Fort" }),
      entity({
        entityClass: "living_public_figure",
        canonicalName: "A Living Person",
      }),
    ]),
    "living_public_figure",
  );
});

Deno.test("private_individual outranks living_public_figure when both are present", () => {
  assertEquals(
    deriveGatingReason([
      entity({ entityClass: "living_public_figure" }),
      entity({ entityClass: "private_individual" }),
    ]),
    "private_individual",
  );
});

Deno.test("isGatingEntityClass agrees with deriveGatingReason for every class", () => {
  const classes = [
    "historical_public_figure",
    "living_public_figure",
    "fictional_character",
    "canon_character",
    "real_place",
    "real_event",
    "organization_brand",
    "private_individual",
  ] as const;
  for (const entityClass of classes) {
    const gated = deriveGatingReason([entity({ entityClass })]) !== null;
    assertEquals(isGatingEntityClass(entityClass), gated, entityClass);
  }
});

Deno.test("parseGatingReason accepts only the two real reasons", () => {
  assertEquals(
    parseGatingReason("living_public_figure"),
    "living_public_figure",
  );
  assertEquals(parseGatingReason("private_individual"), "private_individual");
  assertEquals(parseGatingReason(null), null);
  assertEquals(parseGatingReason(undefined), null);
  assertEquals(parseGatingReason(""), null);
  assertEquals(parseGatingReason("historical_public_figure"), null);
  assertEquals(parseGatingReason("DROP TABLE stories;"), null);
  assertEquals(parseGatingReason(42), null);
});

Deno.test("the reason set contains exactly the two gating classes", () => {
  assertEquals(GATING_REASONS.size, 2);
  assert(GATING_REASONS.has("living_public_figure"));
  assert(GATING_REASONS.has("private_individual"));
});

Deno.test("the reason stored is always a bare enum, never a name or free text", () => {
  // The whole point of storing a class rather than the entity: `deriveGatingReason`
  // has no path that can return anything other than one of the two literal
  // strings in GATING_REASONS, so there is no way for a canonical name or a
  // user's idea text to end up in the column this feeds.
  const reason = deriveGatingReason([
    entity({
      entityClass: "living_public_figure",
      canonicalName: "A Famous Person Whose Name Must Never Leak",
      surface: "the famous person my story is about",
    }),
  ]);
  assert(reason);
  assert(GATING_REASONS.has(reason));
  assertEquals(reason, "living_public_figure");
});

Deno.test("the error code is a stable machine-readable string", () => {
  assertEquals(STORY_GATED_PRIVATE_ERROR_CODE, "story_gated_private");
});
