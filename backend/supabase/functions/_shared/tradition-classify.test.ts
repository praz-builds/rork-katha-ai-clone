import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANONICAL_RETELLING_SUPPORTED,
  classifyTradition,
  classifyTraditionForGeneration,
  downgradeCanonicalRequest,
} from "./tradition-classify.ts";

// ---------------------------------------------------------------------------
// Silence: the default answer
// ---------------------------------------------------------------------------

Deno.test("empty and non-string input classify silently", () => {
  for (const value of [undefined, null, "", "   ", 42, {}, []]) {
    const result = classifyTradition(value);
    assertEquals(result.tradition, undefined);
    assertEquals(result.provenance, "none");
    assertEquals(result.confidence, 0);
    assertEquals(result.evidence.length, 0);
  }
});

Deno.test("an ordinary bedtime idea names no tradition", () => {
  const ideas = [
    "A bedtime story about a fox who cannot sleep and counts the stars instead.",
    "Two sisters build a raft out of bottle caps and sail the garden pond.",
    "A boy misses the last bus home and walks it with a stray dog.",
  ];
  for (const idea of ideas) {
    const result = classifyTradition(idea);
    assertEquals(result.tradition, undefined, idea);
    assertEquals(result.provenance, "none", idea);
  }
});

// ---------------------------------------------------------------------------
// False-positive resistance: the point of the module
// ---------------------------------------------------------------------------

Deno.test("a character named Christian is not a faith request", () => {
  const cases = [
    "A bedtime story about a boy named Christian who loses his football.",
    "A story about twins called Christian and Maria on a camping trip.",
    "Write a tale where the dog's name is Christian and he eats the homework.",
  ];
  for (const idea of cases) {
    const result = classifyTradition(idea);
    assertEquals(result.tradition, undefined, idea);
    assertEquals(result.provenance, "none", idea);
  }
});

Deno.test("buildings, seasons and food are not faith requests", () => {
  const cases = [
    "A story about a church bake sale that runs out of lemon cake.",
    "A bedtime story set at a mosque's open day where a kitten gets loose.",
    "A tale about the school Christmas play going hilariously wrong.",
    "A Diwali street party where the lights fail and the neighbours fix it.",
    "A story about a synagogue's community garden in the middle of winter.",
    "A temple cat who guards the shoe rack.",
    "A story about a family cooking a Ramadan meal together for neighbours.",
  ];
  for (const idea of cases) {
    const result = classifyTradition(idea);
    assertEquals(result.tradition, undefined, idea);
    assertEquals(result.provenance, "none", idea);
  }
});

Deno.test("a bare mention with no intent nearby does not match", () => {
  const result = classifyTradition(
    "The museum's east wing holds Hindu sculpture, Greek pottery and a very large whale skeleton, and the guard has fallen asleep beside all of it while the night cleaner discovers the exhibits have started arguing with each other about which of them is oldest.",
  );
  assertEquals(result.tradition, undefined);
});

Deno.test("two traditions at once returns no tradition, not a guess", () => {
  const result = classifyTradition(
    "A Jewish bedtime story and a Muslim bedtime story about two neighbours.",
  );
  assertEquals(result.tradition, undefined);
});

// ---------------------------------------------------------------------------
// Inspired: an original story in a tradition's spirit
// ---------------------------------------------------------------------------

Deno.test("an original story in a tradition's spirit is inspired", () => {
  const cases: readonly [string, string][] = [
    ["A Jewish bedtime story about kindness to a neighbour.", "jewish"],
    ["An Islamic bedtime story about sharing at school.", "muslim"],
    ["A Hindu bedtime story about telling the truth.", "hindu"],
    ["A Christian bedtime story about forgiving a friend.", "christian"],
    ["A story about a Muslim family raising two loud boys.", "muslim"],
    ["A bedtime tale rooted in Hindu tradition about a lost kite.", "hindu"],
  ];
  for (const [idea, expected] of cases) {
    const result = classifyTradition(idea);
    assertEquals(result.tradition, expected, idea);
    assertEquals(result.provenance, "inspired", idea);
    assert(result.confidence > 0.5, idea);
    assert(result.evidence.length > 0, idea);
  }
});

Deno.test("inspired markers are recorded as evidence", () => {
  const result = classifyTradition(
    "An original story in the spirit of Jewish tradition about a lost key.",
  );
  assertEquals(result.tradition, "jewish");
  assertEquals(result.provenance, "inspired");
  assert(result.evidence.some((e) => e.kind === "inspired"));
});

// ---------------------------------------------------------------------------
// Canonical: a story that already exists
// ---------------------------------------------------------------------------

