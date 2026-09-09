// The generation deadline arithmetic, pinned.
//
// 2026-09-09: a real chapter from the leading model takes 70s. The previous
// 120s budget split its 84s paid window evenly across two models, 42s each,
// so the leader timed out before it had finished writing - every time, with a
// healthy credential. These tests are the arithmetic that must not regress.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GENERATION_DEADLINE_MS,
  OPENROUTER_CHAPTER_RESERVE_MS,
  OPENROUTER_MODELS,
  openRouterPhaseDeadlines,
  PHASE_END_SHARE,
} from "./llm.ts";

const MEASURED_CHAPTER_MS = 70_000;

Deno.test("the buffered budget lets both paid models each write a measured chapter", () => {
  const window = Math.floor(
    GENERATION_DEADLINE_MS * PHASE_END_SHARE.openrouter,
  );
  const deadlines = openRouterPhaseDeadlines(window, OPENROUTER_MODELS.length);
  assertEquals(deadlines.length, OPENROUTER_MODELS.length);
  // The leader's own slice fits a chapter.
  assert(deadlines[0] >= MEASURED_CHAPTER_MS, `leader gets ${deadlines[0]}ms`);
  // Every follower still has a chapter left even if the leader burns its slice.
  for (let index = 1; index < deadlines.length; index += 1) {
    const inherited = deadlines[index] - deadlines[index - 1];
    assert(
      inherited >= MEASURED_CHAPTER_MS,
      `model ${index} inherits only ${inherited}ms`,
    );
  }
  // The last model owns the whole window: nothing is left unspendable.
  assertEquals(deadlines[deadlines.length - 1], window);
  assertEquals(OPENROUTER_CHAPTER_RESERVE_MS, MEASURED_CHAPTER_MS);
});

Deno.test("the paid phase is not split evenly, and a small budget degrades to an equal share", () => {
  // 160s across two models: leader 90s, follower the rest.
  assertEquals(openRouterPhaseDeadlines(160_000, 2), [90_000, 160_000]);
  // Each follower keeps a chapter behind the model in front of it.
  assertEquals(openRouterPhaseDeadlines(210_000, 3), [
    70_000,
    140_000,
    210_000,
  ]);
  // A 60s edit window cannot reserve 70s; it falls back to equal slices.
  assertEquals(openRouterPhaseDeadlines(48_000, 2), [24_000, 48_000]);
  assertEquals(openRouterPhaseDeadlines(0, 2), [0, 0]);
  assertEquals(openRouterPhaseDeadlines(10_000, 0), []);
});

Deno.test("Gemini and the free tier keep real slices behind the leader", () => {
  const gemini = Math.floor(
    GENERATION_DEADLINE_MS * (PHASE_END_SHARE.gemini - PHASE_END_SHARE.openrouter),
  );
  const free = Math.floor(
    GENERATION_DEADLINE_MS *
      (PHASE_END_SHARE.openrouterFree - PHASE_END_SHARE.gemini),
  );
  // Enough for a quota-blocked provider to say so, and no more.
  assert(gemini >= 20_000, `gemini slice ${gemini}ms`);
  assert(free >= 10_000, `free slice ${free}ms`);
});
