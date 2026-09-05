import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const generateSource = await Deno.readTextFile(
  new URL("../generate-audio/index.ts", import.meta.url),
);
const statusSource = await Deno.readTextFile(
  new URL("../audio-status/index.ts", import.meta.url),
);

Deno.test("fresh narration cannot reach a paid provider before audio unlocks exist", () => {
  assertStringIncludes(generateSource, "Narration unlock is not available yet");
  assert(!generateSource.includes("RUNPOD_ENDPOINT"));
  assert(!generateSource.includes("api.runpod.ai"));
});

Deno.test("audio status cannot poll an unbound provider job", () => {
  assertStringIncludes(statusSource, "Narration unlock is not available yet");
  assert(!statusSource.includes("RUNPOD_API_KEY"));
  assert(!statusSource.includes("api.runpod.ai"));
  assert(!statusSource.includes("fetch("));
});
