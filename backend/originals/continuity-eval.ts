/**
 * The continuity evaluation harness: the same stories, written twice.
 *
 *   deno run -A backend/originals/continuity-eval.ts write --arm=before --only=low-orbit-lullaby
 *   deno run -A backend/originals/continuity-eval.ts write --arm=after
 *   deno run -A backend/originals/continuity-eval.ts judge --arm=before
 *   deno run -A backend/originals/continuity-eval.ts report
 *
 * WHY THIS DOES NOT CALL THE DEPLOYED FUNCTIONS.
 *
 * The "after" numbers have to come from the changed pipeline, and the changed
 * pipeline is not deployed -- deliberately: the house library is being
 * published against the current production functions by another lane, and a
 * mid-run deploy would mean the library was written by two different pipelines.
 * So this harness runs the chapter loop in-process, importing the SAME prompt
 * builders, the same series-state merge, the same previous-chapter window and
 * the same bible that `continue-story` uses. What differs from production is
 * the transport, not the prompt: a local call has no 150s gateway to stream
 * around, so each chapter is one buffered JSON request against the same model
 * with the same strict schema.
 *
 * The two arms differ in exactly one thing, and it is a flag:
 *
 *   before  no story bible, no auto-plan -- which is what production builds
 *           today, since `story_bible` is null on every existing story.
 *
 *           One honest caveat: the moments-layer change (a landed moment is
 *           named positionally instead of quoted) is in the shared builder and
 *           is therefore in BOTH arms. It is not gated by the flag, so it does
 *           not show up in this measurement either way. What the numbers below
 *           isolate is the bible and the plan.
 *   after   the bible is seeded from the cast, extracted after every chapter,
 *           merged append-only, and rendered into the next chapter's prompt;
 *           a 5+ chapter series with no beats gets a plan first.
 *
 * COST. `meta/muse-spark-1.3-contributor` is $0.10/M in and $0.20/M out. A
 * chapter is ~8k in and ~2.5k out, so ~$0.0013; the "after" arm adds one
 * extraction per chapter, ~$0.0005. A 53-chapter arm is about $0.07, both arms
 * plus judging about $0.20. The balance is checked before anything is written
 * and the run refuses to start below a floor, because this credit is shared
 * with real users.
 */
import {
  buildContinuationSystemPrompt,
  buildContinuationUserPrompt,
  buildStorySystemPrompt,
  buildUserPrompt,
} from "../supabase/functions/_shared/story-prompts.ts";
import {
  buildPreviousChapterWindow,
} from "../supabase/functions/_shared/continuation-window.ts";
import {
  isEmptySeriesState,
  mergeSeriesState,
  parseStructuredOutput,
  providedSeriesStateKeys,
} from "../supabase/functions/_shared/story_text.ts";
import { STORY_OUTPUT_JSON_SCHEMA } from "../supabase/functions/_shared/story_schema.ts";
import {
  emptyStoryBible,
  formatStoryBibleBlock,
  mergeStoryBible,
  seedStoryBible,
  type StoryBible,
} from "../supabase/functions/_shared/story-bible.ts";
import {
  CONTINUITY_MAX_TOKENS,
  CONTINUITY_OUTPUT,
  CONTINUITY_SYSTEM_PROMPT,
  parseProposal,
} from "../supabase/functions/_shared/continuity.ts";
import {
  buildSeriesPlanPrompt,
  needsAutoPlan,
  parseSeriesPlan,
  SERIES_PLAN_SYSTEM_PROMPT,
} from "../supabase/functions/_shared/series-plan.ts";
import { EMPTY_SERIES_STATE } from "../supabase/functions/_shared/types.ts";

/**
 * The key, and ONLY the key.
 *
 * Deliberately not `lib.ts`'s `env`: that one demands the Supabase URL, the
 * anon key and the service-role key, because everything else in this directory
 * writes to the database. This harness never touches it -- it runs the chapter
 * loop in-process and writes JSON files -- so requiring production database
 * credentials in order to measure a prompt change would be asking for the
 * wrong secret.
 */
