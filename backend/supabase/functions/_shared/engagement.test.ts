import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRecordRead, handleToggle } from "./engagement.ts";

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
