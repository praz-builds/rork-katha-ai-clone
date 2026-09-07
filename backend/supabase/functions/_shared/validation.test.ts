import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  deriveContentRating,
  normalizeSpiceLevel,
  scanCrudeLexicon,
  validateGenerationRequest,
} from "./validation.ts";
import {
  GENRE_ALLOWED_SPICE,
  GENRE_DEFAULT_SPICE,
  SPICE_LEVELS,
} from "./types.ts";

// Helper to build a valid base request
function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    primary_genre: "romance",
    topic:
      "A lighthouse keeper receives a letter from the future warning of a storm",
    request_id: "test-request-123",
    ...overrides,
  };
}

Deno.test("valid adult romance request passes", () => {
  const result = validateGenerationRequest(validRequest());
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "romance");
  assertEquals(result.storyMode, "standalone");
  assertEquals(result.audienceMode, "adult");
  assertEquals(result.spiceLevel, "steamy"); // romance defaults to steamy
});

Deno.test("is_series maps to series story mode", () => {
  const result = validateGenerationRequest(validRequest({ is_series: true }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.storyMode, "series");
});

Deno.test("story_mode accepts explicit series value", () => {
  const result = validateGenerationRequest(
    validRequest({ story_mode: "series" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.storyMode, "series");
});

Deno.test("invalid story_mode rejected", () => {
  const result = validateGenerationRequest(
    validRequest({ story_mode: "serial" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "story_mode must be 'standalone' or 'series'");
});

Deno.test("darkRomance rejected in kids mode", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance", audience_mode: "kids" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "Dark Romance is not available in kids mode");
});

// The retirement of the explicit tier (2026-09-07). It used to 403 here; a
// stale client or a replayed request now gets the story one notch cooler
// instead of a failed generation.
Deno.test("legacy explicit spice normalizes down to steamy", () => {
  const result = validateGenerationRequest(
    validRequest({ spice_level: "explicit" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "steamy");
});

Deno.test("legacy explicit spice still clamps to the genre ceiling", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "poetry", spice_level: "explicit" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("a value that was never a spice tier is still rejected", () => {
  const result = validateGenerationRequest(
    validRequest({ spice_level: "scorching" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "spice_level must be 'sweet' or 'steamy'");
});

Deno.test("no genre may allow a retired spice tier", () => {
  for (const [genre, allowed] of Object.entries(GENRE_ALLOWED_SPICE)) {
    for (const level of allowed) {
      assert(
        SPICE_LEVELS.has(level),
        `${genre} allows retired or unknown spice level "${level}"`,
      );
    }
  }
});

Deno.test("no genre default may be a retired spice tier", () => {
  for (const [genre, level] of Object.entries(GENRE_DEFAULT_SPICE)) {
    assert(
      SPICE_LEVELS.has(level),
      `${genre} defaults to retired or unknown spice level "${level}"`,
    );
  }
});

Deno.test("normalizeSpiceLevel maps the retired tier and keeps live ones", () => {
  assertEquals(normalizeSpiceLevel("explicit"), "steamy");
  assertEquals(normalizeSpiceLevel("  steamy "), "steamy");
  assertEquals(normalizeSpiceLevel("sweet"), "sweet");
  assertEquals(normalizeSpiceLevel("scorching"), undefined);
  assertEquals(normalizeSpiceLevel(undefined), undefined);
});

// A row written before the retirement keeps its rating, because feed and
// library exclude `content_rating = 'explicit'` from public surfaces and a
// silent downgrade to "steamy" would publish it.
Deno.test("deriveContentRating still reports a stored explicit rating", () => {
  assertEquals(deriveContentRating("adult", "explicit"), "explicit");
  assertEquals(deriveContentRating("adult", "steamy"), "steamy");
  assertEquals(deriveContentRating("adult", "sweet"), "sweet");
  assertEquals(deriveContentRating("kids", "explicit"), "kids");
});

Deno.test("scanCrudeLexicon reports crude vocabulary in generated prose", () => {
  const found = scanCrudeLexicon(
    "She said the word Tits out loud, then jerked off the handbrake and " +
      "called him a dick.",
  );
  assert(found.includes("tits"));
  assert(found.includes("dick"));
  assertEquals(found.filter((t) => t === "tits").length, 1);
});

Deno.test("scanCrudeLexicon leaves ordinary prose alone", () => {
  // "Dick" the person and the words the prompt bans but the scanner
  // deliberately does not (cocked, prick, screwed, rode) must not fire.
  assertEquals(
    scanCrudeLexicon(
      "Dick cocked his head at the prick of the needle, screwed the lid " +
        "back on, and rode north until dawn.",
    ),
    [],
  );
  assertEquals(scanCrudeLexicon(""), []);
  assertEquals(scanCrudeLexicon(null), []);
});

Deno.test("poetry allows only sweet", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "poetry", spice_level: "steamy" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet"); // clamped to default
});

Deno.test("darkRomance defaults to steamy", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "steamy");
});

Deno.test("darkRomance with sweet spice stays sweet (not escalated)", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "darkRomance", spice_level: "sweet" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("old genre 'drama' maps to contemporary", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "drama" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "contemporary");
});

Deno.test("backward compat: genre array extracts first element", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: undefined, genre: ["fantasy"] }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "fantasy");
});

Deno.test("secondary genres are retained with primary first", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "mystery",
      genres: ["horror", "mystery", "fantasy", "romance"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.genres, ["mystery", "horror", "fantasy"]);
});

Deno.test("new creation rejects Spanish while historical story language remains read-only", () => {
  const result = validateGenerationRequest(
    validRequest({ language: "Spanish" }),
  );
  if (!("error" in result)) throw new Error("Expected error");
  assertEquals(result.error, "language must be English or Portuguese");
});

Deno.test("new creation accepts Portuguese", () => {
  const result = validateGenerationRequest(
    validRequest({ language: "Portuguese" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.language, "Portuguese");
});

Deno.test("kids mode strips identity lenses", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "adventure",
      audience_mode: "kids",
      identity_lenses: ["queer"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.identityLenses.length, 0);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("deriveContentRating: kids -> kids", () => {
  assertEquals(deriveContentRating("kids", "sweet"), "kids");
});

Deno.test("deriveContentRating: steamy -> steamy", () => {
  assertEquals(deriveContentRating("adult", "steamy"), "steamy");
});

Deno.test("deriveContentRating: sweet -> sweet", () => {
  assertEquals(deriveContentRating("adult", "sweet"), "sweet");
});

Deno.test("server validation keeps the seed floor at one character", () => {
  const result = validateGenerationRequest(validRequest({ topic: "a" }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.seed, "a");
});

Deno.test("an empty or whitespace-only seed is still rejected", () => {
  for (const topic of ["", "   ", "\n\t"]) {
    const result = validateGenerationRequest(validRequest({ topic }));
    assertEquals("error" in result, true, `accepted ${JSON.stringify(topic)}`);
  }
});

Deno.test("unknown genre maps to contemporary", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "nonExistentGenre" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "contemporary");
});

// ---------------------------------------------------------------------------
// v7 taxonomy (2026-09-08): four new genres, seven removed from the UI
// ---------------------------------------------------------------------------

// The documented replacement for each genre the product owner removed from
// the creation UI. `contemporary` -> `sliceOfLife`, `poetry` -> `folktale`,
// romantasy/darkRomance/paranormalRomance -> `romance`, `cozyFantasy` ->
// `fantasy`, `thriller` -> `mystery`. See GENRE_MIGRATION_MAP's contract
// comment in types.ts.
const REMOVED_GENRE_REPLACEMENTS: Record<string, string> = {
  romantasy: "romance",
  darkRomance: "romance",
  paranormalRomance: "romance",
  cozyFantasy: "fantasy",
  poetry: "folktale",
  thriller: "mystery",
  contemporary: "sliceOfLife",
};

Deno.test("every removed genre still validates and normalises to its documented replacement", () => {
  for (
    const [removed, replacement] of Object.entries(REMOVED_GENRE_REPLACEMENTS)
  ) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: removed }),
    );
    if ("error" in result) {
      throw new Error(`${removed} was rejected: ${result.error}`);
    }
    assertEquals(
      result.primaryGenre,
      replacement,
      `${removed} normalised to ${result.primaryGenre}, expected ${replacement}`,
    );
  }
});

