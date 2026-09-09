import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  expandRename,
  substituteCharacterName,
  substituteCharacters,
  substituteCharactersInJson,
} from "./character-substitution.ts";

Deno.test("whole words only: a name inside a longer word is left alone", () => {
  assertEquals(
    substituteCharacterName(
      "Maya met Mayank in the Himalaya.",
      "Maya",
      "Priya",
    ),
    "Priya met Mayank in the Himalaya.",
  );
});

Deno.test("possessives and punctuation follow the name", () => {
  assertEquals(
    substituteCharacterName(
      `"Maya's chai," said Maya, "is Maya’s business."`,
      "Maya",
      "Priya",
    ),
    `"Priya's chai," said Priya, "is Priya’s business."`,
  );
});

Deno.test("all caps is preserved, other spellings take the replacement as typed", () => {
  assertEquals(
    substituteCharacterName("MAYA! maya. Maya", "Maya", "Priya"),
    "PRIYA! Priya. Priya",
  );
});

Deno.test("a full name expands to the full name and the first name, never the surname", () => {
  assertEquals(
    expandRename({ from: "Aarav Mehta", to: "Rohan Iyer" }),
    [
      { from: "Aarav Mehta", to: "Rohan Iyer" },
      { from: "Aarav", to: "Rohan" },
    ],
  );
  assertEquals(
    substituteCharacters(
      "Aarav Mehta walked in. Aarav sat. Mr Mehta's shop was shut.",
      [{ from: "Aarav Mehta", to: "Rohan Iyer" }],
    ),
    "Rohan Iyer walked in. Rohan sat. Mr Mehta's shop was shut.",
  );
});

Deno.test("renaming to the same name, or with a blank, is a no-op", () => {
  assertEquals(expandRename({ from: "Maya", to: "maya" }), []);
  assertEquals(expandRename({ from: "", to: "Priya" }), []);
  assertEquals(
    substituteCharacters("Maya sat.", [{ from: "Maya", to: "" }]),
    "Maya sat.",
  );
});

Deno.test("pronouns are never rewritten", () => {
  assertEquals(
    substituteCharacters("Maya said she would. He agreed.", [{
      from: "Maya",
      to: "Rohan",
    }]),
    "Rohan said she would. He agreed.",
  );
});

Deno.test("non-Latin names are matched on the same word rules", () => {
  assertEquals(
    substituteCharacterName("माया ने कहा। मायांक चुप रहा।", "माया", "प्रिया"),
    "प्रिया ने कहा। मायांक चुप रहा।",
  );
});

Deno.test("a JSON value is renamed in every string, at any depth", () => {
  const state = {
    open_hooks: ["Maya has not said why she came back"],
    relationship_state: "Aarav and Maya are circling each other",
    nested: { count: 2, notes: [{ text: "MAYA shouted" }] },
  };
  assertEquals(
    substituteCharactersInJson(state, [{ from: "Maya", to: "Priya" }]),
    {
      open_hooks: ["Priya has not said why she came back"],
      relationship_state: "Aarav and Priya are circling each other",
      nested: { count: 2, notes: [{ text: "PRIYA shouted" }] },
    },
  );
});
