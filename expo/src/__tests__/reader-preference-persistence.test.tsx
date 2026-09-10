/**
 * A rendering preference the reader changes is theirs from then on.
 *
 * The reader remounts for every story, and in practice whenever the app
 * navigates back into it -- so anything held only in component state is a
 * choice the reader has to make again on the next chapter. Type size, line
 * height and reading mode were already written to AsyncStorage; the narration
 * voice was not, so a reader who picked the male narrator was handed the
 * female one again on the very next chapter they opened.
 *
 * Each preference is covered twice, and both halves are needed: writing it and
 * reading it back are separate bugs, and a test that only asserts `setItem`
 * passes against a screen that never looks at the value again.
 *
 * The two halves are separate tests rather than one mount-choose-remount test
 * on purpose. Unmounting the reader and mounting it again inside a single test
 * leaves the shared renderer state in a shape where the second tree renders
 * nothing -- the same fragility `reader-screen-audio.test.tsx` was given its
 * own file for. A fresh test IS a fresh mount, which is all this needs.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { getDefaultVoices, getVoice } from "@/data/voices";
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
const base = stories.find((item) => item.chapters.length > 1)!;
// The voice toggle only renders for a chapter that has both narrations, and no
// seed story carries them.
const story = {
  ...base,
  chapters: base.chapters.map((chapter) => ({
    ...chapter,
    audioUrls: { female: "https://audio.test/f.mp3", male: "https://audio.test/m.mp3" },
  })),
};

// The names the sheet actually labels its segments with, read from the
// catalogue rather than typed out, so renaming a voice does not quietly turn
// these into tests of nothing.
const [femaleId, maleId] = getDefaultVoices(
  story.language === "Spanish" ? "es" : "en",
);
const MALE_VOICE = `Use ${getVoice(maleId)!.name} voice`;
const FEMALE_VOICE = `Use ${getVoice(femaleId)!.name} voice`;

type Screen = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  cleanup();
  storage.clear();
  jest.clearAllMocks();
});

afterEach(() => cleanup());

async function openReader(): Promise<Screen> {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  return view;
}

async function open(view: Screen, sheet: "Listen" | "Preferences") {
  await act(async () => {
    await fireEvent.press(view.getByText(sheet));
  });
}

function selected(view: Screen, label: string): boolean {
  return view.getByLabelText(label).props.accessibilityState?.selected === true;
}

it("writes the narration voice the reader picks", async () => {
  const view = await openReader();
  await open(view, "Listen");
  await act(async () => {
    await fireEvent.press(view.getByLabelText(MALE_VOICE));
  });

  await waitFor(() =>
    expect(storage.setItem).toHaveBeenCalledWith("katha.voice.gender.v1", "male")
  );
});

it("opens a later story on the voice the reader last picked", async () => {
  await storage.setItem("katha.voice.gender.v1", "male");

  const view = await openReader();
  await open(view, "Listen");

  await waitFor(() => expect(selected(view, MALE_VOICE)).toBe(true));
  expect(selected(view, FEMALE_VOICE)).toBe(false);
});

it("writes the reading mode the reader picks", async () => {
  const view = await openReader();
  await open(view, "Preferences");
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Night reading mode"));
  });

  const written = storage.setItem.mock.calls.find(
    ([key]) => key === "katha.reader.preferences.v1",
  );
  expect(written).toBeTruthy();
  expect(JSON.parse(String(written![1])).theme).toBe("night");
});

it("opens a later story in the reading mode the reader last picked", async () => {
  await storage.setItem(
    "katha.reader.preferences.v1",
    JSON.stringify({ typeSize: 22, lineHeight: 38, theme: "night" }),
  );

  const view = await openReader();
  await open(view, "Preferences");

  await waitFor(() => expect(selected(view, "Night reading mode")).toBe(true));
});

it("does not let a slow stored value overwrite a choice already made", async () => {
  // The stored value resolves a tick or two after mount. A reader fast enough
  // to reach the sheet first had their brand-new choice replaced by the older
  // stored one -- their narrator changing under them a moment after they
  // picked it, the same failure the music restore is already written against.
  const realGetItem = storage.getItem.getMockImplementation();
  let releaseRead!: () => void;
  const slowRead = new Promise<string | null>((resolve) => {
    releaseRead = () => resolve("female");
  });
  storage.getItem.mockImplementation(((key: string) =>
    key === "katha.voice.gender.v1"
      ? slowRead
      : Promise.resolve(null)) as typeof storage.getItem);

  try {
    const view = await openReader();
    await open(view, "Listen");
    await act(async () => {
      await fireEvent.press(view.getByLabelText(MALE_VOICE));
    });

    await act(async () => {
      releaseRead();
      await slowRead;
    });

    expect(selected(view, MALE_VOICE)).toBe(true);
  } finally {
    // `jest.clearAllMocks()` clears calls, not implementations, so a mock left
    // in place here would silently break every test that ran after it.
    storage.getItem.mockImplementation(realGetItem!);
  }
});
