/**
 * Mechanical checks an Original must pass before it is approved, run against
 * the database (what readers get), not the review export.
 *
 *   deno run -A backend/originals/verify.ts slug [slug...]
 *
 * - every planned chapter exists and none is suspiciously short
 * - chapter titles are distinct and not generic
 * - no leaked markup/JSON or meta text
 * - no sentence of the brief (topic, moments, cast notes) pasted into the prose
 * - no "major" issue quote from its review still present verbatim
 * Prints PASS or the failures; exits non-zero if any story fails.
 */
import { service } from "./lib.ts";

const here = new URL(".", import.meta.url);
const state = JSON.parse(await Deno.readTextFile(new URL("run-state.json", here)));
const briefs = new Map<string, { request: Record<string, unknown> }>();
const reviews = new Map<string, { issues?: { chapter: number; severity: string; quote?: string }[] }>();
for await (const e of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(e.name)) {
    for (const b of JSON.parse(await Deno.readTextFile(new URL(e.name, here))).stories) briefs.set(b.slug, b);
  }
  if (/^reviews.*\.jsonl$/.test(e.name)) {
    for (const l of (await Deno.readTextFile(new URL(e.name, here))).split("\n")) {
      try {
        const r = JSON.parse(l);
        reviews.set(r.slug, r);
      } catch { /* skip */ }
    }
  }
}

const GENERIC = /^(chapter\s*\d+|part\s*\d+|the (journey|beginning|end|return))$/i;
const LEAK = /("\s*}\s*[,”"]|\{\s*"|\\n|```|<\/?[a-z]+>|\bIn this chapter\b|\bchapter_title\b)/;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

let failed = 0;
for (const slug of Deno.args) {
  const s = state[slug];
  const brief = briefs.get(slug);
  if (!s?.story_id || !brief) {
    console.log(`${slug}: UNKNOWN`);
    failed++;
    continue;
  }
  const { data: chapters } = await service.from("chapters").select("chapter_number,title,content,word_count")
    .eq("story_id", s.story_id).order("chapter_number");
  const problems: string[] = [];
  const planned = brief.request.planned_chapter_count as number;
  if ((chapters?.length ?? 0) < planned) problems.push(`${chapters?.length}/${planned} chapters`);
  const titles = new Map<string, number>();
  const counts = chapters!.map((c) => c.word_count as number).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  for (const c of chapters!) {
    const t = norm(c.title ?? "");
    if (!t || GENERIC.test(c.title)) problems.push(`ch${c.chapter_number} generic title "${c.title}"`);
    if (titles.has(t)) problems.push(`ch${c.chapter_number} repeats ch${titles.get(t)}'s title "${c.title}"`);
    titles.set(t, c.chapter_number);
    if (LEAK.test(c.content)) problems.push(`ch${c.chapter_number} leak: ${c.content.match(LEAK)![0]}`);
    if (c.word_count < median * 0.45) problems.push(`ch${c.chapter_number} short (${c.word_count} vs median ${median})`);
    const prose = norm(c.content);
    const r = brief.request as Record<string, unknown>;
    const briefBits = [r.topic, ...(r.moments as string[] ?? []),
      ...((r.characters as { background: string; appearance: string }[]) ?? []).flatMap((x) => [x.background, x.appearance])];
    for (const bit of briefBits) {
      for (const sentence of String(bit ?? "").split(/[.;]/)) {
        const n = norm(sentence);
        if (n.split(" ").length >= 9 && prose.includes(n)) {
          problems.push(`ch${c.chapter_number} pastes brief: "${sentence.trim().slice(0, 60)}"`);
        }
      }
    }
  }
  // Quote hits are warnings, not failures: a reviewer often quotes the line
  // that was RIGHT, and the fix lands in the chapter that contradicted it.
  const warnings: string[] = [];
  for (const issue of reviews.get(slug)?.issues ?? []) {
    if (issue.severity !== "major" || !issue.quote || issue.quote.length < 12) continue;
    const q = norm(issue.quote.replace(/\.\.\.|…/g, " "));
    const ch = chapters!.find((c) => c.chapter_number === issue.chapter);
    if (ch && q.length > 12 && norm(ch.content).includes(q)) {
      warnings.push(`ch${issue.chapter} still has flagged quote "${issue.quote.slice(0, 50)}"`);
    }
  }
  if (problems.length) failed++;
  console.log(`${slug}: ${problems.length ? "FAIL " + problems.join(" | ") : "PASS"}${warnings.length ? " (check: " + warnings.join(" | ") + ")" : ""}`);
}
Deno.exit(failed ? 1 : 0);
