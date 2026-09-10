/**
 * The Notes field takes one blob of typed or pasted text and has to make a
 * list of it. Everything a reader plausibly pastes goes through here: a
 * comma-separated line out of a notebook, a column out of a spreadsheet with
 * a newline per entry, and the usual debris of trailing commas, blank lines
 * and the same phrase twice.
 *
 * The duplicate rule is the one worth guarding. A reader who pastes their
 * list, adds four more phrases, and pastes the whole thing again must end up
 * with four new phrases, not with a list where every entry appears twice.
 */
import {
  MAX_PHRASE_INPUT_LENGTH,
  MAX_PHRASE_LENGTH,
  parsePhraseInput,
} from "@/lib/phrases";

it("splits on commas", () => {
  const parsed = parsePhraseInput("bite the bullet, under the weather, cold feet");
  expect(parsed.phrases).toEqual([
    "bite the bullet",
    "under the weather",
    "cold feet",
  ]);
  expect(parsed.overLimit).toBe(false);
});

it("splits on line breaks, including a pasted CRLF column", () => {
  const parsed = parsePhraseInput("bite the bullet\r\nunder the weather\ncold feet");
  expect(parsed.phrases).toEqual([
    "bite the bullet",
    "under the weather",
    "cold feet",
  ]);
});

it("takes commas and line breaks in the same paste", () => {
  const parsed = parsePhraseInput("bite the bullet, under the weather\ncold feet");
  expect(parsed.phrases).toHaveLength(3);
});

it("drops blanks, trailing separators and runs of whitespace", () => {
  const parsed = parsePhraseInput("  bite   the bullet ,,\n\n , cold feet,\n");
  expect(parsed.phrases).toEqual(["bite the bullet", "cold feet"]);
});

it("drops a phrase repeated inside the same paste, and counts it", () => {
  const parsed = parsePhraseInput("cold feet, Cold Feet, cold  feet");
  expect(parsed.phrases).toEqual(["cold feet"]);
  expect(parsed.duplicates).toBe(2);
});

it("drops a phrase already saved, whatever its case", () => {
  const parsed = parsePhraseInput("cold feet, spill the beans", ["Cold Feet"]);
  expect(parsed.phrases).toEqual(["spill the beans"]);
  expect(parsed.duplicates).toBe(1);
});

it("drops a single phrase longer than the column allows, and keeps the rest", () => {
  const long = "x".repeat(MAX_PHRASE_LENGTH + 1);
  const parsed = parsePhraseInput(`${long}, cold feet`);
  expect(parsed.phrases).toEqual(["cold feet"]);
  expect(parsed.tooLong).toBe(1);
});

it("parses nothing at all once the raw text is over the character limit", () => {
  // Partial-saving an over-long paste is the worst answer available: the
  // reader cannot tell which half landed.
  const raw = `${"a".repeat(MAX_PHRASE_INPUT_LENGTH)}, cold feet`;
  const parsed = parsePhraseInput(raw);
  expect(parsed.overLimit).toBe(true);
  expect(parsed.phrases).toEqual([]);
});

it("accepts a paste of exactly the character limit", () => {
  const raw = "a".repeat(MAX_PHRASE_INPUT_LENGTH);
  const parsed = parsePhraseInput(raw);
  expect(parsed.overLimit).toBe(false);
  expect(parsed.phrases).toEqual([]);
  expect(parsed.tooLong).toBe(1);
});

it("returns an empty result for empty input rather than one blank phrase", () => {
  expect(parsePhraseInput("   \n , ").phrases).toEqual([]);
});