Deno.test("a removed genre normalises the same way as a secondary genre", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "fantasy",
      genres: ["fantasy", "thriller", "cozyFantasy"],
    }),
  );
  if ("error" in result) throw new Error(result.error);
  // thriller -> mystery, cozyFantasy -> fantasy (already present, so it is
  // not duplicated).
  assertEquals(result.genres, ["fantasy", "mystery"]);
});

Deno.test("the four new v7 genres validate as themselves, unmigrated", () => {
  for (
    const genre of ["educational", "fanfiction", "folktale", "sliceOfLife"]
  ) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre }),
    );
    if ("error" in result) throw new Error(`${genre}: ${result.error}`);
    assertEquals(result.primaryGenre, genre);
  }
});

// darkRomance, paranormalRomance and thriller all migrate away from their own
// identity for a NEW submission (see the table above), which would make the
// kids-mode block on them unreachable if it ran on the migrated value. It
// runs on the raw, pre-migration string instead, so this safety gate survives
// the taxonomy change untouched.
Deno.test("kids mode still refuses a removed genre by its own raw name, not its replacement", () => {
  for (const genre of ["darkRomance", "paranormalRomance", "thriller"]) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre, audience_mode: "kids" }),
    );
    if (!("error" in result)) {
      throw new Error(`${genre} was accepted in kids mode`);
    }
  }
});

