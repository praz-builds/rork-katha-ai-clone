/**
 * Job 3: grounding must run for every genre, not just the ones it was first
 * built and tested against.
 *
 * The product requirement is "grounding on all genres." The pipeline itself
 * (`resolveGrounding` in `grounding-pipeline.ts`) already has no genre concept
 * at all - its input is `{ idea, characterNames, cache, deadlineMs }`, and
 * every one of `generate-story`, `generate-story-stream` and `shape-story`
 * calls it without branching on `primaryGenre` first. That is a structural
 * argument, not a test, so this file proves the one place a genre COULD
 * plausibly gate grounding without anyone noticing: the prompt layer that
 * renders a resolved card into the text the model actually reads.
 *
 * `buildUserPrompt` in `story-prompts.ts` inserts `buildGroundingBlock`
 * unconditionally - it does not sit inside any genre-specific branch - and
 * this file asserts that holds for every member of `PRIMARY_GENRES`,
 * including every DB-only genre a story can still be stored and continued in.
 * A regression that wrapped the grounding layer in "only for genres that need
 * facts" would fail this test for whichever genres it excluded.
 */
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildUserPrompt } from "./story-prompts.ts";
import type { GroundingCard } from "./grounding-types.ts";
import { PRIMARY_GENRES, type PrimaryGenre } from "./types.ts";

const RAIGAD_FORT: GroundingCard = {
  canonicalName: "Raigad Fort",
  entityClass: "real_place",
  era: "17th century, Western Ghats",
  role: "Hill fort and Maratha capital",
  nameForms: "Raigad Fort, never anglicised as 'Fort Raigad'",
  voice: "",
  details: [
    "Reached by a single stepped path cut into rock",
    "Monsoon closes the ravine roads for months",
    "A market square at the summit, not just fortifications",
    "Cisterns cut into stone to hold the monsoon's water",
    "Stone walls that follow the hill's own contour",
  ],
  pitfalls: ["Placing it on a plain rather than a hilltop"],
  source: "model_knowledge",
};

Deno.test("every primary genre renders the grounding block - grounding is not gated by genre", () => {
  assert(PRIMARY_GENRES.size > 0);

  for (const genre of PRIMARY_GENRES) {
    const prompt = buildUserPrompt({
      primaryGenre: genre as PrimaryGenre,
      seed: "A courier climbs to Raigad Fort at dawn.",
      grounding: [RAIGAD_FORT],
    });

    assertStringIncludes(
      prompt,
      "## Grounded facts",
      `grounding block missing for genre "${genre}"`,
    );
    assertStringIncludes(
      prompt,
      "Raigad Fort",
      `grounded entity missing for genre "${genre}"`,
    );
  }
});

Deno.test("an ungrounded prompt is identical across genres in whether it carries a grounding block", () => {
  // The negative case matters too: no card, no block, for every genre alike -
  // proving the presence/absence of the layer tracks whether a card was
  // resolved, never which genre was selected.
  for (const genre of PRIMARY_GENRES) {
    const prompt = buildUserPrompt({
      primaryGenre: genre as PrimaryGenre,
      seed: "A dragon and a princess share a pot of tea.",
    });
    assert(
      !prompt.includes("## Grounded facts"),
      `unexpected grounding block for genre "${genre}"`,
    );
  }
});
