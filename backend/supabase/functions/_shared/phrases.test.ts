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
  for (const phrase of BANNED_PHRASES) {
    assertEquals(isAllowedCorpusPhrase(phrase), false, phrase);
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
