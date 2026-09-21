import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Audio } from "expo-av";
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

/**
 * A two-chapter story whose first chapter is already narrated.
 *
 * `nextNarrated` is the difference between the two things being tested here:
 * an instant chapter boundary (cached) and one that has to be paid for
 * (prefetch).
 */
function makeTwoChapterStory(nextNarrated = true): Story {
  return makeStory({
    chapters: [
      makeChapter({ audioUrl: "https://audio/ch1.mp3" }),
      makeChapter({
        id: "chapter-2",
        title: "The Salt Flats",
        chapterNumber: 2,
        ...(nextNarrated ? { audioUrl: "https://audio/ch2.mp3" } : {}),
      }),
    ],
  });
}

/** Long enough for a poll interval to have fired if one were running. */
const POLL_GRACE_MS = 3_500;

/** Play the current chapter to its end. */
async function finishChapter(): Promise<void> {
  await act(async () => {
    mockStatus.callback?.({
      isLoaded: true,
      isPlaying: false,
      positionMillis: 30_000,
      durationMillis: 30_000,
      didJustFinish: true,
    });
  });
}

describe("one chapter ending is the next one starting", () => {
  it("moves into the next chapter by itself, still playing, with nothing pressed", async () => {
    const view = await render(
      <ListenScreen story={makeTwoChapterStory()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    expect(view.getByText("The Crossing")).toBeTruthy();

    await finishChapter();

    await waitFor(() => expect(view.getByText("The Salt Flats")).toBeTruthy());
    // Still playing: the chain is the point. A reader who has to press play at
    // every chapter boundary does not have an audiobook.
    await waitFor(() =>
      expect(view.getByLabelText("Pause narration")).toBeTruthy()
    );
    expect(view.queryByText(/That's the end of/)).toBeNull();
  });

  it("stops where it is when autoplay is off, exactly as it used to", async () => {
    const view = await render(
      <ListenScreen story={makeTwoChapterStory()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText("Autoplay next chapter"));
    });

    await finishChapter();

    expect(view.getByText("The Crossing")).toBeTruthy();
    expect(view.getByLabelText("Play narration")).toBeTruthy();
    expect(view.queryByText(/That's the end of/)).toBeNull();
  });

  it("does not stop the chapter that is playing when autoplay is turned off", async () => {
    const story = makeStory({
      chapters: [makeChapter({ audioUrl: "https://audio/ch1.mp3" })],
    });
    const view = await render(<ListenScreen story={story} onClose={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 5_000,
        durationMillis: 30_000,
      });
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Autoplay next chapter"));
    });

    // "Stop after this", not "stop now".
    expect(view.getByLabelText("Pause narration")).toBeTruthy();
    expect(mockSound.pauseAsync).not.toHaveBeenCalled();
  });

  it("says the story is over rather than falling silent on the last chapter", async () => {
    const story = makeStory({
      chapters: [makeChapter({ audioUrl: "https://audio/ch1.mp3" })],
    });
    const view = await render(<ListenScreen story={story} onClose={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    await finishChapter();

    await waitFor(() =>
      expect(view.getByText("That's the end of The Salt Road.")).toBeTruthy()
    );
    expect(view.getByLabelText("Close")).toBeTruthy();
  });
});

describe("a chapter that can be heard before it is finished", () => {
  it("plays the first chunk and keeps polling for the rest", async () => {
    requestMock.mockResolvedValue({
      kind: "pending",
      manifest: {
        chunks: 3,
        entries: [
          {
            index: 0,
            url: "https://audio/chunk-0.mp3",
            durationMs: 45_000,
            charCount: 9_000,
          },
        ],
        pending: [
          { index: 1, charCount: 9_000 },
          { index: 2, charCount: 4_780 },
        ],
      },
    });
    pollMock.mockResolvedValue({ kind: "pending" });

    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );

    // Playing at chunk 0, instead of waiting for the whole chapter.
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    const createAsync = Audio.Sound.createAsync as jest.Mock;
    expect(createAsync.mock.calls[0][0]).toEqual({
      uri: "https://audio/chunk-0.mp3",
    });
    // And still polling -- the later chunks' urls arrive nowhere else.
    await waitFor(() => expect(pollMock).toHaveBeenCalled(), { timeout: 8000 });
  }, 20000);

  it("names the chapter that could not finish instead of hanging at the end of chunk 0", async () => {
    // The reader is already listening to chunk 0 when chunk 1 fails at the
    // provider. `failNarration` deletes the parts, so nothing further is ever
    // coming -- and "never fail backwards out of playback" used to leave them
    // with silence, a playhead parked at the end and a poll every 2.5s.
    requestMock.mockResolvedValue({
      kind: "pending",
      manifest: {
        chunks: 3,
        entries: [
          {
            index: 0,
            url: "https://audio/chunk-0.mp3",
            durationMs: 45_000,
            charCount: 9_000,
          },
        ],
        pending: [
          { index: 1, charCount: 9_000 },
          { index: 2, charCount: 4_780 },
        ],
      },
    });
    pollMock.mockResolvedValue({ kind: "failed", errorCode: "gpu_oom" });

    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    await waitFor(
      () => expect(view.getByText("The narration did not finish")).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(view.getByTestId("narration-loader-context").props.children).toBe(
      "Chapter 1: The Crossing",
    );

    // And the audio stops with it. Narration playing behind a screen that
    // says the narration did not finish leaves no transport to stop it.
    expect(mockSound.unloadAsync).toHaveBeenCalled();

    // And the poll stops: a terminal row has nothing more to say.
    const pollsAtFailure = pollMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, POLL_GRACE_MS));
    expect(pollMock.mock.calls.length).toBe(pollsAtFailure);
  }, 20000);

  it("plays the stitched file, and stops polling, when there is no manifest", async () => {
    requestMock.mockResolvedValue({
      kind: "ready",
      audioUrl: "https://audio/whole.mp3",
      cached: false,
    });

    const view = await render(
      <ListenScreen story={makeStory()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    const createAsync = Audio.Sound.createAsync as jest.Mock;
    expect(createAsync.mock.calls[0][0]).toEqual({ uri: "https://audio/whole.mp3" });
    await new Promise((resolve) => setTimeout(resolve, POLL_GRACE_MS));
    expect(pollMock).not.toHaveBeenCalled();
  }, 20000);
});

describe("narrating the next chapter before the reader gets there", () => {
  it("asks for it halfway through, and says it is a prefetch", async () => {
    const view = await render(
      <ListenScreen story={makeTwoChapterStory(false)} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    requestMock.mockResolvedValue({ kind: "pending" });

    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 61_000,
        durationMillis: 120_000,
      });
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock).toHaveBeenCalledWith({
      storyId: "story-1",
      chapterId: "chapter-2",
      voiceId: "aria",
      purpose: "prefetch",
    });
  });

  it("changes nothing the reader can see when the server refuses it", async () => {
    requestMock.mockResolvedValue({
      kind: "unavailable",
      message: "Prefetch is not enabled",
    });
    const view = await render(
      <ListenScreen story={makeTwoChapterStory(false)} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 61_000,
        durationMillis: 120_000,
      });
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    // A 503 on a prefetch is the server's deliberate answer, not news for the
    // reader: still playing, still on this chapter, no refusal screen.
    expect(view.getByTestId("listen-player-bar")).toBeTruthy();
    expect(view.queryByTestId("narration-loader")).toBeNull();
    expect(view.queryByText("Narration is not available yet")).toBeNull();
    expect(view.getByText("The Crossing")).toBeTruthy();
  });

  it("asks only once, however far the reader scrubs back and forth", async () => {
    const view = await render(
      <ListenScreen story={makeTwoChapterStory(false)} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());
    requestMock.mockResolvedValue({ kind: "pending" });

    for (const positionMillis of [61_000, 20_000, 70_000, 80_000]) {
      await act(async () => {
        mockStatus.callback?.({
          isLoaded: true,
          isPlaying: true,
          positionMillis,
          durationMillis: 120_000,
        });
      });
    }

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // Each prefetch is a real RunPod job. Twice is twice the money for one
    // chapter of audio.
    expect(requestMock).toHaveBeenCalledTimes(1);
  });


  it("starts no background poll when the reader has left the chapter it was for", async () => {
    // Three chapters, and only the middle one needs paying for. The reader
    // triggers its prefetch and then jumps PAST it, which is the ordinary way
    // to leave a request in flight.
    const story = makeStory({
      chapters: [
        makeChapter({ audioUrl: "https://audio/ch1.mp3" }),
        makeChapter({
          id: "chapter-2",
          title: "The Salt Flats",
          chapterNumber: 2,
        }),
        makeChapter({
          id: "chapter-3",
          title: "The Last Well",
          chapterNumber: 3,
          audioUrl: "https://audio/ch3.mp3",
        }),
      ],
    });
    const view = await render(<ListenScreen story={story} onClose={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    // The prefetch is asked for, and left unresolved.
    let resolvePrefetch: (outcome: { kind: "pending" }) => void = () => {};
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePrefetch = resolve as typeof resolvePrefetch;
      }),
    );
    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 61_000,
        durationMillis: 120_000,
      });
    });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        expect.objectContaining({ chapterId: "chapter-2", purpose: "prefetch" }),
      )
    );

    // The reader moves on before the server answers.
    await act(async () => {
      fireEvent.press(view.getByLabelText("Chapter list"));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Listen to chapter 3: The Last Well"));
    });
    await waitFor(() => expect(view.getByText("The Last Well")).toBeTruthy());

    // ...and only then does the prefetch resolve. The clock is taken over
    // first, so that any interval the callback starts is one this test can
    // actually run.
    jest.useFakeTimers();
    try {
      await act(async () => {
        resolvePrefetch({ kind: "pending" });
      });
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      // **Nothing is polling chapter 2.** The callback used to restore the old
      // target after the arrival cleanup had already cleared it, and the
      // background poll then outlived the thing it was for -- a request every
      // fifteen seconds, for a chapter nobody is on.
      expect(pollMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not prefetch a chapter that is already narrated", async () => {
    const view = await render(
      <ListenScreen story={makeTwoChapterStory()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("listen-player-bar")).toBeTruthy());

    await act(async () => {
      mockStatus.callback?.({
        isLoaded: true,
        isPlaying: true,
        positionMillis: 61_000,
        durationMillis: 120_000,
      });
    });
    // Chapter 2 has a cached url; there is nothing to pay for.
    expect(requestMock).not.toHaveBeenCalled();
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
