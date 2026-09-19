/**
 * Apply editor output (edits-*.jsonl) to Originals in the database.
 *
 *   deno run -A backend/originals/apply-edits.ts edits-x.jsonl [--dry-run]
 *
 * Titles and exact replacements are applied directly to `chapters`. Every
 * `find` must occur exactly once in its chapter or the whole story's edits are
 * refused before anything is written. Writes are guarded on the content that
 * was validated and stop at the first failure (no rewrites after one); they
 * are not a single transaction. Rewrites are run
 * through the app's Reimagine afterwards (reimagine.ts), one chapter at a time.
 */
import { callStream, houseClient, service } from "./lib.ts";

const [file] = Deno.args;
const dry = Deno.args.includes("--dry-run");
const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));

type Edit = {
  slug: string;
  titles?: { chapter: number; to: string }[];
  replace?: { chapter: number; find: string; with: string }[];
  rewrite?: { chapter: number; instruction: string }[];
};
const lines = (await Deno.readTextFile(new URL(file, here))).split("\n").filter((l) => l.trim());
const house = dry ? null : await houseClient();
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

for (const line of lines) {
  const e = JSON.parse(line) as Edit;
  const storyId = state[e.slug]?.story_id;
  if (!storyId) {
    console.log(`${e.slug}: no story id`);
    continue;
  }
  const { data: chapters } = await service.from("chapters").select("id,chapter_number,title,content")
    .eq("story_id", storyId).order("chapter_number");
  const byNum = new Map(chapters!.map((c) => [c.chapter_number, { ...c }]));
  const problems: string[] = [];
  for (const r of e.replace ?? []) {
    const c = byNum.get(r.chapter);
    if (!c) {
      problems.push(`ch${r.chapter} missing`);
      continue;
    }
    const n = c.content.split(r.find).length - 1;
    if (n !== 1) {
      problems.push(`ch${r.chapter} find occurs ${n}x: "${r.find.slice(0, 60)}"`);
      continue;
    }
    c.content = c.content.replace(r.find, () => r.with).replace(/\n{3,}/g, "\n\n").trim();
  }
  for (const t of e.titles ?? []) {
    const c = byNum.get(t.chapter);
    if (c) c.title = t.to.trim();
  }
  if (problems.length) {
    console.log(`${e.slug}: REFUSED - ${problems.join(" | ")}`);
    continue;
  }
  let changed = 0;
  for (const c of byNum.values()) {
    const orig = chapters!.find((o) => o.id === c.id)!;
    if (orig.content === c.content && orig.title === c.title) continue;
    changed += 1;
    if (dry) continue;
    const firstLine = c.content.split("\n")[0].slice(0, 500);
    // Guarded on the content we validated against: if the chapter changed
    // since it was read (a concurrent edit, a reimagine), the update matches no
    // row and nothing is overwritten.
    const { data: updated, error } = await service.from("chapters").update({
      title: c.title,
      content: c.content,
      word_count: words(c.content),
      first_line: firstLine,
    }).eq("id", c.id).eq("content", orig.content).select("id");
    if (error || !updated?.length) {
      problems.push(`ch${c.chapter_number} ${error ? error.message : "changed since it was read - not overwritten"}`);
      // Stop at the first failure. Not a transaction: chapters already
      // written in this story stay written, and are listed so a rerun (whose
      // finds will then no longer match) is investigated rather than trusted.
      break;
    }
  }
  console.log(`${e.slug}: ${changed} chapters edited${dry ? " (dry run)" : ""}${problems.length ? " ERR " + problems.join(" | ") : ""}`);

  if (problems.length) {
    console.log(`${e.slug}: rewrites SKIPPED after a failed update`);
    continue;
  }
  for (const r of e.rewrite ?? []) {
    if (dry) {
      console.log(`${e.slug}: would reimagine ch${r.chapter}`);
      continue;
    }
    const res = await callStream(house!.client, "reimagine-chapter", {
      story_id: storyId,
      chapter_number: r.chapter,
      prompt: r.instruction.slice(0, 300),
      request_id: crypto.randomUUID(),
      stream: true,
    });
    console.log(`${e.slug}: reimagine ch${r.chapter} ${res.event}`);
  }
}
