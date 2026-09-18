/**
 * Permanently delete failed Original drafts: the story rows (chapters and
 * dependants cascade) and their stored cover/portrait files.
 *   deno run -A backend/originals/delete-drafts.ts <story_id> [...]
 * Refuses any story that is curated or not owned by the house account.
 */
import { houseUserId, service } from "./lib.ts";
const HOUSE = await houseUserId();
for (const id of Deno.args) {
  const { data: row } = await service.from("stories").select("id,title,author_id,is_curated").eq("id", id).maybeSingle();
  if (!row) { console.log(`${id}: already gone`); continue; }
  if (row.author_id !== HOUSE || row.is_curated) { console.log(`${id}: REFUSED (${row.is_curated ? "curated" : "not house-owned"})`); continue; }
  for (const bucket of ["covers"]) {
    const { data: files } = await service.storage.from(bucket).list(`covers/${id}`);
    const paths = (files ?? []).map((f) => `covers/${id}/${f.name}`);
    if (paths.length) await service.storage.from(bucket).remove(paths);
  }
  const { error } = await service.from("stories").delete().eq("id", id);
  console.log(`${id} "${row.title}": ${error ? "ERROR " + error.message : "deleted"}`);
}
