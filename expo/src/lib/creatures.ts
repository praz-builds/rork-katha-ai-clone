/**
 * Katha creature avatars.
 *
 * Thirty-six tiny clay-render spirits (six body silhouettes x six pastel
 * backgrounds) used as profile avatars. Each is a 256x256 WebP under
 * assets/creatures/. Ids are stable: never renumber, only append.
 */
export type CreatureId = `k${string}`;

export const CREATURE_IDS: readonly string[] = [
  "k01",
  "k02",
  "k03",
  "k04",
  "k05",
  "k06",
  "k07",
  "k08",
  "k09",
  "k10",
  "k11",
  "k12",
  "k13",
  "k14",
  "k15",
  "k16",
  "k17",
  "k18",
  "k19",
  "k20",
  "k21",
  "k22",
  "k23",
  "k24",
  "k25",
  "k26",
  "k27",
  "k28",
  "k29",
  "k30",
  "k31",
  "k32",
  "k33",
  "k34",
  "k35",
  "k36",
];

export const CREATURES: readonly { id: string; source: number; label: string }[] = [
  { id: "k01", source: require("../../assets/creatures/k01.webp"), label: "Round orange spirit on lavender with a spark" },
  { id: "k02", source: require("../../assets/creatures/k02.webp"), label: "Round forest green spirit on peach with a small flame" },
  { id: "k03", source: require("../../assets/creatures/k03.webp"), label: "Round cream white spirit on sky with a tiny crown" },
  { id: "k04", source: require("../../assets/creatures/k04.webp"), label: "Round plum spirit on mint with a leaf sprout" },
  { id: "k05", source: require("../../assets/creatures/k05.webp"), label: "Round plum spirit on butter with an orbiting dot" },
  { id: "k06", source: require("../../assets/creatures/k06.webp"), label: "Round olive spirit on blush with a swirl" },
  { id: "k07", source: require("../../assets/creatures/k07.webp"), label: "Droplet cream white spirit on lavender with a crescent moon" },
  { id: "k08", source: require("../../assets/creatures/k08.webp"), label: "Droplet cobalt blue spirit on peach with a spark" },
  { id: "k09", source: require("../../assets/creatures/k09.webp"), label: "Droplet orange spirit on sky with a small flame" },
  { id: "k10", source: require("../../assets/creatures/k10.webp"), label: "Droplet deep blue spirit on mint with a tiny crown" },
  { id: "k11", source: require("../../assets/creatures/k11.webp"), label: "Droplet deep blue spirit on butter with a leaf sprout" },
  { id: "k12", source: require("../../assets/creatures/k12.webp"), label: "Droplet lavender spirit on blush with an orbiting dot" },
  { id: "k13", source: require("../../assets/creatures/k13.webp"), label: "Cloud deep teal spirit on lavender with a swirl" },
  { id: "k14", source: require("../../assets/creatures/k14.webp"), label: "Cloud mauve spirit on peach with a crescent moon" },
  { id: "k15", source: require("../../assets/creatures/k15.webp"), label: "Cloud coral spirit on sky with a spark" },
  { id: "k16", source: require("../../assets/creatures/k16.webp"), label: "Cloud orange spirit on mint with a small flame" },
  { id: "k17", source: require("../../assets/creatures/k17.webp"), label: "Cloud coral spirit on butter with a tiny crown" },
  { id: "k18", source: require("../../assets/creatures/k18.webp"), label: "Cloud deep teal spirit on blush with a leaf sprout" },
  { id: "k19", source: require("../../assets/creatures/k19.webp"), label: "Bean coral spirit on lavender with an orbiting dot" },
  { id: "k20", source: require("../../assets/creatures/k20.webp"), label: "Bean orange spirit on peach with a swirl" },
  { id: "k21", source: require("../../assets/creatures/k21.webp"), label: "Bean warm yellow spirit on sky with a crescent moon" },
  { id: "k22", source: require("../../assets/creatures/k22.webp"), label: "Bean mauve spirit on mint with a spark" },
  { id: "k23", source: require("../../assets/creatures/k23.webp"), label: "Bean sage green spirit on butter with a small flame" },
  { id: "k24", source: require("../../assets/creatures/k24.webp"), label: "Bean forest green spirit on blush with a tiny crown" },
  { id: "k25", source: require("../../assets/creatures/k25.webp"), label: "Pebble warm mustard spirit on lavender with a leaf sprout" },
  { id: "k26", source: require("../../assets/creatures/k26.webp"), label: "Pebble deep teal spirit on peach with an orbiting dot" },
  { id: "k27", source: require("../../assets/creatures/k27.webp"), label: "Pebble orange spirit on sky with a swirl" },
  { id: "k28", source: require("../../assets/creatures/k28.webp"), label: "Pebble orange spirit on mint with a crescent moon" },
  { id: "k29", source: require("../../assets/creatures/k29.webp"), label: "Pebble lavender spirit on butter with a spark" },
  { id: "k30", source: require("../../assets/creatures/k30.webp"), label: "Pebble deep blue spirit on blush with a small flame" },
  { id: "k31", source: require("../../assets/creatures/k31.webp"), label: "Star orange spirit on lavender with a tiny crown" },
  { id: "k32", source: require("../../assets/creatures/k32.webp"), label: "Star plum spirit on peach with a leaf sprout" },
  { id: "k33", source: require("../../assets/creatures/k33.webp"), label: "Star terracotta spirit on sky with an orbiting dot" },
  { id: "k34", source: require("../../assets/creatures/k34.webp"), label: "Star orange spirit on mint with a swirl" },
  { id: "k35", source: require("../../assets/creatures/k35.webp"), label: "Star deep teal spirit on butter with a crescent moon" },
  { id: "k36", source: require("../../assets/creatures/k36.webp"), label: "Star mustard spirit on blush with a spark" },
];

const BY_ID: ReadonlyMap<string, number> = new Map(CREATURES.map((c) => [c.id, c.source]));

/** Image source for a creature id, or null when the id is unknown. */
export function creatureSource(id: string | null | undefined): number | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/**
 * Deterministic creature for a seed (user id, email, device id...).
 * Simple djb2-style string hash mod the catalogue size, so the same seed
 * always yields the same creature, on every platform, with no storage.
 */
export function creatureForSeed(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return CREATURE_IDS[hash % CREATURE_IDS.length];
}
