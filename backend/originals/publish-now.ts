/**
 * Publish approved Originals whose Codex cover is not drawn yet, keeping the
 * pipeline's own cover for now. publish.ts later swaps in the Codex cover.
 *   deno run -A backend/originals/publish-now.ts slug [slug...]
 */
import { service } from "./lib.ts";
const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));
const titles = new Map<string, string>();
for await (const e of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(e.name)) {
    for (const b of JSON.parse(await Deno.readTextFile(new URL(e.name, here))).stories) titles.set(b.slug, b.title);
  }
}
for (const slug of Deno.args) {
  const id = state[slug]?.story_id;
  if (!id) { console.log(`${slug}: unknown`); continue; }
  const { data } = await service.from("stories").select("cover_image_url").eq("id", id).single();
  const { error } = await service.from("stories").update({
    title: titles.get(slug), entity_gate_reason: null, is_curated: true, is_public: true,
    ...(data?.cover_image_url ? { cover_status: "ready" } : {}),
  }).eq("id", id);
  const { error: e2 } = await service.from("chapters").update({ is_published: true }).eq("story_id", id);
  console.log(`${slug}: ${error || e2 ? "ERROR " + (error ?? e2)!.message : "published"}${data?.cover_image_url ? "" : " (no cover yet)"}`);
}
