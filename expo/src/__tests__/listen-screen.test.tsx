import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import ListenScreen from "@/screens/ListenScreen";
import { pollNarration, requestNarration } from "@/lib/narration";
import type { Chapter, Story } from "@/types/domain";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("@/lib/narration", () => ({
  requestNarration: jest.fn(),
  pollNarration: jest.fn(),
}));

/**
 * The sound, with its status callback exposed.
 *
 * The screen only learns the file's duration from that callback, and the
 * duration is the whole input to the transcript's cue maths -- so a test that
 * cannot fire it cannot exercise the highlight at all. The `mock` prefix is
 * what lets these survive `jest.mock`'s hoisting.
 */
const mockSound = {
  playAsync: jest.fn(),
  pauseAsync: jest.fn(),
  unloadAsync: jest.fn(),
  setPositionAsync: jest.fn(),
  setRateAsync: jest.fn(),
};
const mockStatus: {
  callback: ((status: Record<string, unknown>) => void) | null;
} = { callback: null };

jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(
        (
          _source: unknown,
          _initial: unknown,
          callback: (status: Record<string, unknown>) => void,
        ) => {
          mockStatus.callback = callback;
          return Promise.resolve({ sound: mockSound });
        },
      ),
    },
  },
}));

const requestMock = requestNarration as jest.MockedFunction<typeof requestNarration>;
const pollMock = pollNarration as jest.MockedFunction<typeof pollNarration>;

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "chapter-1",
    storyId: "story-1",
    title: "The Crossing",
    chapterNumber: 1,
    isPublished: true,
    paragraphs: [
      "She opened the door. The hallway was dark.",
      "Somewhere below, a clock struck three.",
    ],
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "The Salt Road",
    authorId: "author-1",
    genre: "mystery",
    language: "English",
    likes: 0,
    bookmarks: 0,
    views: 0,
    comments: 0,
    createdAt: new Date().toISOString(),
    chapters: [makeChapter()],
    ...overrides,
  } as Story;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus.callback = null;
  requestMock.mockResolvedValue({ kind: "pending" });
  pollMock.mockResolvedValue({ kind: "pending" });
});

describe("a chapter nobody has listened to yet", () => {
  it("lands on the preparing screen and asks for the narration, instead of apologising", async () => {
    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith({
      storyId: "story-1",
      chapterId: "chapter-1",
      voiceId: "aria",
    });
    expect(view.getByTestId("narration-loader")).toBeTruthy();
    // The status line moved off "checking" because the server actually
    // accepted the job, not because a timer fired.
    await waitFor(() =>
      expect(view.getByText("Reading the chapter aloud")).toBeTruthy()
    );
    expect(
      view.getByText("First listen only. This usually takes under a minute."),
    ).toBeTruthy();
  });

  it("swaps to the transcript and the player once the poll says the audio is ready", async () => {
    pollMock.mockResolvedValue({
      kind: "ready",
      audioUrl: "https://audio/ch1.mp3",
      cached: false,
    });

    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    await waitFor(
      () => expect(view.getByTestId("listen-player-bar")).toBeTruthy(),
      { timeout: 15000 },
    );
    expect(view.queryByTestId("narration-loader")).toBeNull();
    expect(view.getByTestId("transcript-scroll")).toBeTruthy();
    expect(view.getByText("She opened the door.")).toBeTruthy();
  }, 20000);
});

describe("a chapter that already has narration", () => {
  it("plays it without asking the server to generate anything", async () => {
    const story = makeStory({
      chapters: [makeChapter({ audioUrls: { female: "https://audio/cached.mp3" } })],
    });
    const view = await render(<ListenScreen story={story} onClose={jest.fn()} />);

    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    expect(requestMock).not.toHaveBeenCalled();
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("highlights the line the narration is on, and dims what is behind it", async () => {
    const story = makeStory({
      chapters: [makeChapter({ audioUrl: "https://audio/cached.mp3" })],
    });
    const view = await render(<ListenScreen story={story} onClose={jest.fn()} />);
    await waitFor(() => expect(mockStatus.callback).not.toBeNull());

    // A measured 30s file, with the playhead most of the way through the
    // second of three lines.
    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 14_000,
        durationMillis: 30_000,
      });
    });

    const active = view.getByTestId("transcript-line-1");
    expect(active.props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId("transcript-line-0").props.accessibilityState.selected)
      .toBe(false);
    expect(view.getByText("0:14")).toBeTruthy();
    expect(view.getByText("0:30")).toBeTruthy();
  });
});

describe("the endings that are not a failure", () => {
  it("explains an entitlement refusal and offers reading instead of a retry that cannot work", async () => {
    requestMock.mockResolvedValue({
      kind: "unavailable",
      message: "Narration unlock is not available yet",
    });
    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    await waitFor(() =>
      expect(view.getByText("Narration is not available yet")).toBeTruthy()
    );
    expect(view.getByLabelText("Read it instead")).toBeTruthy();
    expect(view.queryByLabelText("Try again")).toBeNull();
    // Nothing is being polled for a refusal.
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("says plainly that there is no connection, and offers another go", async () => {
    requestMock.mockResolvedValue({ kind: "offline" });
    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    await waitFor(() => expect(view.getByText("No connection")).toBeTruthy());
    expect(view.getByLabelText("Try again")).toBeTruthy();
  });

  it("retries the whole acquisition, not just the poll, after a failure", async () => {
    requestMock.mockResolvedValue({ kind: "failed", errorCode: "provider_failed" });
    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    await waitFor(() =>
      expect(view.getByText("The narration did not finish")).toBeTruthy()
    );
    expect(requestMock).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText("Try again"));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
  });
});

describe("leaving", () => {
  it("stops the audio when the player is closed", async () => {
    const onClose = jest.fn();
    const story = makeStory({
      chapters: [makeChapter({ audioUrl: "https://audio/cached.mp3" })],
    });
    const view = await render(<ListenScreen story={story} onClose={onClose} />);
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    await fireEvent.press(view.getByLabelText("Close player"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockSound.unloadAsync).toHaveBeenCalled());
  });
});
