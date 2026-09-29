/**
 * The faith layer, as it reaches a prompt.
 *
 * `traditions.test.ts` covers the contract and `tradition-classify.test.ts`
 * covers the reading of an idea. What is left, and what this file is, is the
 * join: does the reviewed policy actually arrive in the text the model is sent,
 * and -- much more importantly -- does NOTHING arrive when no tradition was
 * asked for.
 *
 * The invariant at the top of the file is the one worth breaking the build
 * over: a story with no tradition must produce a BYTE-IDENTICAL user prompt to
 * the one it produced before this layer existed. Every story ever written here
 * has no tradition, so a stray newline in the absent case is a change to the
 * entire product, and it is not the kind of change that shows up as an error.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildContinuationUserPrompt,
  buildStorySystemPrompt,
  buildTraditionBlock,
  buildUserPrompt,
  type ContinuationPromptInput,
} from "./story-prompts.ts";
import { buildStoryShapePrompt } from "./story-shape.ts";
import {
  getTradition,
  SUPPORTED_TRADITION_IDS,
  type SupportedTraditionId,
  UNIVERSAL_SCRIPTURE_RULES,
} from "./traditions.ts";
import { classifyTraditionForGeneration } from "./tradition-classify.ts";
import { EMPTY_SERIES_STATE } from "./types.ts";

const SEED = "Two sisters argue over a lantern on the last night of a journey.";

// ---------------------------------------------------------------------------
// Absent is absent
// ---------------------------------------------------------------------------

Deno.test("buildTraditionBlock is empty for absent, unknown and unsupported", () => {
  assertEquals(buildTraditionBlock(undefined), "");
  assertEquals(buildTraditionBlock(null), "");
  assertEquals(buildTraditionBlock(""), "");
  // Declared in `traditions.ts` but not supported: recognised, and deliberately
  // rendered as nothing, because no reviewed representation policy exists.
  for (const id of ["buddhist", "sikh", "shinto", "secular"]) {
    assertEquals(buildTraditionBlock(id), "", id);
  }
  // A value that bypassed the validator reaches nothing it did not pick,
  // including a key every object inherits.
  for (const bogus of ["atlantis", "constructor", "toString", 7, {}]) {
    assertEquals(buildTraditionBlock(bogus), "", String(bogus));
  }
});

Deno.test("no tradition leaves the user prompt byte-identical", () => {
  const base = {
    primaryGenre: "contemporary",
    genres: ["contemporary"],
    seed: SEED,
    storyMode: "standalone" as const,
    chapterRole: "standalone" as const,
    characters: [{ name: "Amina", isHero: true }],
    whereAndWhen: "A night train, 1994",
    culturalSetting: "IN" as const,
    moments: ["The lantern goes out."],
    beats: ["They argue."],
    chapterNumber: 1,
    audienceMode: "adult" as const,
    spiceLevel: "sweet" as const,
    chapterLength: "standard" as const,
  };
  const before = buildUserPrompt(base);
  // Cast at the boundary on purpose: the public overload types `tradition` as
  // a supported id, so these are the values that can only arrive from a caller
  // that skipped the validator. They must still render nothing.
  for (const absent of [undefined, null, "", "buddhist", "nonsense", 3]) {
    assertEquals(
      buildUserPrompt({
        ...base,
        tradition: absent as unknown as undefined,
      }),
      before,
      String(absent),
    );
  }
  assert(!before.includes("Faith and tradition"));
});

Deno.test("no tradition leaves the continuation prompt byte-identical", () => {
  const base: ContinuationPromptInput = {
    primaryGenre: "contemporary",
    genres: ["contemporary"],
    audienceMode: "adult",
    spiceLevel: "sweet",
    chapterRole: "mid_series",
    chapterNumber: 3,
    chapterLength: "standard",
    plannedChapterCount: 5,
    seed: SEED,
    moments: [],
    beats: [],
    storyValues: [],
    characters: [],
    seriesState: EMPTY_SERIES_STATE,
    title: "The Lantern",
    previousChapters: "Chapter two happened.",
    isFinale: false,
  };
  const before = buildContinuationUserPrompt(base);
  const after = buildContinuationUserPrompt({ ...base, tradition: undefined });
  assertEquals(after.jsonPrompt, before.jsonPrompt);
  assertEquals(after.prosePrompt, before.prosePrompt);
  assert(!before.jsonPrompt.includes("Faith and tradition"));
});

// ---------------------------------------------------------------------------
// The block itself
// ---------------------------------------------------------------------------

Deno.test("every Phase 1 tradition renders a block with its own policy", () => {
  assertEquals([...SUPPORTED_TRADITION_IDS].sort(), [
    "christian",
    "hindu",
    "jewish",
    "muslim",
  ]);
  for (const id of SUPPORTED_TRADITION_IDS) {
    const block = buildTraditionBlock(id);
    const entry = getTradition(id);
    assertStringIncludes(block, "Faith and tradition:");
    assertStringIncludes(block, entry.promptName);
    // Every narration rule, verbatim from the contract.
    for (const rule of entry.narrationRules) assertStringIncludes(block, rule);
    // The stereotype guard and its framing.
    // The stereotype guard, led by what to BUILD rather than by what to avoid:
    // the positive instruction comes first and at length, the list is the
    // boundary on it. See the comment on the clause in story-prompts.ts.
    assertStringIncludes(
      block,
      "Build the story out of family, relationships, values, ordinary life, celebration and community.",
    );
    assertStringIncludes(
      block,
      "A tradition is not a building, a garment and a symbol",
    );
    assert(
      block.indexOf("Build the story out of family") <
        block.indexOf("Steer clear of:"),
      "the positive instruction must precede the avoid list",
    );
    for (const item of entry.avoidStereotypes) {
      assertStringIncludes(block, item);
    }
    // The same precedence line the Story world block ends on.
    assertStringIncludes(
      block,
      "If the brief points anywhere else, follow the brief; this preference never overrides it.",
    );
  }
});

Deno.test("scripture is prohibited in every tradition's block", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    const block = buildTraditionBlock(id);
    for (const rule of UNIVERSAL_SCRIPTURE_RULES) {
      assertStringIncludes(block, rule);
    }
    assertStringIncludes(
      block,
      "Direct scriptural quotation is not available in this product.",
    );
    assertStringIncludes(block, "Qur'an verse");
    assertStringIncludes(block, "hadith");
    assertStringIncludes(block, "Bible or Torah passage");
    assertStringIncludes(block, "may only be paraphrased");
    assertStringIncludes(
      block,
      "read as a retelling in the storyteller's own plain words rather than as a quotation",
    );
    // The tradition's own texts are named, from the contract.
    for (const text of getTradition(id).scripturePolicy.namedTexts) {
      assertStringIncludes(block, text);
    }
  }
});

Deno.test("Muslim: prophets are narrated only and may never be voiced", () => {
  const block = buildTraditionBlock("muslim");
  assertStringIncludes(block, "Narrated only, never voiced:");
  assertStringIncludes(block, "Allah");
  assertStringIncludes(block, "the prophets, including Muhammad");
  assertStringIncludes(block, "angels");
  // The default-on extensions, which is what makes the Prophet's family and
  // companions configurable rather than hard-coded here.
  assertStringIncludes(block, "The Prophet's family (Ahl al-Bayt)");
  assertStringIncludes(block, "The Prophet's companions (Sahaba)");
  // All four halves of the rule.
  assertStringIncludes(block, "never given a line of dialogue");
  assertStringIncludes(block, "never quoted word for word");
  assertStringIncludes(
    block,
    "never voiced, imitated or channelled by another character",
  );
  assertStringIncludes(block, "never a point-of-view character");
  assertStringIncludes(block, "spoken ABOUT in narration");
});

Deno.test("narrate-only appears for every tradition that has such figures", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    const block = buildTraditionBlock(id);
    assertStringIncludes(block, "Narrated only, never voiced:");
    for (const figure of getTradition(id).depiction.narrateOnly) {
      assertStringIncludes(block, figure);
    }
  }
});

Deno.test("Jewish: the spoken divine address reaches the prompt", () => {
  const block = buildTraditionBlock("jewish");
  assertStringIncludes(block, 'use "Hashem"');
  // And only where the contract has one; the others must not invent a word.
  for (const id of ["christian", "hindu"] as SupportedTraditionId[]) {
    assertEquals(getTradition(id).divineAddress, null);
    assert(!buildTraditionBlock(id).includes("named aloud"));
  }
});

Deno.test("nothing in the block is client text", () => {
  // The block is assembled from the checked-in contract only, so a value a
  // client could ever send cannot appear in it.
  for (const id of SUPPORTED_TRADITION_IDS) {
    const block = buildTraditionBlock(id);
    assert(!block.includes("<katha:"), id);
  }
});

// ---------------------------------------------------------------------------
// Placement in the assembled prompt
// ---------------------------------------------------------------------------

Deno.test("the tradition block sits beside, and after, the story world block", () => {
  const prompt = buildUserPrompt({
    primaryGenre: "contemporary",
    seed: SEED,
    culturalSetting: "IN",
    tradition: "christian",
  });
  const world = prompt.indexOf("Story world preference:");
  const faith = prompt.indexOf("Faith and tradition:");
  assert(world > -1 && faith > world);
  // The two axes are independent: India and a Christian family is an ordinary
  // household, and both must survive into the prompt.
  assertStringIncludes(prompt, "rooted in India");
  assertStringIncludes(prompt, "a Christian family's tradition");
});

Deno.test("the tradition survives into a continuation", () => {
  const { jsonPrompt, prosePrompt } = buildContinuationUserPrompt({
    primaryGenre: "contemporary",
    genres: ["contemporary"],
    audienceMode: "adult",
    spiceLevel: "sweet",
    chapterRole: "mid_series",
    chapterNumber: 4,
    chapterLength: "standard",
    plannedChapterCount: 6,
    seed: SEED,
    tradition: "muslim",
    moments: [],
    beats: [],
    storyValues: [],
    characters: [],
    seriesState: EMPTY_SERIES_STATE,
    title: "The Lantern",
    previousChapters: "Chapter three happened.",
    isFinale: false,
  });
  for (const prompt of [jsonPrompt, prosePrompt]) {
    assertStringIncludes(prompt, "Faith and tradition:");
    assertStringIncludes(prompt, "a Muslim family's tradition");
    assertStringIncludes(prompt, "Narrated only, never voiced:");
  }
});

// ---------------------------------------------------------------------------
// The system prompt: static, and the precedence fix
// ---------------------------------------------------------------------------

Deno.test("the system prompt states the precedence rule, statically", () => {
  const prompt = buildStorySystemPrompt({ primaryGenre: "contemporary" });
  assertStringIncludes(prompt, "Inference is the fallback, not the authority.");
  assertStringIncludes(
    prompt,
    "outranks anything the names would suggest: follow the stated one, and let the names follow it too, never the reverse",
  );
  assertStringIncludes(
    prompt,
    "any cultural setting or faith tradition the brief states outright",
  );
  // And it names no tradition, because it is the same bytes for everyone.
  for (const id of SUPPORTED_TRADITION_IDS) {
    assert(
      !prompt.includes(getTradition(id).promptName),
      `system prompt must not name ${id}`,
    );
  }
  assert(!prompt.includes("Faith and tradition:"));
});

Deno.test("the system prompt is byte-identical across traditions", () => {
  // THE CACHE ARGUMENT, executed. `systemMessage` in `llm.ts` marks the system
  // prompt as a cache prefix on the strength of it being identical per (genre,
  // audience, spice, language, mode, length). The precedence sentence added for
  // the faith layer is static text: it takes no tradition, so there is nothing
  // it could vary on. `buildStorySystemPrompt` does not accept a tradition at
  // all, which is the structural half of the same guarantee; this asserts the
  // textual half by pinning the exact bytes across every axis the prefix is
  // keyed on.
  const axes = [
    { primaryGenre: "romance" },
    { primaryGenre: "romance", audienceMode: "kids" as const },
    { primaryGenre: "horror", spiceLevel: "steamy" as const },
    { primaryGenre: "mystery", language: "Spanish" },
  ];
  for (const axis of axes) {
    const a = buildStorySystemPrompt(axis);
    const b = buildStorySystemPrompt({ ...axis });
    assertEquals(a, b, JSON.stringify(axis));
    assertStringIncludes(a, "Inference is the fallback, not the authority.");
  }
});

// ---------------------------------------------------------------------------
// Where the value comes from
// ---------------------------------------------------------------------------

Deno.test("an explicit request tradition beats the classifier", () => {
  // The resolution the two generation handlers perform, stated as the one
  // expression they both use. An idea that classifies one way, with a request
  // that states another, must follow the request: a stated preference is never
  // overruled by a guess about the same thing.
  const idea = "An Islamic bedtime story about a lost key.";
  const classified = classifyTraditionForGeneration(idea);
  assertEquals(classified.tradition, "muslim");

  const requested: SupportedTraditionId = "jewish";
  const resolved = requested ?? classified.tradition;
  assertEquals(resolved, "jewish");
  assertStringIncludes(
    buildUserPrompt({
      primaryGenre: "contemporary",
      seed: idea,
      tradition: resolved,
    }),
    "a Jewish family's tradition",
  );

  // And with nothing stated, the classifier fills the gap.
  const unstated: SupportedTraditionId | undefined = undefined;
  assertEquals(unstated ?? classified.tradition, "muslim");
});

Deno.test("a canonical request reaches the prompt downgraded to inspired", () => {
  // "Retell the story of Rama" asks for a canonical retelling, which Phase 1
  // cannot do (no verified source, and quotation is forbidden). The downgrade
  // happens in `classifyTraditionForGeneration`, so what reaches the prompt is
  // the tradition with an original story in its spirit -- never a recollection
  // of scripture with a sacred name on it.
  const result = classifyTraditionForGeneration(
    "Retell the story of Rama and the forest years.",
  );
  assertEquals(result.tradition, "hindu");
  assertEquals(result.provenance, "inspired");
  assertEquals(result.downgraded, true);

  const prompt = buildUserPrompt({
    primaryGenre: "adventure",
    seed: "Retell the story of Rama and the forest years.",
    tradition: result.tradition,
  });
  assertStringIncludes(prompt, "a Hindu family's tradition");
  assertStringIncludes(prompt, "Never quote the Gita or any shloka");
  assertStringIncludes(
    prompt,
    "Direct scriptural quotation is not available in this product.",
  );
});

Deno.test("an idea that merely mentions a faith stays silent", () => {
  for (
    const idea of [
      "A bedtime story about a boy named Christian who loses his bike.",
      "A church bake sale goes wrong.",
      "A heist during Diwali.",
    ]
  ) {
    assertEquals(
      classifyTraditionForGeneration(idea).tradition,
      undefined,
      idea,
    );
    assertEquals(
      buildTraditionBlock(classifyTraditionForGeneration(idea).tradition),
      "",
      idea,
    );
  }
});

// ---------------------------------------------------------------------------
// Shaping, which runs first and names the cast
// ---------------------------------------------------------------------------

Deno.test("the shaper is told the tradition before it invents a cast", () => {
  const withTradition = buildStoryShapePrompt(
    "A lost lantern.",
    "contemporary",
    {
      tradition: "muslim",
    },
  );
  assertStringIncludes(withTradition, "a Muslim family's tradition");
  assertStringIncludes(
    withTradition,
    "A stated tradition outranks anything the idea's names would otherwise suggest",
  );
  assertStringIncludes(withTradition, "sacred figures are narrated only");
  assertStringIncludes(
    withTradition,
    "Do not plan a beat that quotes scripture.",
  );
  assertStringIncludes(
    withTradition,
    "creator-supplied names are never changed",
  );

  // And absent is absent here too: the shaping prompt is unchanged.
  const before = buildStoryShapePrompt("A lost lantern.", "contemporary", {});
  for (const absent of [undefined, "buddhist", "nonsense"]) {
    assertEquals(
      buildStoryShapePrompt("A lost lantern.", "contemporary", {
        tradition: absent as SupportedTraditionId | undefined,
      }),
      before,
      String(absent),
    );
  }
});