function openRouterKey(): string {
  const fromEnv = Deno.env.get("OPENROUTER_API_KEY");
  if (fromEnv) return fromEnv;
  const file = Deno.env.get("ENV_FILE") ??
    decodeURIComponent(new URL("../.env", import.meta.url).pathname);
  try {
    for (const line of Deno.readTextFileSync(file).split("\n")) {
      if (line.startsWith("OPENROUTER_API_KEY=")) {
        return line.slice("OPENROUTER_API_KEY=".length).trim();
      }
    }
  } catch { /* fall through to the error below */ }
  throw new Error(
    "OPENROUTER_API_KEY is not set. Put it in the environment or in backend/.env (or point ENV_FILE at a file that has it).",
  );
}
const env = { OPENROUTER_API_KEY: openRouterKey() };

const MODEL = "meta/muse-spark-1.3-contributor";
/** Refuse to start below this many dollars. The credit is shared with real users. */
const CREDIT_FLOOR = 1.0;

const here = new URL(".", import.meta.url);
const arg = (name: string, fallback = "") =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join(
    "=",
  ) ??
    fallback;
const command = Deno.args[0] ?? "report";
const arm = arg("arm", "after") as "before" | "after";
const only = arg("only") ? arg("only").split(",") : null;
const concurrency = Number(arg("concurrency", "4"));
const maxChapters = Number(arg("max-chapters", "99"));

/** The six that actually failed, from `NEXT_SESSION_PROMPT.md`. */
const DEFAULT_SLUGS = [
  "low-orbit-lullaby",
  "nine-oclock-zanzibar",
  "last-train-from-shimla",
  "returned-on-thursdays",
  "cartographers-heir",
  "a-winter-for-the-eagle",
];

type Brief = {
  slug: string;
  title: string;
  logline?: string;
  request: Record<string, unknown> & { planned_chapter_count: number };
};

type WrittenChapter = {
  chapter_number: number;
  title: string;
  content: string;
  previously_summary: string;
  hook_type: string;
  hook_text: string;
  word_count: number;
};

type WrittenStory = {
  slug: string;
  arm: string;
  model: string;
  chapters: WrittenChapter[];
  bible?: StoryBible;
  beats: string[];
  plan_generated: boolean;
  contradictions: { chapter: number; kind: string; severity: string }[];
  usage: { prompt: number; completion: number };
  errors: string[];
};

async function loadBriefs(): Promise<Brief[]> {
  const briefs: Brief[] = [];
  for await (const entry of Deno.readDir(here)) {
    if (/^briefs.*\.json$/.test(entry.name)) {
      briefs.push(
        ...JSON.parse(await Deno.readTextFile(new URL(entry.name, here)))
          .stories,
      );
    }
  }
  const wanted = only ?? DEFAULT_SLUGS;
  return briefs.filter((b) => wanted.includes(b.slug));
}

let promptTokens = 0;
let completionTokens = 0;

/**
 * One OpenRouter chat completion, with an optional strict schema.
 *
 * Retries twice on a transient failure and then gives up: a harness that
 * silently retries forever turns a broken provider into a large bill.
 */
