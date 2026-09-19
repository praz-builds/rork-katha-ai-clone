/**
 * The chapter plan a long series gets whether or not the writer drew one.
 *
 * WHY. `beats` exists and works: the blueprint screen fills it, the prompt
 * reads it positionally (beat N owns chapter N), and stories written with beats
 * drifted measurably less than stories written without. But a story created
 * anywhere other than the blueprint screen -- and every story of the 83 written
 * on 2026-09-18 that reached 8+ chapters without one -- is paced by the model
 * one chapter at a time, with no idea where the midpoint is or what the ending
 * has to pay off. That is how the same reveal lands in chapters 2, 12 and 14.
 *
 * So: a series of 5+ chapters with no beats gets a plan generated for it.
 *
 * The shape of a beat that WORKS is not a guess either. It is
 * `backend/originals/BEATS_GUIDE.md`, written after the first review pass, and
 * the two things it added to a plain outline are the two that mattered:
 *
 *   1. each beat carries its DATE when time matters, so the clock moves;
 *   2. each beat carries the FIXED FACTS it depends on, so they cannot drift;
 *   3. the story's truth is fixed ONCE, in beat 1 or 2, so every chapter is
 *      written from the same backstory.
 *
 * Returned on Thursdays had beats and still collapsed its calendar -- until
 * every beat carried its date. That is the evidence for (1), and it is why the
 * prompt below asks for a date rather than suggesting one.
 *
 * LATENCY: none, at the reader. This call is started BEFORE
 * `begin_story_generation` and awaited when chapter one is persisted 55-100 s
 * later, which is exactly the arrangement entity classification uses (AGENTS.md,
 * Grounding item 1). Chapter one does not need the plan -- beat one is the
 * story's own topic -- so nothing waits on it. A plan that misses its deadline
 * is a no-op and the story is written as it is today.
 */

import { generateFastStructuredText } from "./llm.ts";
import { MAX_BEAT_LENGTH, MAX_PLANNED_CHAPTER_COUNT } from "./types.ts";

/**
 * 25 s, sized from the 23.4 s live measurement of a classification-shaped
 * prompt on `meta/muse-spark-1.3-contributor` (AGENTS.md). It runs beside a
 * 55-100 s generation, so the budget is bounded by the work it hides behind,
 * not by a reader.
 */
export const PLAN_DEADLINE_MS = 25_000;

/** Below this a story is short enough for the model to pace unaided. */
export const AUTO_PLAN_MIN_CHAPTERS = 5;

const PLAN_OUTPUT = {
  name: "katha_series_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["beats", "truth"],
    properties: {
      beats: {
        type: "array",
        description: "One line per chapter, in order.",
        items: { type: "string" },
      },
      truth: {
        type: "array",
        description:
          "The story's settled truth, fixed now: the secret, the mystery's solution, who did what and why, the rules and costs of any magic. One short line each.",
        items: { type: "string" },
      },
    },
  },
} as const;

export const SERIES_PLAN_SYSTEM_PROMPT =
  `You plan serialised fiction. You are given a story brief and a chapter count, and you return the chapter-by-chapter plan the writer will follow.

Each beat:
- names the ONE distinct event of that chapter — a new place, a new reveal, a new decision. No two chapters may share a scene, a setting-visit or a reveal.
- advances time explicitly when time matters, by naming it ("Day 3, dawn:"), so the clock moves.
- carries the fixed facts it depends on — names, ages, dates, counts, who did what — so they cannot drift between chapters.
- escalates. Stakes rise. The midpoint turns the story. The last beat is the ending that pays off the setup: never a cliffhanger, never a summary.

Beat 1 is the hook, and it comes from the brief's own idea.

Fix the story's truth now, before a word is written, and return it separately: the secret, the backstory, the mystery's solution, the rules and costs of its magic. Every chapter will be written from it, so it must be stated once and completely. For a mystery, fix the solution, where each clue is planted and which leads are false, and put the clue placements in the beats that plant them.

Return exactly as many beats as there are chapters. Each beat is one line, at most 200 characters. Write beats as claims about events, never as questions or themes.`;

export interface SeriesPlan {
  beats: string[];
  truth: string[];
}

export interface SeriesPlanBrief {
  seed: string;
  plannedChapterCount: number;
  primaryGenre?: string;
  audienceMode?: string;
  whereAndWhen?: string;
  moments?: readonly string[];
  characters?: readonly { name?: string | null; background?: string | null }[];
  avoid?: string;
  title?: string;
}

