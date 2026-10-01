import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
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

Deno.test("a reading day needs someone else's story and 60 seconds today", () => {
  const read = (over: Partial<Parameters<typeof readEarnsStreak>[0]>) =>
    readEarnsStreak({
      isOwnStory: false,
      durationSeconds: 0,
      recorded: true,
      dwellTodaySeconds: 0,
      ...over,
    });
  assertEquals(read({ durationSeconds: 60 }), true);
  assertEquals(read({ durationSeconds: 59, dwellTodaySeconds: 59 }), false);
  assertEquals(read({ durationSeconds: undefined }), false);
  // Five 40-second chapters: the fifth row is already in the day's sum.
  assertEquals(read({ durationSeconds: 40, dwellTodaySeconds: 200 }), true);
  // A deduped request is not among the rows, so it is added on top.
  assertEquals(
    read({ durationSeconds: 30, recorded: false, dwellTodaySeconds: 30 }),
    true,
  );
  // The author's own chapter never counts as reading, however long.
  assertEquals(
    read({ isOwnStory: true, durationSeconds: 600, dwellTodaySeconds: 600 }),
    false,
  );
});
