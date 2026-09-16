import { CREATURES, CREATURE_IDS, creatureForSeed, creatureSource } from "../lib/creatures";

describe("creatures catalogue", () => {
  it("has 36 unique ids in k01..k36 order", () => {
    expect(CREATURE_IDS).toHaveLength(36);
    expect(new Set(CREATURE_IDS).size).toBe(36);
    expect(CREATURE_IDS[0]).toBe("k01");
    expect(CREATURE_IDS[35]).toBe("k36");
    expect(CREATURES.map((c) => c.id)).toEqual(CREATURE_IDS);
  });

  it("resolves every entry to a truthy image source with a label", () => {
    for (const creature of CREATURES) {
      expect(creature.source).toBeTruthy();
      expect(creature.label.length).toBeGreaterThan(0);
      expect(creatureSource(creature.id)).toBe(creature.source);
    }
  });

  it("returns null for unknown ids", () => {
    expect(creatureSource("k99")).toBeNull();
    expect(creatureSource("")).toBeNull();
    expect(creatureSource(null)).toBeNull();
    expect(creatureSource(undefined)).toBeNull();
  });

  it("picks deterministically per seed and spreads across ids", () => {
    const seeds = Array.from({ length: 100 }, (_, i) => `user-${i}@example.com`);
    const first = seeds.map(creatureForSeed);
    const second = seeds.map(creatureForSeed);
    expect(second).toEqual(first);
    for (const id of first) expect(CREATURE_IDS).toContain(id);
    expect(new Set(first).size).toBeGreaterThan(1);
  });
});
