/**
 * Publish approved Originals: cover, title, curated, public, chapters published.
 * Reads run-state.json but never writes it (the runner may be running and owns
 * that file); the runner reconciles `published` from the database on start.
 *
 *   deno run -A backend/originals/publish.ts slug [slug...]
 */
import { service } from "./lib.ts";
const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));
const briefs = new Map<string, { title: string }>();
for await (const e of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(e.name)) {
    for (const b of JSON.parse(await Deno.readTextFile(new URL(e.name, here))).stories) briefs.set(b.slug, b);
  }
}
for (const slug of Deno.args) {
  const s = state[slug];
  const brief = briefs.get(slug);
  if (!s?.story_id || !brief) {
    console.log(`${slug}: unknown`);
    continue;
  }
  let cover = s.cover_uploaded as string | undefined;
  if (!cover) {
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(new URL(`covers/${slug}.png`, here));
    } catch {
      console.log(`${slug}: no approved cover yet - not published`);
      continue;
    }
    const path = `covers/${s.story_id}/original-v1.png`;
    const { error } = await service.storage.from("covers").upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) {
      console.log(`${slug}: cover upload ${error.message}`);
      continue;
    }
    cover = service.storage.from("covers").getPublicUrl(path).data.publicUrl;
  }
  // See run-originals.ts finalize() for why the title is restored and the
  // entity-gate flag cleared on house stories.
  const { error } = await service.from("stories").update({
    title: brief.title,
    entity_gate_reason: null,
    cover_image_url: cover,
    cover_status: "ready",
    is_curated: true,
    is_public: true,
  }).eq("id", s.story_id);
  const { error: chError } = await service.from("chapters").update({ is_published: true }).eq("story_id", s.story_id);
  console.log(`${slug}: ${error || chError ? "ERROR " + (error ?? chError)!.message : "published"}`);
}
