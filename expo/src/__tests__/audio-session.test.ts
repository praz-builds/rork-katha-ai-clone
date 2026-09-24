/**
 * Narration and genre music keep playing when the phone locks.
 *
 * expo-av's audio mode is process-wide and was never set, so on a device both
 * stopped on lock or app switch, and iOS's silent switch muted them. The mode
 * is now set once at start-up; this pins what it says, that it cannot take the
 * app down, and that web (which has no audio session) is left alone.
 */

/* eslint-disable import/first */
const mockSetAudioMode = jest.fn();

jest.mock("expo-av", () => ({
  Audio: {
    Sound: { createAsync: jest.fn() },
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args),
  },
}));

import { Platform } from "react-native";
import {
  APP_AUDIO_MODE,
  configureAudioSession,
  resetAudioSessionForTests,
} from "@/lib/audio-session";

const originalOS = Platform.OS;

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  mockSetAudioMode.mockReset();
  mockSetAudioMode.mockResolvedValue(undefined);
  resetAudioSessionForTests();
});

afterEach(() => setOS(originalOS));

it("keeps playing in the background and through the iOS silent switch", async () => {
  await expect(configureAudioSession()).resolves.toBe(true);
  expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
  expect(mockSetAudioMode.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      allowsRecordingIOS: false,
      playThroughEarpieceAndroid: false,
    }),
  );
});

it("uses expo-av's own DuckOthers values, not guesses", () => {
  // The module writes the numbers so a partial expo-av mock cannot crash it;
  // this checks the numbers against the real enums.
  const { InterruptionModeAndroid, InterruptionModeIOS } = jest.requireActual(
    "expo-av/build/Audio.types",
  );
  expect(APP_AUDIO_MODE.interruptionModeIOS).toBe(InterruptionModeIOS.DuckOthers);
  expect(APP_AUDIO_MODE.interruptionModeAndroid).toBe(InterruptionModeAndroid.DuckOthers);
});

it("sets the mode once however often start-up runs", async () => {
  await Promise.all([configureAudioSession(), configureAudioSession()]);
  await configureAudioSession();
  expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
});

it("never throws, and tries again next time after a failure", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSetAudioMode.mockRejectedValueOnce(new Error("no audio session"));
  await expect(configureAudioSession()).resolves.toBe(false);
  await expect(configureAudioSession()).resolves.toBe(true);
  expect(mockSetAudioMode).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

it("leaves web alone", async () => {
  setOS("web");
  await expect(configureAudioSession()).resolves.toBe(false);
  expect(mockSetAudioMode).not.toHaveBeenCalled();
});
