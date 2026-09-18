/**
 * The Katha Originals reach the app.
 *
 * They did not. Home's house shelf was the bundled seed catalogue and nothing
 * on the client ever read a curated story from the database, so a story
 * published to production with `is_curated = true`, a cover and published
 * chapters appeared nowhere -- not on Home, not in a genre rail, not in
 * Explore's browse.
 *
 * These pin the read: curated rows only, newest first, bounded, metadata only
 * (a catalogue must not download every chapter of every novel on boot), mapped
 * by the same mapper the shelf reads use, and silent on failure because it
 * runs on boot.
 */
const mockFrom = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: {
    functions: { invoke: jest.fn() },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("@/lib/session", () => ({
  bootstrapUser: () => Promise.resolve({ userId: "u1", balance: 10 }),
}));

// Imported after the mocks, deliberately: they must be registered before the
// module under test loads.
/* eslint-disable import/first */
import { CURATED_LIMIT, fetchCuratedStories } from "@/lib/api";
/* eslint-enable import/first */

type Calls = {
  select: unknown[];
  eq: unknown[][];
  neq: unknown[][];
  order: unknown[][];
  limit: unknown[];
};

/**
 * Stub `supabase.from("stories")` and record the query that was built.
 * `stories` ends its chain on `.limit()`. Any read of `chapters` is recorded
 * too, because there must not be one.
 */
function stubStories(result: { data: unknown; error: unknown } | "throw"): Calls {
  const calls: Calls = { select: [], eq: [], neq: [], order: [], limit: [] };
  mockFrom.mockImplementation((table: string) => {
    if (table !== "stories") {
      throw new Error(`unexpected read of ${table}`);
    }
    const chain: Record<string, unknown> = {};
    chain.select = (columns: unknown) => {
      calls.select.push(columns);
      return chain;
    };
    chain.eq = (...args: unknown[]) => {
      calls.eq.push(args);
      return chain;
    };
    chain.neq = (...args: unknown[]) => {
      calls.neq.push(args);
      return chain;
    };
    chain.order = (...args: unknown[]) => {
      calls.order.push(args);
      return chain;
    };
    chain.limit = (count: unknown) => {
      calls.limit.push(count);
      if (result === "throw") return Promise.reject(new Error("network"));
      return Promise.resolve(result);
    };
    return chain;
  });
  return calls;
}

const CURATED_ROW = {
  id: "orig-1",
  title: "The Salt Orchard",
  author_id: "katha",
  primary_genre: "fantasy",
  genre: ["fantasy"],
  topic: "A witch inherits an orchard that grows memories instead of fruit.",
  cover_image_url: "https://cdn.test/covers/orig-1/cover.png",
  cover_status: "ready",
  is_curated: true,
  is_public: true,
  story_mode: "series",
  planned_chapter_count: 7,
  like_count: 12,
  bookmark_count: 3,
  read_count: 140,
  themes: ["found family", "grief"],
  created_at: "2026-09-10T08:00:00Z",
};

beforeEach(() => {
  mockFrom.mockReset();
});

it("asks for curated, finished stories only, newest first, and bounded", async () => {
  const calls = stubStories({ data: [], error: null });

  await fetchCuratedStories();

  expect(mockFrom).toHaveBeenCalledWith("stories");
  expect(calls.eq).toEqual(
    expect.arrayContaining([
      ["is_curated", true],
      ["status", "complete"],
    ]),
  );
  expect(calls.order).toEqual([["created_at", { ascending: false }]]);
  expect(calls.limit).toEqual([CURATED_LIMIT]);
  expect(CURATED_LIMIT).toBe(120);
});

it("selects no chapter bodies and never reads the chapters table", async () => {
  // Eighty-odd novels on boot, every chapter of each, before Home's first
  // frame, for a reader who will open two of them. The chapters are fetched
  // on the tap instead. `stubStories` throws on any other table.
  const calls = stubStories({ data: [CURATED_ROW], error: null });

  const stories = await fetchCuratedStories();

  expect(stories).toHaveLength(1);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  // `content_rating` is a story column; `content` is a chapter body.
  const columns = String(calls.select[0]).split(",").map((c) => c.trim());
  expect(columns).not.toContain("content");
  expect(columns).toContain("is_curated");
});

it("maps a row into a Katha Original the Home rail will pick up", async () => {
  stubStories({ data: [CURATED_ROW], error: null });

  const [story] = await fetchCuratedStories();

  // `isFeatured` is what Home's "Katha Originals" rail filters on.
  expect(story.isFeatured).toBe(true);
  expect(story.id).toBe("orig-1");
  expect(story.title).toBe("The Salt Orchard");
  expect(story.genre).toBe("fantasy");
  expect(story.coverImageUrl).toBe("https://cdn.test/covers/orig-1/cover.png");
  expect(story.synopsis).toBe(
    "A witch inherits an orchard that grows memories instead of fruit.",
  );
  expect(story.views).toBe(140);
  expect(story.likes).toBe(12);
  // Metadata only: the open path hydrates it.
  expect(story.chapters).toEqual([]);
  // The row's mode, not a chapter count there is nothing to count for.
  expect(story.storyMode).toBe("series");
  expect(story.plannedChapterCount).toBe(7);
});

it("tags an original with its themes, not with the writer's 'draft' label", async () => {
  // Explore turns every tag into a filter chip. "draft" on eighty originals
  // would be a chip that selects the whole house catalogue.
  stubStories({ data: [CURATED_ROW], error: null });

  const [story] = await fetchCuratedStories();

  expect(story.tags).toEqual(["found family", "grief"]);
});

it("dates an original by its row, not as published today", async () => {
  stubStories({ data: [CURATED_ROW], error: null });

  const [story] = await fetchCuratedStories();

  expect(story.publishedOffset).toBeGreaterThan(0);
});

it("keeps the server's newest-first order", async () => {
  stubStories({
    data: [
      { ...CURATED_ROW, id: "newer", title: "Newer" },
      { ...CURATED_ROW, id: "older", title: "Older" },
    ],
    error: null,
  });

  const stories = await fetchCuratedStories();

  expect(stories.map((story) => story.id)).toEqual(["newer", "older"]);
});

it("skips rows missing an id or a title instead of rendering a blank card", async () => {
  stubStories({
    data: [{ ...CURATED_ROW, id: undefined }, { ...CURATED_ROW, title: "" }, null, CURATED_ROW],
    error: null,
  });

  const stories = await fetchCuratedStories();

  expect(stories.map((story) => story.id)).toEqual(["orig-1"]);
});

it("returns nothing rather than throwing when the query errors", async () => {
  // Runs on boot. Empty means "keep the bundled catalogue", which is the
  // offline first launch -- not an error banner about a list.
  stubStories({ data: null, error: { message: "offline" } });
  expect(await fetchCuratedStories()).toEqual([]);
});

it("returns nothing rather than throwing when the request itself rejects", async () => {
  stubStories("throw");
  await expect(fetchCuratedStories()).resolves.toEqual([]);
});

test("never surfaces explicit curated stories, the same line Explore draws", async () => {
  const calls = stubStories({ data: [CURATED_ROW], error: null });
  await fetchCuratedStories();
  expect(calls.neq).toContainEqual(["content_rating", "explicit"]);
});
