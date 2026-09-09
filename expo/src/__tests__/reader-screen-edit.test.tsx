/**
 * Who gets Edit and Reimagine, and when.
 *
 * Edit is the author's, over a chapter that is finished. Reimagine is
 * everybody's - a reader of somebody else's story gets a private copy - and is
 * likewise offered only once there is a whole chapter to reimagine. Neither is
 * ever rendered disabled: a greyed control mid-generation is a question the
 * writer cannot answer, so both are simply absent until the chapter lands.
 */

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
jest.mock("@/lib/chapter-save", () => ({
  saveChapter: jest.fn(() => Promise.resolve({ titleSaved: true })),
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
});

it("offers Reimagine to a reader who did not write the story", async () => {
  const onReimagine = jest.fn();
  const view = await render(
    <ReaderScreen story={baseStory} onBack={jest.fn()} onReimagine={onReimagine} />,
  );

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Reimagine"));
  });

  expect(onReimagine).toHaveBeenCalledTimes(1);
});

it("opens the notepad for a story the reader owns and closes it again", async () => {
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });

  await waitFor(() => expect(view.getByText("Edit chapter")).toBeTruthy());
  expect(view.getByLabelText("Chapter text")).toBeTruthy();

  await act(async () => {
    await fireEvent.press(view.getByTestId("edit-chapter-back"));
  });
  await waitFor(() => expect(view.queryByText("Edit chapter")).toBeNull());
});

it("round-trips a chapter with a deliberately blank paragraph, preserving every paragraph's index", async () => {
  jest.useFakeTimers();
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });
  await waitFor(() => expect(view.getByLabelText("Chapter text")).toBeTruthy());

  // Paragraph 0, an intentionally blank paragraph 1, then paragraph 2 - the
  // exact `join("\n\n")` shape a real chapter with a deliberate blank line
  // between two paragraphs produces. Splitting on `/\n\s*\n/` and dropping
  // empty parts would collapse the blank one away and pull "Paragraph two."
  // down an index.
  const withBlankParagraph = "Paragraph zero.\n\n\n\nParagraph two.";
  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), withBlankParagraph);
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });
  await act(async () => {
    jest.runAllTimers();
  });
  await waitFor(() => expect(view.queryByText("Edit chapter")).toBeNull());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });
  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(withBlankParagraph)
  );
  jest.useRealTimers();
});
