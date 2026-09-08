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

function makeMockSound(): MockSound {
  return {
    playAsync: jest.fn(() => Promise.resolve()),
    pauseAsync: jest.fn(() => Promise.resolve()),
    unloadAsync: jest.fn(() => Promise.resolve()),
    setStatusAsync: jest.fn(() => Promise.resolve()),
  };
}

jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(),
    },
  },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

// One fixture track tagged with story-1's genre ("adventure"), so it sorts
// first in the picker and is reachable by an accessible label in tests.
jest.mock("@/lib/music-catalogue", () => {
  const actual = jest.requireActual("@/lib/music-catalogue");
  return {
    ...actual,
    MUSIC_TRACKS: [
      { id: "calm-tide", title: "Calm Tide", genres: ["adventure"], source: { uri: "https://example.com/calm-tide.mp3" } },
    ],
  };
});

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const createAsyncMock = Audio.Sound.createAsync as unknown as jest.Mock;
// story-1: "The Last Lighthouse Keeper", genre "adventure", two chapters,
// and chapter 1 has a narration audioUrl so Listen actually plays.
const story = stories.find((item) => item.chapters.length > 1)!;
const MUSIC_STORAGE_KEY = "katha.reader.music.v1";

let createdSounds: MockSound[] = [];

beforeEach(() => {
  cleanup();
  storage.clear();
  jest.clearAllMocks();
  createdSounds = [];
  createAsyncMock.mockImplementation(() => {
    const sound = makeMockSound();
    createdSounds.push(sound);
    return Promise.resolve({ sound });
  });
});

afterEach(() => {
  cleanup();
});

async function openMusicPicker(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByText("Music"));
  });
}

it("persists a selected track per story", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMusicPicker(view);
  await waitFor(() => expect(view.getByLabelText("Calm Tide")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Calm Tide"));
  });

  await waitFor(() => {
    expect(storage.setItem).toHaveBeenCalledWith(
      MUSIC_STORAGE_KEY,
      JSON.stringify({ [story.id]: "calm-tide" }),
    );
  });
});

it("restores a story's saved track when the reader reopens it", async () => {
  // Simulates reopening a story that already has a saved choice, the same
  // way production restores it: the selection is read from AsyncStorage on
  // mount, not carried over from a live component instance.
  await AsyncStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify({ [story.id]: "calm-tide" }));

  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMusicPicker(view);

  await waitFor(() => {
    expect(view.getByLabelText("Calm Tide, selected")).toBeTruthy();
  });
});

it("selecting None clears a previously selected track", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMusicPicker(view);
  await waitFor(() => expect(view.getByLabelText("Calm Tide")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Calm Tide"));
  });
  await waitFor(() => {
    expect(storage.setItem).toHaveBeenLastCalledWith(
      MUSIC_STORAGE_KEY,
      JSON.stringify({ [story.id]: "calm-tide" }),
    );
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("None"));
  });

  await waitFor(() => {
    expect(storage.setItem).toHaveBeenLastCalledWith(MUSIC_STORAGE_KEY, JSON.stringify({}));
  });
});

it("ducks music when narration starts and restores it when narration stops", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMusicPicker(view);
  await waitFor(() => expect(view.getByLabelText("Calm Tide")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Calm Tide"));
  });
  await waitFor(() => expect(createdSounds).toHaveLength(1));
  const musicSound = createdSounds[0];

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close music"));
  });
  await act(async () => {
    await fireEvent.press(view.getByText("Listen"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Play narration"));
  });
  await waitFor(() => expect(createdSounds).toHaveLength(2));

  await waitFor(() => {
    expect(musicSound.setStatusAsync).toHaveBeenCalledWith({ volume: 0.18 });
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Pause narration"));
  });

  await waitFor(() => {
    expect(musicSound.setStatusAsync).toHaveBeenLastCalledWith({ volume: 1 });
  });
});

it("stops music and releases the audio instance when leaving the story", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openMusicPicker(view);
  await waitFor(() => expect(view.getByLabelText("Calm Tide")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Calm Tide"));
  });
  await waitFor(() => expect(createdSounds).toHaveLength(1));
  const musicSound = createdSounds[0];

  // unmount() is itself async here (it wraps the real teardown in act()), so
  // it must be awaited for the effect cleanup that releases music to run.
  await view.unmount();

  expect(musicSound.unloadAsync).toHaveBeenCalled();
});