// A removed genre reaching validation is exactly the "old client, a retry, a
// stored draft" scenario the task calls out — it must never throw or 500.
Deno.test("every removed genre is accepted without error in adult mode", () => {
  for (const genre of Object.keys(REMOVED_GENRE_REPLACEMENTS)) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre }),
    );
    if ("error" in result) {
      throw new Error(`${genre} raised an error instead of normalising`);
    }
  }
});

Deno.test("folktale (poetry's replacement) allows only sweet, matching poetry's old register", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "folktale", spice_level: "steamy" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

// ---------------------------------------------------------------------------
// Spice leaves the product surface: an absent spice_level is a first-class,
// safe path, not merely tolerated. (spice inference from prose is a
// follow-up, not implemented here.)
// ---------------------------------------------------------------------------

Deno.test("omitting spice_level entirely succeeds and defaults to sweet for a sweet-default genre", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "fantasy" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("omitting spice_level succeeds and defaults per genre for a steamy-default genre", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "romance" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "steamy");
});

Deno.test("omitting spice_level on every one of the 19 genres never errors", () => {
  const allGenres = [
    "romance",
    "romantasy",
    "darkRomance",
    "cozyFantasy",
    "paranormalRomance",
    "fantasy",
    "scifi",
    "thriller",
    "mystery",
    "horror",
    "contemporary",
    "historical",
    "adventure",
    "comedy",
    "poetry",
    "educational",
    "fanfiction",
    "folktale",
    "sliceOfLife",
  ];
  for (const genre of allGenres) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre }),
    );
    if ("error" in result) {
      throw new Error(`${genre} without spice_level errored: ${result.error}`);
    }
    assert(
      SPICE_LEVELS.has(result.spiceLevel),
      `${genre} produced a non-live spice level: ${result.spiceLevel}`,
    );
  }
});