Deno.test("asking for an existing story is canonical", () => {
  const cases = [
    "Tell me the story of Noah.",
    "A Bible story for bedtime.",
    "Retell the Ramayana for a six year old.",
    "The parable of the sower, told simply.",
    "A story from the Qur'an about patience.",
  ];
  for (const idea of cases) {
    assertEquals(classifyTradition(idea).provenance, "canonical", idea);
  }
});

Deno.test("a shared figure marks canonical without naming a tradition", () => {
  // Noah belongs to three traditions at once. Reporting one would be a guess.
  const result = classifyTradition("Tell me the story of Noah.");
  assertEquals(result.provenance, "canonical");
  assertEquals(result.tradition, undefined);
  assert(result.evidence.some((e) => e.rule === "canonical.shared-figure"));
});

Deno.test("a distinctive figure names its own tradition", () => {
  const cases: readonly [string, string][] = [
    ["Tell me the story of Ganesha and the moon.", "hindu"],
    ["A bedtime retelling of the good Samaritan.", "christian"],
    ["The story of Queen Esther, told for children.", "jewish"],
  ];
  for (const [idea, expected] of cases) {
    const result = classifyTradition(idea);
    assertEquals(result.tradition, expected, idea);
    assertEquals(result.provenance, "canonical", idea);
  }
});

Deno.test("canonical outranks inspired when both signals are present", () => {
  const result = classifyTradition(
    "Retell a Hindu story about Hanuman for bedtime.",
  );
  assertEquals(result.tradition, "hindu");
  assertEquals(result.provenance, "canonical");
});

// ---------------------------------------------------------------------------
// The Phase-1 downgrade
// ---------------------------------------------------------------------------

Deno.test("Phase 1 does not support canonical retelling", () => {
  assertEquals(CANONICAL_RETELLING_SUPPORTED, false);
});

Deno.test("a canonical request with a tradition downgrades to inspired", () => {
  const raw = classifyTradition("Retell a Hindu story about Hanuman.");
  const downgraded = downgradeCanonicalRequest(raw);
  assertEquals(downgraded.provenance, "inspired");
  assertEquals(downgraded.tradition, "hindu");
  assertEquals(downgraded.downgraded, true);
  // The evidence survives the downgrade, so the log keeps the truth.
  assertEquals(downgraded.evidence.length, raw.evidence.length);
});

Deno.test("a canonical request with no tradition downgrades to none", () => {
  const downgraded = downgradeCanonicalRequest(
    classifyTradition("Tell me the story of Noah."),
  );
  assertEquals(downgraded.provenance, "none");
  assertEquals(downgraded.tradition, undefined);
  assertEquals(downgraded.downgraded, true);
});

Deno.test("a non-canonical result passes through the downgrade untouched", () => {
  const raw = classifyTradition("A Jewish bedtime story about kindness.");
  assertEquals(downgradeCanonicalRequest(raw), raw);
  assertEquals(raw.downgraded, undefined);
});

Deno.test("the generation helper applies the downgrade for the caller", () => {
  const result = classifyTraditionForGeneration(
    "Retell a Christian story about the prodigal son.",
  );
  assertEquals(result.provenance, "inspired");
  assertEquals(result.tradition, "christian");
  assertEquals(result.downgraded, true);
});

// ---------------------------------------------------------------------------
// Determinism and bounds
// ---------------------------------------------------------------------------

Deno.test("classification is deterministic and case-insensitive", () => {
  const a = classifyTradition("A JEWISH BEDTIME STORY ABOUT KINDNESS");
  const b = classifyTradition("a jewish bedtime story about kindness");
  assertEquals(a.tradition, b.tradition);
  assertEquals(a.provenance, b.provenance);
  assertEquals(a.confidence, b.confidence);
});

Deno.test("curly apostrophes match the same as straight ones", () => {
  assertEquals(
    classifyTradition("A story from the Qur’an about patience.").tradition,
    "muslim",
  );
});

Deno.test("matched evidence is bounded and lowercased", () => {
  const result = classifyTradition(
    `An Islamic bedtime story about ${"patience ".repeat(600)}`,
  );
  assertEquals(result.tradition, "muslim");
  for (const e of result.evidence) {
    assert(e.matched.length <= 80);
    assertEquals(e.matched, e.matched.toLocaleLowerCase());
  }
});

Deno.test("confidence stays within bounds", () => {
  const ideas = [
    "A Hindu bedtime story about Krishna and a Hindu family and Hindu tradition.",
    "A story about a fox.",
    "Tell me the story of Noah.",
  ];
  for (const idea of ideas) {
    const c = classifyTradition(idea).confidence;
    assert(c >= 0 && c <= 0.95, `${idea} -> ${c}`);
  }
});
