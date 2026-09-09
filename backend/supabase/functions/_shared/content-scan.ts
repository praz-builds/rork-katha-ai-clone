/**
 * Post-generation content reporting.
 *
 * `scanCrudeLexicon` (validation.ts) is the detector; this module is the one
 * place that decides what a hit *means*, so the three generation paths agree.
 *
 * The decision is report-only, and deliberately so. The obvious alternative -
 * treating a hit the way `requireUsableStoryOutput` treats an out-of-band word
 * count, so the chain falls through to the next provider - was rejected for
 * three reasons:
 *
 *  1. It buys a second full generation (11-30s and the reasoning tokens that
 *     go with it, per the OpenRouter notes in AGENTS.md) on the word of a
 *     regex whose over-matches are documented and accepted.
 *  2. It cannot help the streamed path at all. By the time the scan runs the
 *     reader has already been shown every word, so a rejection there would
 *     discard prose the user is looking at.
 *  3. The real control is the language floor in layer 1 of the system prompt,
 *     which no tier, genre, lens or audience mode can drop. This scan exists
 *     to tell us whether that floor actually holds in production - if the hit
 *     rate is near zero the floor works, and if it is not, the fix belongs in
 *     the prompt rather than in a retry loop.
 *
 * Escalating to rejection is a decision to make from that data, not before it.
 */
import { logError } from "./errors.ts";
import { scanCrudeLexicon } from "./validation.ts";

export interface CrudeLexiconReportContext {
  feature:
    | "generate_story"
    | "generate_story_stream"
    | "continue_story"
    | "reimagine_chapter";
  storyId?: string | null;
  userId?: string | null;
}

/**
 * Scan finished prose and record any crude-lexicon hit. Never throws, never
 * rewrites the text, and returns the matched terms for the caller's own logs.
 *
 * Only the matched terms travel to `error_events`, never the prose around
 * them - the AGENTS.md rule is that `context` stores identifiers and enums
 * only. The terms are a closed set defined in `validation.ts`, which is what
 * makes them enum-ish enough to store; they are also what a fix would need,
 * since "the floor leaked" is not actionable without knowing which word got
 * through.
 */
export async function reportCrudeLexicon(
  text: string,
  context: CrudeLexiconReportContext,
): Promise<string[]> {
  const terms = scanCrudeLexicon(text);
  if (!terms.length) return terms;

  console.error(
    `[content-scan] crude lexicon in ${context.feature}: ${terms.join(", ")}`,
  );
  await logError({
    bucket: "generation.story",
    severity: "low",
    source: "runtime",
    errorCode: "crude_lexicon_leaked",
    error: new Error("Generated prose contained crude lexicon terms"),
    context: {
      feature: context.feature,
      terms,
      term_count: terms.length,
      ...(context.storyId ? { story_id: context.storyId } : {}),
    },
    userId: context.userId ?? null,
  });
  return terms;
}
