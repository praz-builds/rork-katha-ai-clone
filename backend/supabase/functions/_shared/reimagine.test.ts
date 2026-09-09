import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyReplacementsToCast,
  parseReplacements,
  renamesFor,
  type ResolvedReplacement,
} from "./reimagine.ts";

const SAVED_ID = "3f1a6b2e-9c4d-4a7b-8e2f-1d0c5b6a7e88";

function ok(value: ReturnType<typeof parseReplacements>) {
  assert(!("error" in value), `expected success, got ${JSON.stringify(value)}`);
  return value.replacements;
}

function err(value: ReturnType<typeof parseReplacements>): string {
  assert("error" in value, "expected a rejection");
  return value.error;
}

Deno.test("an absent replacement list is an empty list, not an error", () => {
  assertEquals(ok(parseReplacements(undefined)), []);
  assertEquals(ok(parseReplacements(null)), []);
  assertEquals(ok(parseReplacements([])), []);
});

Deno.test("a saved-character reference is read as a link, not as fields", () => {
  const [replacement] = ok(parseReplacements([{
    from_name: "  Maya  ",
    to: { saved_character_id: SAVED_ID },
    apply_to_all_chapters: true,
  }]));
  assertEquals(replacement.fromName, "Maya");
  assertEquals(replacement.savedCharacterId, SAVED_ID);
  assertEquals(replacement.character, undefined);
  assertEquals(replacement.applyToAllChapters, true);
});

Deno.test("a new character is read as fields, and blanks stay absent", () => {
  const [replacement] = ok(parseReplacements([{
    from_name: "Maya",
    to: { name: "Priya", role: "  ", appearance: "tall" },
  }]));
  assertEquals(replacement.character?.name, "Priya");
  assertEquals(replacement.character?.description, undefined);
  assertEquals(replacement.character?.appearance, "tall");
  // Absent means false: a rename must never escape its chapter by default.
  assertEquals(replacement.applyToAllChapters, false);
});

Deno.test("malformed replacements are refused with a message, not guessed at", () => {
  assertEquals(
    err(parseReplacements("Maya")),
    "character_replacements must be an array",
  );
  assertEquals(
    err(parseReplacements([{ to: { name: "Priya" } }])),
    "from_name must be 1-100 characters",
  );
  assertEquals(
    err(parseReplacements([{ from_name: "Maya" }])),
    'Replacement for "Maya" needs a "to"',
  );
  assertEquals(
    err(parseReplacements([{ from_name: "Maya", to: { name: "  " } }])),
    'Replacement for "Maya" needs a name of 1-100 characters',
  );
  assertEquals(
    err(parseReplacements([{
      from_name: "Maya",
      to: { saved_character_id: "not-a-uuid" },
    }])),
    "to.saved_character_id must be a UUID",
  );
  assertEquals(
    err(parseReplacements([{
      from_name: "Maya",
      to: { name: "Priya", background: "x".repeat(501) },
    }])),
    "to.background must be a string of 500 characters or fewer",
  );
  // Two rules for the same name would apply in an order nobody chose.
  assertEquals(
    err(parseReplacements([
      { from_name: "Maya", to: { name: "Priya" } },
      { from_name: "maya", to: { name: "Rhea" } },
    ])),
    'Duplicate replacement for "maya"',
  );
  assert(
    err(
      parseReplacements(
        Array.from({ length: 7 }, (_, i) => ({
          from_name: `N${i}`,
          to: { name: `M${i}` },
        })),
      ),
    ).includes("6 entries or fewer"),
  );
});

const resolved = (
  fromName: string,
  to: Record<string, unknown>,
  applyToAllChapters = false,
): ResolvedReplacement => ({
  fromName,
  to: to as unknown as ResolvedReplacement["to"],
  applyToAllChapters,
});

Deno.test("a replaced character takes the old one's place, not a seat beside it", () => {
  const cast = [
    { name: "Maya", description: "a courier", isHero: true },
    { name: "Devan", description: "her brother", isHero: false },
  ];
  const next = applyReplacementsToCast(cast, [
    resolved("maya", { name: "Priya", appearance: "tall" }),
  ]);
  assertEquals(
    next.length,
    2,
    "the cast must not grow when someone is swapped",
  );
  assertEquals(next[0].name, "Priya");
  assertEquals(next[0].appearance, "tall");
  // The lead stays the lead: replacing a character is not demoting them.
  assertEquals(next[0].isHero, true);
  // A field the sheet left blank inherits rather than erasing what the story knew.
  assertEquals(next[0].description, "a courier");
  assertEquals(next[1].name, "Devan");
});

Deno.test("a replacement for someone not on the roster joins the cast", () => {
  // The model invents unnamed people; the reader may be renaming one of them.
  const next = applyReplacementsToCast(
    [{ name: "Maya", isHero: true }],
    [resolved("The innkeeper", { name: "Rhea" })],
  );
  assertEquals(next.map((c) => c.name), ["Maya", "Rhea"]);
});

Deno.test("only the replacements marked apply_to_all_chapters escape this chapter", () => {
  const replacements = [
    resolved("Maya", { name: "Priya" }, true),
    resolved("Devan", { name: "Arun" }, false),
  ];
  assertEquals(renamesFor(replacements, "all"), [{
    from: "Maya",
    to: "Priya",
  }]);
  assertEquals(renamesFor(replacements, "any"), [
    { from: "Maya", to: "Priya" },
    { from: "Devan", to: "Arun" },
  ]);
});
