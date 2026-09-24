/**
 * The reader stays responsive: a tap that changes nothing about the prose must
 * not rebuild the prose, and mute must silence the track from the tap itself.
 *
 * Both are regressions the founder felt before anyone measured them -- the
 * music icon took a visible moment to strike through, and the music a moment
 * longer to stop -- because every reader render rebuilt every word of up to
 * five mounted pages, and the sound was only released from an effect that ran
 * after that render had committed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { stories } from "@/data/seed";
import ReaderScreen from "@/screens/ReaderScreen";

type MockSound = {
  playAsync: jest.Mock;
  pauseAsync: jest.Mock;
  unloadAsync: jest.Mock;
  setStatusAsync: jest.Mock;
};

jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("@/lib/music-cache", () => ({
  resolveMusicUri: jest.fn((track: { file: string }) =>
    Promise.resolve(`https://cdn.example.com/music/${track.file}`)),
}));

// One fixture track for story-1's genre, so a track is always chosen and the
// test does not depend on what the live catalogue happens to hold.
jest.mock("@/lib/music-catalogue", () => {
  const actual = jest.requireActual("@/lib/music-catalogue");
  return {
    ...actual,
    MUSIC_TRACKS: [
      { id: "calm_tide_01", title: "Calm Tide", genres: ["adventure"], file: "calm_tide_01.m4a" },
    ],
  };
});

const LOAD = { timeout: 10000 };
const createAsyncMock = Audio.Sound.createAsync as unknown as jest.Mock;
const story = stories.find((item) => item.chapters.length > 1)!;
let createdSounds: MockSound[] = [];

beforeEach(async () => {
  cleanup();
  // Mute is persisted, so one test's mute would open the next one silent.
  await AsyncStorage.clear();
  jest.clearAllMocks();
  createdSounds = [];
  createAsyncMock.mockImplementation(() => {
    const sound: MockSound = {
      playAsync: jest.fn(() => Promise.resolve()),
      pauseAsync: jest.fn(() => Promise.resolve()),
      unloadAsync: jest.fn(() => Promise.resolve()),
      setStatusAsync: jest.fn(() => Promise.resolve()),
    };
    createdSounds.push(sound);
    return Promise.resolve({ sound });
  });
});

afterEach(() => {
  cleanup();
});

async function openChrome(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
}

it("does not rebuild a single word when the chrome or the music toggles", async () => {
  let wordRenders = 0;
  // Stable for the life of the test, as the phrase-capture host's is.
  const renderWord = (word: string) => {
    wordRenders += 1;
    return word;
  };
  const view = await render(
    <ReaderScreen story={story} onBack={jest.fn()} renderWord={renderWord} />,
  );
  await waitFor(() => expect(createdSounds).toHaveLength(1), LOAD);
  expect(wordRenders).toBeGreaterThan(0);

  wordRenders = 0;
  await openChrome(view);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Music"));
  });
  expect(view.getByLabelText("Music, off")).toBeTruthy();

  // Before PageWords, each of these renders re-ran `renderWord` for every
  // word on every mounted page.
  expect(wordRenders).toBe(0);
});

it("still rebuilds the words when the search changes what they show", async () => {
  let wordRenders = 0;
  const renderWord = (word: string) => {
    wordRenders += 1;
    return word;
  };
  const view = await render(
    <ReaderScreen story={story} onBack={jest.fn()} renderWord={renderWord} />,
  );
  await openChrome(view);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });
  wordRenders = 0;
  const firstWord = story.chapters[0].paragraphs[0].split(/\s+/)[0].replace(/\W/g, "");
  await act(async () => {
    await fireEvent.changeText(view.getByLabelText("Find in chapter"), firstWord);
  });
  // The memo must not hold a stale highlight: a page with a new hit redraws.
  expect(wordRenders).toBeGreaterThan(0);
});

it("pauses the playing track from the tap itself, not from a later effect", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1), LOAD);
  await openChrome(view);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Music"));
  });

  // The old path never paused: it waited for the re-render to commit, then
  // unloaded from an effect. The handler now pauses first, then releases.
  expect(createdSounds[0].pauseAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(createdSounds[0].unloadAsync).toHaveBeenCalledTimes(1), LOAD);
  expect(view.getByLabelText("Music, off")).toBeTruthy();
});

it("drops a track that finished loading after the reader had already muted", async () => {
  let finishLoad: () => void = () => {};
  const late: MockSound = {
    playAsync: jest.fn(() => Promise.resolve()),
    pauseAsync: jest.fn(() => Promise.resolve()),
    unloadAsync: jest.fn(() => Promise.resolve()),
    setStatusAsync: jest.fn(() => Promise.resolve()),
  };
  createAsyncMock.mockImplementationOnce(() => new Promise((resolve) => {
    finishLoad = () => resolve({ sound: late });
  }));

  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createAsyncMock).toHaveBeenCalledTimes(1), LOAD);
  await openChrome(view);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Music"));
  });

  await act(async () => {
    finishLoad();
  });
  await waitFor(() => expect(late.unloadAsync).toHaveBeenCalled(), LOAD);
  // Never faded up: a muted reader hears nothing, not a blip.
  expect(late.setStatusAsync).not.toHaveBeenCalled();
});
