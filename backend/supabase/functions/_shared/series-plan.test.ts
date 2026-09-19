/**
 * When a long series gets a plan drawn for it, and what shape that plan has to
 * be before it is allowed anywhere near a prompt.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  AUTO_PLAN_MIN_CHAPTERS,
  buildSeriesPlanPrompt,
  needsAutoPlan,
  parseSeriesPlan,
} from "./series-plan.ts";

Deno.test("a writer's own plan is never overwritten", () => {
  assertEquals(
    needsAutoPlan({
      storyMode: "series",
      plannedChapterCount: 10,
      beats: ["Ch1: the flood", "Ch2: the list"],
    }),
    false,
  );
  // A beats array that exists but holds only blanks is an absence, not a plan.
  assert(
    needsAutoPlan({
      storyMode: "series",
      plannedChapterCount: 10,
      beats: ["", "  "],
    }),
  );
});

Deno.test("only a series long enough to drift gets a plan", () => {
  assert(!needsAutoPlan({ storyMode: "standalone", plannedChapterCount: 10 }));
  assert(
    !needsAutoPlan({
      storyMode: "series",
      plannedChapterCount: AUTO_PLAN_MIN_CHAPTERS - 1,
    }),
  );
  assert(
    needsAutoPlan({
      storyMode: "series",
      plannedChapterCount: AUTO_PLAN_MIN_CHAPTERS,
    }),
  );
  assert(needsAutoPlan({ storyMode: "series", plannedChapterCount: 15 }));
  // Past the product's own ceiling is a malformed request, not a longer story.
  assert(!needsAutoPlan({ storyMode: "series", plannedChapterCount: 40 }));
});

Deno.test("a plan with the wrong number of beats is refused outright", () => {
  // `buildPlanSection` reads beats POSITIONALLY. A nine-beat plan on a
  // ten-chapter story tells chapter ten it has run past the outline, and a
  // five-beat plan mis-assigns every chapter after the fifth. An exact match or
  // nothing.
  const nine = JSON.stringify({
    beats: Array.from({ length: 9 }, (_, i) => `Ch${i + 1}: something happens`),
    truth: [],
  });
  assertEquals(parseSeriesPlan(nine, 10), null);
  assert(parseSeriesPlan(nine, 9) !== null);
});

Deno.test("a truncated or unreadable plan is null, and the story is written as it always was", () => {
  for (const raw of ["", "{", "not json", '{"beats":"one two three"}']) {
    assertEquals(parseSeriesPlan(raw, 8), null);
  }
});

Deno.test("beats are capped at the product's beat length and the truth at eight lines", () => {
  const plan = parseSeriesPlan(
    JSON.stringify({
      beats: Array.from({ length: 5 }, () => "x".repeat(400)),
      truth: Array.from({ length: 20 }, (_, i) => `truth ${i}`),
    }),
    5,
  );
  assert(plan);
  assertEquals(plan!.beats[0].length, 200);
  assertEquals(plan!.truth.length, 8);
});

Deno.test("the plan prompt carries the count, the cast and the moments as anchors", () => {
  const prompt = buildSeriesPlanPrompt({
    seed: "A salt notary on a flooded island",
    plannedChapterCount: 10,
    primaryGenre: "mystery",
    whereAndWhen: "Zeeland, 1953",
    characters: [{ name: "Klazina", background: "a widow of sixty-one" }],
    moments: ["the dyke breaks", "the list is found"],
  });
  assert(prompt.includes("Return exactly 10 beats"));
  assert(prompt.includes("Klazina"));
  assert(prompt.includes("the dyke breaks"));
  assert(prompt.includes("Zeeland, 1953"));
});

Deno.test("a kids plan is told the safety rule before a beat is written", () => {
  // The safety layer cannot be left to the prose prompt alone: a plan that
  // schedules a fright in chapter six cannot be written safely however careful
  // chapter six's writer is.
  const prompt = buildSeriesPlanPrompt({
    seed: "A lighthouse keeper's cat",
    plannedChapterCount: 6,
    audienceMode: "kids",
  });
  assert(prompt.includes("children ages 4-10"));
  assert(prompt.includes("Nothing frightening"));
});
