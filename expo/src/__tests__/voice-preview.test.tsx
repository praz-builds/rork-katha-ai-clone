/**
 * Hearing a voice on the Voices screen before choosing it.
 *
 * Three promises, each asserted rather than eyeballed:
 *
 * - LISTENING IS NOT CHOOSING. A sample never writes the preferred voice.
 * - ONE AT A TIME. A second sample stops the first; a sample that finishes
 *   loading after it was superseded is unloaded, never played over the newer.
 * - IT SAYS WHEN IT FAILED. A missing clip is an error the reader can see and
 *   retry, not a spinner that never ends.
 */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockFetchNarrationVoices = jest.fn();
const mockPreferredVoiceId = jest.fn();
const mockSetPreferredVoiceId = jest.fn();

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});
jest.mock("@/lib/voices", () => ({
  fetchNarrationVoices: (...args: unknown[]) =>
    mockFetchNarrationVoices(...args),
  preferredVoiceId: (...args: unknown[]) => mockPreferredVoiceId(...args),
  setPreferredVoiceId: (...args: unknown[]) =>
    mockSetPreferredVoiceId(...args),
}));

type StatusCallback = (status: Record<string, unknown>) => void;
type Pending = {
  uri: string;
  callback: StatusCallback;
  resolve: () => void;
  reject: (error: Error) => void;
  sound: { unloadAsync: jest.Mock; setOnPlaybackStatusUpdate: jest.Mock };
};
const mockLoads: Pending[] = [];

jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(
        (source: { uri: string }, _initial: unknown, callback: StatusCallback) =>
          new Promise((resolve, reject) => {
            const sound = {
              unloadAsync: jest.fn(() => Promise.resolve()),
              setOnPlaybackStatusUpdate: jest.fn(),
            };
            mockLoads.push({
              uri: source.uri,
              callback,
              sound,
              resolve: () => resolve({ sound }),
              reject,
            });
          }),
      ),
    },
  },
}));

/* eslint-disable import/first */
import VoicesScreen from "@/screens/VoicesScreen";
/* eslint-enable import/first */

const voice = (id: string, name: string, previewUrl: string | null) => ({
  id,
  displayName: name,
  language: "en",
  gender: "female",
  tier: "standard",
  previewUrl,
});

const ARIA_URL = "https://project.supabase.test/storage/v1/object/public/audio/voice-previews/aria.mp3";
const KAI_URL = "https://project.supabase.test/storage/v1/object/public/audio/voice-previews/kai.mp3";

beforeEach(() => {
  mockLoads.length = 0;
  mockFetchNarrationVoices.mockReset();
  mockPreferredVoiceId.mockReset();
  mockSetPreferredVoiceId.mockReset();
  mockPreferredVoiceId.mockResolvedValue("aria");
  mockFetchNarrationVoices.mockResolvedValue([
    voice("aria", "Aria", ARIA_URL),
    voice("kai", "Kai", KAI_URL),
    voice("nova", "Nova", null),
  ]);
});

afterEach(cleanup);

const renderVoices = async () => {
  const view = await render(<VoicesScreen onBack={jest.fn()} />);
  await waitFor(() => view.getByTestId("voice-preview-kai"));
  return view;
};

it("plays a sample without choosing that voice", async () => {
  const view = await renderVoices();

  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  expect(mockLoads.map((load) => load.uri)).toEqual([KAI_URL]);
  expect(view.getByLabelText("Loading Kai sample. Tap to cancel")).toBeTruthy();

  await act(async () => {
    mockLoads[0].resolve();
    mockLoads[0].callback({ isLoaded: true, isPlaying: true });
  });
  expect(view.getByLabelText("Stop Kai sample")).toBeTruthy();

  // Aria is still the chosen voice, on screen and on disk.
  expect(mockSetPreferredVoiceId).not.toHaveBeenCalled();
  expect(view.getByTestId("voice-aria").props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(view.getByTestId("voice-kai").props.accessibilityState).toMatchObject({
    selected: false,
  });
});

it("stops the sample on a second press and when it finishes", async () => {
  const view = await renderVoices();

  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  await act(async () => {
    mockLoads[0].resolve();
    mockLoads[0].callback({ isLoaded: true, isPlaying: true });
  });
  await fireEvent.press(view.getByLabelText("Stop Kai sample"));
  expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
  expect(view.getByLabelText("Play Kai sample")).toBeTruthy();

  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  await act(async () => {
    mockLoads[1].resolve();
    mockLoads[1].callback({ isLoaded: true, isPlaying: true });
  });
  await act(async () => {
    mockLoads[1].callback({ isLoaded: true, isPlaying: false, didJustFinish: true });
  });
  expect(mockLoads[1].sound.unloadAsync).toHaveBeenCalled();
  expect(view.getByLabelText("Play Kai sample")).toBeTruthy();
});

it("never lets a superseded sample play over the newer one", async () => {
  const view = await renderVoices();

  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  await fireEvent.press(view.getByLabelText("Play Aria sample"));
  expect(mockLoads.map((load) => load.uri)).toEqual([KAI_URL, ARIA_URL]);

  // Kai's slow load lands after Aria was asked for.
  await act(async () => {
    mockLoads[0].resolve();
    mockLoads[0].callback({ isLoaded: true, isPlaying: true });
  });
  expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
  expect(view.queryByLabelText("Stop Kai sample")).toBeNull();
  expect(view.getByLabelText("Loading Aria sample. Tap to cancel")).toBeTruthy();
});

it("says a missing sample failed, and lets it be tried again", async () => {
  const view = await renderVoices();

  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  await act(async () => {
    mockLoads[0].reject(new Error("404"));
  });
  await waitFor(() => view.getByLabelText("Kai sample unavailable. Try again"));
  expect(view.getByText("Sample unavailable right now")).toBeTruthy();

  await fireEvent.press(view.getByLabelText("Kai sample unavailable. Try again"));
  expect(mockLoads).toHaveLength(2);
  expect(mockSetPreferredVoiceId).not.toHaveBeenCalled();
});

it("offers no sample for a voice the registry has none for", async () => {
  const view = await renderVoices();
  expect(view.getByTestId("voice-nova")).toBeTruthy();
  expect(view.queryByTestId("voice-preview-nova")).toBeNull();
});

it("stops the sample when the screen goes away", async () => {
  const view = await renderVoices();
  await fireEvent.press(view.getByLabelText("Play Kai sample"));
  await act(async () => {
    mockLoads[0].resolve();
    mockLoads[0].callback({ isLoaded: true, isPlaying: true });
  });
  await act(async () => {
    await view.unmount();
  });
  expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
});

it("still saves the voice when the row itself is pressed", async () => {
  const view = await renderVoices();
  await fireEvent.press(view.getByTestId("voice-kai"));
  expect(mockSetPreferredVoiceId).toHaveBeenCalledWith("kai");
  expect(mockLoads).toHaveLength(0);
});
