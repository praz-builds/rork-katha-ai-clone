import React from "react";
import { render } from "@testing-library/react-native";
import { MusicPicker } from "@/components/reader/MusicPicker";

/**
 * These two tests stand next to music-picker.test.tsx (the real, empty
 * catalogue) on purpose: the only difference here is the mocked
 * MUSIC_TRACKS array below. MusicPicker itself is untouched, which is the
 * proof that adding a track is purely a catalogue-module change.
 */
jest.mock("@/lib/music-catalogue", () => {
  const actual = jest.requireActual("@/lib/music-catalogue");
  return {
    ...actual,
    MUSIC_TRACKS: [
      { id: "forest-calm", title: "Forest Calm", genres: ["fantasy", "adventure"], source: { uri: "https://example.com/forest-calm.mp3" } },
      { id: "neon-drift", title: "Neon Drift", genres: ["scifi"], source: { uri: "https://example.com/neon-drift.mp3" } },
      { id: "old-manor", title: "Old Manor", genres: ["mystery", "horror"], source: { uri: "https://example.com/old-manor.mp3" } },
    ],
  };
});

it("makes a catalogue track appear in the picker with no other change", async () => {
  const view = await render(
    <MusicPicker
      visible
      genre="scifi"
      selectedTrackId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  // Unlike music-picker.test.tsx (real, empty catalogue), this track exists
  // purely because the mocked MUSIC_TRACKS array above lists it.
  expect(view.getByLabelText("Neon Drift")).toBeTruthy();
});

it("orders the story's own genre first, other tracks after, None always offered", async () => {
  const view = await render(
    <MusicPicker
      visible
      genre="fantasy"
      selectedTrackId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  const labels = view
    .getAllByRole("button")
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => label !== "Close music");

  // "Forest Calm" is tagged fantasy, so it leads; "Neon Drift" and
  // "Old Manor" are not fantasy, so they follow in catalogue order. Nothing
  // is selected, so "None" is the current choice.
  expect(labels).toEqual(["None, selected", "Forest Calm", "Neon Drift", "Old Manor"]);
});

it("shows the currently selected track", async () => {
  const view = await render(
    <MusicPicker
      visible
      genre="scifi"
      selectedTrackId="neon-drift"
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  expect(view.getByLabelText("Neon Drift, selected")).toBeTruthy();
  expect(view.getByLabelText("None")).toBeTruthy();
});