async function complete(input: {
  system: string;
  user: string;
  maxTokens: number;
  schema?: { name: string; schema: unknown };
}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          // Doubled, exactly as `openRouterTokenBudget` doubles it in
          // production: this model spends tokens reasoning before it emits a
          // character, so a budget sized to the answer comes back empty. The
          // first run of this harness lost every continuity extraction to it.
          max_tokens: input.maxTokens * 2,
          temperature: 0.8,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          ...(input.schema
            ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: input.schema.name,
                  strict: true,
                  schema: input.schema.schema,
                },
              },
            }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      }
      promptTokens += body.usage?.prompt_tokens ?? 0;
      completionTokens += body.usage?.completion_tokens ?? 0;
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("empty completion");
      }
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Dollars of credit still available. */
async function creditsLeft(): Promise<number> {
  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  const body = await res.json();
  return (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
}

async function writeStory(brief: Brief): Promise<WrittenStory> {
  const r = brief.request;
  const planned = Math.min(r.planned_chapter_count, maxChapters);
  const characters = (r.characters ?? []) as {
    name: string;
    background?: string;
    appearance?: string;
    isHero?: boolean;
  }[];
  const moments = (r.moments ?? []) as string[];
  let beats = ((r.beats ?? []) as string[]).slice(0, planned);
  const story: WrittenStory = {
    slug: brief.slug,
    arm,
    model: MODEL,
    chapters: [],
    beats,
    plan_generated: false,
    contradictions: [],
    usage: { prompt: 0, completion: 0 },
    errors: [],
  };

  const common = {
    primaryGenre: r.primary_genre as string,
    audienceMode: (r.audience_mode ?? "adult") as string,
    language: (r.language ?? "English") as string,
    chapterLength: (r.chapter_length ?? "standard") as
      | "short"
      | "standard"
      | "long",
    plannedChapterCount: planned as 1,
  };

  // --- the plan, for the "after" arm only ---
  if (
    arm === "after" &&
    needsAutoPlan({ storyMode: "series", plannedChapterCount: planned, beats })
  ) {
    try {
      const raw = await complete({
        system: SERIES_PLAN_SYSTEM_PROMPT,
        user: buildSeriesPlanPrompt({
          seed: r.topic as string,
          plannedChapterCount: planned,
          primaryGenre: r.primary_genre as string,
          audienceMode: r.audience_mode as string,
          whereAndWhen: r.where_and_when as string,
          moments,
          characters,
          avoid: r.avoid as string,
          title: brief.title,
        }),
        maxTokens: 2_400,
      });
      const plan = parseSeriesPlan(raw, planned);
      if (plan) {
        beats = plan.beats;
        story.beats = plan.beats;
        story.plan_generated = true;
        story.bible = seedStoryBible({
          characters,
          truth: plan.truth,
          whereAndWhen: r.where_and_when as string,
        });
      }
    } catch (error) {
      story.errors.push(`plan: ${error}`);
    }
  }
  if (arm === "after" && !story.bible) {
    story.bible = seedStoryBible({
      characters,
      whereAndWhen: r.where_and_when as string,
    });
  }

  let seriesState = EMPTY_SERIES_STATE;

  for (let n = 1; n <= planned; n += 1) {
    const isFinale = n === planned;
    const bible = story.bible ?? emptyStoryBible();
    const bibleBlock = arm === "after"
      ? formatStoryBibleBlock(bible, {
        castNames: characters.map((c) => c.name),
        isFinale,
      })
      : "";

    const system = n === 1
      ? buildStorySystemPrompt({ ...common, storyMode: "series" } as never)
      : buildContinuationSystemPrompt({
        ...common,
        mode: isFinale ? "finale" : "chapter",
        seriesState,
      } as never);

    const user = n === 1
      ? buildUserPrompt({
        ...common,
        storyMode: "series",
        chapterRole: "series_opening",
        chapterNumber: 1,
        seed: r.topic as string,
        whereAndWhen: r.where_and_when as string,
        moments,
        beats,
        writingStyle: r.writing_style as string,
        avoid: r.avoid as string,
        characters,
        storyValues: (r.story_values ?? []) as string[],
      } as never)
      : buildContinuationUserPrompt({
        ...common,
        genres: [r.primary_genre as string],
        spiceLevel: "sweet",
        chapterRole: isFinale ? "finale" : "mid_series",
        chapterNumber: n,
        seed: r.topic as string,
        whereAndWhen: r.where_and_when as string,
        moments,
        beats,
        storyValues: (r.story_values ?? []) as string[],
        writingStyle: r.writing_style as string,
        avoid: r.avoid as string,
        characters,
        seriesState,
        // The single difference between the arms.
        storyBible: arm === "after" ? bible : undefined,
        title: brief.title,
        previousChapters: buildPreviousChapterWindow(
          [...story.chapters].reverse().slice(0, 4),
        ),
        previousChapterTitles: story.chapters.map((c) => c.title),
        isFinale,
      } as never).jsonPrompt;

    let output;
    try {
      output = parseStructuredOutput(
        await complete({
          system,
          user,
          maxTokens: 16_000,
          schema: {
            name: "katha_story_output",
            schema: STORY_OUTPUT_JSON_SCHEMA,
          },
        }),
        `Chapter ${n}`,
      );
    } catch (error) {
      story.errors.push(`ch${n}: ${error}`);
      break;
    }

    const content = (output.chapter_body ?? "").trim();
    if (!content) {
      story.errors.push(`ch${n}: empty body`);
      break;
    }
    story.chapters.push({
      chapter_number: n,
      title: output.chapter_title || `Chapter ${n}`,
      content,
      previously_summary: output.previously_summary ?? "",
      hook_type: output.hook_type ?? "none",
      hook_text: output.hook_text ?? "",
      word_count: content.split(/\s+/).length,
    });

    seriesState = isEmptySeriesState(output.series_state)
      ? seriesState
      : mergeSeriesState(
        seriesState,
        output.series_state,
        providedSeriesStateKeys(output.raw_series_state),
        moments,
      );

    // --- the continuity check, "after" only ---
    if (arm === "after") {
      try {
        const raw = await complete({
          schema: CONTINUITY_OUTPUT,
          system: CONTINUITY_SYSTEM_PROMPT,
          user: `${bibleBlock}\n\nChapter ${n}, exactly as it was written:\n\n${
            content.slice(0, 14_000)
          }\n\nExtract this chapter's facts, clock, truth and scenes, and name anything that contradicts the fixed facts above.`,
          maxTokens: CONTINUITY_MAX_TOKENS,
        });
        const merged = mergeStoryBible(bible, parseProposal(raw), n);
        story.bible = merged.bible;
        for (const entry of merged.contradictions) {
          story.contradictions.push({
            chapter: n,
            kind: entry.kind,
            severity: entry.severity,
          });
        }
      } catch (error) {
        story.errors.push(`check ch${n}: ${error}`);
      }
    }
    console.log(
      `${new Date().toISOString().slice(11, 19)} ${arm.padEnd(6)} ${
        brief.slug.padEnd(26)
      } ch ${n}/${planned} ${
        story.chapters[story.chapters.length - 1].word_count
      }w`,
    );
  }

  story.usage = { prompt: promptTokens, completion: completionTokens };
  return story;
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

/**
 * The rubric, narrowed to the four regenerate classes.
 *
 * `REVIEW_GUIDE.md` asks a reader for a verdict on the whole story, which is
 * the right question for a publication gate and the wrong one for a
 * before/after measurement: prose taste moves the number for reasons that have
 * nothing to do with continuity. So the judge here counts only what this change
 * claims to fix, and counts it the same way in both arms.
 */
const JUDGE_SYSTEM =
  `You are a continuity auditor. You read a whole multi-chapter story and list every continuity defect in it. You do not judge prose, pacing, or whether you enjoyed it.

Count only these four classes:
- "fact": a name, age, date, count, currency, relationship, occupation, physical trait, object or piece of backstory that is stated one way and later another way.
- "replay": a scene or reveal that already happened being written again as if new, or a character re-introduced as a stranger.
- "clock": story time that runs backwards, a calendar that does not add up, a deadline that is missed and then met, times that contradict each other.
- "fair": a mystery whose solution contradicts an earlier chapter, whose final clue was never planted, or that is otherwise unfair to the reader.

For each defect give the LATER chapter number, the class, a severity ("major" if a reader would notice and be pulled out of the story, "minor" otherwise), and one short sentence. Be strict and be consistent: the same story read twice must produce the same count.`;

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "kind", "severity", "what"],
        properties: {
          chapter: { type: "integer" },
          kind: { type: "string", enum: ["fact", "replay", "clock", "fair"] },
          severity: { type: "string", enum: ["major", "minor"] },
          what: { type: "string" },
        },
      },
    },
  },
};

