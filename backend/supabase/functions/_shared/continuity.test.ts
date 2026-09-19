/**
 * The continuity check's parsing, its repair validation, and its telemetry.
 *
 * No provider is called here. What is worth pinning is everything AROUND the
 * model call: a response that cannot be read must degrade to a no-op rather
 * than damage the bible, and a repair must never be applied to prose it cannot
 * uniquely locate — it runs on text a reader has already been shown.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  applyRepairs,
  continuityErrorContext,
  contradictionInstruction,
  MAX_REPAIR_PAIRS,
  parseProposal,
  parseRepairs,
} from "./continuity.ts";
import type { BibleContradiction } from "./story-bible.ts";

Deno.test("a well-formed extraction becomes a proposal", () => {
  const proposal = parseProposal(JSON.stringify({
    facts: [{ subject: "Klazina", key: "cows", value: "three" }],
    calendar: {
      now: "Day 3, dusk",
      elapsed: "two days",
      day: 3,
      deadline: "the 09:00 ferry",
    },
    truth: ["Adriaan took the list"],
    shown: ["Klazina finds the floorboard loose"],
    noticed: [{
      what: "the ring was posted back",
      canonical: "it was returned in person",
      kind: "fact",
    }],
  }));
  assertEquals(proposal.facts.length, 1);
  assertEquals(proposal.calendar.day, 3);
  assertEquals(proposal.calendar.deadline, "the 09:00 ferry");
  assertEquals(proposal.truth.length, 1);
  assertEquals(proposal.shown.length, 1);
  assertEquals(proposal.noticed[0].kind, "fact");
});

Deno.test("an unreadable extraction is an empty proposal, never a throw", () => {
  // A continuity check that cannot answer must not be able to damage the record
  // it exists to protect. Every one of these merges as a no-op.
  for (const raw of ["", "sorry, I can't help with that", "null", "[]", "{"]) {
    const proposal = parseProposal(raw);
    assertEquals(proposal.facts.length, 0);
    assertEquals(proposal.shown.length, 0);
    assertEquals(proposal.calendar.day, undefined);
  }
});

Deno.test("strict JSON wrapped in a fence is still recovered", () => {
  const proposal = parseProposal(
    '```json\n{"facts":[{"subject":"Anil","key":"age","value":"79"}],"calendar":{},"truth":[],"shown":[],"noticed":[]}\n```',
  );
  assertEquals(proposal.facts.length, 1);
});

Deno.test("a missing day is undefined, not zero", () => {
  // Zero would read as "the story is back on its opening day" and would log a
  // clock contradiction on every chapter whose extraction skipped the field.
  const proposal = parseProposal(
    '{"facts":[],"calendar":{"now":"later"},"truth":[],"shown":[],"noticed":[]}',
  );
  assertEquals(proposal.calendar.day, undefined);
  assertEquals(proposal.calendar.now, "later");
});

Deno.test("a repair whose find text is ambiguous is rejected, not applied to the first match", () => {
  // The defect this prevents: an automated editor silently rewriting the wrong
  // sentence in prose the reader has already read. `EDIT_GUIDE.md` asked the
  // human editors for this rule in prose; here it is enforced in code.
  const chapter = "She counted the cows. Later she counted the cows again.";
  const result = applyRepairs(chapter, [{
    find: "counted the cows",
    replace: "counted the geese",
  }]);
  assertEquals(result.edits.length, 0);
  assertEquals(result.rejected, 1);
  assertEquals(result.text, chapter);
});

Deno.test("a repair whose find text is absent is rejected", () => {
  const chapter = "Eight red-and-white cows stood in the yard.";
  const result = applyRepairs(chapter, [{
    find: "nine cows",
    replace: "three cows",
  }]);
  assertEquals(result.rejected, 1);
  assertEquals(result.text, chapter);
});

Deno.test("a unique repair lands, and later pairs are checked against the repaired text", () => {
  const chapter =
    "Eight cows stood in the yard. Klazina counted eight, then eight more.";
  const result = applyRepairs(chapter, [
    { find: "Eight cows stood", replace: "Three cows stood" },
    // Now ambiguous in the ORIGINAL and still ambiguous after the first pair:
    // rejected either way, which is the point of re-checking.
    { find: "eight", replace: "three" },
  ]);
  assertEquals(result.edits.length, 1);
  assertEquals(result.rejected, 1);
  assert(result.text.startsWith("Three cows stood"));
});

Deno.test("repairs are capped, so a chapter needing wholesale rewriting is not rewritten here", () => {
  const many = Array.from(
    { length: 12 },
    (_, i) => ({ find: `f${i}`, replace: `r${i}` }),
  );
  assertEquals(
    parseRepairs(JSON.stringify({ edits: many })).length,
    MAX_REPAIR_PAIRS,
  );
});

Deno.test("a no-op pair and a malformed pair are both dropped before anything is applied", () => {
  const pairs = parseRepairs(JSON.stringify({
    edits: [
      { find: "same", replace: "same" },
      { find: "   ", replace: "x" },
      { find: 7, replace: "x" },
      { find: "real", replace: "fixed" },
    ],
  }));
  assertEquals(pairs.length, 1);
  assertEquals(pairs[0].replace, "fixed");
});

function hard(what: string): BibleContradiction {
  return {
    chapter: 5,
    what,
    canonical: "canon says otherwise",
    severity: "hard",
    kind: "fact",
  };
}

Deno.test("a regeneration instruction names the contradiction rather than saying 'try again'", () => {
  const instruction = contradictionInstruction([
    hard("Klazina has eight cows"),
    { ...hard("x"), severity: "soft", what: "a hunch" },
  ]);
  assert(instruction.includes("Klazina has eight cows"));
  // Soft contradictions never reach a regeneration: a model's hunch must not
  // cost a reader a second chapter.
  assertEquals(instruction.includes("a hunch"), false);
});

Deno.test("no hard contradiction means no regeneration instruction at all", () => {
  assertEquals(
    contradictionInstruction([{ ...hard("x"), severity: "soft" }]),
    "",
  );
  assertEquals(contradictionInstruction([]), "");
});

Deno.test("telemetry carries counts and enums, never a word of the story", () => {
  const context = continuityErrorContext({
    chapterNumber: 7,
    contradictions: [
      hard("Klazina has eight cows"),
      {
        chapter: 7,
        what: "the ferry left at eight",
        canonical: "09:00",
        severity: "soft",
        kind: "clock",
      },
    ],
    repaired: 1,
    rejected: 0,
    elapsedMs: 4_200,
  });
  const serialized = JSON.stringify(context);
  // `error_events.context` is identifiers and enums only. A contradiction is
  // made of exactly the kind of text that rule exists to keep out of it.
  assertEquals(serialized.includes("Klazina"), false);
  assertEquals(serialized.includes("ferry"), false);
  assertEquals(context.hard_count, 1);
  assertEquals(context.soft_count, 1);
  assertEquals((context.kinds as Record<string, number>).clock, 1);
  assertEquals(context.chapter_number, 7);
});
