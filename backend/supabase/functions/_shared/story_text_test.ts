import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseGeneratedStoryText } from "./story_text.ts";

Deno.test("generated text keeps paragraph boundaries after the title", () => {
  assertEquals(
    parseGeneratedStoryText(
      "\n# A Quiet Door\n\nFirst paragraph.\n\nSecond paragraph.\n",
      "Untitled",
    ),
    {
      title: "A Quiet Door",
      content: "First paragraph.\n\nSecond paragraph.",
    },
  );
});

Deno.test("blank generated text returns an empty body", () => {
  assertEquals(parseGeneratedStoryText(" \n ", "Untitled"), {
    title: "Untitled",
    content: "",
  });
});
