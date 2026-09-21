/**
 * The columns that recorded which paths a story took, read back at last.
 *
 * Migration 00078 has stored `directions_offered`, `direction_chosen` and
 * `direction_chosen_by` on every continuation since it landed. Nothing ever
 * selected them: no edge function, and on the client only the WRITE side of
 * the contract existed, where `directions_offered` travels up with a request.
 * So a perfect record accumulated in Postgres that the app could not see, and
 * the surface it was recorded for could not be built without this read.
 *
 * These pin the read and the parse. The parse matters more than it looks:
 * `directions_offered` is jsonb with no shape enforced by the database, and
 * the reader must render nothing -- never crash, never a blank card -- for
 * every value that is not a real offer.
 */
const mockFrom = jest.fn();
const selectArgs: string[] = [];

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
// module under test loads. Several other suites here carry the same
// `import/first` warning for the same reason.
import { fetchMyStories } from "@/lib/api";
import { loadStoryChapters } from "@/lib/search";

const STORY_ROW = {
  id: "story-1",
  title: "The Old Fort",
  author_id: "u1",
  primary_genre: "adventure",
  genre: ["adventure"],
  story_mode: "series",
  planned_chapter_count: 3,
};

const BASE_CHAPTER = {
  id: "chapter-2",
  story_id: "story-1",
  chapter_number: 2,
  title: "The Attic",
  content: "The attic door had not opened in years.",
  is_published: true,
};

/**
 * `stories` ends its chain on `.limit()`, `chapters` on `.order()`.
 *
 * The chapter rows are PROJECTED down to the columns the query actually asked
 * for, which is what PostgREST does and what a mock that hands back the whole
 * row cannot see. Without it every assertion below passes against a select
 * that never mentions the direction columns -- which is exactly the bug this
 * file exists for, dressed up as a green test.
 */
function stubTables(chapterRows: unknown[]) {
  selectArgs.length = 0;
  mockFrom.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    let selected: string[] = [];
    chain.select = (columns: string) => {
      if (table === "chapters") {
        selectArgs.push(columns);
        selected = columns.split(",").map((column) => column.trim());
      }
      return chain;
    };
    chain.eq = () => chain;
    chain.order = () =>
      table === "chapters"
        ? Promise.resolve({
          data: chapterRows.map((row) => {
            const record = row as Record<string, unknown>;
            const projected: Record<string, unknown> = {};
            selected.forEach((column) => {
              if (column in record) projected[column] = record[column];
            });
            return projected;
          }),
          error: null,
        })
        : chain;
    chain.limit = () => Promise.resolve({ data: [STORY_ROW], error: null });
    return chain;
  });
}

beforeEach(() => {
  mockFrom.mockReset();
});

it("asks for the three direction columns", async () => {
  stubTables([BASE_CHAPTER]);

  await fetchMyStories();

  // Named individually: a select that lost one of them would still pass a test
  // that only checked the string was non-empty, and the missing one would be
  // invisible until a reader saw a boundary with no paths on it.
  expect(selectArgs[0]).toContain("directions_offered");
  expect(selectArgs[0]).toContain("direction_chosen");
  expect(selectArgs[0]).toContain("direction_chosen_by");
});

it("carries an offer, the direction taken, and who took it", async () => {
  stubTables([
    {
      ...BASE_CHAPTER,
      directions_offered: [
        { id: "beat-2", prompt: "Ask Aaji to open the stuck page." },
        { id: "hook-0", prompt: "Follow the map fragment under the floorboard." },
      ],
      direction_chosen: "Ask Aaji to open the stuck page.",
      direction_chosen_by: "reader",
    },
  ]);

  const [story] = await fetchMyStories();
  const chapter = story.chapters[0];

  expect(chapter.directionsOffered).toEqual([
    { id: "beat-2", prompt: "Ask Aaji to open the stuck page." },
    { id: "hook-0", prompt: "Follow the map fragment under the floorboard." },
  ]);
  expect(chapter.directionChosen).toBe("Ask Aaji to open the stuck page.");
  expect(chapter.directionChosenBy).toBe("reader");
});

it("leaves a chapter written before 00078 with nothing to show", async () => {
  // Null is not "no directions were offered", it is "nobody recorded what was
  // offered". The surface renders nothing at all for it, and that starts here.
  stubTables([
    {
      ...BASE_CHAPTER,
      directions_offered: null,
      direction_chosen: null,
      direction_chosen_by: null,
    },
  ]);

  const [story] = await fetchMyStories();

  expect(story.chapters[0].directionsOffered).toBeUndefined();
  expect(story.chapters[0].directionChosen).toBeUndefined();
  expect(story.chapters[0].directionChosenBy).toBeUndefined();
});

