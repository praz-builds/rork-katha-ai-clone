import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { reportCrudeLexicon } from "./content-scan.ts";

// `logError` degrades to a console line when service credentials are absent,
// which is exactly the state a unit test runs in. That is what makes these
// assertions safe without a database: the reporter's contract is that it
// returns the matched terms and never throws, whatever the logger does.

Deno.test("clean prose reports nothing", async () => {
  const terms = await reportCrudeLexicon(
    "He held the door a moment longer than he needed to, and she noticed.",
    { feature: "generate_story" },
  );
  assertEquals(terms, []);
});

Deno.test("a crude term is reported without rewriting the prose", async () => {
  const prose = "She reached for his dick.";
  const terms = await reportCrudeLexicon(prose, {
    feature: "generate_story",
    storyId: "8f14e45f-ceea-467a-9f8b-1a2b3c4d5e6f",
    userId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  });
  assertEquals(terms, ["dick"]);
  // Report-only is the whole design decision; a scan that mutated the text
  // would leave the streamed path showing one thing and storing another.
  assertEquals(prose, "She reached for his dick.");
});

Deno.test("a character named Dick does not fire the scan", async () => {
  const terms = await reportCrudeLexicon(
    "Dick Fenwick had not written a letter in thirty years.",
    { feature: "continue_story" },
  );
  assertEquals(terms, []);
});

Deno.test("empty and non-string input is inert", async () => {
  assertEquals(await reportCrudeLexicon("", { feature: "generate_story" }), []);
  assertEquals(
    await reportCrudeLexicon(
      undefined as unknown as string,
      { feature: "generate_story_stream" },
    ),
    [],
  );
});