// Kids mode already forced sweet before this bucket; this pins that the v7
// genre and spice changes did not disturb it.
Deno.test("kids mode still forces sweet even when spice_level is explicitly requested steamy", () => {
  const result = validateGenerationRequest(
    validRequest({
      primary_genre: "adventure",
      audience_mode: "kids",
      spice_level: "steamy",
    }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.spiceLevel, "sweet");
});

Deno.test("kids mode forces sweet on the new v7 genres too", () => {
  for (
    const genre of ["educational", "fanfiction", "folktale", "sliceOfLife"]
  ) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre, audience_mode: "kids" }),
    );
    if ("error" in result) throw new Error(`${genre}: ${result.error}`);
    assertEquals(result.spiceLevel, "sweet");
  }
});

Deno.test("case-insensitive genre match", () => {
  const result = validateGenerationRequest(
    validRequest({ primary_genre: "FANTASY" }),
  );
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.primaryGenre, "fantasy");
});

// ---------------------------------------------------------------------------
// The brief — story shape, moments, values, craft fields
// ---------------------------------------------------------------------------

Deno.test("cast cap is 3, not 10", () => {
  const cast = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Character ${i + 1}` }));

  const ok = validateGenerationRequest(validRequest({ characters: cast(3) }));
  if ("error" in ok) throw new Error(ok.error);
  assertEquals(ok.characters.length, 3);

  const tooMany = validateGenerationRequest(
    validRequest({ characters: cast(4) }),
  );
  assertEquals("error" in tooMany, true);
});

Deno.test("a non-empty cast is normalized to exactly one lead", () => {
  const result = validateGenerationRequest(validRequest({
    characters: [
      { name: "Minoo", isHero: false },
      { name: "Rustom", isHero: false },
      { name: "Asha", isHero: true },
    ],
  }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.characters.map((character) => character.isHero), [
    false,
    false,
    true,
  ]);

  const noLead = validateGenerationRequest(validRequest({
    characters: [{ name: "Minoo" }, { name: "Rustom" }],
  }));
  if ("error" in noLead) throw new Error(noLead.error);
  assertEquals(noLead.characters.map((character) => character.isHero), [
    true,
    false,
  ]);
});

Deno.test("character portrait_url survives validation", () => {
  const result = validateGenerationRequest(validRequest({
    characters: [{
      name: "Praz",
      description: "A young explorer",
      appearance: "Dark hair and travel clothes",
      portrait_url: "https://example.com/portraits/praz.png",
    }],
  }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(
    result.characters[0].portraitUrl,
    "https://example.com/portraits/praz.png",
  );
});

Deno.test("planned_chapter_count accepts only 3, 7, 15", () => {
  for (const n of [3, 7, 15]) {
    const r = validateGenerationRequest(
      validRequest({ planned_chapter_count: n }),
    );
    if ("error" in r) throw new Error(`${n} rejected: ${r.error}`);
    assertEquals(r.plannedChapterCount, n);
  }
  for (const n of [1, 2, 4, 10, 30, 0, -3, 7.5]) {
    const r = validateGenerationRequest(
      validRequest({ planned_chapter_count: n }),
    );
    assertEquals("error" in r, true, `${n} was accepted`);
  }
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.plannedChapterCount, 3);
});

Deno.test("chapter_length validates and defaults to standard", () => {
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.chapterLength, "standard");

  const long = validateGenerationRequest(
    validRequest({ chapter_length: "long" }),
  );
  if ("error" in long) throw new Error(long.error);
  assertEquals(long.chapterLength, "long");

  assertEquals(
    "error" in validateGenerationRequest(
      validRequest({ chapter_length: "epic" }),
    ),
    true,
  );
});

Deno.test("moments are clamped at 5, not rejected", () => {
  const r = validateGenerationRequest(
    validRequest({
      moments: ["a", "b", "c", "d", "e", "f", "g", "", "   ", 42],
    }),
  );
  if ("error" in r) throw new Error(r.error);
  assertEquals(r.moments, ["a", "b", "c", "d", "e"]);
});

Deno.test("values are kids-only", () => {
  const kids = validateGenerationRequest(
    validRequest({
      primary_genre: "adventure",
      audience_mode: "kids",
      story_values: ["kindness", "courage"],
    }),
  );
  if ("error" in kids) throw new Error(kids.error);
  assertEquals(kids.storyValues, ["kindness", "courage"]);

  const adult = validateGenerationRequest(
    validRequest({ story_values: ["kindness"] }),
  );
  if ("error" in adult) throw new Error(adult.error);
  assertEquals(adult.storyValues, []);
});

Deno.test("illustrate_chapters defaults off and requires a literal true", () => {
  const dflt = validateGenerationRequest(validRequest());
  if ("error" in dflt) throw new Error(dflt.error);
  assertEquals(dflt.illustrateChapters, false);

  for (const v of ["true", 1, {}, null]) {
    const r = validateGenerationRequest(
      validRequest({ illustrate_chapters: v }),
    );
    if ("error" in r) throw new Error(r.error);
    assertEquals(
      r.illustrateChapters,
      false,
      `${JSON.stringify(v)} enabled it`,
    );
  }

  const on = validateGenerationRequest(
    validRequest({ illustrate_chapters: true }),
  );
  if ("error" in on) throw new Error(on.error);
  assertEquals(on.illustrateChapters, true);
});

Deno.test("brief free-text fields are bounded", () => {
  const long = "x".repeat(301);
  for (const field of ["where_and_when", "avoid", "writing_style"]) {
    const r = validateGenerationRequest(validRequest({ [field]: long }));
    assertEquals("error" in r, true, `${field} accepted 301 chars`);
  }
  // The accept side of the boundary. Without it, flipping `>` to `>=` in
  // optionalText would still pass this test.
  const atLimit = "x".repeat(300);
  for (const field of ["where_and_when", "avoid"]) {
    const r = validateGenerationRequest(validRequest({ [field]: atLimit }));
    if ("error" in r) {
      throw new Error(`${field} rejected exactly 300: ${r.error}`);
    }
  }

  const ok = validateGenerationRequest(
    validRequest({ where_and_when: "A hill town, off-season, present day" }),
  );
  if ("error" in ok) throw new Error(ok.error);
  assertEquals(ok.whereAndWhen, "A hill town, off-season, present day");
});

Deno.test("writing style keeps the craft and drops the author", () => {
  // [input, exact expected output]
  const cases: [string, string | undefined][] = [
    // Plain craft direction is untouched.
    ["poetic, short sentences", "poetic, short sentences"],
    // An imitation request is removed; anything else the user said survives.
    ["like Colleen Hoover", undefined],
    ["hardboiled, like Raymond Chandler", "hardboiled"],
    ["written by Stephen King", undefined],
    // Non-ASCII names. An ASCII-only pattern stopped at the accent and leaked
    // the rest of the name.
    ["like Gabriel Garc\u00eda M\u00e1rquez", undefined],
    ["lyrical, in the style of Ng\u0169g\u0129 wa Thiong'o", "lyrical"],
    // Initials. An earlier pattern required two characters and stopped at
    // "Ursula", leaking "K Le Guin".
    ["in the style of Ursula K Le Guin, but funnier", "but funnier"],
    ["like J. R. R. Tolkien", undefined],
    // Uncased scripts have no uppercase, so a \p{Lu}-only pattern never matched
    // them and the name passed straight through.
    ["in the style of \u6751\u4e0a\u6625\u6a39", undefined],
    [
      "dreamlike, like \u6751\u4e0a\u6625\u6a39, in short scenes",
      "dreamlike, in short scenes",
    ],
    // Lowercase prose after a trigger is NOT a name. A single case-insensitive
    // regex made \p{Lu} match lowercase, and these were gutted.
    ["like the sea at dusk", "like the sea at dusk"],
    [
      "reads like a diary, short sentences",
      "reads like a diary, short sentences",
    ],
    ["Like a folk tale told badly", "Like a folk tale told badly"],
  ];

  for (const [input, expected] of cases) {
    const result = validateGenerationRequest(
      validRequest({ writing_style: input }),
    );
    if ("error" in result) throw new Error(result.error);
    assertEquals(
      result.writingStyle,
      expected,
      `"${input}" produced ${JSON.stringify(result.writingStyle)}`,
    );
  }
});

// Section 3, decisions 23 and 26: kids mode removes rather than defaults, and
// the removal is enforced server-side, not only in the genre row.
Deno.test("every genre the kids interface hides is refused server-side", () => {
  for (
    const genre of ["darkRomance", "paranormalRomance", "horror", "thriller"]
  ) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre, audience_mode: "kids" }),
    );
    if (!("error" in result)) {
      throw new Error(`${genre} was accepted in kids mode`);
    }
  }
});

Deno.test("kids mode still accepts the genres it does show", () => {
  for (const genre of ["adventure", "comedy", "fantasy", "mystery"]) {
    const result = validateGenerationRequest(
      validRequest({ primary_genre: genre, audience_mode: "kids" }),
    );
    if ("error" in result) throw new Error(`${genre}: ${result.error}`);
    assertEquals(result.spiceLevel, "sweet");
  }
});

// ---------------------------------------------------------------------------
// The story plan
// ---------------------------------------------------------------------------

Deno.test("beats default to an empty plan", () => {
  const result = validateGenerationRequest(validRequest());
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.beats, []);
});

Deno.test("beats are clamped to the planned chapter count, not rejected", () => {
  const result = validateGenerationRequest(validRequest({
    planned_chapter_count: 3,
    beats: ["one", "two", "three", "four", "five"],
  }));
  if ("error" in result) throw new Error(result.error);
  // A plan longer than the story promises beats no chapter can reach. Clamping
  // keeps the story generating; rejecting would fail the request over a
  // preference the user cannot see.
  assertEquals(result.beats, ["one", "two", "three"]);
});

Deno.test("a plan shorter than the story is legal", () => {
  const result = validateGenerationRequest(validRequest({
    planned_chapter_count: 7,
    beats: ["one", "two"],
  }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.beats, ["one", "two"]);
});

Deno.test("beats are trimmed, bounded, and stripped of empties", () => {
  const result = validateGenerationRequest(validRequest({
    planned_chapter_count: 15,
    beats: ["  spaced  ", "", "   ", "x".repeat(500), 42, null],
  }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.beats[0], "spaced");
  assertEquals(result.beats[1].length, 200);
  assertEquals(result.beats.length, 2);
});

Deno.test("a non-array plan is an absent plan", () => {
  const result = validateGenerationRequest(validRequest({
    beats: "one, two, three",
  }));
  if ("error" in result) throw new Error(result.error);
  assertEquals(result.beats, []);
});

// ---------------------------------------------------------------------------
// Notification consent
//
// iOS grants exactly one system prompt per install, and the onboarding notify
// screen is a soft pre-prompt spending it deliberately. A push sent to someone
// who did not accept is unrecoverable: it cannot be un-sent, and the permission
// cannot be asked for again.
// ---------------------------------------------------------------------------

Deno.test("notification consent defaults to off", () => {
  const result = validateGenerationRequest(validRequest());
  assert(!("error" in result));
  assertEquals(result.notifyOnReady, false);
});

Deno.test("notification consent requires a literal true", () => {
  for (const value of ["true", 1, "yes", {}, [], "on"]) {
    const result = validateGenerationRequest({
      ...validRequest(),
      notify_on_ready: value,
    });
    assert(!("error" in result));
    assertEquals(
      result.notifyOnReady,
      false,
      `${JSON.stringify(value)} is not consent`,
    );
  }
});

Deno.test("an accepted prompt is carried through", () => {
  const result = validateGenerationRequest({
    ...validRequest(),
    notify_on_ready: true,
  });
  assert(!("error" in result));
  assertEquals(result.notifyOnReady, true);
});
