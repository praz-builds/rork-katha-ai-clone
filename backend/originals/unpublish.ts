/**
 * Take Originals back off the shelf (curated and public both false) and mark
 * them unpublished in run-state.json, so the runner's review gate decides again.
 *
 *   deno run -A backend/originals/unpublish.ts slug [slug...]
 */
import { service } from "./lib.ts";
const here = new URL(".", import.meta.url);
const path = new URL("run-state.json", here);
const state = JSON.parse(await Deno.readTextFile(path));
for (const slug of Deno.args) {
  const s = state[slug];
  if (!s?.story_id) continue;
  const { error } = await service.from("stories").update({ is_curated: false, is_public: false })
    .eq("id", s.story_id);
  console.log(slug, error ? error.message : "unpublished");
  if (!error) s.published = false;
}
await Deno.writeTextFile(path, JSON.stringify(state, null, 1) + "\n");
