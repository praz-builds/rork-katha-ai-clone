import React, { useState } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import type { SavedCharacter } from "@/types/domain";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) => React.createElement(Text, null, `${credits} credits`),
  };
});

/* eslint-disable import/first */
import CreateBriefFlow, { type StudioCreateDraft } from "@/components/create/CreateBriefFlow";
/* eslint-enable import/first */

const saved: SavedCharacter[] = [
  { id: "s-naina", name: "Naina", appearance: "A baker", createdAt: "2026-09-09T00:00:03Z" },
  { id: "s-aarav", name: "Aarav", appearance: "An engineer", createdAt: "2026-09-09T00:00:02Z" },
  { id: "s-maya", name: "Maya", appearance: "The one who stayed", createdAt: "2026-09-09T00:00:01Z" },
  { id: "s-kabir", name: "Kabir", appearance: "A courier", createdAt: "2026-09-09T00:00:00Z" },
];

const initialDraft: StudioCreateDraft = {
  primaryGenre: "romance",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "",
  language: "English",
  visibility: "private",
  characters: [],
  isSeries: false,
};

function Harness({
  library,
  onDraft,
}: {
  library: SavedCharacter[];
  onDraft?: (draft: StudioCreateDraft) => void;
}) {
  const [draft, setDraft] = useState<StudioCreateDraft>(initialDraft);
  onDraft?.(draft);
  return (
    <CreateBriefFlow
      credits={12}
      isAnonymous={false}
      draft={draft}
      setDraft={setDraft}
      onGenerate={jest.fn()}
      onBack={jest.fn()}
      loadSavedCharacters={async () => library}
      saveSavedCharacter={async (input) => ({ id: `s-${input.name}`, name: input.name, createdAt: "now" })}
    />
  );
}

it("defaults to Saved when the library has anyone in it, and to New when it is empty", async () => {
  const withLibrary = await render(<Harness library={saved} />);
  await waitFor(() =>
    expect(withLibrary.getByLabelText("Saved characters").props.accessibilityState.selected).toBe(true)
  );
  expect(withLibrary.getByLabelText("Add Naina to this story")).toBeTruthy();
  expect(withLibrary.queryByLabelText("Add a character")).toBeNull();

  const empty = await render(<Harness library={[]} />);
  await waitFor(() =>
    expect(empty.getByLabelText("New character").props.accessibilityState.selected).toBe(true)
  );
  expect(empty.getByLabelText("Add a character")).toBeTruthy();
});

it("adds a saved character with one tap, makes the first the lead, and removes it on a second tap", async () => {
  let latest: StudioCreateDraft = initialDraft;
  const view = await render(<Harness library={saved} onDraft={(draft) => { latest = draft; }} />);
  const chip = await view.findByLabelText("Add Naina to this story");
  await fireEvent.press(chip);

  await waitFor(() => expect(view.getByLabelText("Remove Naina from this story")).toBeTruthy());
  expect(latest.characters).toHaveLength(1);
  expect(latest.characters[0]).toEqual(expect.objectContaining({
    name: "Naina",
    appearance: "A baker",
    isHero: true,
    savedCharacterId: "s-naina",
  }));
  expect(view.getByText("Naina · Lead")).toBeTruthy();

  await fireEvent.press(view.getByLabelText("Remove Naina from this story"));
  await waitFor(() => expect(view.getByLabelText("Add Naina to this story")).toBeTruthy());
  expect(latest.characters).toHaveLength(0);
});

it("stops at three, disables the rest, and says why", async () => {
  let latest: StudioCreateDraft = initialDraft;
  const view = await render(<Harness library={saved} onDraft={(draft) => { latest = draft; }} />);
  await fireEvent.press(await view.findByLabelText("Add Naina to this story"));
  await fireEvent.press(view.getByLabelText("Add Aarav to this story"));
  await fireEvent.press(view.getByLabelText("Add Maya to this story"));

  await waitFor(() => expect(view.getByText("Up to three characters per story.")).toBeTruthy());
  const fourth = view.getByLabelText("Add Kabir to this story");
  expect(fourth.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(fourth);
  expect(latest.characters).toHaveLength(3);
  expect(view.getByText("3 of 3")).toBeTruthy();
});

/** Visibility is a dropdown inside More options, with the other five. */
it("offers Private and Public as named states, with the spec's copy on each", async () => {
  let latest: StudioCreateDraft = initialDraft;
  const view = await render(<Harness library={[]} onDraft={(draft) => { latest = draft; }} />);

  await fireEvent.press(await view.findByRole("button", { name: "More options" }));
  const trigger = await view.findByRole("button", { name: "Who can read it" });
  expect(trigger.props.accessibilityValue).toEqual({ text: "Private" });

  await fireEvent.press(view.getByRole("button", { name: "About Who can read it" }));
  expect(view.getByText("Only you can see this story.")).toBeTruthy();
  expect(view.getByText("Anyone on Katha can read it once it's written.")).toBeTruthy();

  await fireEvent.press(trigger);

  await fireEvent.press(view.getByRole("button", { name: "Public" }));
  await waitFor(() => expect(latest.visibility).toBe("public"));
});

it("puts a saved character added to the story into Moments as a tag, and drops it when removed", async () => {
  const view = await render(<Harness library={saved} />);
  await fireEvent.press(await view.findByLabelText("Add Naina to this story"));
  await fireEvent.press(view.getByRole("button", { name: "More options" }));

  expect(view.getByLabelText("Add Naina to this moment")).toBeTruthy();
  // Only the cast is offered, not the whole library.
  expect(view.queryByLabelText("Add Aarav to this moment")).toBeNull();

  await fireEvent.press(view.getByLabelText("Remove Naina from this story"));
  await waitFor(() => expect(view.queryByLabelText("Add Naina to this moment")).toBeNull());
});
