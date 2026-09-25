/**
 * What Explore's search actually sends, and what it refuses to send.
 *
 * `explore-search.test.tsx` covers the field: the debounce, the abort, the
 * out-of-order guard. This covers the QUERY, which is the half with a
 * security surface on it. Three of the clauses in `searchStories` are not
 * features, they are the visibility rules the feed enforces, restated on the
 * client because there is no `search` edge function to hold them:
 *
 *   - `is_public OR is_curated`      — a private story is not a result
 *   - `content_rating <> 'explicit'` — browse never surfaces explicit work
 *   - `author_id NOT IN (blocked)`   — the reader's own block list
 *
 * A refactor that drops any one of those shows somebody a row the product
 * promised they would not see, and it does so silently. So they are asserted
 * here against a recorded query, including in the combination a code review
 * flagged as the dangerous one: with a genre chip ALSO selected.
 */
type Call = { method: string; args: unknown[] };

const calls: Call[] = [];
let rows: unknown[] = [];
let queryError: unknown = null;
let blockRows: unknown[] | { error: unknown } = [];
let mockUserId: string | null = "reader-1";

const mockFrom = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: mockUserId ? { id: mockUserId } : null },
          error: null,
        }),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

/* eslint-disable import/first */
import {
  loadStoryChapters,
  mapSearchRow,
  publishedOffsetFrom,
  searchStories,
  themeTags,
} from "@/lib/search";
/* eslint-enable import/first */

/**
 * A chainable PostgREST stub that RECORDS rather than interprets.
 *
 * Every filter method returns the same object and appends to `calls`, so a
 * test can ask "was `neq('content_rating', 'explicit')` on this query?"
 * without a Postgres to run it against. The chain resolves at `.limit()`,
 * which is where `searchStories` ends it.
 */
function stubTables() {
  calls.length = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "user_blocks") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.abortSignal = () => chain;
      chain.eq = () =>
        Promise.resolve(
          Array.isArray(blockRows)
            ? { data: blockRows, error: null }
            : { data: null, error: (blockRows as { error: unknown }).error },
        );
      return chain;
    }
    if (table === "profiles") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.ilike = () => chain;
      chain.abortSignal = () => chain;
      chain.limit = () => Promise.resolve({ data: [], error: null });
      return chain;
    }
    // `stories`
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
    chain.select = record("select");
    chain.eq = record("eq");
    chain.neq = record("neq");
    chain.or = record("or");
    chain.not = record("not");
    chain.order = record("order");
    chain.abortSignal = record("abortSignal");
    chain.limit = (...args: unknown[]) => {
      calls.push({ method: "limit", args });
      return Promise.resolve({ data: queryError ? null : rows, error: queryError });
    };
    return chain;
  });
}

const had = (method: string, ...args: unknown[]) =>
  calls.some((call) =>
    call.method === method &&
    JSON.stringify(call.args.slice(0, args.length)) === JSON.stringify(args)
  );

beforeEach(() => {
  rows = [];
  queryError = null;
  blockRows = [];
  mockUserId = "reader-1";
  stubTables();
});

describe("the visibility clauses survive every other filter", () => {
  it("keeps them when a genre is selected as well as a term", async () => {
    blockRows = [{ blocked_id: "blocked-author" }];

    const outcome = await searchStories({ text: "wolf", genre: "fantasy" });
    expect(outcome.source).toBe("supabase");

    // The four rules, all still on the query with genre and term applied.
    expect(had("eq", "status", "complete")).toBe(true);
    expect(had("or", "is_public.eq.true,is_curated.eq.true")).toBe(true);
    expect(had("neq", "content_rating", "explicit")).toBe(true);
    expect(had("not", "author_id", "in", "(blocked-author)")).toBe(true);

    // And the genre and title disjunctions are BOTH there, as separate `or`
    // groups. postgrest-js appends each one (`searchParams.append("or", …)`,
    // PostgrestFilterBuilder), so they arrive as two `or=` params that
    // PostgREST combines with AND — the second does not replace the first.
    const ors = calls.filter((call) => call.method === "or").map((call) =>
      call.args[0]
    );
    expect(ors).toEqual([
      "is_public.eq.true,is_curated.eq.true",
      "title.ilike.*wolf*,topic.ilike.*wolf*",
      "primary_genre.eq.fantasy,genre.cs.{fantasy}",
    ]);
  });

  it("builds a URL that carries every or-group, not just the last", () => {
    // The mechanical half of the claim above, against the same API
    // postgrest-js uses. `append` is not `set`: three or-groups go out as
    // three `or=` params.
    const url = new URL("https://project.supabase.test/rest/v1/stories");
    for (const group of ["is_public.eq.true", "title.ilike.*w*", "genre.cs.{a}"]) {
      url.searchParams.append("or", `(${group})`);
    }
    expect(url.searchParams.getAll("or")).toEqual([
      "(is_public.eq.true)",
      "(title.ilike.*w*)",
      "(genre.cs.{a})",
    ]);
  });
});

