import React from "react";
import { render } from "@testing-library/react-native";
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
