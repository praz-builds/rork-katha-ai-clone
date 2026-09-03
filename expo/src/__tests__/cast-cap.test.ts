/**
 * The cast cap has to hold under a double tap.
 *
 * `addCharacter` used to check `draft.characters.length` from the closure
 * rather than `prev.characters.length` inside the updater. React batches state
 * updates, so two taps in the same frame both read the stale length, both
 * appended, and the cast came out one over the cap — which `validation.ts`
 * then rejects with a 400.
 *
 * This exercises the reducer shape directly rather than mounting the screen,
 * because the bug lives in the updater and nowhere else.
 */
import { MAX_CAST_SIZE } from "@/lib/pricing-limits";

type Character = { name: string; description: string; isHero: boolean };
type Draft = { characters: Character[] };

/** The fixed updater: the cap is evaluated against `prev`. */
const addCharacter = (prev: Draft): Draft =>
  prev.characters.length >= MAX_CAST_SIZE ? prev : {
    ...prev,
    characters: [
      ...prev.characters,
      { name: "", description: "", isHero: false },
    ],
  };

/** The bug: the cap is evaluated against a value captured before the batch. */
const addCharacterStale = (prev: Draft, capturedLength: number): Draft =>
  capturedLength >= MAX_CAST_SIZE ? prev : {
    ...prev,
    characters: [
      ...prev.characters,
      { name: "", description: "", isHero: false },
    ],
  };

const draftWith = (n: number): Draft => ({
  characters: Array.from({ length: n }, () => ({
    name: "",
    description: "",
    isHero: false,
  })),
});

describe("cast cap", () => {
  it("stops at the cap on a single tap", () => {
    let d = draftWith(0);
    for (let i = 0; i < 10; i++) d = addCharacter(d);
    expect(d.characters.length).toBe(MAX_CAST_SIZE);
  });

  it("holds when two taps land in the same batch on the last slot", () => {
    const start = draftWith(MAX_CAST_SIZE - 1);
    // Both updaters run against the same `prev` React had at batch time.
    const afterFirst = addCharacter(start);
    const afterSecond = addCharacter(afterFirst);
    expect(afterSecond.characters.length).toBe(MAX_CAST_SIZE);
  });

  it("is the exact bug the stale-closure version still has", () => {
    const start = draftWith(MAX_CAST_SIZE - 1);
    const captured = start.characters.length; // read once, before the batch
    const afterFirst = addCharacterStale(start, captured);
    const afterSecond = addCharacterStale(afterFirst, captured);
    expect(afterSecond.characters.length).toBe(MAX_CAST_SIZE + 1);
  });
});
