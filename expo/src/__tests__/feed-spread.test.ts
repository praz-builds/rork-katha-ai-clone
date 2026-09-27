/**
 * `spreadByKey`, the thing that stops Explore reading as a catalogue dump.
 *
 * WHAT IT IS FOR. The Originals were authored and published in genre blocks
 * (`backend/originals/slots.json`: romance, then comedy, then fantasy) and
 * every engagement count on them is still zero, so every sort ties on every
 * row, `Array.prototype.sort` is stable, and the list falls through to
 * publication order -- eight romance, then six comedy, then seven fantasy.
 *
 * THE PROPERTIES THAT MATTER, and none of them is "looks random":
 *
 * 1. **Totality.** Every input comes out exactly once. The caller runs this
 *    over a list that GROWS as pages arrive, so a helper that dropped or
 *    duplicated a row would show up only at a page boundary, as a card that
 *    vanished or a duplicate-key warning nobody reads.
 * 2. **No run until the tail.** Two neighbours share a key only once every
 *    other group is exhausted. The first implementation promised a run limit
 *    of two and delivered five, because it drained the leading key two at a
 *    time and the others one at a time; the test below is the one that caught
 *    it, so it is written against the whole list rather than its first rows.
 * 3. **Within-key order is exact**, which is where the real ranking signal
 *    will live once there are engagement counts to rank by.
 * 4. **Deterministic**, or the list reshuffles under the reader's thumb on
 *    every re-render.
 */
import { spreadByKey } from "@/lib/feed-shuffle";

type Row = { id: string; genre: string };

const rows = (spec: string): Row[] =>
  spec.split("").map((genre, index) => ({ id: `${genre}${index}`, genre }));

const genres = (out: Row[]) => out.map((row) => row.genre).join("");

/** The longest run of one key anywhere in the output. */
function longestRun(out: Row[]): number {
  let best = 0;
  let run = 0;
  let last: string | null = null;
  for (const row of out) {
    run = row.genre === last ? run + 1 : 1;
    last = row.genre;
    if (run > best) best = run;
  }
  return best;
}

it("breaks a genre-blocked catalogue up, all the way to the end", () => {
  // Three solid blocks, the shape the real catalogue has. Evenly sized, so
  // every group runs out together and there is no tail at all.
  const input = rows("aaaaaabbbbbbcccccc");
  const out = spreadByKey(input, (row) => row.genre);

  expect(genres(out)).toBe("abcabcabcabcabcabc");
  expect(longestRun(out)).toBe(1);
});

it("returns every input exactly once, and invents nothing", () => {
  const input = rows("aaaaaaaabbbbbbcccccc");
  const out = spreadByKey(input, (row) => row.genre);

  expect(out).toHaveLength(input.length);
  expect(out.map((row) => row.id).sort())
    .toEqual(input.map((row) => row.id).sort());
  expect(new Set(out.map((row) => row.id)).size).toBe(input.length);
});

it("only repeats a genre once the others have run out", () => {
  // Uneven: `a` outlasts the rest, so the tail is unavoidably a run of `a`.
  // What must hold is that the run is at the END and nowhere before it.
  const input = rows("aaaaaaaabbcc");
  const out = spreadByKey(input, (row) => row.genre);

  expect(genres(out)).toBe("abcabcaaaaaa");
  // Everything before the tail alternates.
  expect(longestRun(out.slice(0, 6))).toBe(1);
});

it("keeps each genre's own order exactly", () => {
  // Within-key ranking is the half that survives, and it has to be exact:
  // it is where a real engagement signal will show up.
  const input = rows("aaabbb");
  const out = spreadByKey(input, (row) => row.genre);

  expect(out.filter((row) => row.genre === "a").map((row) => row.id))
    .toEqual(["a0", "a1", "a2"]);
  expect(out.filter((row) => row.genre === "b").map((row) => row.id))
    .toEqual(["b3", "b4", "b5"]);
});

it("lets the top of the input lead", () => {
  // Groups are dealt in order of their best-ranked member, so the first card
  // is still the first card. A reader's top result does not move.
  const input = rows("cabcab");
  const out = spreadByKey(input, (row) => row.genre);
  expect(out[0].id).toBe("c0");
  expect(genres(out)).toBe("cabcab");
});

it("degrades rather than fails when there is nothing to interleave", () => {
  // One key throughout: nothing to interleave with, so the input comes back.
  expect(genres(spreadByKey(rows("aaaaa"), (row) => row.genre))).toBe("aaaaa");
  // Degenerate sizes.
  expect(spreadByKey(rows("a"), (row) => row.genre)).toHaveLength(1);
  expect(spreadByKey([], (row: Row) => row.genre)).toEqual([]);
});

it("does not mutate its input", () => {
  const input = rows("aaabbb");
  const before = input.map((row) => row.id).join(",");
  spreadByKey(input, (row) => row.genre);
  expect(input.map((row) => row.id).join(",")).toBe(before);
});

it("is deterministic, so a re-render does not reshuffle under the reader", () => {
  const input = rows("aaaaaaaabbbbbbcccccc");
  expect(genres(spreadByKey(input, (row) => row.genre)))
    .toBe(genres(spreadByKey(input, (row) => row.genre)));
});

it("survives a growing list without clumping at the seam", () => {
  // The caller re-runs this over the ACCUMULATED list every time a page
  // arrives, which is the whole reason it is not applied per page: page 2 of
  // a genre-blocked catalogue is its own block, and appending a spread page
  // to a spread page puts two blocks end to end.
  const page1 = rows("aaaabbbb");
  const page2 = rows("ccccdddd");
  const both = spreadByKey([...page1, ...page2], (row) => row.genre);

  expect(both).toHaveLength(16);
  expect(longestRun(both)).toBe(1);
});
