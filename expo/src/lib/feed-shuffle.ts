/**
 * A shuffle that is the same all day for one reader and different tomorrow.
 *
 * WHY HOME NEEDS ONE. Before counts exist -- a fresh catalogue, every story at
 * zero reads and zero likes -- sorting Trending by views and Most loved by
 * likes both fall back to catalogue order, and so does Originals. All three
 * rails opened on the same card. The shuffle decides ties; a real count still
 * outranks it, because the shuffle runs first and the sort by count is stable.
 *
 * WHY SEEDED AND NOT RANDOM. Home re-renders on every feed fetch, credit
 * change and tab switch. A random order on each render would reshuffle the
 * rails under the reader's thumb, which reads as a glitch. The seed is the
 * reader and the day, the same idea as the greeting in `lib/greeting.ts`, so
 * the page is stable for the whole day and fresh the next.
 *
 * Pure: nothing here reads the clock or the session. The caller hands in the
 * date and the reader id.
 */
import { dayOfYear } from "@/lib/greeting";

/**
 * The seed for one reader on one local day. A null reader (no session yet)
 * still gets a daily order; it simply is not personal until the id arrives.
 */
export function dailyFeedSeed(readerId: string | null, date: Date = new Date()): string {
  // `||`, not `??`: an empty id is no reader, not a reader called "".
  return `${readerId || "guest"}:${date.getFullYear()}-${dayOfYear(date)}`;
}

/** FNV-1a, 32-bit. Enough to spread short strings; this is not cryptography. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny deterministic generator returning floats in [0, 1). */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A copy of `items` in a Fisher-Yates order fixed by `seed`. The input is
 * never mutated. Two calls with the same seed and the same input return the
 * same order; `salt` lets one seed produce a different order per rail, so
 * Trending and Most loved do not tie-break identically.
 */
export function seededShuffle<T>(items: readonly T[], seed: string, salt = ""): T[] {
  const next = generator(hashSeed(`${seed}#${salt}`));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal the list out by key, round-robin, so neighbours differ.
 *
 * WHY EXPLORE NEEDS ONE. The catalogue was authored and published in genre
 * blocks -- `backend/originals/slots.json` runs romance, then comedy, then
 * fantasy -- and every engagement count on it is still zero. Sorting by views
 * or likes therefore ties on every row, `Array.prototype.sort` is stable, and
 * the list falls through to publication order: eight romance, then six comedy,
 * then seven fantasy. It reads like a catalogue dump, which is what it is.
 *
 * `seededShuffle` alone does not fix it. It breaks the ties, but a shuffle of
 * a genre-clustered list is still clustered often enough to notice -- runs are
 * what random sequences actually look like.
 *
 * HOW. Group by key, keeping each group in the order it arrived, then take one
 * from each non-empty group in turn. Two neighbours can only share a key once
 * every OTHER group has run out, which is the tail and is unavoidable: at that
 * point there is nothing left to interleave with.
 *
 * WHY THIS SHAPE AND NOT A MINIMAL-DISTURBANCE PASS. The first attempt walked
 * the list in order and moved an item only when it would have made a third
 * consecutive neighbour. That preserves the ranking better and it is wrong: it
 * drains the leading key two at a time while spending the others one at a
 * time, so the majority key is exhausted early and the list ends in a long
 * solid run of whatever is left. Its own test caught a run of five where two
 * was promised. Dealing from groups cannot do that, because a group is only
 * ever ahead of the others by one.
 *
 * WHAT IT COSTS. Ranking ACROSS keys is disturbed -- the second card is the
 * best of another genre rather than the second best overall. Ranking WITHIN a
 * key is exact, because each group keeps its order. That is the right trade
 * here: every cross-key comparison is currently a tie between zeroes, and a
 * discovery surface wants variety in the first screenful more than it wants a
 * strict ordering nobody can perceive.
 *
 * TOTALITY. Every input appears exactly once, and the input is not mutated.
 * That is load-bearing for the caller, which runs this over a list that GROWS
 * as pages arrive; a helper that dropped or duplicated a row would show up
 * only at a page boundary. Deterministic, so a re-render does not reshuffle
 * under the reader's thumb.
 */
export function spreadByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (items.length < 2) return [...items];

  // A Map keeps insertion order, so the groups come out ordered by the
  // position of their best-ranked member: the top of the input still leads.
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  if (groups.size === 1) return [...items];

  const queues = [...groups.values()];
  const out: T[] = [];
  while (out.length < items.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}
