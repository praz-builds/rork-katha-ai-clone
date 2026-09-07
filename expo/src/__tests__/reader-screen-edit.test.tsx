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
  expect(view.queryByLabelText("Reimagine")).toBeNull();
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