it.each([
  ["an empty array", []],
  ["a string", "Ask Aaji to open the stuck page."],
  ["an object", { id: "beat-2", prompt: "Ask Aaji." }],
  ["a number", 7],
  ["an array of nulls", [null, null]],
  ["an array of strings", ["Ask Aaji."]],
  ["rows with no prompt", [{ id: "beat-2" }, { id: "hook-0", prompt: "   " }]],
  ["nested arrays", [["Ask Aaji."]]],
])("renders nothing for %s rather than crashing", async (_label, offered) => {
  stubTables([{ ...BASE_CHAPTER, directions_offered: offered }]);

  const [story] = await fetchMyStories();

  // Undefined, not `[]`: the block above it renders on presence, and an empty
  // array would put a heading over nothing.
  expect(story.chapters[0].directionsOffered).toBeUndefined();
});

it("keeps the usable rows out of a partly malformed offer", async () => {
  stubTables([
    {
      ...BASE_CHAPTER,
      directions_offered: [
        { prompt: "Ask Aaji to open the stuck page." },
        null,
        { id: "hook-0" },
        "Follow the map.",
        { id: "hook-1", prompt: "Follow the map fragment." },
      ],
    },
  ]);

  const [story] = await fetchMyStories();

  // The row that lost its id keeps its prose and borrows its position; the
  // ones with no prose have nothing to show and are dropped.
  expect(story.chapters[0].directionsOffered).toEqual([
    { id: "offered-0", prompt: "Ask Aaji to open the stuck page." },
    { id: "hook-1", prompt: "Follow the map fragment." },
  ]);
});

it.each(["writer", "", "READER", 3, null, undefined])(
  "refuses to attribute a choice to %p",
  async (chosenBy) => {
    // The CHECK constraint allows three values. Anything else means nobody
    // knows who decided, and a default here would put a sentence about a
    // decision under a chapter that has no record of one.
    stubTables([{ ...BASE_CHAPTER, direction_chosen_by: chosenBy }]);

    const [story] = await fetchMyStories();

    expect(story.chapters[0].directionChosenBy).toBeUndefined();
  },
);

/**
 * THE OTHER READ, WHICH IS THE ONE MOST READERS GO THROUGH.
 *
 * `fetchMyStories` above serves the stories you WROTE. Everything opened from
 * Explore, from search, or from a curated rail is hydrated by
 * `loadStoryChapters` instead — somebody else's story, which is the only kind
 * whose branching a reader is ever actually curious about.
 *
 * The two are separate selects in separate modules, so the feature can be
 * complete on one path and absent on the other with every other test green.
 * It was: the first version of this work read the columns only in `api.ts`,
 * and the block would have rendered on nothing a reader was likely to open.
 */
it("refuses to render an unbounded offer", async () => {
  // Only `service_role` writes this column, so this is not a reachable attack
  // today. It is a refusal to hand a jsonb column with no enforced shape
  // straight to a non-virtualised `View`: one card per entry, drawn at a
  // chapter boundary the reader is trying to read past.
  stubTables([
    {
      ...BASE_CHAPTER,
      directions_offered: Array.from({ length: 5000 }, (_, i) => ({
        id: `beat-${i}`,
        prompt: `Path ${i}`,
      })),
    },
  ]);

  const [story] = await fetchMyStories();

  expect(story.chapters[0].directionsOffered).toHaveLength(8);
});

describe("the stories somebody else wrote", () => {
  const OTHER_STORY = {
    id: "story-2",
    title: "Salt Weather",
    authorId: "someone-else",
    chapters: [],
  } as unknown as Parameters<typeof loadStoryChapters>[0];

  it("asks for the three direction columns on this path too", async () => {
    stubTables([{ ...BASE_CHAPTER, story_id: "story-2" }]);

    await loadStoryChapters(OTHER_STORY);

    expect(selectArgs[0]).toContain("directions_offered");
    expect(selectArgs[0]).toContain("direction_chosen");
    expect(selectArgs[0]).toContain("direction_chosen_by");
  });

  it("parses them the same way `api.ts` does", async () => {
    stubTables([
      {
        ...BASE_CHAPTER,
        story_id: "story-2",
        directions_offered: [
          { id: "beat-1", prompt: "Wait for the tide to turn." },
          { prompt: "   " },
        ],
        direction_chosen: "Wait for the tide to turn.",
        direction_chosen_by: "ranking",
      },
    ]);

    const { ok, story } = await loadStoryChapters(OTHER_STORY);

    expect(ok).toBe(true);
    // The promptless row is dropped rather than rendered blank, exactly as on
    // the other path — both go through `lib/chapter-directions.ts` so they
    // cannot drift into disagreeing about what a malformed offer means.
    expect(story.chapters[0].directionsOffered).toEqual([
      { id: "beat-1", prompt: "Wait for the tide to turn." },
    ]);
    expect(story.chapters[0].directionChosen).toBe("Wait for the tide to turn.");
    expect(story.chapters[0].directionChosenBy).toBe("ranking");
  });

  it("leaves a pre-00078 chapter with nothing to render", async () => {
    stubTables([{ ...BASE_CHAPTER, story_id: "story-2" }]);

    const { story } = await loadStoryChapters(OTHER_STORY);

    // `undefined`, not `[]`: the render gate is presence, and an empty array
    // would put a heading over a chapter nobody knows was offered anything.
    expect(story.chapters[0].directionsOffered).toBeUndefined();
    expect(story.chapters[0].directionChosenBy).toBeUndefined();
  });
});
