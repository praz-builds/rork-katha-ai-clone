import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { stories } from "@/data/seed";
import ReaderScreen from "@/screens/ReaderScreen";

jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(() => Promise.resolve({
        sound: {
          pauseAsync: jest.fn(),
          playAsync: jest.fn(),
          unloadAsync: jest.fn(),
        },
      })),
    },
  },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("@/lib/api", () => ({
  editParagraph: jest.fn(() => Promise.resolve("Rewritten paragraph.")),
  publishStory: jest.fn(() => Promise.resolve(undefined)),
}));

const baseStory = stories.find((item) => item.chapters.length > 1)!;

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

it("does not show the Edit control for a story the reader does not own", async () => {
  const view = await render(<ReaderScreen story={baseStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  expect(view.queryByLabelText("Edit")).toBeNull();
  // Reimagine is not author-only: a reader rewrites into a private copy of
  // their own (created-flow spec §4), so the control stays.
  expect(view.getByLabelText("Reimagine")).toBeTruthy();
});

it("opens the editor for a story the reader owns and lets them save a manual edit", async () => {
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });

  await waitFor(() => expect(view.getByText("Edit Story")).toBeTruthy());
  expect(view.getByLabelText("Chapter text")).toBeTruthy();

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close editor"));
  });

  await waitFor(() => expect(view.queryByText("Edit Story")).toBeNull());
});

it("round-trips a chapter with a deliberately blank paragraph, preserving every paragraph's index (finding 6)", async () => {
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });
  await waitFor(() => expect(view.getByLabelText("Chapter text")).toBeTruthy());

  // Paragraph 0, an intentionally blank paragraph 1, then paragraph 2 - the
  // exact `join("\n\n")` shape a real chapter with a deliberate blank line
  // between two paragraphs would produce.
  const withBlankParagraph = "Paragraph zero.\n\n\n\nParagraph two.";
  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), withBlankParagraph);
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close editor"));
  });
  await waitFor(() => expect(view.queryByText("Edit Story")).toBeNull());

  // Reopen: the closed editor's text becomes `chapter.paragraphs` by way of
  // the reader's own split/join round trip. Before the fix, splitting on
  // `/\n\s*\n/` and filtering empty parts collapsed the blank paragraph away
  // and pulled "Paragraph two." from index 2 down to index 1 - exactly the
  // index shift that would point the AI editor at the wrong paragraph.
  // (The chrome is still visible from the earlier toggle - closing the
  // editor does not hide it - so there is no second toggle to press here.)
  await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });

  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(withBlankParagraph)
  );
});