describe("a block list that did not load", () => {
  it("falls back to the bundled catalogue rather than searching unfiltered", async () => {
    // Fail CLOSED. A block is a promise that one person will not have to see
    // another again, and the failure mode of getting it wrong is showing
    // them precisely the author they blocked, silently. The bundled
    // catalogue has no real authors in it, so it cannot contain one.
    blockRows = { error: { message: "network" } };
    rows = [{ id: "s1", title: "A story by somebody blocked" }];

    const outcome = await searchStories({ text: "wolf", genre: "fantasy" });

    expect(outcome.source).toBe("local");
    expect(outcome.stories.some((story) => story.id === "s1")).toBe(false);
    // The stories query was never even built.
    expect(calls.length).toBe(0);
  });

  it("still searches for a reader who is not signed in", async () => {
    // No session is an answer, not a failure: somebody with no account has
    // blocked nobody. Failing closed here would break search for every
    // signed-out reader, which is the opposite of the point.
    mockUserId = null;
    const outcome = await searchStories({ text: "wolf", genre: null });
    expect(outcome.source).toBe("supabase");
    expect(had("not", "author_id", "in", "()")).toBe(false);
  });
});

describe("how old a live result is", () => {
  it("dates it from created_at instead of calling everything new", () => {
    // Explore's Newest sort is `a.publishedOffset - b.publishedOffset`. Every
    // live row used to map to 0, so the comparator could not separate any two
    // of them and the list stayed in the server's like-count order — Newest
    // quietly behaved as a second Most-loved.
    const now = Date.parse("2026-03-10T12:00:00Z");
    const at = (iso: string) => publishedOffsetFrom(iso, now);

    expect(at("2026-03-10T08:00:00Z")).toBe(0); // this morning
    expect(at("2026-03-09T11:00:00Z")).toBe(1);
    expect(at("2026-02-08T12:00:00Z")).toBe(30);
    // Nothing to order by is still 0, as before.
    expect(publishedOffsetFrom(null, now)).toBe(0);
    expect(publishedOffsetFrom("not a date", now)).toBe(0);
    // A clock skewed into the future does not sort ahead of today.
    expect(at("2026-03-11T12:00:00Z")).toBe(0);
  });

  it("orders two rows the way Newest would", () => {
    const older = mapSearchRow({
      id: "a",
      title: "Older",
      created_at: "2026-01-01T00:00:00Z",
    });
    const newer = mapSearchRow({
      id: "b",
      title: "Newer",
      created_at: "2026-03-01T00:00:00Z",
    });
    expect(older).not.toBeNull();
    expect(newer).not.toBeNull();
    expect(newer!.publishedOffset).toBeLessThan(older!.publishedOffset);
  });
});

describe("opening a story whose chapters will not load", () => {
  const story = mapSearchRow({ id: "s9", title: "A story" })!;

  const stubChapters = (answer: unknown) =>
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => Promise.resolve(answer);
      return chain;
    });

  it("reports the failure instead of handing back a chapterless story", async () => {
    // The caller navigates on whatever comes back. Returning the
    // metadata-only copy on failure put the reader inside a story with a
    // cover, a title and no words — no error, no retry, indistinguishable
    // from a story nobody had written yet.
    stubChapters({ data: null, error: { message: "network" } });

    const result = await loadStoryChapters(story);
    expect(result.ok).toBe(false);
    expect(result.story.chapters).toEqual([]);
  });

  it("treats a story with no published chapters as an answer, not a failure", async () => {
    stubChapters({ data: [], error: null });
    expect((await loadStoryChapters(story)).ok).toBe(true);
  });

  it("returns the chapters when they load", async () => {
    stubChapters({
      data: [{
        id: "c1",
        story_id: "s9",
        chapter_number: 1,
        title: "One",
        content: "A line.\n\nAnother line.",
        is_published: true,
      }],
      error: null,
    });

    const result = await loadStoryChapters(story);
    expect(result.ok).toBe(true);
    expect(result.story.chapters).toHaveLength(1);
    expect(result.story.chapters[0].paragraphs).toEqual([
      "A line.",
      "Another line.",
    ]);
  });
});

describe("live rows carry their themes as tags", () => {
  it("maps themes to clean, capped tags so Explore's tag filter has something to filter", () => {
    const story = mapSearchRow({
      id: "t1",
      title: "Tagged",
      themes: ["  Found Family ", "found family", "grief", 7, "", "x".repeat(40), "a", "b", "c", "d", "e"],
    });
    expect(story!.tags).toEqual(["found family", "grief", "a", "b", "c", "d"]);
  });

  it("treats missing or malformed themes as no tags", () => {
    expect(themeTags(undefined)).toEqual([]);
    expect(themeTags("grief")).toEqual([]);
    expect(mapSearchRow({ id: "t2", title: "Bare" })!.tags).toEqual([]);
  });
});
