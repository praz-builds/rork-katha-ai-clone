/**
 * The reader's own "..." (D13): the same report sheet the story page has,
 * reachable from inside the book without leaving it, and wired to the story
 * the reader is holding.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

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
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, auth: {} },
  isSupabaseConfigured: true,
}));
jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return {
    ...actual,
    fetchThread: jest.fn(() => Promise.resolve([])),
    reportContent: jest.fn(() => Promise.resolve({ ok: true })),
    blockAuthor: jest.fn(() => Promise.resolve({ ok: true })),
  };
});

/* eslint-disable import/first */
import { stories } from "@/data/seed";
import ReaderScreen from "@/screens/ReaderScreen";
import { blockAuthor, reportContent } from "@/lib/comments";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const story = stories.find((item) => item.chapters.length > 1)!;

beforeEach(() => {
  cleanup();
  storage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/**
 * Open the reader's "..." and wait for the sheet.
 *
 * The parameter is `Awaited<ReturnType<typeof render>>`: this version of
 * @testing-library/react-native renders on a concurrent root, so `render`
 * returns a promise and the bare `ReturnType` is that promise, not the
 * queries.
 */
const openMore = async (view: Awaited<ReturnType<typeof render>>) => {
  await act(async () => {
    await fireEvent.press(view.getAllByLabelText("More options")[0]);
  });
  await waitFor(() => expect(view.getByLabelText("Report story")).toBeTruthy());
};

it("offers a More options entry on the page, without the chrome open", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  expect(view.getAllByLabelText("More options").length).toBeGreaterThan(0);
  expect(view.queryByLabelText("Report story")).toBeNull();
});

it("opens the report sheet for THIS story and files the chosen reason", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMore(view);

  // The reader's own header already carries the title, so the sheet's copy of
  // it is the second match, not the only one.
  expect(view.getAllByText(story.title).length).toBeGreaterThan(0);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Report story"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Inappropriate story content"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Submit report"));
  });

  await waitFor(() =>
    expect(reportContent).toHaveBeenCalledWith(
      { storyId: story.id },
      "inappropriate_content",
      "",
    )
  );
  await waitFor(() => expect(view.getByText("Story reported")).toBeTruthy());
});

it("routes to sign-in instead of filing when the host gates the action", async () => {
  const onRequireSignIn = jest.fn();
  const view = await render(
    <ReaderScreen
      story={story}
      onBack={jest.fn()}
      onRequireSignIn={onRequireSignIn}
    />,
  );
  await openMore(view);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Report story"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Other"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Submit report"));
  });

  await waitFor(() => expect(onRequireSignIn).toHaveBeenCalled());
  expect(reportContent).not.toHaveBeenCalled();
  expect(view.queryByText("Story reported")).toBeNull();
});

it("blocks the author and leaves the reader", async () => {
  const onBack = jest.fn();
  const view = await render(<ReaderScreen story={story} onBack={onBack} />);
  await openMore(view);
  const authorRow = view.getByLabelText(/^Block /);
  await act(async () => {
    await fireEvent.press(authorRow);
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText(/^Confirm block /));
  });

  await waitFor(() => expect(blockAuthor).toHaveBeenCalledWith(story.authorId));
  expect(onBack).toHaveBeenCalled();
});
