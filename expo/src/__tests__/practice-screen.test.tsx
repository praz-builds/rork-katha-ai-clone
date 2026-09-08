/**
 * The Practice surface in Library: a list of every saved phrase with the
 * sentence and story it came from, plus a short pass over whatever is due.
 */
const mockListSavedPhrases = jest.fn();
const mockRecordPracticeOutcome = jest.fn();
const mockUnsavePhrase = jest.fn();

jest.mock("@/lib/phrases", () => {
  const actual = jest.requireActual("@/lib/phrases");
  return {
    ...actual,
    listSavedPhrases: () => mockListSavedPhrases(),
    recordPracticeOutcome: (...args: [string, "know" | "again"]) =>
      mockRecordPracticeOutcome(...args),
    unsavePhrase: (...args: [string]) => mockUnsavePhrase(...args),
  };
});

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import PracticeScreen from "@/screens/PracticeScreen";
import type { SavedPhrase } from "@/lib/phrases";
/* eslint-enable import/first */

function phrase(over: Partial<SavedPhrase> & { id: string }): SavedPhrase {
  const now = new Date().toISOString();
  return {
    phrase: "lighthouse",
    sentence: "The old lighthouse stood alone.",
    storyId: "story-1",
    storyTitle: "The Last Lighthouse",
    chapterId: "chapter-1",
    createdAt: now,
    dueAt: now,
    reviewCount: 0,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockUnsavePhrase.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

it("explains how to save a phrase when nothing has been saved yet", async () => {
  mockListSavedPhrases.mockResolvedValueOnce([]);
  const view = await render(<PracticeScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText("Nothing saved yet")).toBeTruthy();
  });
  expect(view.getByText(/tap a word to save it/i)).toBeTruthy();
});

it("lists every saved phrase with the sentence and story it came from", async () => {
  mockListSavedPhrases.mockResolvedValueOnce([
    phrase({
      id: "p1",
      phrase: "lighthouse",
      sentence: "The old lighthouse stood alone.",
      storyTitle: "The Last Lighthouse",
      dueAt: new Date(Date.now() + 100_000_000).toISOString(), // not due
    }),
  ]);
  const view = await render(<PracticeScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText("The old lighthouse stood alone.")).toBeTruthy();
  });
  expect(view.getByText("The Last Lighthouse")).toBeTruthy();
  expect(view.getAllByText("lighthouse").length).toBeGreaterThan(0);
});

it("records exactly one practice request per answer", async () => {
  mockListSavedPhrases.mockResolvedValueOnce([
    phrase({ id: "p1", phrase: "lighthouse" }),
    phrase({ id: "p2", phrase: "harbor", sentence: "The harbor was quiet." }),
  ]);
  mockRecordPracticeOutcome.mockResolvedValue(undefined);
  const view = await render(<PracticeScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByText("1 of 2")).toBeTruthy();
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Got this phrase"));
  });

  await waitFor(() => {
    expect(mockRecordPracticeOutcome).toHaveBeenCalledTimes(1);
  });
  expect(mockRecordPracticeOutcome).toHaveBeenCalledWith("p1", "know");

  await waitFor(() => {
    expect(view.getByText("2 of 2")).toBeTruthy();
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Still learning this phrase"));
  });

  await waitFor(() => {
    expect(mockRecordPracticeOutcome).toHaveBeenCalledTimes(2);
  });
  expect(mockRecordPracticeOutcome).toHaveBeenNthCalledWith(2, "p2", "again");
});

it("shows a caught-up state once every due phrase has been answered", async () => {
  mockListSavedPhrases.mockResolvedValueOnce([phrase({ id: "p1" })]);
  mockRecordPracticeOutcome.mockResolvedValue(undefined);
  const view = await render(<PracticeScreen onBack={jest.fn()} />);

  await waitFor(() => expect(view.getByText("1 of 1")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Got this phrase"));
  });

  await waitFor(() => {
    expect(view.getByText("1 phrase practised")).toBeTruthy();
  });
});

it("removes a phrase from the list", async () => {
  mockListSavedPhrases.mockResolvedValueOnce([
    phrase({ id: "p1", phrase: "lighthouse", dueAt: new Date(Date.now() + 100_000_000).toISOString() }),
  ]);
  const view = await render(<PracticeScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(view.getByLabelText('Remove "lighthouse" from saved phrases')).toBeTruthy();
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText('Remove "lighthouse" from saved phrases'));
  });

  await waitFor(() => {
    expect(mockUnsavePhrase).toHaveBeenCalledWith("p1");
  });
});


// Removing a phrase the cursor has already passed shifted the due queue left
// under it, so the cursor then pointed one PAST the next due phrase and that
// phrase was silently skipped for the rest of the session. The reader never saw
// it come up, and nothing indicated why.
it("does not skip the next due phrase when an earlier one is removed", async () => {
  mockListSavedPhrases.mockResolvedValue([
    phrase({ id: "p1", phrase: "first" }),
    phrase({ id: "p2", phrase: "second" }),
    phrase({ id: "p3", phrase: "third" }),
  ]);

  const view = await render(<PracticeScreen onBack={jest.fn()} />);
  await waitFor(() => expect(view.getAllByText("first").length).toBeGreaterThan(0));

  // Answer the first, so the cursor sits at index 1.
  await fireEvent.press(view.getByLabelText("Got this phrase"));
  await waitFor(() => expect(view.getAllByText("second").length).toBeGreaterThan(0));

  // Remove the ALREADY-ANSWERED phrase, which sits before the cursor.
  await act(async () => {
    fireEvent.press(
      view.getByLabelText('Remove "first" from saved phrases'),
    );
  });

  // The queue shifted left, so without moving the cursor with it the screen
  // would jump from "second" to "third" and never show "second" again.
  await waitFor(() => expect(view.getAllByText("second").length).toBeGreaterThan(0));
});
