import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  alignFirstLine,
  cleanChapterProse,
  enforceProseIntegrity,
  type ProseIntegrityBrief,
  proseIntegrityBrief,
  scanBrandNames,
  splitSentences,
} from "./prose-integrity.ts";

// Every case below is either lifted from the 2026-09-18 editorial review of 83
// production chapters, or is the legitimate prose each rule must never touch.
// The second group matters more: a false positive deletes a sentence a writer
// paid for, and nothing downstream would ever put it back.

const kinds = (result: ReturnType<typeof cleanChapterProse>) =>
  result.removals.map((r) => r.kind).sort();

/** A realistic chapter, long enough that the breakers behave as in production. */
function chapter(...extra: string[]): string {
  return [
    "The bus from Sukkur came in forty minutes late, and Nadia had spent all of them on the bench outside the ticket office, watching the pigeons argue over a samosa wrapper.",
    "Her brother's letter was folded twice in her coat pocket. She had read it on the train and again on the platform, and it still said the same thing: come home, Abba is asking for you.",
    '"You\'re Nadia," said a man in a grey shalwar kameez. He did not offer to take her bag. "Farooq sent me. The car is round the back."',
    "The car smelled of cardamom and engine oil. The seat springs had been mended with string.",
    "She watched the city go by in pieces through the cracked window. A tea stall. A wall of torn posters. Two boys racing a goat down the middle of the road.",
    ...extra,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Clean prose is untouched, byte for byte
// ---------------------------------------------------------------------------

Deno.test("clean prose is returned byte for byte, with no removals", () => {
  const prose = `${chapter()}\n`;
  const result = cleanChapterProse(prose, {
    moments: ["Nadia finds the letter her mother hid inside the harmonium"],
  });
  assertEquals(result.text, prose);
  assertEquals(result.removals, []);
  assertEquals(result.changed, false);
});

Deno.test("empty and non-string input is returned as-is", () => {
  assertEquals(cleanChapterProse("").text, "");
  assertEquals(cleanChapterProse("   ").changed, false);
});

// ---------------------------------------------------------------------------
// JSON residue
// ---------------------------------------------------------------------------

Deno.test("trailing JSON residue after the last sentence is stripped", () => {
  const result = cleanChapterProse(
    chapter(
      'By the time they reached the house, the lamps had already been lit, and the guests had arrived."}",',
    ),
  );
  assert(result.text.endsWith("the guests had arrived."));
  assertEquals(kinds(result), ["json_residue"]);
});

Deno.test("residue after closing dialogue keeps the dialogue's closing quote", () => {
  const result = cleanChapterProse(
    chapter('"The bus has arrived."}'),
  );
  assert(result.text.endsWith('"The bus has arrived."'));
});

Deno.test("the rest of a JSON object after chapter_body is cut at the seam", () => {
  const result = cleanChapterProse(
    chapter(
      'She did not look back.", "word_count": 1330, "themes": ["return", "family"], "first_line": "The bus from Sukkur came in forty minutes late."}',
    ),
  );
  assert(result.text.endsWith("She did not look back."));
  assert(!result.text.includes("word_count"));
});

Deno.test("a whole JSON object handed over as prose is reduced to its chapter body", () => {
  const raw =
    '{"title": "The Harmonium", "chapter_title": "Cardamom", "chapter_body": "The bus came in late.\\n\\nNadia waited on the bench and counted pigeons until the man in grey arrived.\\n\\nThe car smelled of cardamom.", "word_count": 25}';
  const result = cleanChapterProse(raw);
  assertEquals(
    result.text,
    "The bus came in late.\n\nNadia waited on the bench and counted pigeons until the man in grey arrived.\n\nThe car smelled of cardamom.",
  );
});

Deno.test("prose ending on a bracket is not residue", () => {
  const prose = chapter("The sign on the door read [CLOSED]");
  assertEquals(cleanChapterProse(prose).text, prose);
});

Deno.test("leaked prompt fences are removed", () => {
  const result = cleanChapterProse(
    chapter("<katha:moment>She kept the key.</katha:moment>"),
  );
  assert(result.text.endsWith("She kept the key."));
  assertEquals(kinds(result), ["markup_residue"]);
});

// ---------------------------------------------------------------------------
// Duplicate trailing paragraphs
// ---------------------------------------------------------------------------

Deno.test("a final paragraph that repeats the one before it is dropped", () => {
  const last =
    "She put the letter back in her pocket and did not take it out again until the lights of the house came into view.";
  const result = cleanChapterProse(chapter(last, last));
  assertEquals(result.text, chapter(last));
  assertEquals(kinds(result), ["duplicate_paragraph"]);
});

Deno.test("a truncated copy of the previous paragraph is dropped", () => {
  const last =
    "She put the letter back in her pocket and did not take it out again until the lights of the house came into view.";
  const result = cleanChapterProse(
    chapter(last, "She put the letter back in her pocket and did not"),
  );
  assertEquals(result.text, chapter(last));
});

Deno.test("a duplicate hidden behind residue is still caught", () => {
  const last =
    "She put the letter back in her pocket and did not take it out again until the lights of the house came into view.";
  const result = cleanChapterProse(chapter(last, `${last}"}`));
  assertEquals(result.text, chapter(last));
});

Deno.test("a short repeated line is a refrain and is kept", () => {
  const prose = chapter("Knock.", "Knock.");
  assertEquals(cleanChapterProse(prose).text, prose);
});

// ---------------------------------------------------------------------------
// Model notes
// ---------------------------------------------------------------------------

Deno.test("a banned-phrase note is removed and its replacement prose kept", () => {
  const result = cleanChapterProse(
    chapter(
      "The air was thick is banned, avoid. Use: The air in the courtyard smelled of wet brick and kerosene.",
    ),
  );
  assert(!/banned|avoid|Use:/.test(result.text));
  assert(
    result.text.endsWith(
      "The air in the courtyard smelled of wet brick and kerosene.",
    ),
  );
  assertEquals(kinds(result), ["model_note"]);
});

Deno.test("a note line on its own is removed", () => {
  const result = cleanChapterProse(
    chapter(
      "The air was thick is banned, avoid. Use:",
      "Inside, the fan turned slowly.",
    ),
  );
  assert(!result.text.includes("banned"));
  assert(result.text.endsWith("Inside, the fan turned slowly."));
});

Deno.test("a word count check is removed", () => {
  const result = cleanChapterProse(
    chapter("Word count check: ...approx 1330 words..."),
  );
  assertEquals(result.text, chapter());
  assertEquals(kinds(result), ["model_note"]);
});

Deno.test("parenthetical and bracketed author notes are removed", () => {
  const result = cleanChapterProse(
    chapter(
      "(Note: moment three lands in the next chapter.)",
      "[Author's note: keep the brother offstage]",
      "The gate was open.",
    ),
  );
  assertEquals(result.text, chapter("The gate was open."));
});

Deno.test("prose that mentions bans and word counts is kept", () => {
  const prose = chapter(
    "Smoking is banned on the platform, so the guard smoked behind the parcels office instead.",
    "Her thesis was about 2,000 words short, and the deadline was Friday.",
    '"Use your head," her father used to say. "Avoid the main road after dark."',
  );
  assertEquals(cleanChapterProse(prose).text, prose);
});

// ---------------------------------------------------------------------------
// Structure and reader address
// ---------------------------------------------------------------------------

Deno.test("a cross-reference phrase is lifted out and the sentence kept", () => {
  const result = cleanChapterProse(
    chapter(
      "Inspector Baig held up the evidence bag from Chapter 1 and turned it to the light.",
    ),
  );
  assert(
    result.text.endsWith(
      "Inspector Baig held up the evidence bag and turned it to the light.",
    ),
  );
  assertEquals(kinds(result), ["structure_reference"]);
});

Deno.test("a sentence that is only a cross-reference is removed", () => {
  const result = cleanChapterProse(
    chapter(
      "He had seen the ring before. That was in Chapter 1. He was sure of it.",
    ),
  );
  assert(
    result.text.endsWith("He had seen the ring before. He was sure of it."),
  );
});

Deno.test("chapters of books inside the story world are kept", () => {
  const prose = chapter(
    "She opened the manual to chapter three and read the wiring diagram twice.",
    "In chapter 7 of the constitution, the clause about emergencies ran to a single page.",
    "He had written the first chapter of his novel on the back of electricity bills.",
    "It was the next chapter of their lives, her mother said, and it would not wait.",
    '"Read me Chapter Two again," the boy said from under the blanket.',
  );
  assertEquals(cleanChapterProse(prose).text, prose);
});

Deno.test("direct address to the reader is removed", () => {
  const result = cleanChapterProse(
    chapter(
      "As the reader already knows, the letter was a forgery. Nadia did not.",
    ),
  );
  assert(result.text.endsWith("Nadia did not."));
  assertEquals(kinds(result), ["reader_address"]);
});

Deno.test("a heading above the chapter is removed", () => {
  const result = cleanChapterProse(`Chapter 3: The Spare Keys\n\n${chapter()}`);
  assertEquals(result.text, chapter());
  assertEquals(kinds(result), ["heading"]);
  assertEquals(
    cleanChapterProse(`# The Spare Keys\n\n${chapter()}`).text,
    chapter(),
  );
});

// ---------------------------------------------------------------------------
// Brief echoes
// ---------------------------------------------------------------------------

const brief: ProseIntegrityBrief = {
  moments: [
    "Nadia finds the letter her mother hid inside the old harmonium in the storeroom",
  ],
  characters: [{
    background:
      "Grew up in Lahore and moved to Karachi when her father lost his job at the mill. Distrusts anyone in uniform.",
    appearance:
      "Tall, with a scar through her left eyebrow from a fall off her cousin's bicycle.",
  }],
};

Deno.test("a moment pasted into narration is removed", () => {
  const result = cleanChapterProse(
    chapter(
      "Later that night, Nadia finds the letter her mother hid inside the old harmonium in the storeroom. The paper was soft as cloth.",
    ),
    brief,
  );
  assert(!result.text.includes("harmonium"));
  assert(result.text.endsWith("The paper was soft as cloth."));
  assertEquals(kinds(result), ["brief_echo"]);
});

Deno.test("a background sentence put in a character's mouth is removed, quotes balanced", () => {
  const result = cleanChapterProse(
    chapter(
      '"I grew up in Lahore and moved to Karachi when my father lost his job at the mill. Now I drive for Farooq."',
    ),
    brief,
  );
  assert(!result.text.includes("Lahore"));
  assert(result.text.endsWith('"Now I drive for Farooq."'));
});

Deno.test("an appearance sentence pasted into narration is removed", () => {
  const result = cleanChapterProse(
    chapter(
      "She was tall, with a scar through her left eyebrow from a fall off her cousin's bicycle. The driver did not ask.",
    ),
    brief,
  );
  assert(!result.text.includes("scar"));
});

Deno.test("prose about the same things, in its own words, is kept", () => {
  const prose = chapter(
    "The harmonium had not been played since the funeral. Someone had stacked flour sacks on it.",
    "Karachi had never forgiven her for Lahore, or she had never forgiven it. She could not remember which.",
    "The scar on her eyebrow itched in the heat, the way it always did.",
  );
  assertEquals(cleanChapterProse(prose, brief).text, prose);
});

Deno.test("the echo rule stands down when the brief matches too much of the chapter", () => {
  // A brief so generic it matches most of the chapter is the breaker's case:
  // deleting that much prose is worse than any leak.
  const line =
    "She walked down the long road toward the house where she was born.";
  const prose = Array.from({ length: 8 }, () => line).join(" ");
  const result = cleanChapterProse(prose, { moments: [line] });
  assertEquals(result.text, prose);
  assertEquals(kinds(result), ["brief_echo_capped"]);
});

// ---------------------------------------------------------------------------
// Circuit breaker and the async wrapper
// ---------------------------------------------------------------------------

Deno.test("a pass that would gut the chapter reverts to the residue cleanup", () => {
  const notes = Array.from(
    { length: 6 },
    (_, i) => `Word count check: approx ${1000 + i} words so far.`,
  );
  const prose = ["The gate was open.", ...notes].join("\n\n") + '"}';
  const result = cleanChapterProse(prose);
  assertStringIncludes(result.text, "Word count check");
  assert(!result.text.endsWith('"}'));
  assertEquals(kinds(result), ["json_residue", "reverted"]);
});

Deno.test("enforceProseIntegrity cleans and never throws without a database", async () => {
  const result = await enforceProseIntegrity(
    chapter(
      "Word count check: approx 1330 words.",
      "Manchester United were losing on the radio.",
    ),
    proseIntegrityBrief({
      moments: brief.moments,
      characters: brief.characters,
    }),
    { feature: "continue_story", chapterNumber: 3 },
  );
  assert(!result.text.includes("Word count"));
  // Brands are reported, never rewritten.
  assertStringIncludes(result.text, "Manchester United");
  // Telemetry is handed off, not awaited by the caller, and settles on its
  // own (no database here, so each write degrades to a console line).
  await result.telemetry;
});

// ---------------------------------------------------------------------------
// Brands and helpers
// ---------------------------------------------------------------------------

Deno.test("the reviewed brands are found as proper nouns only", () => {
  assertEquals(
    scanBrandNames(
      "He drove a Corolla to Safeway, sent it by Western Union and drank a Pakola.",
    ),
    ["corolla", "pakola", "safeway", "western_union"],
  );
  assertEquals(
    scanBrandNames(
      "Her voice was husky. The greyhound slept. It was a solo flight past the corolla of the lily.",
    ),
    [],
  );
});

Deno.test("sentence splitting round-trips and respects abbreviations", () => {
  const text = 'Mr. Baig said nothing. "Go," she said! Then: silence… And rain';
  assertEquals(splitSentences(text).join(""), text);
  assertEquals(splitSentences(text)[0], "Mr. Baig said nothing. ");
});

Deno.test("a reading word elsewhere in the sentence does not shield a leaked reference", () => {
  const result = cleanChapterProse(
    chapter(
      "She read the label on the evidence bag from Chapter 1 and set it down.",
    ),
  );
  assert(
    result.text.endsWith(
      "She read the label on the evidence bag and set it down.",
    ),
  );
  assertEquals(kinds(result), ["structure_reference"]);
});

Deno.test("a character reading from a chapter keeps the reference", () => {
  const prose = chapter(
    "Her grandmother read aloud from Chapter 3 while the kettle boiled.",
    "He was quoting from chapter two again, the part about the flood.",
  );
  assertEquals(cleanChapterProse(prose).text, prose);
});

Deno.test("enforceProseIntegrity does not wait for telemetry", async () => {
  let resolved = false;
  const pending = enforceProseIntegrity(
    chapter("Word count check: approx 1330 words."),
    {},
    { feature: "generate_story" },
  ).then((r) => {
    resolved = true;
    return r;
  });
  const result = await pending;
  assert(resolved);
  assert(result.telemetry instanceof Promise);
  await result.telemetry;
});

Deno.test("first_line follows the stored body when cleaning changed its opening", () => {
  // The heading was the model's "first line"; the stored chapter opens on prose.
  assertEquals(
    alignFirstLine(
      "Chapter 3: The Spare Keys",
      "The door was open.\n\nMore.",
      true,
    ),
    "The door was open.",
  );
  // A line that still opens the body is kept, and so is anything when the
  // body did not change.
  assertEquals(
    alignFirstLine(
      "The door was open.",
      "The door was open. She went in.",
      true,
    ),
    "The door was open.",
  );
  assertEquals(alignFirstLine("Anything", "Other text.", false), "Anything");
});
