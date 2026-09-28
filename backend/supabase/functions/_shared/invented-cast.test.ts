/**
 * The no-character path: a creator types one sentence and names nobody.
 *
 * Character creation is optional everywhere in the product, so this is the
 * ordinary request rather than the edge case. These tests pin two things: that
 * the brief for such a request actually asks the model to invent the people,
 * and that a brief which DOES carry a cast is byte for byte the string it was
 * before the invention block existed.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildStorySystemPrompt, buildUserPrompt } from "./story-prompts.ts";
import { EMPTY_SERIES_STATE } from "./types.ts";

/** The marker line the invention block always opens with. */
const CAST_MARKER = "Cast: the creator named nobody.";

Deno.test("no cast: the brief asks for a protagonist with an age and a nameable want", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "contemporary",
    seed: "a little girl who is afraid of the ocean",
  });
  assertStringIncludes(prompt, CAST_MARKER);
  assertStringIncludes(prompt, "a name, an age, and one specific want");
  assertStringIncludes(prompt, "interior life the reader can feel");
});

Deno.test("no cast: the brief asks for supporting people and a prior relationship", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a boy who discovers a secret garden",
  });
  assertStringIncludes(
    prompt,
    "A lone protagonist thinking to themselves is not a story.",
  );
  assertStringIncludes(
    prompt,
    "a relationship between them that already existed before the first sentence",
  );
});

Deno.test("no cast: the brief names the conflict and the arc as things to invent", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a boy who discovers a secret garden",
  });
  assertStringIncludes(prompt, "Invent the source of the conflict");
  assertStringIncludes(prompt, "The idea may be an image rather than a plot.");
  assertStringIncludes(prompt, "Invent the setting concretely");
});

Deno.test("no cast: kids get a small legible cast, adults get a tight one", () => {
  const kids = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a little girl who is afraid of the ocean",
    audienceMode: "kids",
  });
  const adult = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a woman who is afraid of the ocean",
    audienceMode: "adult",
  });
  assertStringIncludes(kids, "small and legible for a young listener");
  assert(!adult.includes("young listener"));
  assertStringIncludes(adult, "Keep the invented cast tight.");
});

Deno.test("a supplied cast suppresses the invention block entirely", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a little girl who is afraid of the ocean",
    audienceMode: "kids",
    characters: [{ name: "Maren", isHero: true }],
  });
  assert(!prompt.includes(CAST_MARKER));
  assert(!prompt.includes("Invent a protagonist"));
  assert(!prompt.includes("Invent the source of the conflict"));
});

/*
  A continuation must NOT be told to invent a lead.

  Chapter five of a cast-less story still passes `characters: []`, because the
  creator never named anyone. Its people exist in the story bible and in the
  previous-chapters window, and asking for a protagonist there is how a series
  acquires a second one.
*/
Deno.test("a later chapter never receives the invention block", () => {
  const midSeries = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a boy who discovers a secret garden",
    storyMode: "series",
    chapterRole: "mid_series",
    chapterNumber: 4,
    seriesState: EMPTY_SERIES_STATE,
  });
  assert(!midSeries.includes(CAST_MARKER));

  const finale = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a boy who discovers a secret garden",
    storyMode: "series",
    chapterRole: "finale",
    chapterNumber: 6,
  });
  assert(!finale.includes(CAST_MARKER));
});

Deno.test("a series opening still receives it", () => {
  const opening = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a boy who discovers a secret garden",
    storyMode: "series",
    chapterRole: "series_opening",
    chapterNumber: 1,
  });
  assertStringIncludes(opening, CAST_MARKER);
});

/*
  THE BYTE-IDENTICAL PROOF.

  Captured from `main` at 93d422a, before the invention block was written, and
  pasted here unaltered. If any future edit to the cast layer, the idea layer or
  the closing instruction changes what a creator who named their characters
  gets, this fails.
*/
const SUPPLIED_CAST_SNAPSHOT_93D422A = `Write a short story (1200-1600 words).
Genre: fantasy
Audience: children ages 4-10. Keep content safe and age-appropriate.
The user's idea for the story:
<katha:idea>
a little girl who is afraid of the ocean
</katha:idea>
Characters:
- <katha:character-name>
Maren
</katha:character-name> (protagonist)
  Background: <katha:background>
grew up inland
</katha:background>
  Appearance: <katha:appearance>
short braids
</katha:appearance>
- <katha:character-name>
Tio Bas
</katha:character-name>
  Background: <katha:background>
a fisherman
</katha:background>

Respond with a JSON object only. No markdown fences. Follow the output schema from your instructions.`;

Deno.test("supplied cast: the brief is byte-identical to the pre-change output", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "fantasy",
    seed: "a little girl who is afraid of the ocean",
    audienceMode: "kids",
    characters: [
      {
        name: "Maren",
        background: "grew up inland",
        appearance: "short braids",
        isHero: true,
      },
      { name: "Tio Bas", background: "a fisherman" },
    ],
    language: "English",
  });
  assertEquals(prompt, SUPPLIED_CAST_SNAPSHOT_93D422A);
});

/*
  Bedtime pacing lives in the audience layer, which is invariant per audience
  mode, so it is safe in the cached system prefix. It is the one change here
  that a supplied cast also receives, deliberately: it is about the shape of a
  bedtime story, not about who is in it.
*/
Deno.test("kids mode carries the bedtime wind-down rules", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "fantasy",
    audienceMode: "kids",
  });
  assertStringIncludes(prompt, "**Bedtime pacing:**");
  assertStringIncludes(prompt, "wind down rather than wind up");
  assertStringIncludes(
    prompt,
    "Resolve the tension this chapter raises before its final section",
  );
  assertStringIncludes(prompt, "let the last fifth be progressively calmer");
  assertStringIncludes(prompt, "No cliffhanger");
});

Deno.test("adult mode carries no bedtime pacing rules", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    audienceMode: "adult",
  });
  assert(!prompt.includes("Bedtime pacing"));
  assert(!prompt.includes("wind down rather than wind up"));
});

Deno.test("a kids series chapter keeps its bedtime pacing too", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "fantasy",
    audienceMode: "kids",
    storyMode: "series",
    chapterRole: "mid_series",
  });
  assertStringIncludes(prompt, "**Bedtime pacing:**");
  // The series contract still gets to keep its gentle open question.
  assertStringIncludes(prompt, "The larger story question may stay open");
});
