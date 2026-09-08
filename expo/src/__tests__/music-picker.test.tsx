import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { MusicPicker } from "@/components/reader/MusicPicker";

/**
 * Exercises MusicPicker against the REAL catalogue module, which ships with
 * an empty MUSIC_TRACKS array (see src/lib/music-catalogue.ts). This is the
 * exact state the app will run in until licensed audio is added.
 */
it("renders an honest unavailable state with an empty catalogue, and does not crash", async () => {
  const view = await render(
    <MusicPicker
      visible
      genre="fantasy"
      selectedTrackId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  expect(view.getByText("No music yet")).toBeTruthy();
  expect(view.getByText(/Ambient tracks are not available yet/)).toBeTruthy();
  // No track rows and no "None" toggle: there is nothing to choose between yet.
  expect(view.queryByLabelText("None")).toBeNull();
  // The sheet itself still works: closing it is always available.
  expect(view.getByLabelText("Close music")).toBeTruthy();
});

// A stale selection must always be clearable.
//
// With an empty catalogue the picker rendered only its empty state, so a reader
// whose saved track had since been removed from the catalogue was left holding
// a selection with no control to clear it: music they could not turn off.
describe("clearing a selection the catalogue no longer offers", () => {
  it("offers None when a selection exists even with an empty catalogue", async () => {
    const onSelect = jest.fn();
    const view = await render(
      <MusicPicker
        visible
        genre="historical"
        selectedTrackId="a-track-that-no-longer-exists"
        onSelect={onSelect}
        onClose={jest.fn()}
      />,
    );

    const none = await view.findByText("None");
    await fireEvent.press(none);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("still shows the plain empty state when there is nothing to clear", async () => {
    const view = await render(
      <MusicPicker
        visible
        genre="historical"
        selectedTrackId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    await waitFor(() => expect(view.getByText("No music yet")).toBeTruthy());
    expect(view.queryByText("None")).toBeNull();
  });
});
