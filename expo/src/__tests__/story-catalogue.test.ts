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
import { mapSearchRow } from "@/lib/search";
import { storyProgressLabel } from "@/screens/StoryDetailScreen";
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

  it("opens the hydrated copy, and routes it to the story page", async () => {
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
    // Routed on the HYDRATED copy, which is the one that has chapters to
    // show on the page being opened.
    expect(openTarget(opened.story)).toBe("story");
  });

  it("sends a one-chapter standalone to the story page too", async () => {
    // The old fork dropped this tap straight into the prose, so most of the
    // catalogue was read without its cover, blurb or author ever being seen.
    const opened = await hydrateForOpen(story("orig-2"), async (s) => ({
      ok: true,
      story: { ...s, chapters: [chapter(s.id, 1)] },
    }));

    expect(opened.kind).toBe("open");
    if (opened.kind !== "open") return;
    expect(openTarget(opened.story)).toBe("story");
  });

  it("still distinguishes a series from a standalone, for the copy that needs it", () => {
    // `isSeries` no longer routes anything; it is the definition of the
    // question two screens currently ask inline. The metadata-only copy has
    // nothing to count: a multi-chapter story whose row says nothing about
    // its mode is a series only once its chapters are in.
    const bare = story("orig-3");
    expect(isSeries(bare)).toBe(false);
    expect(isSeries({ ...bare, chapters: [chapter(bare.id, 1), chapter(bare.id, 2)] }))
      .toBe(true);
    expect(isSeries({ ...bare, storyMode: "series" })).toBe(true);
  });

  it("sends a story being written right now to the reader, not its story page", () => {
    // A story mid-generation has no chapters on the server and no story page
    // worth showing: it is watched, page by page, in the reader.
    const live = story("session-1");
    expect(openTarget(live, new Set(["session-1"]))).toBe("reader");
    expect(openTarget(live, new Set(["some-other-session"]))).toBe("story");
    // And once the session finishes it is an ordinary finished story again.
    expect(openTarget({ ...live, chapters: [chapter(live.id, 1)] }, new Set()))
      .toBe("story");
  });

  it("gives a search result its real chapter count before the story page reads it", async () => {
    // `mapSearchRow` always returns `chapters: []` -- the search query selects
    // metadata only. The story page counts chapters for its progress line, so
    // a tap that reached it on the unhydrated copy would say "0 chapters"
    // about a story with three. Every route into it goes through
    // `needsChapters` -> `hydrateForOpen` first, and this pins that the page
    // is handed the hydrated copy rather than the one the list held.
    const row = mapSearchRow({
      id: "found-1",
      title: "The Ferry",
      author_id: "a1",
      genre: "adventure",
      story_mode: "series",
      is_public: true,
    })!;
    expect(row.chapters).toHaveLength(0);
    expect(needsChapters(row, new Set())).toBe(true);
    expect(storyProgressLabel(row)).toBe("0 chapters");

    const opened = await hydrateForOpen(row, async (s) => ({
      ok: true,
      story: {
        ...s,
        chapters: [chapter(s.id, 1), chapter(s.id, 2), chapter(s.id, 3)],
      },
    }));

    expect(opened.kind).toBe("open");
    if (opened.kind !== "open") return;
    expect(openTarget(opened.story)).toBe("story");
    expect(storyProgressLabel(opened.story)).toBe("3 chapters");
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
