import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ChapterUpdateClient,
  type ChapterUpdateFilter,
  updateChapterContentIfUnchanged,
} from "./chapters.ts";

type Recorded = {
  table: string;
  values: Record<string, unknown>;
  filters: [string, unknown][];
  selected: string | null;
};

/** Minimal stand-in for the PostgREST builder, recording what the helper asked for. */
function stubClient(
  rows: unknown[] | null,
  error: unknown = null,
): { client: ChapterUpdateClient; recorded: Recorded } {
  const recorded: Recorded = {
    table: "",
    values: {},
    filters: [],
    selected: null,
  };

  const filter: ChapterUpdateFilter = {
    eq(column, value) {
      recorded.filters.push([column, value]);
      return filter;
    },
    select(columns) {
      recorded.selected = columns;
      return Promise.resolve({ data: rows, error });
    },
  };

  return {
    recorded,
    client: {
      from(table) {
        recorded.table = table;
        return {
          update(values) {
            recorded.values = values;
            return filter;
          },
        };
      },
    },
  };
}

Deno.test("chapter update carries the read content as its concurrency predicate", async () => {
  const { client, recorded } = stubClient([{ id: "chapter-1" }]);

  const result = await updateChapterContentIfUnchanged(client, {
    chapterId: "chapter-1",
    previousContent: "one\n\ntwo",
    nextContent: "one\n\nTWO",
    wordCount: 2,
  });

  assertEquals(result.updated, true);
  assertEquals(recorded.table, "chapters");
  assertEquals(recorded.values, { content: "one\n\nTWO", word_count: 2 });
  assertEquals(recorded.filters, [
    ["id", "chapter-1"],
    ["content", "one\n\ntwo"],
  ]);
  // Without asking for rows back there is no way to tell a no-op apart from a
  // successful write, which is the whole point of the predicate.
  assertEquals(recorded.selected, "id");
});

Deno.test("chapter update reports a conflict when a concurrent edit already landed", async () => {
  for (const rows of [[], null]) {
    const { client } = stubClient(rows);
    const result = await updateChapterContentIfUnchanged(client, {
      chapterId: "chapter-1",
      previousContent: "stale",
      nextContent: "next",
      wordCount: 1,
    });
    assertEquals(result.updated, false);
  }
});

Deno.test("chapter update surfaces a database error rather than reporting success", async () => {
  const { client } = stubClient(null, { message: "boom" });
  let thrown: unknown = null;
  try {
    await updateChapterContentIfUnchanged(client, {
      chapterId: "chapter-1",
      previousContent: "a",
      nextContent: "b",
      wordCount: 1,
    });
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown, { message: "boom" });
});
