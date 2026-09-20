/**
 * Phrase capture is only a feature if a reader can find it.
 *
 * The capture itself has worked since it merged, and `phrase-capture-reader`
 * covers it. What had never been true is that anybody could DISCOVER it: the
 * gesture is invisible, it does not exist at all in a browser
 * (react-native-web drops `Text.onLongPress` -- see the note on `WEB` in
 * `PhraseCaptureReader`), and a screen-reader user is served fluent prose with
 * no per-word stops to press. This file covers the three answers to that: a
 * one-time coach mark, a gesture-free selection mode, and a toast that says
 * where the phrase went.
 */
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

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

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
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import PhraseCaptureReader from "@/components/reader/PhraseCaptureReader";
import type { SavedPhrase } from "@/lib/phrases";
import { selectionTextFrom, wordCountOf } from "@/lib/text-selection";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

const COACH_KEY = "katha.reader.phraseCoach.v1";
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

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

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

beforeEach(async () => {
  cleanup();
  jest.clearAllMocks();
  mockSavePhrase.mockReset();
  mockUnsavePhrase.mockReset();
  mockListSavedPhrases.mockResolvedValue([]);
  // The shared in-memory AsyncStorage mock survives between tests, and the
  // coach mark's whole contract is "once, ever" -- a leftover key from an
  // earlier test would make the next one pass for the wrong reason.
  await storage.clear();
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("tells a first-time reader the gesture exists", async () => {
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await waitFor(() => expect(view.getByTestId("phrase-coach")).toBeTruthy());
  expect(view.getByTestId("phrase-coach")).toBeTruthy();
});

it("never shows the coach mark a second time", async () => {
  await storage.setItem(COACH_KEY, "seen");

  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);
  // Let the storage read resolve; the mark appears only after it comes back
  // empty, so waiting is what makes the negative meaningful.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(view.queryByTestId("phrase-coach")).toBeNull();
});

it("burns the flag when the reader dismisses it, so the next launch is quiet", async () => {
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByTestId("phrase-coach")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByTestId("phrase-coach-dismiss"));
  });

  expect(view.queryByTestId("phrase-coach")).toBeNull();
  await waitFor(() =>
    expect(storage.setItem).toHaveBeenCalledWith(COACH_KEY, "seen")
  );
});

/**
 * The writer watching their own chapter appear is not the audience for a
 * reading tip, and -- the part that matters -- they must not SPEND their one
 * showing on it. The flag stays unwritten, so the same reader still gets the
 * mark on a finished chapter later.
 */
it("stays quiet during a live generation, without spending the one showing", async () => {
  const view = await render(
    <PhraseCaptureReader story={STORY} onBack={jest.fn()} liveSessionId="session-1" />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(view.queryByTestId("phrase-coach")).toBeNull();
  expect(storage.setItem).not.toHaveBeenCalledWith(COACH_KEY, "seen");
});

it("the save toast says where the phrase went", async () => {
  mockSavePhrase.mockResolvedValueOnce(savedRecord());
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-word-1"));
  });

  await waitFor(() => expect(view.getByText("Saved to Notes")).toBeTruthy());
});

it("the first save dismisses the coach mark for good", async () => {
  mockSavePhrase.mockResolvedValueOnce(savedRecord());
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByTestId("phrase-coach")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-word-1"));
  });

  await waitFor(() => expect(view.queryByTestId("phrase-coach")).toBeNull());
  await waitFor(() =>
    expect(storage.setItem).toHaveBeenCalledWith(COACH_KEY, "seen")
  );
});

/**
 * THE SCREEN-READER ROUTE, END TO END.
 *
 * With a screen reader running, `renderWord` serves plain text -- there is no
 * word to press and no long-press to make, so before this control the feature
 * was unreachable for them entirely. Pressing it puts the page into a mode
 * where two ordinary taps bound a phrase.
 */
it("offers a gesture-free route while a screen reader is running", async () => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  mockSavePhrase.mockResolvedValueOnce(
    savedRecord({ id: "saved-2", phrase: "The lighthouse stood" }),
  );
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await waitFor(() => expect(view.getByTestId("phrase-capture-entry")).toBeTruthy());
  // Fluent prose until the reader asks otherwise: no per-word stops exist yet.
  expect(view.queryByTestId("reader-word-0")).toBeNull();

  await act(async () => {
    await fireEvent.press(view.getByTestId("phrase-capture-entry"));
  });
  await waitFor(() => expect(view.getByTestId("reader-word-0")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-word-0"));
  });
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-word-2"));
  });
  await act(async () => {
    await fireEvent.press(view.getByTestId("selection-action-save"));
  });

  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));
  expect(mockSavePhrase.mock.calls[0][0].phrase).toBe("The lighthouse stood");
});

