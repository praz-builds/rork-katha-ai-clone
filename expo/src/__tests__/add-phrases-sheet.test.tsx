/**
 * The Add phrases sheet. Two things matter here beyond the parsing, which is
 * tested on its own: that Save hands the caller the parsed list rather than
 * the raw text, and that a save which did NOT happen leaves the sheet open
 * saying so. A sheet that closes on failure tells the reader their list is
 * saved when it is not, and they find out weeks later when none of it ever
 * shows up in a story.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import AddPhrasesSheet from "@/components/library/AddPhrasesSheet";
import { MAX_PHRASE_INPUT_LENGTH } from "@/lib/phrases";
/* eslint-enable import/first */

const renderSheet = async (
  overrides: Partial<React.ComponentProps<typeof AddPhrasesSheet>> = {},
) => {
  const onSave = overrides.onSave ?? jest.fn().mockResolvedValue(true);
  const onClose = overrides.onClose ?? jest.fn();
  const view = await render(
    <AddPhrasesSheet
      visible
      onClose={onClose}
      existingPhrases={[]}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { view, onSave, onClose };
};

it("saves the parsed phrases, not the raw text, and closes", async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  const { view, onClose } = await renderSheet({ onSave });

  await fireEvent.changeText(
    view.getByTestId("add-phrases-field"),
    "bite the bullet, under the weather\ncold feet",
  );
  await fireEvent.press(view.getByTestId("add-phrases-save"));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith(
    ["bite the bullet", "under the weather", "cold feet"],
    "English",
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("sends the language the reader picked", async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  const { view } = await renderSheet({ onSave });

  await fireEvent.press(view.getByTestId("add-phrases-language-English"));
  await fireEvent.changeText(view.getByTestId("add-phrases-field"), "cold feet");
  await fireEvent.press(view.getByTestId("add-phrases-save"));

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(["cold feet"], "English")
  );
});

// Portuguese was offered in every language picker in the app and nothing
// behind it was ever built: no narration voice, no phrase corpus, none of the
// prose rules tuned for it. Offering a language the product cannot write or
// speak is a promise broken the moment somebody takes it up.
it("offers only the language the product can actually write", async () => {
  const { view } = await renderSheet({});
  expect(view.getByTestId("add-phrases-language-English")).toBeTruthy();
  expect(view.queryByTestId("add-phrases-language-Portuguese")).toBeNull();
});

it("stays open and explains itself when the save fails", async () => {
  const onSave = jest.fn().mockRejectedValue(new Error("network"));
  const { view, onClose } = await renderSheet({ onSave });

  await fireEvent.changeText(view.getByTestId("add-phrases-field"), "cold feet");
  await fireEvent.press(view.getByTestId("add-phrases-save"));

  await waitFor(() => expect(view.getByTestId("add-phrases-error")).toBeTruthy());
  expect(onClose).not.toHaveBeenCalled();
});

it("treats a save that resolves false as a failure too", async () => {
  const onSave = jest.fn().mockResolvedValue(false);
  const { view, onClose } = await renderSheet({ onSave });

  await fireEvent.changeText(view.getByTestId("add-phrases-field"), "cold feet");
  await fireEvent.press(view.getByTestId("add-phrases-save"));

  await waitFor(() => expect(view.getByTestId("add-phrases-error")).toBeTruthy());
  expect(onClose).not.toHaveBeenCalled();
});

it("counts characters against the limit and refuses to save over it", async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  const { view } = await renderSheet({ onSave });

  const raw = "a".repeat(MAX_PHRASE_INPUT_LENGTH + 5);
  await fireEvent.changeText(view.getByTestId("add-phrases-field"), raw);

  expect(view.getByTestId("add-phrases-counter").props.children.join("")).toBe(
    `${raw.length} / ${MAX_PHRASE_INPUT_LENGTH}`,
  );
  await fireEvent.press(view.getByTestId("add-phrases-save"));
  await waitFor(() => expect(onSave).not.toHaveBeenCalled());
});

it("does not save an empty field", async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  const { view } = await renderSheet({ onSave });

  await fireEvent.press(view.getByTestId("add-phrases-save"));
  await waitFor(() => expect(onSave).not.toHaveBeenCalled());
});

it("says how many of a paste are already saved before anything is written", async () => {
  const { view } = await renderSheet({ existingPhrases: [{ phrase: "cold feet", language: "English" }] });

  await fireEvent.changeText(
    view.getByTestId("add-phrases-field"),
    "cold feet, spill the beans",
  );

  expect(view.getByTestId("add-phrases-summary").props.children).toContain(
    "1 already saved",
  );
});

it("counts already-saved per language, not across all of them", async () => {
  // "saudade" saved while learning Portuguese is not the same thing as
  // "saudade" saved while learning English — storage keeps them as two
  // records, and calling the second a duplicate here would hide that behind
  // the UI.
  //
  // Portuguese can no longer be CHOSEN, but rows saved before it was removed
  // still carry it, so the per-language comparison still has to hold: typing
  // the same word in English must not be called a duplicate of the stored
  // Portuguese one.
  const { view } = await renderSheet({
    existingPhrases: [{ phrase: "saudade", language: "Portuguese" }],
  });

  await fireEvent.changeText(view.getByTestId("add-phrases-field"), "saudade");
  await fireEvent.press(view.getByTestId("add-phrases-language-English"));
  expect(view.getByTestId("add-phrases-summary").props.children).not.toContain(
    "1 already saved",
  );
});
