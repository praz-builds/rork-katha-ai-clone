import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildContinuationSystemPrompt,
  buildStorySystemPrompt,
  buildUserPrompt,
} from "./story-prompts.ts";

Deno.test("buildStorySystemPrompt includes genre module text", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "romance" });
  assert(prompt.includes("## Genre: romance"));
  assert(prompt.includes("Intimate, warm, grounded"));
});

Deno.test("genre normalization: drama maps to contemporary", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "drama" });
  assert(prompt.includes("## Genre: contemporary"));
});

Deno.test("genre normalization: FANTASY case-insensitive", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "FANTASY" });
  // should normalize to fantasy
  assert(prompt.includes("## Genre: fantasy"));
});

Deno.test("genre normalization: unknown defaults to contemporary", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "unknownGenre" });
  assert(prompt.includes("## Genre: contemporary"));
});

Deno.test("kids mode includes audience mode rules", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "adventure",
    audienceMode: "kids",
  });
  assert(prompt.includes("## Kids Mode (MANDATORY CONSTRAINTS)"));
  assert(prompt.includes("children ages 4-10"));
});

Deno.test("adult mode does not include kids rules", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    audienceMode: "adult",
  });
  assert(!prompt.includes("## Kids Mode"));
});

Deno.test("queer lens text present when enabled", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    identityLenses: ["queer"],
  });
  assert(prompt.includes("## Queer Identity Lens"));
});

Deno.test("queer lens absent when not enabled", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "romance" });
  assert(!prompt.includes("## Queer Identity Lens"));
});

Deno.test("trope text present for werewolf", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "paranormalRomance",
    tropeModules: ["werewolf"],
  });
  assert(prompt.includes("## Trope Guidance"));
  assert(prompt.includes("werewolf pack dynamics"));
});

Deno.test("output schema reminder present in every prompt", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "comedy" });
  assert(prompt.includes("## Output Format (CRITICAL)"));
  assert(prompt.includes("chapter_body"));
});

Deno.test("spice rules vary: sweet vs steamy", () => {
  const sweetPrompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    spiceLevel: "sweet",
  });
  const steamyPrompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    spiceLevel: "steamy",
  });
  assert(sweetPrompt.includes("Content Heat: Sweet"));
  assert(steamyPrompt.includes("Content Heat: Steamy"));
  assert(!sweetPrompt.includes("Content Heat: Steamy"));
});

Deno.test("story engine section present", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "thriller" });
  assert(prompt.includes("## Story Engine"));
  assert(prompt.includes("Protagonist with a want"));
});

Deno.test("language section added for non-English", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    language: "Spanish",
  });
  assert(prompt.includes("Write the entire story in Spanish"));
});

Deno.test("language section absent for English", () => {
  const prompt = buildStorySystemPrompt({
    primaryGenre: "romance",
    language: "English",
  });
  assert(!prompt.includes("Write the entire story in English"));
});

Deno.test("deprecated 2-arg signature still works", () => {
  const prompt = buildStorySystemPrompt("romance", "Spanish");
  assert(prompt.includes("## Genre: romance"));
  assert(prompt.includes("Write the entire story in Spanish"));
});

Deno.test("buildContinuationSystemPrompt includes continuation rules", () => {
  const prompt = buildContinuationSystemPrompt({
    primaryGenre: "mystery",
    mode: "chapter",
  });
  assert(prompt.includes("## Continuation Rules"));
  assert(prompt.includes("## Mid-Series Chapter"));
});

Deno.test("buildContinuationSystemPrompt finale mode", () => {
  const prompt = buildContinuationSystemPrompt({
    primaryGenre: "mystery",
    mode: "finale",
  });
  assert(prompt.includes("## Series Finale"));
  assert(!prompt.includes("## Mid-Series Chapter"));
});

Deno.test("buildUserPrompt includes genre and seed", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "thriller",
    seed: "A detective discovers that all the evidence points to herself",
  });
  assert(prompt.includes("Genre: thriller"));
  assert(prompt.includes("A detective discovers"));
});

Deno.test("buildUserPrompt kids mode adds audience note", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "adventure",
    audienceMode: "kids",
    seed: "A young fox discovers a magical forest near her den at sunrise",
  });
  assert(prompt.includes("Audience: children ages 4-10"));
  assert(prompt.includes("500-1200 words"));
});

Deno.test("buildUserPrompt includes tropes when set", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "romance",
    tropeModules: ["enemiesToLovers", "forcedProximity"],
    seed: "Two rival bakery owners compete for the same high-end vanilla extract",
  });
  assert(prompt.includes("Tropes to include: enemiesToLovers, forcedProximity"));
});

Deno.test("new genre modules exist: darkRomance, cozyFantasy, paranormalRomance, contemporary", () => {
  for (const genre of ["darkRomance", "cozyFantasy", "paranormalRomance", "contemporary"]) {
    const prompt = buildStorySystemPrompt({ primaryGenre: genre });
    assert(prompt.includes(`## Genre: ${genre}`), `Missing genre module for ${genre}`);
  }
});

Deno.test("banned words are in the prompt", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "fantasy" });
  assert(prompt.includes("delve"));
  assert(prompt.includes("tapestry"));
});