it("puts the words in the accessibility tree only inside that mode", async () => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(await view.findByTestId("phrase-capture-entry"));
  });

  const word = await view.findByTestId("reader-word-0");
  expect(word.props.accessible).toBe(true);
  expect(word.props.accessibilityRole).toBe("button");
});

it("Done leaves the mode without saving anything", async () => {
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(await view.findByTestId("phrase-capture-entry"));
  });
  await act(async () => {
    await fireEvent.press(await view.findByTestId("reader-word-0"));
  });
  await act(async () => {
    await fireEvent.press(view.getByTestId("phrase-mode-done"));
  });

  expect(view.queryByTestId("phrase-mode-bar")).toBeNull();
  expect(view.queryByTestId("selection-toolbar")).toBeNull();
  expect(mockSavePhrase).not.toHaveBeenCalled();
});

/*
  THE WEB RESOLVER, TESTED WITHOUT A BROWSER.

  The listener that raises the toolbar from a DOM selection cannot run under
  this (native) test environment, so the part worth testing is the pure
  function it calls: what the browser hands back, turned into a phrase.
*/
describe("the browser's own selection, read as a phrase", () => {
  it("collapses the newlines a multi-line selection carries", () => {
    expect(selectionTextFrom({ toString: () => "  the lighthouse\n  stood alone " }))
      .toBe("the lighthouse stood alone");
  });

  it("reads a collapsed selection, and no selection, as nothing", () => {
    expect(selectionTextFrom({ isCollapsed: true, toString: () => "x" })).toBe("");
    expect(selectionTextFrom(null)).toBe("");
    expect(selectionTextFrom(undefined)).toBe("");
  });

  it("counts the words the toolbar reports", () => {
    expect(wordCountOf("the lighthouse stood")).toBe(3);
    expect(wordCountOf("  ")).toBe(0);
  });
});

/**
 * THE CHROME ROUTE, WHICH IS THE ONE A SIGHTED READER ACTUALLY FINDS.
 *
 * The gesture routes are a long-press on native and a text selection on web,
 * and neither announces itself -- which is the whole reason this round of work
 * exists. The labelled control in the chrome is how somebody learns the
 * feature is there at all.
 *
 * It reaches the chrome by being threaded `PhraseCaptureReader` ->
 * `ReaderScreen` -> `ReaderChrome`, across three files owned by three
 * different changes, and **a prop dropped anywhere along that chain fails
 * silently**: `ReaderChrome` renders nothing when `onSavePhrase` is absent, so
 * the control would simply never appear, the gesture tests would all still
 * pass, and the feature would be exactly as undiscoverable as it was before.
 * That is the failure this test exists to catch.
 */
it("puts a labelled way in on the chrome, and takes it away inside the mode", async () => {
  // No screen reader, so the persistent fallback control is not mounted and
  // anything found here came down the prop chain and nowhere else.
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  const view = await render(<PhraseCaptureReader story={STORY} onBack={jest.fn()} />);

  // The chrome is a transient overlay: it starts hidden, and a tap on the page
  // brings it back. That is how a reader reaches ANY control in it, so the
  // test does what they do rather than reaching past it.
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  // "Save a phrase", not "Save phrase": the chrome control is named apart from
  // the selection toolbar's commit button, which is the one that writes. See
  // `ChromeAction.a11yLabel` for why they must not sound alike.
  const entry = await view.findByLabelText("Save a phrase");
  expect(view.queryByTestId("phrase-capture-entry")).toBeNull();

  expect(view.queryByTestId("phrase-mode-bar")).toBeNull();

  await act(async () => {
    await fireEvent.press(entry);
  });

  // The mode bar, not a word: for a sighted reader every word is a tappable
  // stop whether or not the mode is open, so `reader-word-0` would prove
  // nothing. The bar exists only inside the mode.
  await waitFor(() => expect(view.getByTestId("phrase-mode-bar")).toBeTruthy());

  // And the way in stands down while the reader is standing in it.
  expect(view.queryByLabelText("Save a phrase")).toBeNull();
});
