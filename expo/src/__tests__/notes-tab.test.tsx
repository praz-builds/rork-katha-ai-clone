/**
 * Notes: the phrase list, and the switch above it.
 *
 * The switch is the part with a caveat, and the test says the caveat out loud
 * rather than asserting something stronger than the code does. It persists
 * the reader's answer to the device; it does not yet reach `generate-story`,
 * which reads `saved_phrases` and consults no preference. What is testable
 * today is that the answer is written and read back, so the moment a server
 * field exists there is one place to point it at.
 */
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));

/* eslint-disable import/first */
import NotesTab from "@/components/library/NotesTab";
import {
  isPhraseReinforcementEnabled,
  savePhrase,
  saveManualPhrases,
} from "@/lib/phrases";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(async () => {
  await storage.clear();
});

it("shows the empty state when nothing is saved", async () => {
  const view = await render(<NotesTab />);
  await waitFor(() => expect(view.getByTestId("notes-empty")).toBeTruthy());
});

it("keeps the explanation behind the info affordance rather than always on screen", async () => {
  const view = await render(<NotesTab />);
  await waitFor(() => expect(view.getByTestId("notes-empty")).toBeTruthy());

  expect(view.queryByTestId("notes-info-panel")).toBeNull();
  await fireEvent.press(view.getByTestId("notes-info"));
  expect(view.getByTestId("notes-info-panel")).toBeTruthy();
});

it("lists saved phrases, captured ones and typed ones alike", async () => {
  await savePhrase({
    phrase: "under the weather",
    sentence: "She had been under the weather all week.",
    storyId: "story-1",
    storyTitle: "The Last Lighthouse",
    chapterId: "chapter-1",
  });
  await saveManualPhrases(["cold feet"], "English");

  const view = await render(<NotesTab />);

  await waitFor(() => expect(view.getByText("cold feet")).toBeTruthy());
  expect(view.getByText("under the weather")).toBeTruthy();
  // A captured phrase names its story; a typed one says where it came from
  // instead of inventing one.
  expect(view.getByText("From The Last Lighthouse")).toBeTruthy();
  expect(view.getByText("Added by you · English")).toBeTruthy();
});

it("removes a phrase and does not put it back", async () => {
  const saved = await saveManualPhrases(["cold feet"], "English");
  const view = await render(<NotesTab />);

  await waitFor(() => expect(view.getByText("cold feet")).toBeTruthy());
  await fireEvent.press(view.getByTestId(`notes-remove-${saved[0].id}`));

  await waitFor(() => expect(view.queryByText("cold feet")).toBeNull());
});

it("adds phrases through the sheet and shows them in the list", async () => {
  const view = await render(<NotesTab />);
  await waitFor(() => expect(view.getByTestId("notes-empty")).toBeTruthy());

  await fireEvent.press(view.getByTestId("notes-add-phrases"));
  await fireEvent.changeText(
    view.getByTestId("add-phrases-field"),
    "cold feet, spill the beans",
  );
  await fireEvent.press(view.getByTestId("add-phrases-save"));

  await waitFor(() => expect(view.getByText("cold feet")).toBeTruthy());
  expect(view.getByText("spill the beans")).toBeTruthy();
});

it("starts with reinforcement on, and persists the reader turning it off", async () => {
  const view = await render(<NotesTab />);
  const toggle = await view.findByTestId("notes-reinforcement-toggle");

  await waitFor(() => expect(view.getByTestId("notes-empty")).toBeTruthy());
  expect(toggle.props.accessibilityState.checked).toBe(true);
  expect(view.queryByTestId("notes-paused-note")).toBeNull();

  await fireEvent.press(toggle);

  await waitFor(() => expect(view.getByTestId("notes-paused-note")).toBeTruthy());
  await waitFor(async () =>
    expect(await isPhraseReinforcementEnabled()).toBe(false)
  );
});

it("reads the persisted preference back on the next mount", async () => {
  const first = await render(<NotesTab />);
  const toggle = await first.findByTestId("notes-reinforcement-toggle");
  await fireEvent.press(toggle);
  await waitFor(async () =>
    expect(await isPhraseReinforcementEnabled()).toBe(false)
  );
  first.unmount();

  const second = await render(<NotesTab />);
  const secondToggle = await second.findByTestId("notes-reinforcement-toggle");
  await waitFor(() =>
    expect(secondToggle.props.accessibilityState.checked).toBe(false)
  );
  expect(second.getByTestId("notes-paused-note")).toBeTruthy();
});
