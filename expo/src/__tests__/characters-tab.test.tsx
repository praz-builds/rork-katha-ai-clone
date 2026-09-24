/**
 * Library › Characters: the saved-character list, its empty state, and the
 * icon-only button that crafts a new one.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import CharactersTab from "@/components/library/CharactersTab";
import type { SavedCharacter } from "@/types/domain";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const naina: SavedCharacter = {
  id: "saved-naina",
  name: "Naina Mistry",
  appearance: "A 29-year-old baker",
  createdAt: "2026-09-09T00:00:00Z",
};

const savedFrom = (id: string) => jest.fn(async (input: { name: string; appearance?: string }) => ({
  id,
  name: input.name,
  appearance: input.appearance,
  createdAt: "2026-09-24T00:00:00Z",
}));

it("lists saved characters with their appearance", async () => {
  const view = await render(<CharactersTab loadCharacters={async () => [naina]} />);
  expect(await view.findByLabelText("Edit Naina Mistry")).toBeTruthy();
  expect(view.getByText("A 29-year-old baker")).toBeTruthy();
  expect(view.queryByTestId("characters-empty")).toBeNull();
});

it("shows one line and the create button when there are none", async () => {
  const view = await render(<CharactersTab loadCharacters={async () => []} />);
  await waitFor(() => expect(view.getByTestId("characters-empty")).toBeTruthy());
  expect(view.getByLabelText("Create new character")).toBeTruthy();
});

it("creates a character through Craft character and lists it", async () => {
  const saveCharacter = savedFrom("saved-kabir");
  const view = await render(
    <CharactersTab loadCharacters={async () => []} saveCharacter={saveCharacter} />,
  );
  await waitFor(() => expect(view.getByTestId("characters-empty")).toBeTruthy());

  await fireEvent.press(view.getByLabelText("Create new character"));
  await waitFor(() => expect(view.getByText("Craft character")).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText("Name"), "Kabir");
  await fireEvent.changeText(view.getByLabelText("Appearance"), "A courier");
  await fireEvent.press(view.getByText("Save"));

  await waitFor(() =>
    expect(saveCharacter).toHaveBeenCalledWith(expect.objectContaining({ name: "Kabir", appearance: "A courier" })),
  );
  expect(await view.findByLabelText("Edit Kabir")).toBeTruthy();
  expect(view.queryByTestId("characters-empty")).toBeNull();
});

it("opens a saved character for editing, and a rename replaces the old row", async () => {
  const saveCharacter = savedFrom("saved-naina-2");
  const deleteCharacter = jest.fn(async () => {});
  const view = await render(
    <CharactersTab
      loadCharacters={async () => [naina]}
      saveCharacter={saveCharacter}
      deleteCharacter={deleteCharacter}
    />,
  );
  await fireEvent.press(await view.findByLabelText("Edit Naina Mistry"));
  await waitFor(() => expect(view.getByLabelText("Name").props.value).toBe("Naina Mistry"));

  await fireEvent.changeText(view.getByLabelText("Name"), "Naina Rao");
  await fireEvent.press(view.getByText("Save"));

  await waitFor(() => expect(deleteCharacter).toHaveBeenCalledWith("saved-naina"));
  expect(saveCharacter).toHaveBeenCalledWith(expect.objectContaining({ name: "Naina Rao" }));
  expect(await view.findByLabelText("Edit Naina Rao")).toBeTruthy();
  expect(view.queryByLabelText("Edit Naina Mistry")).toBeNull();
});

it("refuses a rename onto another character's name instead of overwriting them", async () => {
  const kabir: SavedCharacter = {
    id: "saved-kabir",
    name: "Kabir Sethi",
    appearance: "A ferry pilot",
    createdAt: "2026-09-10T00:00:00Z",
  };
  const saveCharacter = savedFrom("saved-kabir");
  const deleteCharacter = jest.fn(async () => {});
  const alert = jest.spyOn(require("react-native").Alert, "alert").mockImplementation(() => {});
  const view = await render(
    <CharactersTab
      loadCharacters={async () => [naina, kabir]}
      saveCharacter={saveCharacter}
      deleteCharacter={deleteCharacter}
    />,
  );
  await fireEvent.press(await view.findByLabelText("Edit Naina Mistry"));
  await waitFor(() => expect(view.getByLabelText("Name").props.value).toBe("Naina Mistry"));

  await fireEvent.changeText(view.getByLabelText("Name"), " kabir sethi ");
  await fireEvent.press(view.getByText("Save"));

  await waitFor(() => expect(alert).toHaveBeenCalledWith("That name is taken", expect.stringContaining("Kabir Sethi")));
  expect(saveCharacter).not.toHaveBeenCalled();
  expect(deleteCharacter).not.toHaveBeenCalled();
  alert.mockRestore();
});