async function judge(story: WrittenStory): Promise<Record<string, unknown>> {
  const body = story.chapters
    .map((c) => `## Chapter ${c.chapter_number}: ${c.title}\n\n${c.content}`)
    .join("\n\n");
  const raw = await complete({
    system: JUDGE_SYSTEM,
    user: `Story: ${story.slug}\n\n${body}`,
    maxTokens: 3_000,
    schema: { name: "katha_continuity_audit", schema: JUDGE_SCHEMA },
  });
  let parsed: Record<string, unknown> = { issues: [] };
  try {
    parsed = JSON.parse(raw);
  } catch { /* an unreadable audit counts as no issues found, and says so */ }
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  // Duplicate chapter titles are counted deterministically rather than asked
  // for: it is a string comparison, and a model asked to do string comparisons
  // over fourteen chapters will miss some.
  const seen = new Map<string, number>();
  for (const chapter of story.chapters) {
    const key = chapter.title.trim().toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        chapter: chapter.chapter_number,
        kind: "title",
        severity: "major",
        what: `title repeats chapter ${first}`,
      });
    } else {
      seen.set(key, chapter.chapter_number);
    }
  }
  return {
    slug: story.slug,
    arm: story.arm,
    chapters: story.chapters.length,
    issues,
  };
}

// ---------------------------------------------------------------------------

