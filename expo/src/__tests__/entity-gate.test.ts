import {
  deriveGatingReasonFromEntities,
  parseGatingReason,
  pendingGatingReason,
} from "@/lib/entity-gate";

/**
 * The client mirror of `_shared/entity-visibility-gate.ts`. The three cases
 * here are the three the server's own test pins: both gating classes, and a
 * historical figure that must never gate.
 */
describe("deriveGatingReasonFromEntities", () => {
  it("gates a living public figure", () => {
    expect(
      deriveGatingReasonFromEntities([
        { name: "Taylor Swift", entityClass: "living_public_figure", needsGrounding: false },
      ]),
    ).toBe("living_public_figure");
  });

  it("gates a private individual, and it outranks a public figure", () => {
    expect(
      deriveGatingReasonFromEntities([
        { name: "Rihanna", entityClass: "living_public_figure" },
        { name: "my neighbour Priya", entityClass: "private_individual" },
      ]),
    ).toBe("private_individual");
  });

  it("never gates a historical figure, a place, an event, or a canon character", () => {
    expect(
      deriveGatingReasonFromEntities([
        { name: "Shivaji Maharaj", entityClass: "historical_figure" },
        { name: "Taj Mahal", entityClass: "real_place" },
        { name: "Battle of Plassey", entityClass: "real_event" },
        { name: "Hermione Granger", entityClass: "canon_character" },
      ]),
    ).toBeNull();
  });

  it("reads the class under the server's snake_case and a bare `class` key too", () => {
    expect(deriveGatingReasonFromEntities([{ entity_class: "living_public_figure" }])).toBe(
      "living_public_figure",
    );
    expect(deriveGatingReasonFromEntities([{ class: "private_individual" }])).toBe(
      "private_individual",
    );
  });

  it("treats anything unreadable as not gated", () => {
    expect(deriveGatingReasonFromEntities(undefined)).toBeNull();
    expect(deriveGatingReasonFromEntities([])).toBeNull();
    expect(deriveGatingReasonFromEntities([null, 42, "living_public_figure"])).toBeNull();
  });
});

describe("pendingGatingReason", () => {
  it("prefers the server's own verdict when the shape response carries one", () => {
    expect(
      pendingGatingReason({
        gatingReason: "living_public_figure",
        groundingEntities: [{ entityClass: "historical_figure" }],
      }),
    ).toBe("living_public_figure");
  });

  it("falls back to the entity list when there is no verdict", () => {
    expect(
      pendingGatingReason({
        groundingEntities: [{ entityClass: "private_individual" }],
      }),
    ).toBe("private_individual");
  });

  it("does not accept a made-up reason", () => {
    expect(parseGatingReason("policy_violation")).toBeNull();
    expect(pendingGatingReason({ gatingReason: "nope", groundingEntities: [] })).toBeNull();
  });
});
