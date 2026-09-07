/**
 * Tap-to-save phrase capture, wired into the reader through the
 * `renderWord` seam. `savePhrase`/`unsavePhrase`/`listSavedPhrases` are
 * mocked so these tests exercise the tap/long-press/toggle/rollback
 * behaviour on its own terms - `phrases-lib*.test.ts` cover what those
 * functions actually do against local storage and a reachable server.
 */
jest.mock(
  "@react-native-async-storage/async-storage",
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
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

const mockSavePhrase = jest.fn();
const mockUnsavePhrase = jest.fn();
const mockListSavedPhrases = jest.fn();

jest.mock("@/lib/phrases", () => {
  const actual = jest.requireActual("@/lib/phrases");
  return {
    ...actual,
    savePhrase: (...args: [unknown]) => mockSavePhrase(...args),
    unsavePhrase: (...args: [string]) => mockUnsavePhrase(...args),
    listSavedPhrases: () => mockListSavedPhrases(),
  };
});

/* eslint-disable import/first */
import React from "react";
import { AccessibilityInfo, Alert } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import PhraseCaptureReader from "@/components/reader/PhraseCaptureReader";
import type { SavedPhrase } from "@/lib/phrases";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

const SENTENCE = "The lighthouse stood alone on the point.";

const STORY: Story = {
  id: "story-1",
  title: "The Last Lighthouse",
  authorId: "author-1",
  genre: "adventure",
  synopsis: "A quiet coastal story.",
  chapters: [{
    id: "chapter-1",
    storyId: "story-1",
    title: "Chapter one",
    paragraphs: [
      `${SENTENCE} Waves crashed against the old stone wall. Nobody came to visit anymore.`,
    ],
    chapterNumber: 1,
    isPublished: true,
  }],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

// "The"=0 "lighthouse"=1 "stood"=2 "alone"=3 "on"=4 "the"=5 "point."=6 ...
const LIGHTHOUSE_WORD = "reader-word-1";

function savedRecord(over: Partial<SavedPhrase> = {}): SavedPhrase {
  const now = new Date().toISOString();
  return {
    id: "saved-1",
    phrase: "lighthouse",
    sentence: SENTENCE,
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
  mockListSavedPhrases.mockResolvedValue([]);
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("tapping a word calls save exactly once, with that word as the phrase", async () => {
  mockSavePhrase.mockResolvedValueOnce(savedRecord());
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });

  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));
  expect(mockSavePhrase).toHaveBeenCalledWith(expect.objectContaining({
    phrase: "lighthouse",
    storyId: "story-1",
    chapterId: "chapter-1",
  }));
});

it("long-press saves the surrounding sentence, not just the word", async () => {
  mockSavePhrase.mockResolvedValueOnce(savedRecord({ id: "saved-2", phrase: SENTENCE, sentence: SENTENCE }));
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent(view.getByTestId(LIGHTHOUSE_WORD), "longPress");
  });

  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));
  const [call] = mockSavePhrase.mock.calls[0];
  expect(call.phrase).toBe(SENTENCE);
  expect(call.phrase).not.toBe("lighthouse");
});

it("tapping an already-saved phrase unsaves it", async () => {
  mockSavePhrase.mockResolvedValueOnce(savedRecord());
  mockUnsavePhrase.mockResolvedValueOnce(true);
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });
  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));

  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });

  await waitFor(() => expect(mockUnsavePhrase).toHaveBeenCalledTimes(1));
  expect(mockUnsavePhrase).toHaveBeenCalledWith("saved-1");
  expect(mockSavePhrase).toHaveBeenCalledTimes(1);
});

it("rolls back and never alerts when a save fails", async () => {
  mockSavePhrase.mockResolvedValueOnce(null);
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });
  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));

  // The optimistic save was rolled back: tapping the same word again saves
  // it again rather than unsaving it, proving the UI no longer thinks it is
  // saved.
  mockSavePhrase.mockResolvedValueOnce(savedRecord());
  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });

  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(2));
  expect(mockUnsavePhrase).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it("de-dupes a second tap on the same word while the first save is still in flight", async () => {
  let resolveSave: (value: SavedPhrase) => void = () => {};
  mockSavePhrase.mockReturnValueOnce(new Promise((resolve) => {
    resolveSave = resolve;
  }));
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  // The handler that queues the save runs synchronously inside `fireEvent`,
  // so by the time this first `await` settles, the in-flight guard for this
  // word is already set - the unresolved mock promise above is what keeps it
  // set for the second tap below to run into.
  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });
  await act(async () => {
    await fireEvent.press(view.getByTestId(LIGHTHOUSE_WORD));
  });

  expect(mockSavePhrase).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSave(savedRecord());
    await Promise.resolve();
  });
});

it("still highlights search matches when this custom renderWord is supplied", async () => {
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });
  await act(async () => {
    await fireEvent.changeText(view.getByLabelText("Find in chapter"), "lighthouse");
  });

  await waitFor(() => {
    expect(view.getByText("1 of 1")).toBeTruthy();
  });
});