const outDir = new URL(`bench/${arm}/`, here);

async function runWrite() {
  const left = await creditsLeft();
  console.log(`OpenRouter credit left: $${left.toFixed(2)}`);
  if (left < CREDIT_FLOOR) {
    throw new Error(
      `refusing to run: $${
        left.toFixed(2)
      } left, floor is $${CREDIT_FLOOR}. This credit is shared with real users.`,
    );
  }
  await Deno.mkdir(outDir, { recursive: true });
  const briefs = await loadBriefs();
  const queue = [...briefs];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      for (;;) {
        const brief = queue.shift();
        if (!brief) return;
        const target = new URL(`${brief.slug}.json`, outDir);
        try {
          await Deno.stat(target);
          console.log(`${brief.slug}: already written, skipping`);
          continue;
        } catch { /* not written yet */ }
        const story = await writeStory(brief);
        await Deno.writeTextFile(target, JSON.stringify(story, null, 1));
      }
    },
  );
  await Promise.all(workers);
  console.log(
    `tokens: ${promptTokens} in / ${completionTokens} out; spent about $${
      (promptTokens * 1e-7 + completionTokens * 2e-7).toFixed(4)
    }`,
  );
}

async function runJudge() {
  const dir = new URL(`bench/${arm}/`, here);
  await Deno.mkdir(new URL(`bench/audits/`, here), { recursive: true });
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.name.endsWith(".json")) continue;
    const story: WrittenStory = JSON.parse(
      await Deno.readTextFile(new URL(entry.name, dir)),
    );
    const target = new URL(`bench/audits/${arm}-${entry.name}`, here);
    try {
      await Deno.stat(target);
      continue;
    } catch { /* not judged yet */ }
    const audit = await judge(story);
    await Deno.writeTextFile(target, JSON.stringify(audit, null, 1));
    const issues = audit.issues as { severity: string }[];
    console.log(
      `${arm.padEnd(6)} ${story.slug.padEnd(26)} ${issues.length} issues (${
        issues.filter((i) => i.severity === "major").length
      } major) over ${story.chapters.length} chapters`,
    );
  }
}

async function runReport() {
  const audits: Record<string, Record<string, unknown>[]> = {
    before: [],
    after: [],
  };
  const dir = new URL("bench/audits/", here);
  for await (const entry of Deno.readDir(dir)) {
    const audit = JSON.parse(await Deno.readTextFile(new URL(entry.name, dir)));
    (audits[audit.arm] ??= []).push(audit);
  }
  const rows: string[] = [];
  rows.push(
    "| story | chapters | issues before | major before | issues after | major after |",
  );
  rows.push("|---|---|---|---|---|---|");
  const slugs = new Set(
    [...audits.before, ...audits.after].map((a) => a.slug as string),
  );
  const totals = { bi: 0, bm: 0, ai: 0, am: 0, bc: 0, ac: 0 };
  for (const slug of [...slugs].sort()) {
    const before = audits.before.find((a) => a.slug === slug);
    const after = audits.after.find((a) => a.slug === slug);
    const count = (a?: Record<string, unknown>, major = false) => {
      const issues = (a?.issues ?? []) as { severity: string }[];
      return major
        ? issues.filter((i) => i.severity === "major").length
        : issues.length;
    };
    totals.bi += count(before);
    totals.bm += count(before, true);
    totals.ai += count(after);
    totals.am += count(after, true);
    totals.bc += (before?.chapters as number) ?? 0;
    totals.ac += (after?.chapters as number) ?? 0;
    rows.push(
      `| ${slug} | ${after?.chapters ?? before?.chapters ?? "-"} | ${
        count(before)
      } | ${count(before, true)} | ${count(after)} | ${count(after, true)} |`,
    );
  }
  rows.push(
    `| **total** | ${
      totals.ac || totals.bc
    } | **${totals.bi}** | **${totals.bm}** | **${totals.ai}** | **${totals.am}** |`,
  );
  const perChapter = (n: number, c: number) => c ? (n / c).toFixed(2) : "-";
  rows.push("");
  rows.push(
    `Major issues per chapter: **${
      perChapter(totals.bm, totals.bc)
    } before**, **${perChapter(totals.am, totals.ac)} after**.`,
  );
  console.log(rows.join("\n"));
}

if (command === "write") await runWrite();
else if (command === "judge") await runJudge();
else await runReport();
