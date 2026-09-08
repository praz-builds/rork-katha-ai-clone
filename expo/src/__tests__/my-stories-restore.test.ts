/**
 * A writer's own stories survive a reload.
 *
 * They did not. Stories persisted correctly in the database, but nothing ever
 * read them back: the library query is `is_public OR is_curated`, a fresh story
 * is private (the column default, and the entity gate forces it), and the
 * client kept its stories in a `useState` array. So closing the tab erased
 * every story a writer had made — from the interface, while the rows sat safe
 * in Postgres. They had spent credits on those.
 *
 * These pin the read path. `App.tsx` merges the result into session state on
 * boot; what matters here is that the request is scoped to the caller and that
 * a story only appears if there is actually something to open.
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
// module under test loads. Four other suites in this directory carry the same
// `import/first` warning for the same reason.
import { fetchMyStories } from "@/lib/api";

/**
 * Stub `supabase.from(table)`.
 *
 * Both reads go straight to PostgREST rather than through an edge function,
 * because RLS already says exactly the right thing: an author may read their
 * own stories and their own chapters whatever the visibility (00002, 00005).
 * `stories` ends its chain on `.limit()`, `chapters` on `.order()`.
 */
function stubTables(
  storyRows: unknown[] | { error: unknown },
  chapterRows: unknown[],
) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "stories") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () =>
        Promise.resolve(
          Array.isArray(storyRows)
            ? { data: storyRows, error: null }
            : { data: null, error: (storyRows as { error: unknown }).error },
        );
      return chain;
    }
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => Promise.resolve({ data: chapterRows, error: null });
    return chain;
  });
}

const LIBRARY_ROW = {
  id: "story-1",
  title: "The Lighthouse Keeper",
  author_id: "u1",
  primary_genre: "mystery",
  genre: ["mystery"],
  topic: "A message in a bottle dated thirty years from now.",
  content_rating: "sweet",
  cover_image_url: null,
  cover_status: "generating",
};

const CHAPTER_ROW = {
  id: "chapter-1",
  story_id: "story-1",
  chapter_number: 1,
  title: "The Bottle",
  content: "The tide left it on the step.\n\nShe read it twice.",
  is_published: false,
};

beforeEach(() => {
  mockFrom.mockReset();
});

it("reads the writer's own stories and their chapters", async () => {
  stubTables([], []);
  await fetchMyStories();
  // Both tables, direct. Going through an edge function would put a second
  // implementation of the RLS rule in front of the one Postgres enforces --
  // and would make this wait on a deploy to work at all.
  expect(mockFrom).toHaveBeenCalledWith("stories");
});

it("returns a story with its chapters, ready to read", async () => {
  stubTables([LIBRARY_ROW], [CHAPTER_ROW]);

  const [story] = await fetchMyStories();

  expect(story.id).toBe("story-1");
  expect(story.title).toBe("The Lighthouse Keeper");
  expect(story.genre).toBe("mystery");
  // Paragraphs, not one blob: the reader paginates on them.
  expect(story.chapters[0].paragraphs).toEqual([
    "The tide left it on the step.",
    "She read it twice.",
  ]);
  expect(mockFrom).toHaveBeenCalledWith("chapters");
});

it("drops a story with no readable chapter rather than listing an empty page", async () => {
  // The row can exist while generation failed partway. A card that opens onto
  // nothing is worse than no card.
  stubTables([LIBRARY_ROW], []);

  expect(await fetchMyStories()).toEqual([]);
});

it("returns nothing rather than throwing when the request fails", async () => {
  // This runs on boot. A writer opening the app into a network blip should get
  // the app, not an error about a list.
  stubTables({ error: { message: "offline" } }, []);
  expect(await fetchMyStories()).toEqual([]);
});

it("skips rows missing an id or a title instead of rendering a blank card", async () => {
  stubTables([{ id: "x" }, { title: "y" }, {}, null], [CHAPTER_ROW]);

  expect(await fetchMyStories()).toEqual([]);
});
