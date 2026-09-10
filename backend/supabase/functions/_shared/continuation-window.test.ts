/**
 * The previous-chapters window: what a continuation actually sends.
 *
 * These pin a LATENCY decision, so they assert sizes as well as content. The
 * defect being prevented is not a wrong chapter; it is a prompt that grows with
 * the series until a reader waits fifteen seconds for the first word.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildPreviousChapterWindow,
  trimToEnds,
  VERBATIM_HEAD_CHARS,
  VERBATIM_TAIL_CHARS,
} from "./continuation-window.ts";

/** A chapter of roughly the length the app actually writes (~2,100 words). */
function chapter(n: number, marker: string) {
  const filler = `${marker} `.repeat(2_000);
  return {
    chapter_number: n,
    title: `Chapter ${n} title`,
    content: `OPENING-${n}. ${filler} ENDING-${n}.`,
    previously_summary: `Summary of chapter ${n}.`,
    hook_type: "unanswered_question",
    hook_text: `Hook ${n}.`,
  };
}

Deno.test("only the newest chapter travels as prose", () => {
  // The read hands them back newest-first; the prompt reads oldest-first.
  const window = buildPreviousChapterWindow([
    chapter(3, "gamma"),
    chapter(2, "beta"),
    chapter(1, "alpha"),
  ]);
  assertStringIncludes(window, "Summary of chapter 1.");
  assertStringIncludes(window, "Summary of chapter 2.");
  // The newest keeps its own ends...
  assertStringIncludes(window, "OPENING-3");
  assertStringIncludes(window, "ENDING-3");
  // ...and the older ones send no prose at all.
  assertEquals(window.includes("alpha alpha"), false);
  assertEquals(window.includes("beta beta"), false);
});

Deno.test("the window is bounded, not proportional to the series", () => {
  const four = buildPreviousChapterWindow([
    chapter(4, "d"),
    chapter(3, "c"),
    chapter(2, "b"),
    chapter(1, "a"),
  ]);
  const one = buildPreviousChapterWindow([chapter(1, "a")]);
  // Four chapters of context must not cost four chapters of prompt. Before
  // this, chapter 5's prompt was ~66 KB and ~15 s to first token.
  assert(
    four.length < one.length + 2_000,
    `four chapters produced ${four.length}, one produced ${one.length}`,
  );
  assert(four.length < 12_000, `window was ${four.length} characters`);
});

Deno.test("a chapter short enough to send whole is sent untouched", () => {
  const text = "A short chapter that fits inside the budget.";
  assertEquals(trimToEnds(text), text);
  // Nothing changes for the stories where nothing needed to.
  assertEquals(trimToEnds(text).includes("["), false);
});

Deno.test("a trimmed chapter keeps both ends and says the middle is gone", () => {
  const long = `HEAD${"x".repeat(40_000)}TAIL`;
  const trimmed = trimToEnds(long);
  assertStringIncludes(trimmed, "HEAD");
  assertStringIncludes(trimmed, "TAIL");
  // Stated rather than silently joined: a model handed prose that ends
  // mid-scene and resumes elsewhere treats the join as a jump cut it has to
  // write around.
  assertStringIncludes(trimmed, "a passage from the middle of this chapter is omitted");
  assert(trimmed.length < VERBATIM_HEAD_CHARS + VERBATIM_TAIL_CHARS + 200);
});

Deno.test("a trimmed newest chapter carries its own summary across the cut", () => {
  // The cut drops ~60% of a standard chapter. Without this the model was told
  // a passage was "summarised above" when the only summaries above belonged to
  // OLDER chapters -- pointed at a summary that did not exist, for the one
  // chapter it most needs to be continuous with.
  const window = buildPreviousChapterWindow([chapter(2, "beta")]);
  assertStringIncludes(window, "What this chapter covered: Summary of chapter 2.");

  // A chapter short enough to travel whole needs no summary of itself; adding
  // one would state the same fact twice.
  const short = buildPreviousChapterWindow([{
    chapter_number: 2,
    content: "Short enough to send whole.",
    previously_summary: "A summary nobody needs here.",
  }]);
  assertEquals(short.includes("What this chapter covered"), false);
});

Deno.test("an empty history produces an empty window, not a broken one", () => {
  assertEquals(buildPreviousChapterWindow([]), "");
  // A chapter row with no content must not put "undefined" into the prompt.
  const window = buildPreviousChapterWindow([
    { chapter_number: 1, content: null, previously_summary: null },
  ]);
  assertEquals(window.includes("undefined"), false);
});
