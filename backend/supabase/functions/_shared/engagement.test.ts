import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dwellTodaySeconds,
  handleRecordRead,
  handleToggle,
  readEarnsStreak,
} from "./engagement.ts";

Deno.test("handleToggle answers CORS preflight without auth", async () => {
  const response = await handleToggle(
    new Request("https://example.com/like", { method: "OPTIONS" }),
    { bodyKey: "storyId", rpc: "toggle_story_like", logName: "like" },
  );

  assertEquals(response.status, 204);
});

Deno.test("handleToggle rejects non-POST methods", async () => {
  const response = await handleToggle(
    new Request("https://example.com/like", { method: "GET" }),
    { bodyKey: "storyId", rpc: "toggle_story_like", logName: "like" },
  );

  assertEquals(response.status, 405);
  assertEquals(await response.json(), { error: "Method not allowed" });
});

Deno.test("handleToggle requires auth before reading the body", async () => {
  const response = await handleToggle(
    new Request("https://example.com/like", {
      method: "POST",
      body: "{}",
    }),
    { bodyKey: "storyId", rpc: "toggle_story_like", logName: "like" },
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Unauthorized" });
});

Deno.test("handleRecordRead rejects non-POST methods", async () => {
  const response = await handleRecordRead(
    new Request("https://example.com/record-read", { method: "GET" }),
  );

  assertEquals(response.status, 405);
  assertEquals(await response.json(), { error: "Method not allowed" });
});

Deno.test("a reading day needs someone else's story and 60 seconds today", async () => {
  let fetched = 0;
  const read = (
    over: Partial<
      Omit<Parameters<typeof readEarnsStreak>[0], "dwellTodaySeconds">
    >,
    dwell = 0,
  ) =>
    readEarnsStreak({
      isOwnStory: false,
      durationSeconds: 0,
      recorded: true,
      dwellTodaySeconds: () => {
        fetched++;
        return Promise.resolve(dwell);
      },
      ...over,
    });

  // A long read answers alone, without asking for the day's sum.
  assertEquals(await read({ durationSeconds: 60 }), true);
  assertEquals(fetched, 0);

  assertEquals(await read({ durationSeconds: 59 }, 59), false);
  assertEquals(await read({ durationSeconds: undefined }), false);
  // Five 40-second chapters: the fifth row is already in the day's sum.
  assertEquals(await read({ durationSeconds: 40 }, 200), true);
  // A deduped request whose earlier row is from yesterday (the dedup window
  // is a rolling 24h) is not in today's sum, so it is added on top.
  assertEquals(await read({ durationSeconds: 30, recorded: false }, 30), true);

  // The author's own chapter never counts as reading, and is never summed.
  fetched = 0;
  assertEquals(
    await read({ isOwnStory: true, durationSeconds: 600 }, 600),
    false,
  );
  assertEquals(fetched, 0);
});

/** A PostgREST builder stand-in that records the filters it was given. */
function fakeStoryReads(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === "limit" ? Promise.resolve(result) : builder;
    };
  }
  const service = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { service, calls };
}

Deno.test("the day's dwell sums other people's stories since UTC midnight", async () => {
  const { service, calls } = fakeStoryReads({
    data: [{ duration_seconds: 40 }, { duration_seconds: null }, {
      duration_seconds: 25,
    }],
    error: null,
  });
  const total = await dwellTodaySeconds(
    service as never,
    "user-1",
    new Date("2026-10-01T15:30:00Z"),
  );
  assertEquals(total, 65);
  assertEquals(calls, [
    ["from", "story_reads"],
    ["select", "duration_seconds"],
    ["eq", "user_id", "user-1"],
    ["eq", "is_own_story", false],
    ["gte", "read_at", "2026-10-01T00:00:00.000Z"],
    ["limit", 200],
  ]);
});

Deno.test("a failed dwell sum withholds the day rather than granting it", async () => {
  const { service } = fakeStoryReads({ data: null, error: new Error("503") });
  assertEquals(await dwellTodaySeconds(service as never, "user-1"), 0);
});
