import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BANNED_PHRASES, BANNED_WORDS } from "./ban-lists.ts";
import {
  buildPhraseLayer,
  isAllowedCorpusPhrase,
  MAX_PHRASE_LAYER_PHRASES,
  normalizePhraseKey,
} from "./phrases.ts";

Deno.test("normalisation collapses casing, trailing punctuation, and curly apostrophes", () => {
  assertEquals(
    normalizePhraseKey("At the end of the day."),
    normalizePhraseKey("at the end of the day"),
  );
  assertEquals(
    normalizePhraseKey("Couldn\u2019t help but!"),
    normalizePhraseKey("couldn't help but"),
  );
});

Deno.test("a banned word or banned phrase is refused entry to the corpus", () => {
  for (const word of BANNED_WORDS) {
    assertEquals(isAllowedCorpusPhrase(word), false, word);
  }
  // A pattern carrying a literal `.*` is not a phrase anybody writes, so the
  // wildcard is instantiated with a real word before the assertion. Feeding the
  // raw pattern back in tested the matcher against its own syntax rather than
  // against prose, which is what let the wildcard bug hide.
  for (const phrase of BANNED_PHRASES) {
    const written = phrase.replaceAll(".*", "her");
    assertEquals(isAllowedCorpusPhrase(written), false, written);
  }
  assertEquals(isAllowedCorpusPhrase("on my way"), true);
});

Deno.test("buildPhraseLayer returns empty for an empty list", () => {
  assertEquals(buildPhraseLayer([]), "");
});

Deno.test("buildPhraseLayer caps injected phrases at the documented number", () => {
  const phrases = Array.from(
    { length: MAX_PHRASE_LAYER_PHRASES + 3 },
    (_, index) => `phrase ${index}`,
  );
  const block = buildPhraseLayer(phrases);

  assertStringIncludes(block, `Use at most ${MAX_PHRASE_LAYER_PHRASES}`);
  assertEquals(block.match(/^- "/gm)?.length, MAX_PHRASE_LAYER_PHRASES);
  assertStringIncludes(block, '"phrase 0"');
  assertEquals(block.includes(`"phrase ${MAX_PHRASE_LAYER_PHRASES}"`), false);
});

Deno.test("the phrase prompt is dialogue-only and lesson-resistant", () => {
  const block = buildPhraseLayer(["on my way"]);
  assertStringIncludes(block, "DIALOGUE only");
  assertStringIncludes(block, "narration ban lists still govern narration");
  assertStringIncludes(block, "never gloss or explain");
  assertStringIncludes(block, "A story that reads like a lesson has failed");
});

// The ban list contains three patterns with a `.*` wildcard, and they were
// silently inert.
//
// `isAllowedCorpusPhrase` normalised each pattern with `normalizePhraseKey`
// before matching, and that strips everything which is not a letter, number or
// apostrophe. "knot in .* stomach" therefore became the literal "knot in
// stomach": the phrase people actually write was allowed straight into the
// corpus, while a collapsed form nobody writes was refused. Exactly backwards,
// and invisible without a test that uses a real sentence.
Deno.test("wildcard ban patterns match the words people actually write", () => {
  for (
    const banned of [
      "knot in my stomach",
      "knot in her stomach",
      "pit in his stomach",
      "let out a breath she didn't know she was holding",
      "let out a breath he didn’t know he was holding",
    ]
  ) {
    assertEquals(
      isAllowedCorpusPhrase(banned),
      false,
      `should be refused: ${banned}`,
    );
  }
});

// The mirror. A ban list that refused everything would pass the test above.
Deno.test("teachable idiom is still allowed past the ban list", () => {
  for (
    const allowed of [
      "hang in there",
      "break a leg",
      "it is on me",
      "call it a day",
      "get the hang of it",
    ]
  ) {
    assertEquals(
      isAllowedCorpusPhrase(allowed),
      true,
      `should be allowed: ${allowed}`,
    );
  }
});
