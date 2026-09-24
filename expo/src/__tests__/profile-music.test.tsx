/**
 * Background music, switched from Profile.
 *
 * The reader's mute and Profile's switch are ONE preference
 * (`katha.reader.music-muted.v1`), read on both sides. These pin that they
 * agree in both directions, through the real screens rather than through the
 * storage helper alone: a switch that wrote its own key would pass a storage
 * test and still leave the reader playing.
 */

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("@/lib/music-cache", () => ({
  resolveMusicUri: jest.fn((track: { file: string }) =>
    Promise.resolve(`https://cdn.example.com/music/${track.file}`)),
}));
jest.mock("@/lib/music-catalogue", () => {
  const actual = jest.requireActual("@/lib/music-catalogue");
  return {
    ...actual,
    MUSIC_TRACKS: [
      { id: "calm_tide_01", title: "Calm Tide", genres: ["adventure"], file: "calm_tide_01.m4a" },
    ],
  };
});
jest.mock("@/lib/profile", () => {
  const actual = jest.requireActual("@/lib/profile");
  return {
    ...actual,
    fetchOwnProfile: jest.fn().mockResolvedValue(null),
    fetchActivityCalendar: jest.fn().mockResolvedValue([]),
  };
});

import { stories } from "@/data/seed";
import { resetProfileStoreForTests } from "@/lib/profile-store";
import ProfileScreen from "@/screens/ProfileScreen";
import ReaderScreen from "@/screens/ReaderScreen";

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const createAsyncMock = Audio.Sound.createAsync as unknown as jest.Mock;
const story = stories.find((item) => item.chapters.length > 1)!;
const MUTED_KEY = "katha.reader.music-muted.v1";
// The reader mounts a lot; under a loaded machine its first sound can take
// longer than waitFor's 1s default.
const SLOW = { timeout: 10000 };

const profileProps = () => ({
  credits: 5,
  onCredits: jest.fn(),
  onPaywall: jest.fn(),
  onJourney: jest.fn(),
  onPublicProfile: jest.fn(),
  onVoices: jest.fn(),
  onSignedOut: jest.fn(),
  onDeleted: jest.fn(),
});

function checked(view: Awaited<ReturnType<typeof render>>): boolean | undefined {
  return view.getByTestId("profile-music-toggle").props.accessibilityState?.checked;
}

/** Lets a mount's storage read land, so an assertion is not racing it. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(async () => {
  cleanup();
  await storage.clear();
  jest.clearAllMocks();
  resetProfileStoreForTests();
  createAsyncMock.mockImplementation(() =>
    Promise.resolve({
      sound: {
        playAsync: jest.fn(() => Promise.resolve()),
        pauseAsync: jest.fn(() => Promise.resolve()),
        unloadAsync: jest.fn(() => Promise.resolve()),
        setStatusAsync: jest.fn(() => Promise.resolve()),
      },
    }));
});

afterEach(cleanup);

describe("the Profile music switch", () => {
  it("is on by default, the shipped default", async () => {
    const view = await render(<ProfileScreen {...profileProps()} />);
    await settle();
    expect(checked(view)).toBe(true);
  });

  it("shows off when the reader has muted music", async () => {
    await AsyncStorage.setItem(MUTED_KEY, "muted");
    const view = await render(<ProfileScreen {...profileProps()} />);
    await waitFor(() => expect(checked(view)).toBe(false));
  });

  it("writes the reader's own key, both ways", async () => {
    const view = await render(<ProfileScreen {...profileProps()} />);
    await settle();

    await act(async () => {
      await fireEvent.press(view.getByTestId("profile-music-toggle"));
    });
    expect(checked(view)).toBe(false);
    expect(await AsyncStorage.getItem(MUTED_KEY)).toBe("muted");

    await act(async () => {
      await fireEvent.press(view.getByTestId("profile-music-toggle"));
    });
    expect(checked(view)).toBe(true);
    expect(await AsyncStorage.getItem(MUTED_KEY)).toBe("on");
  });

  it("keeps a flip made before the saved value has loaded", async () => {
    // Saved: muted. The read captures that value at call time and resolves
    // late, which is what a slow read actually does.
    await AsyncStorage.setItem(MUTED_KEY, "muted");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realGetItem = storage.getItem.getMockImplementation()!;
    storage.getItem.mockImplementation(async (key: string) => {
      const valueAtReadTime = await realGetItem(key);
      if (key === MUTED_KEY) await gate;
      return valueAtReadTime;
    });

    try {
      const view = await render(<ProfileScreen {...profileProps()} />);
      // Drawn on (the default) while the read is out; they switch it off,
      // then on again, before it lands.
      await act(async () => {
        await fireEvent.press(view.getByTestId("profile-music-toggle"));
      });
      await act(async () => {
        await fireEvent.press(view.getByTestId("profile-music-toggle"));
      });
      expect(checked(view)).toBe(true);

      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      // The stale "muted" must not switch it back off.
      expect(checked(view)).toBe(true);
    } finally {
      storage.getItem.mockImplementation(realGetItem);
    }
  });
});

describe("Profile and the reader agree", () => {
  // One renderer per test, and `rerender` with the other screen: the root's
  // component type changes, so the first screen unmounts and the second
  // mounts fresh, which is what moving between the tab and the reader does.
  // (A second `render` after `cleanup()` in the same test gets an unmounted
  // renderer under this Testing Library version.)
  it("off in Profile opens the next story silent, with the reader's mute shown", async () => {
    const view = await render(<ProfileScreen {...profileProps()} />);
    await settle();
    await act(async () => {
      await fireEvent.press(view.getByTestId("profile-music-toggle"));
    });

    await view.rerender(<ReaderScreen story={story} onBack={jest.fn()} />);
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });
    await waitFor(() => expect(view.getByLabelText("Music, off")).toBeTruthy(), SLOW);
    await settle();
    expect(createAsyncMock).not.toHaveBeenCalled();
  });

  it("a mute in the reader shows as off in Profile, and on again plays the next story", async () => {
    const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
    await waitFor(() => expect(createAsyncMock).toHaveBeenCalled(), SLOW);
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Music"));
    });

    await view.rerender(<ProfileScreen {...profileProps()} />);
    await waitFor(() => expect(checked(view)).toBe(false));

    await act(async () => {
      await fireEvent.press(view.getByTestId("profile-music-toggle"));
    });
    createAsyncMock.mockClear();

    await view.rerender(<ReaderScreen story={story} onBack={jest.fn()} />);
    await waitFor(() => expect(createAsyncMock).toHaveBeenCalledTimes(1), SLOW);
  });
});
