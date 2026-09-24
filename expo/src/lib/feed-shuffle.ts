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
