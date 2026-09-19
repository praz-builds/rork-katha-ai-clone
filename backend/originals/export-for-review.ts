/**
 * Export every written Original (brief + all chapters, straight from the
 * database) to review/<slug>.md, so review agents read exactly what a reader
 * will read without needing database credentials.
 *
 *   deno run -A backend/originals/export-for-review.ts
 */
import { service } from "./lib.ts";

const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));
const briefs = new Map<string, Record<string, unknown>>();
for await (const entry of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(entry.name)) {
    for (const b of JSON.parse(await Deno.readTextFile(new URL(entry.name, here))).stories) {
      briefs.set(b.slug, b);
    }
  }
}
await Deno.mkdir(new URL("review/", here), { recursive: true });

let written = 0;
for (const [slug, s] of Object.entries(state) as [string, { story_id?: string; chapters_done?: number }][]) {
  const brief = briefs.get(slug) as { title: string; logline: string; request: Record<string, unknown> } | undefined;
  if (!brief || !s.story_id) continue;
  const planned = brief.request.planned_chapter_count as number;
  const { data: chapters } = await service.from("chapters")
    .select("chapter_number,title,word_count,content")
    .eq("story_id", s.story_id).order("chapter_number");
  if (!chapters || chapters.length < planned) continue;
  const r = brief.request;
  const cast = (r.characters as { name: string; isHero?: boolean; background: string; appearance: string }[])
    .map((c) => `- **${c.name}**${c.isHero ? " (lead)" : ""}: ${c.background} Looks: ${c.appearance}`).join("\n");
  const body = chapters.map((c) =>
    `\n\n---\n\n## Chapter ${c.chapter_number}: ${c.title} (${c.word_count} words)\n\n${c.content}`
  ).join("");
  await Deno.writeTextFile(
    new URL(`review/${slug}.md`, here),
    `# ${brief.title}\n\nslug: ${slug}\nstory_id: ${s.story_id}\n` +
      `genre: ${r.primary_genre} | audience: ${r.audience_mode} | chapters: ${planned} | length: ${r.chapter_length}\n\n` +
      `**Logline:** ${brief.logline}\n\n**Premise:** ${r.topic}\n\n**Setting:** ${r.where_and_when}\n\n` +
      `**Cast:**\n${cast}\n\n**Planned moments:** ${(r.moments as string[]).join(" / ")}\n\n` +
      `**Avoid:** ${r.avoid}\n\n**Voice:** ${r.writing_style}${body}\n`,
  );
  written += 1;
}
console.log(`exported ${written} stories to review/`);
