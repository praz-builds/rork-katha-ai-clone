/**
 * `allStories`: what Home, Explore and the reader resolve a story id against,
 * and what happens when a reader taps a story that arrived without chapters.
 *
 * Two failures this pins, both of which the Katha Originals made possible:
 *
 * 1. The bundled seed catalogue -- placeholder stories with invented counts
 *    and expired narration links -- sitting on Home beside the real
 *    originals, indistinguishable from them. It must go once the real ones
 *    load, and must still be there when they do not (an offline first launch
 *    is not an empty Home).
 * 2. A reader opening a curated story onto a cover, a title and no words,
 *    because the catalogue read is metadata only and nothing fetched the
 *    chapters before navigating.
 */
import {
  buildStoryCatalogue,
  hydrateForOpen,
  isSeries,
  needsChapters,
  openTarget,
} from "@/lib/story-catalogue";
import type { Chapter, Story } from "@/types/domain";

function chapter(storyId: string, n: number): Chapter {
  return {
    id: `${storyId}-c${n}`,
    storyId,
    title: `Chapter ${n}`,
    paragraphs: ["It began."],
    chapterNumber: n,
    chapterRole: "standalone",
    isPublished: true,
  };
}

function story(id: string, overrides: Partial<Story> = {}): Story {
  return {
    id,
    title: id,
    authorId: "a",
    genre: "mystery",
    synopsis: "",
    chapters: [],
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: 0,
    isFeatured: false,
    language: "English",
    ...overrides,
  } as Story;
}

const SEED = [
  story("seed-1", { chapters: [chapter("seed-1", 1)] }),
  story("seed-2", { chapters: [chapter("seed-2", 1)] }),
];
const CURATED = [
  story("orig-1", { isFeatured: true }),
  story("orig-2", { isFeatured: true }),
  story("orig-3", { isFeatured: true }),
];

const ids = (list: Story[]) => list.map((item) => item.id);

describe("buildStoryCatalogue", () => {
  it("falls back to the bundled seed catalogue when no originals have loaded", () => {
    // The offline first launch, or a deploy with nothing curated yet: the
    // alternative is a Home with nothing on it.
    const all = buildStoryCatalogue({
      generated: [],
      discovered: [],
      curated: [],
      seed: SEED,
    });

    expect(ids(all)).toEqual(["seed-1", "seed-2"]);
  });

  it("drops every seed story once the real originals are in", () => {
    const all = buildStoryCatalogue({
      generated: [],
      discovered: [],
      curated: CURATED,
      seed: SEED,
    });

    expect(ids(all)).toEqual(["orig-1", "orig-2", "orig-3"]);
    expect(all.every((item) => item.isFeatured)).toBe(true);
  });

  it("puts the writer's own stories first", () => {
    const mine = story("mine", { chapters: [chapter("mine", 1)] });

    const all = buildStoryCatalogue({
      generated: [mine],
      discovered: [],
      curated: CURATED,
      seed: SEED,
    });

    expect(ids(all)).toEqual(["mine", "orig-1", "orig-2", "orig-3"]);
  });

  it("swaps an opened original into its own slot rather than appending it", () => {
    // Appending would put the card on Home twice; first-one-wins would jump
    // it to the front of Katha Originals the moment somebody opened it.
    const hydrated = { ...CURATED[1], chapters: [chapter("orig-2", 1)] };

    const all = buildStoryCatalogue({
      generated: [],
      discovered: [hydrated],
      curated: CURATED,
      seed: SEED,
    });

    expect(ids(all)).toEqual(["orig-1", "orig-2", "orig-3"]);
    expect(all[1]).toBe(hydrated);
    expect(all[1].chapters).toHaveLength(1);
  });

  it("keeps a search result that is not a house story between the writer's and the house's", () => {
    const found = story("found", { chapters: [chapter("found", 1)] });

    const all = buildStoryCatalogue({
      generated: [],
      discovered: [found],
      curated: CURATED,
      seed: SEED,
    });

    expect(ids(all)).toEqual(["found", "orig-1", "orig-2", "orig-3"]);
  });

  it("never lists one id twice, and the writer's copy wins", () => {
    const mineAndCurated = story("orig-1", {
      chapters: [chapter("orig-1", 1)],
      title: "my copy",
    });

    const all = buildStoryCatalogue({
      generated: [mineAndCurated],
      discovered: [{ ...CURATED[0], title: "search copy" }],
      curated: CURATED,
      seed: SEED,
    });

    expect(ids(all)).toEqual(["orig-1", "orig-2", "orig-3"]);
    expect(all[0].title).toBe("my copy");
  });
});

describe("opening a story that arrived without chapters", () => {
  it("needs chapters when it has none and is not the writer's own", () => {
    expect(needsChapters(CURATED[0], new Set())).toBe(true);
    expect(needsChapters(SEED[0], new Set())).toBe(false);
  });

  it("leaves the writer's own story alone even before it has chapters", () => {
    // A story still being written is keyed by a session id the server has no
    // row for yet; asking for its chapters would fail and tell the writer
    // their own story could not be opened.
    expect(needsChapters(story("session-1"), new Set(["session-1"]))).toBe(false);
  });

  it("opens the hydrated copy, and routes a series to its landing page", async () => {
    const original = story("orig-1", { storyMode: "series" });
    const load = jest.fn(async (s: Story) => ({
      ok: true,
      story: { ...s, chapters: [chapter(s.id, 1)] },
    }));

    const opened = await hydrateForOpen(original, load);

    expect(load).toHaveBeenCalledWith(original);
    expect(opened.kind).toBe("open");
    if (opened.kind !== "open") return;
    expect(opened.story.chapters).toHaveLength(1);
    expect(openTarget(opened.story)).toBe("story");
  });

  it("routes a standalone straight into the reader", async () => {
    const opened = await hydrateForOpen(story("orig-2"), async (s) => ({
      ok: true,
      story: { ...s, chapters: [chapter(s.id, 1)] },
    }));

    expect(opened.kind).toBe("open");
    if (opened.kind !== "open") return;
    expect(openTarget(opened.story)).toBe("reader");
  });

  it("decides series-or-standalone on the hydrated copy's chapters", async () => {
    // The metadata-only copy has nothing to count. A multi-chapter story whose
    // row says nothing about its mode is a series once its chapters are in.
    const bare = story("orig-3");
    expect(isSeries(bare)).toBe(false);

    const opened = await hydrateForOpen(bare, async (s) => ({
      ok: true,
      story: { ...s, chapters: [chapter(s.id, 1), chapter(s.id, 2)] },
    }));

    expect(opened.kind === "open" && openTarget(opened.story)).toBe("story");
  });

  it("does not open anything when the chapter fetch fails", async () => {
    const opened = await hydrateForOpen(story("orig-1"), async (s) => ({
      ok: false,
      story: s,
    }));

    expect(opened).toEqual({ kind: "unreachable" });
  });

  it("does not open a reader on an empty chapter list", async () => {
    // The fetch worked and the story has no published chapter. That is a real
    // answer, and it is still not something to navigate into.
    const opened = await hydrateForOpen(story("orig-1"), async (s) => ({
      ok: true,
      story: s,
    }));

    expect(opened).toEqual({ kind: "unpublished" });
  });
});
