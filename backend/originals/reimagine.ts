/**
 * Rewrite one chapter of an Original with the app's own Reimagine, as its
 * author (so the story is edited in place, not forked).
 *
 *   deno run -A backend/originals/reimagine.ts <slug> <chapter> "<what to change>"
 *
 * Used for review verdicts of "fix". The instruction goes in the same field a
 * reader's typed note does, so the rewrite passes through the same prompt
 * layers, word band and output schema as every other chapter.
 */
import { callStream, houseClient } from "./lib.ts";

const [slug, chapterArg, ...rest] = Deno.args;
const instruction = rest.join(" ").trim();
if (!slug || !chapterArg || !instruction) {
  throw new Error('usage: reimagine.ts <slug> <chapter> "<instruction>"');
}
const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));
const storyId = state[slug]?.story_id;
if (!storyId) throw new Error(`no story for ${slug}`);

const { client } = await houseClient();
const started = Date.now();
const res = await callStream(client, "reimagine-chapter", {
  story_id: storyId,
  chapter_number: Number(chapterArg),
  prompt: instruction.slice(0, 300),
  request_id: crypto.randomUUID(),
  stream: true,
});
console.log(
  `${slug} ch${chapterArg}: ${res.event} in ${Math.round((Date.now() - started) / 1000)}s`,
  res.event === "done" ? "" : JSON.stringify(res.body).slice(0, 300),
);
