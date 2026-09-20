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

// The cache is exercised by its own suite. Here it resolves to the remote URL
// so these tests assert on what the reader does with a track, not on the file
// system underneath it.
jest.mock("@/lib/music-cache", () => ({
  resolveMusicUri: jest.fn((track: { file: string }) =>
    Promise.resolve(`https://cdn.example.com/music/${track.file}`)),
}));

// Two fixture tracks tagged with story-1's genre ("adventure"), so a per-genre
// default set in Profile can be told apart from the catalogue's own choice.
jest.mock("@/lib/music-catalogue", () => {
  const actual = jest.requireActual("@/lib/music-catalogue");
  return {
    ...actual,
    MUSIC_TRACKS: [
      { id: "calm_tide_01", title: "Calm Tide", genres: ["adventure"], file: "calm_tide_01.m4a" },
      { id: "calm_tide_02", title: "High Water", genres: ["adventure"], file: "calm_tide_02.m4a" },
    ],
  };
});

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const createAsyncMock = Audio.Sound.createAsync as unknown as jest.Mock;
// story-1: "The Last Lighthouse Keeper", genre "adventure", two chapters,
// and chapter 1 has a narration audioUrl so Listen actually plays.
const story = stories.find((item) => item.chapters.length > 1)!;
const MUTED_KEY = "katha.reader.music-muted.v1";
const GENRE_KEY = "katha.reader.music-genre.v1";
// The fade-in runs on real timers (~1.8s), past waitFor's 1s default.
const FADE = { timeout: 4000 };

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

async function openChrome(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
}

it("starts the genre's track when a story opens, fading in and looping", async () => {
  await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1));

  // Looping is what makes this usable at all: a chapter outlasts a 3-minute
  // track many times over, and music that stopped partway would be worse than
  // none. It is asserted here rather than trusted.
  expect(createAsyncMock.mock.calls[0][1]).toMatchObject({
    shouldPlay: true,
    isLooping: true,
    volume: 0,
  });
  // Played from a URI, not a bundled asset: the tracks ship from storage.
  expect(createAsyncMock.mock.calls[0][0]).toEqual({
    uri: "https://cdn.example.com/music/calm_tide_02.m4a",
  });

  await waitFor(() => {
    expect(createdSounds[0].setStatusAsync).toHaveBeenLastCalledWith({ volume: 0.45 });
  }, FADE);
  // The fade climbed rather than jumping straight to the reading level.
  const first = createdSounds[0].setStatusAsync.mock.calls[0][0].volume;
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(0.45);
});

it("plays the reader's per-genre default over the catalogue's own choice", async () => {
  // What Profile writes when a reader sets the music for adventure stories.
  // The catalogue's own choice for this story is calm_tide_02 (asserted
  // above), so a default of calm_tide_01 proves the preference won.
  await AsyncStorage.setItem(GENRE_KEY, JSON.stringify({ adventure: "calm_tide_01" }));

  await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1));

  expect(createAsyncMock.mock.calls[0][0]).toEqual({
    uri: "https://cdn.example.com/music/calm_tide_01.m4a",
  });
});

it("stays silent from the start when the reader has muted music", async () => {
  await AsyncStorage.setItem(MUTED_KEY, "muted");

  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openChrome(view);
  await waitFor(() => expect(view.getByLabelText("Music, off")).toBeTruthy());

  expect(createdSounds).toHaveLength(0);
});

it("saves nothing against the story: the track follows the catalogue", async () => {
  await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1));

  // The reader used to write a per-story selection here. Nothing about the
  // story is persisted any more -- music is a setting, and a story id must
  // never turn up as a key.
  const musicWrites = storage.setItem.mock.calls.filter(([key]) => String(key).includes("music"));
  expect(musicWrites).toHaveLength(0);
});

describe("the mute control", () => {
  it("silences the current story immediately and remembers it", async () => {
    const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
    await waitFor(() => expect(createdSounds).toHaveLength(1));
    await openChrome(view);

    await act(async () => {
      await fireEvent.press(view.getByLabelText("Music"));
    });

    await waitFor(() => expect(createdSounds[0].unloadAsync).toHaveBeenCalled());
    expect(storage.setItem).toHaveBeenCalledWith(MUTED_KEY, "muted");
    expect(view.getByLabelText("Music, off")).toBeTruthy();
  });

  it("brings music back when pressed again", async () => {
    await AsyncStorage.setItem(MUTED_KEY, "muted");
    const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
    await openChrome(view);
    await waitFor(() => expect(view.getByLabelText("Music, off")).toBeTruthy());

    await act(async () => {
      await fireEvent.press(view.getByLabelText("Music, off"));
    });

    await waitFor(() => expect(createdSounds).toHaveLength(1));
    expect(storage.setItem).toHaveBeenCalledWith(MUTED_KEY, "on");
    expect(view.getByLabelText("Music")).toBeTruthy();
  });

  it("there is no track picker in the reader any more", async () => {
    const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
    await openChrome(view);

    // Pressing Music mutes. It must not open a list of tracks to choose from:
    // choosing lives in Profile, beside the narration voice.
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Music"));
    });

    expect(view.queryByLabelText("Close music")).toBeNull();
    expect(view.queryByLabelText("Calm Tide")).toBeNull();
    expect(view.queryByLabelText("None")).toBeNull();
  });
});

it("ducks music when narration starts and restores it when narration stops", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1));
  const musicSound = createdSounds[0];

  await openChrome(view);
  await act(async () => {
    await fireEvent.press(view.getByText("Listen"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Play narration"));
  });
  await waitFor(() => expect(createdSounds).toHaveLength(2));

  await waitFor(() => {
    expect(musicSound.setStatusAsync).toHaveBeenLastCalledWith({ volume: 0.1 });
  }, FADE);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Pause narration"));
  });

  await waitFor(() => {
    expect(musicSound.setStatusAsync).toHaveBeenLastCalledWith({ volume: 0.45 });
  }, FADE);
});

it("stops music and releases the audio instance when leaving the story", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await waitFor(() => expect(createdSounds).toHaveLength(1));
  const musicSound = createdSounds[0];

  // unmount() is itself async here (it wraps the real teardown in act()), so
  // it must be awaited for the effect cleanup that releases music to run.
  await view.unmount();

  expect(musicSound.unloadAsync).toHaveBeenCalled();
});
