/**
 * The one list every screen resolves a story id against: `allStories`.
 *
 * It is assembled from four sources, and the rules for combining them are
 * kept here, as a pure function, rather than inline in `App.tsx`'s `useMemo`,
 * because each rule exists to stop a specific wrong thing from reaching a
 * reader and each one is easier to pin in a test than to re-derive from a
 * render:
 *
 * 1. **The writer's own stories lead** (`generated`). They are the most
 *    complete copy of anything the client holds -- a story written this
 *    session carries beats and series state no list query selects -- so when
 *    an id appears twice, this copy is the one kept.
 *
 * 2. **The house catalogue is the curated stories when there are any, and the
 *    bundled seed stories only when there are not.** The seed catalogue was
 *    the whole of Home before the Katha Originals were published: placeholder
 *    stories with invented like counts and two narration links that have
 *    since expired. Shown beside the real originals they would be
 *    indistinguishable from them, and a reader has no way to tell which of
 *    the counts are real. They survive only as the fallback for a first
 *    launch with no network, or a deploy that has not been seeded yet, where
 *    the alternative is a Home with nothing on it at all.
 *
 * 3. **A hydrated copy replaces its metadata-only original IN PLACE**
 *    (`discovered`). Curated stories arrive without their chapters (see
 *    `fetchCuratedStories`), and opening one fetches them and stores the full
 *    copy in `discovered`. Appending that copy would put the same card on
 *    Home twice, and deduplicating by "first one wins" would move a story to
 *    the front of Katha Originals the moment somebody opened it. Swapping it
 *    into the slot the metadata-only copy held keeps both the rail's order and
 *    its length exactly what they were before the tap.
 *
 * 4. **Nothing appears twice.** A story can legitimately be in two sources at
 *    once -- a writer's own story found again through search, a curated story
 *    that is also on the writer's shelf -- and a duplicate id in `allStories`
 *    renders as a duplicate card and a duplicate React key.
 */
import type { Story } from "@/types/domain";

export type StoryCatalogueSources = {
  /** The writer's own stories, restored from the shelf or written this session. */
  generated: readonly Story[];
  /** Stories opened from search or hydrated on open. Full chapters. */
  discovered: readonly Story[];
  /** Katha Originals read from the database. Metadata only until opened. */
  curated: readonly Story[];
  /** The bundled placeholder catalogue. Used only when `curated` is empty. */
  seed: readonly Story[];
};

export function buildStoryCatalogue({
  generated,
  discovered,
  curated,
  seed,
}: StoryCatalogueSources): Story[] {
  const house = curated.length > 0 ? curated : seed;
  const houseIds = new Set(house.map((story) => story.id));
  const hydrated = new Map(discovered.map((story) => [story.id, story]));

  const seen = new Set<string>();
  const result: Story[] = [];
  const add = (story: Story) => {
    if (seen.has(story.id)) return;
    seen.add(story.id);
    result.push(story);
  };

  for (const story of generated) add(story);
  // Discovered stories that are not part of the house catalogue keep the slot
  // they have always had, between the writer's own and the house's. The ones
  // that ARE house stories are placed below, in the house story's own slot.
  for (const story of discovered) {
    if (!houseIds.has(story.id)) add(story);
  }
  for (const story of house) add(hydrated.get(story.id) ?? story);

  return result;
}

/**
 * Does this story need its chapters fetched before it can be opened?
 *
 * A story with no chapters in hand has nothing for the reader to show, and a
 * series landing page with no chapter list is the same empty page with a
 * different header. The writer's own stories are excluded on purpose: a story
 * still being written is registered under a session id before the server has
 * a row for it, and asking the server for that id's chapters would fail and
 * tell the writer their own story could not be opened.
 */
export function needsChapters(story: Story, ownIds: ReadonlySet<string>): boolean {
  return story.chapters.length === 0 && !ownIds.has(story.id);
}

/**
 * A series gets a landing page; a standalone opens straight into its prose.
 *
 * The landing page earns its extra tap only when there is something to land
 * ON - a chapter list to choose from, a series premise to read before
 * committing. For a single-chapter story that page would be a wall between
 * the reader and the one thing they tapped for, so the tap goes where the
 * intent went.
 *
 * Call it on a HYDRATED story. A metadata-only copy has no chapters to count,
 * so the answer would rest on `storyMode` alone.
 */
export function isSeries(story: Story): boolean {
  return story.storyMode === "series" || story.chapters.length > 1;
}

/** Where a tap on this story lands. */
export function openTarget(story: Story): "story" | "reader" {
  return isSeries(story) ? "story" : "reader";
}

/**
 * What happened when a chapterless story was asked for its chapters.
 *
 * - `open`: there is something to read; `story` is the hydrated copy, and it
 *   is the one to store and to route on.
 * - `unreachable`: the fetch failed. The tap is worth trying again.
 * - `unpublished`: the fetch worked and there is nothing to read. Trying
 *   again will not help, and the reader should be told which one this is.
 *
 * Neither of the last two may navigate. Opening the reader on the
 * metadata-only copy put people inside a story with a cover, a title and no
 * words, with nothing to retry.
 */
export type HydratedOpen =
  | { kind: "open"; story: Story }
  | { kind: "unreachable" }
  | { kind: "unpublished" };

/**
 * Fetch a story's chapters and say whether it can be opened.
 *
 * The loader is a parameter rather than an import so this stays a pure
 * decision over whatever `loadStoryChapters` answers -- which is what makes
 * "never open a reader on an empty chapter list" something a test can pin
 * without rendering the whole app.
 */
export async function hydrateForOpen(
  story: Story,
  load: (story: Story) => Promise<{ ok: boolean; story: Story }>,
): Promise<HydratedOpen> {
  const { ok, story: full } = await load(story);
  if (!ok) return { kind: "unreachable" };
  if (full.chapters.length === 0) return { kind: "unpublished" };
  return { kind: "open", story: full };
}