/**
 * Should this story have a plan generated for it?
 *
 * A writer who drew their own plan keeps it, always: this never overwrites
 * `beats`. It fills an absence, and only for a series long enough that pacing
 * it a chapter at a time is the thing that breaks.
 */
export function needsAutoPlan(input: {
  storyMode?: string;
  plannedChapterCount?: number;
  beats?: readonly string[] | null;
}): boolean {
  if (input.storyMode !== "series") return false;
  if (Array.isArray(input.beats) && input.beats.some((b) => b?.trim())) {
    return false;
  }
  const planned = input.plannedChapterCount ?? 0;
  return planned >= AUTO_PLAN_MIN_CHAPTERS &&
    planned <= MAX_PLANNED_CHAPTER_COUNT;
}

export function buildSeriesPlanPrompt(brief: SeriesPlanBrief): string {
  const parts: string[] = [];
  parts.push(
    `Chapters: ${brief.plannedChapterCount}. Return exactly ${brief.plannedChapterCount} beats.`,
  );
  if (brief.title?.trim()) parts.push(`Title: ${brief.title.trim()}`);
  if (brief.primaryGenre) parts.push(`Genre: ${brief.primaryGenre}`);
  if (brief.audienceMode === "kids") {
    // The kids rule is stated in the plan, not only in the writing prompt,
    // because a plan that schedules a fright cannot be written safely however
    // careful the prose layer is.
    parts.push(
      "Audience: children ages 4-10. Escalate gently. Nothing frightening, cruel, or unsafe to imitate may appear in any beat.",
    );
  }
  parts.push(`The idea:\n${brief.seed}`);
  if (brief.whereAndWhen?.trim()) {
    parts.push(`Setting — world and era: ${brief.whereAndWhen.trim()}`);
  }
  const cast = (brief.characters ?? []).filter((c) => c?.name?.trim());
  if (cast.length) {
    parts.push(
      `Cast (their names, ages and histories are fixed; carry them into the beats that use them):\n${
        cast.map((c) =>
          `- ${c.name!.trim()}${
            c.background?.trim() ? `: ${c.background.trim()}` : ""
          }`
        ).join("\n")
      }`,
    );
  }
  const moments = (brief.moments ?? []).filter((m) => m?.trim());
  if (moments.length) {
    parts.push(
      `Moments the reader was promised. Use them as anchors, in order, spread across the run — one beat may carry at most one:\n${
        moments.map((m) => `- ${m.trim()}`).join("\n")
      }`,
    );
  }
  if (brief.avoid?.trim()) parts.push(`Avoid: ${brief.avoid.trim()}`);
  return parts.join("\n\n");
}

/**
 * Normalise a plan response.
 *
 * Returns null unless there is exactly one beat per chapter. A short plan is
 * worse than no plan: `buildPlanSection` reads beats POSITIONALLY, so a
 * nine-beat plan on a ten-chapter story silently tells chapter ten it has run
 * past the end of the outline, and a five-beat plan mis-assigns every chapter
 * after the fifth. An exact match or nothing.
 */
export function parseSeriesPlan(
  raw: string,
  plannedChapterCount: number,
): SeriesPlan | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const beats = (Array.isArray(value.beats) ? value.beats : [])
    .filter((beat): beat is string => typeof beat === "string")
    .map((beat) => beat.trim().slice(0, MAX_BEAT_LENGTH))
    .filter(Boolean);
  if (beats.length !== plannedChapterCount) return null;
  const truth = (Array.isArray(value.truth) ? value.truth : [])
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 8);
  return { beats, truth };
}

/**
 * Generate the plan. Throws on provider failure; every caller treats that as a
 * no-op, because a story without a plan is the story this product has always
 * written and is never worth failing a paid generation over.
 */
export async function planSeries(
  brief: SeriesPlanBrief,
): Promise<SeriesPlan | null> {
  const result = await generateFastStructuredText(
    SERIES_PLAN_SYSTEM_PROMPT,
    buildSeriesPlanPrompt(brief),
    PLAN_OUTPUT,
    // ~200 characters a beat, up to the plan ceiling, plus the truth. Generous
    // rather than tight: a plan truncated mid-JSON returns null and the story
    // loses its plan entirely, which costs far more than the tokens.
    2_400,
    PLAN_DEADLINE_MS,
  );
  return parseSeriesPlan(result.text, brief.plannedChapterCount);
}
