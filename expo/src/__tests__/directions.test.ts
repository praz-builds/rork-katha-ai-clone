/**
 * Turning the story's own state into directions the reader gives.
 *
 * The bar here is not "did it produce something". It is: every output is an
 * INSTRUCTION, every word of it came from the story, and anything that cannot
 * clear both is dropped rather than padded out with a line that would fit any
 * story in the app.
 */

import { toDirection } from "@/lib/directions";

describe("the hooks the product owner photographed off the running app", () => {
  it("turns a subject wh-question into a direction", () => {
    expect(toDirection("Who is writing the predictive linen notes"))
      .toBe("Find out who is writing the predictive linen notes.");
  });

  it("turns a 'what will happen if' into a direction in the reader's voice", () => {
    expect(toDirection("What will happen if Anjali unfolds every sheet tomorrow"))
      .toBe("Show what happens if Anjali unfolds every sheet tomorrow.");
  });

  it("un-inverts a yes/no question around its auxiliary", () => {
    expect(toDirection("Is the casualty girl Divya lying about having no brother"))
      .toBe("Find out whether the casualty girl Divya is lying about having no brother.");
  });
});

describe("frames", () => {
  it.each([
    ["Whose blood is on the shawl", "Reveal whose blood is on the shawl."],
    ["Where the second fragment is buried", "Show where the second fragment is buried."],
    ["When the storm reaches the fort", "Show when the storm reaches the fort."],
    ["Why the lamp was never lit", "Explain why the lamp was never lit."],
    ["How the trunk was opened", "Show how the trunk was opened."],
    ["Which sister sent the letter", "Show which sister sent the letter."],
  ])("frames %s", (source, expected) => {
    expect(toDirection(source)).toBe(expected);
  });

  it("leaves a sentence that is already an instruction alone", () => {
    const source = "Ask Aaji to open the stuck page and share the old fort song.";
    expect(toDirection(source)).toBe(source);
    expect(toDirection("Take Meera to see the real fort path before reading more"))
      .toBe("Take Meera to see the real fort path before reading more.");
  });

  it("strips a modal out of a pressure line to get a bare verb", () => {
    expect(toDirection("Anjali must decide whether to burn the notes"))
      .toBe("Have Anjali decide whether to burn the notes.");
    expect(toDirection("Divya has to admit she has a brother"))
      .toBe("Have Divya admit she has a brother.");
  });

  it("wraps a plain statement without touching a single word of it", () => {
    expect(toDirection("The storm is closing in on the fort"))
      .toBe("Write it so the storm is closing in on the fort.");
    // Every word after the frame is the story's own.
    expect(toDirection("Anjali confronts her mother about the notes"))
      .toBe("Write it so Anjali confronts her mother about the notes.");
  });
});

describe("what it refuses to do", () => {
  it("drops a do-support question rather than conjugating a verb", () => {
    expect(toDirection("Does Anjali know what her mother did")).toBeNull();
    expect(toDirection("Did the lamp ever burn")).toBeNull();
    expect(toDirection("What did she find in the trunk")).toBeNull();
  });

  it("drops an inverted adjunct question", () => {
    // "Explain why did Aaji stop singing" is not English, and un-inverting it
    // means conjugating "stop".
    expect(toDirection("Why did Aaji stop singing?")).toBeNull();
    expect(toDirection("How can she reach the fort in time?")).toBeNull();
  });

  it("drops a yes/no question with no participle to pivot on", () => {
    expect(toDirection("Is Divya her sister")).toBeNull();
  });

  it("drops something too short to be a direction", () => {
    expect(toDirection("Who?")).toBeNull();
    expect(toDirection("")).toBeNull();
    expect(toDirection(undefined)).toBeNull();
    expect(toDirection(null)).toBeNull();
  });

  it("never renames a character to fix a capital", () => {
    // "Anjali" keeps its capital; "The" does not. Lower-casing any leading
    // capital would have the app misspelling the reader's own character on a
    // card it is asking them to buy.
    expect(toDirection("Anjali must leave before dawn")).toContain("Anjali");
    expect(toDirection("The storm must break by morning"))
      .toBe("Have the storm break by morning.");
  });
});

describe("shape", () => {
  it("always ends in a full stop and never in a question mark", () => {
    [
      "Who is writing the notes",
      "What will happen if she leaves",
      "The storm is closing in",
      "Ask Aaji to sing",
    ].forEach((source) => {
      const direction = toDirection(source)!;
      expect(direction.endsWith(".")).toBe(true);
      expect(direction).not.toContain("?");
    });
  });

  it("always starts with a capital", () => {
    expect(toDirection("the storm is closing in on the fort")).toBe(
      "Write it so the storm is closing in on the fort.",
    );
  });

  it("collapses the whitespace the model sometimes leaves behind", () => {
    expect(toDirection("  Who   is   writing   the   notes  "))
      .toBe("Find out who is writing the notes.");
  });
});
