/**
 * Kept in its own file, deliberately.
 *
 * This regression test has to leave an audio load's promise pending across
 * several other, separately act()-wrapped interactions (see the comment
 * inline below for why) -- an "overlapping act() calls" pattern React
 * itself warns is unsupported. In practice that overlap can leave the
 * shared React/react-test-renderer module state for the rest of the test
 * *file* in a bad enough shape that unrelated later tests fail to render
 * anything. Jest gives each test file its own module registry, so isolating
 * this test here contains that risk to a file with nothing else in it to
 * damage, rather than risking every other reader screen test.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
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

it("discards an audio load that resolves after the chapter has changed, instead of playing it", async () => {
  let resolveLoad!: (value: { sound: { pauseAsync: jest.Mock; playAsync: jest.Mock; unloadAsync: jest.Mock } }) => void;
  const staleLoad = new Promise<{ sound: { pauseAsync: jest.Mock; playAsync: jest.Mock; unloadAsync: jest.Mock } }>((resolve) => {
    resolveLoad = resolve;
  });
  (Audio.Sound.createAsync as jest.Mock).mockImplementationOnce(() => staleLoad);

  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByText("Listen"));
  });

  // Starts the audio load for the current chapter. Deliberately not
  // awaited: its own promise cannot settle until staleLoad resolves below,
  // and awaiting it here (as a real screen tap never would) would block the
  // rest of this test on the very load it exists to delay.
  const pendingPress = fireEvent.press(view.getByLabelText("Play narration"));

  // Switch chapters while that load is still in flight.
  await act(async () => {
    await fireEvent.press(view.getByText("Chapters"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText(`Open chapter 2: ${story.chapters[1].title}`));
  });

  // The load for the chapter the reader already left now resolves.
  const staleUnloadAsync = jest.fn();
  await act(async () => {
    resolveLoad({
      sound: { pauseAsync: jest.fn(), playAsync: jest.fn(), unloadAsync: staleUnloadAsync },
    });
    await pendingPress;
  });

  await waitFor(() => {
    // Discarded, not assigned: the stale sound is unloaded...
    expect(staleUnloadAsync).toHaveBeenCalledTimes(1);
  });
  // ...and playback never started for it.
  expect(view.getByLabelText("Play narration")).toBeTruthy();
  expect(view.queryByLabelText("Pause narration")).toBeNull();
});
