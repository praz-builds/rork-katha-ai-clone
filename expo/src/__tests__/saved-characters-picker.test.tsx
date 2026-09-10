import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { SavedCharactersPicker } from "@/components/create/SavedCharactersPicker";
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

it("shows the empty state and still offers New character", async () => {
  const view = await render(
    <SavedCharactersPicker
      visible
      onSelect={jest.fn()}
      onClose={jest.fn()}
      loadCharacters={async () => []}
    />,
  );
  await waitFor(() => expect(view.getByText("No saved characters yet")).toBeTruthy());
  expect(view.getByText("Characters you create in a story are saved here automatically.")).toBeTruthy();
  expect(view.getByLabelText("New character")).toBeTruthy();
});

it("lists saved characters and reports a selection", async () => {
  const onSelect = jest.fn();
  const view = await render(
    <SavedCharactersPicker
      visible
      onSelect={onSelect}
      onClose={jest.fn()}
      loadCharacters={async () => [naina]}
    />,
  );
  const row = await view.findByLabelText("Choose Naina Mistry");
  expect(view.getByText("A 29-year-old baker")).toBeTruthy();
  await fireEvent.press(row);
  expect(onSelect).toHaveBeenCalledWith(naina);
});

it("saves a crafted character to the library first, then selects it", async () => {
  const onSelect = jest.fn();
  const saveCharacter = jest.fn(async (input) => ({
    id: "saved-new",
    name: input.name,
    appearance: input.appearance,
    createdAt: "2026-09-09T00:00:00Z",
  }));
  const view = await render(
    <SavedCharactersPicker
      visible
      onSelect={onSelect}
      onClose={jest.fn()}
      loadCharacters={async () => []}
      saveCharacter={saveCharacter}
    />,
  );
  await waitFor(() => expect(view.getByText("No saved characters yet")).toBeTruthy());
  await fireEvent.press(view.getByLabelText("New character"));
  await waitFor(() => expect(view.getByText("Craft character")).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText("Name"), "Kabir");
  await fireEvent.changeText(view.getByLabelText("Appearance"), "A courier");
  await fireEvent.press(view.getByText("Save"));

  await waitFor(() => expect(onSelect).toHaveBeenCalled());
  expect(saveCharacter).toHaveBeenCalledWith(expect.objectContaining({ name: "Kabir", appearance: "A courier" }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-new", name: "Kabir" }));
});
