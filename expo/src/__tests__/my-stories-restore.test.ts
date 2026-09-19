/**
 * A writer's own stories survive a reload.
 *
 * They did not. Stories persisted correctly in the database, but nothing ever
 * read them back: the library query is `is_public OR is_curated`, a fresh story
 * is private unless the writer asked otherwise (the column default), and the
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

/**
 * The reload bug behind "the chapter end only offers a text box".
 *
 * `mapGeneratedStory` reads `beats` and `series_state` off the generation
 * response, so the continuation chips worked immediately after writing a
 * story. `hydrateStoryRow` hardcoded `beats: []` and `seriesState: undefined`,
 * and the query above never even asked for the columns -- so the moment the
 * app was reloaded and the story came back from Library or Home, the chips
 * vanished for good and the writer saw a bare "type a direction" box. The
 * backend was producing all of it correctly the whole time.
 */
const SERIES_ROW = {
  ...LIBRARY_ROW,
  story_mode: "series",
  planned_chapter_count: 7,
  beats: ["She finds the bottle", "The date is wrong", "Someone is waiting"],
  series_state: {
    open_hooks: ["Who wrote it?"],
    promised_payoffs: ["The keeper's name"],
    next_chapter_pressure: "The tide is coming back in",
    central_conflict: "A message that has not been written yet",
    world_facts: ["The lighthouse has been dark for thirty years"],
    character_changes: ["She stops sleeping"],
    delivered_moments: [],
  },
};

it("keeps beats and series state on a story hydrated from a row", async () => {
  stubTables([SERIES_ROW], [CHAPTER_ROW]);

  const [story] = await fetchMyStories();

  expect(story.beats).toEqual([
    "She finds the bottle",
    "The date is wrong",
    "Someone is waiting",
  ]);
  expect(story.seriesState?.open_hooks).toEqual(["Who wrote it?"]);
  expect(story.seriesState?.promised_payoffs).toEqual(["The keeper's name"]);
  expect(story.seriesState?.next_chapter_pressure).toBe(
    "The tide is coming back in",
  );
  // Everything `deriveContinuationOptions` needs is present, so the chapter
  // end can offer real directions rather than an empty box.
  expect(story.plannedChapterCount).toBe(7);
});

/**
 * A plan that is not one of the four lengths the picker offers.
 *
 * Every extension raises `planned_chapter_count` by exactly one, so 1, 2, 4
 * and 9 are ordinary stored values. The parser used to accept only 3, 7 and 15
 * and drop everything else to `undefined` -- which reads downstream as "no
 * plan", resolves to the default of 3, and tells the author of a four-chapter
 * story that it was complete at chapter three.
 */
it.each([1, 2, 4, 9, 15])("keeps a stored plan of %d chapters", async (planned) => {
  stubTables([{ ...SERIES_ROW, planned_chapter_count: planned }], [CHAPTER_ROW]);

  const [story] = await fetchMyStories();

  expect(story.plannedChapterCount).toBe(planned);
});

it.each([0, 16, 2.5, "7", null])(
  "drops a planned count of %p, which no writer of this column can produce",
  async (planned) => {
    stubTables([{ ...SERIES_ROW, planned_chapter_count: planned }], [CHAPTER_ROW]);

    const [story] = await fetchMyStories();

    expect(story.plannedChapterCount).toBeUndefined();
  },
);

it("trusts the row's story_mode over the number of chapters it happens to have", async () => {
  // A series whose second chapter has not been written yet has exactly one
  // chapter. Counting chapters called it a standalone and hid the continuation
  // UI on the one story that most needed it.
  stubTables([SERIES_ROW], [CHAPTER_ROW]);

  const [story] = await fetchMyStories();

  expect(story.storyMode).toBe("series");
});

it("survives a row written before those columns existed", async () => {
  stubTables([LIBRARY_ROW], [CHAPTER_ROW]);

  const [story] = await fetchMyStories();

  expect(story.beats).toEqual([]);
  expect(story.seriesState).toBeUndefined();
  expect(story.storyMode).toBe("standalone");
});
