import AsyncStorage from "@react-native-async-storage/async-storage";
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

it("reports the last page as Page M of M", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  const next = view.getByLabelText("Next page");
  await act(async () => {
    await fireEvent.press(next);
    await fireEvent.press(next);
    await fireEvent.press(next);
  });

  await waitFor(() => {
    const footers = view.getAllByText(/Page \d+ of \d+/);
    const lastFooter = footers[footers.length - 1];
    expect(lastFooter.props.children.join("")).toMatch(/Page (\d+) of \1/);
  });
});

it("marks the current chapter and navigates to another real chapter", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByText("Chapters"));
  });

  await waitFor(() => {
    expect(view.getByText("Current")).toBeTruthy();
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText(`Open chapter 2: ${story.chapters[1].title}`));
  });

  await waitFor(() => {
    expect(view.getByText(story.chapters[1].title)).toBeTruthy();
  });
});

it("search finds, counts and cycles matches", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });
  await act(async () => {
    await fireEvent.changeText(view.getByLabelText("Find in chapter"), "light");
  });

  await waitFor(() => {
    expect(view.getByText("1 of 5")).toBeTruthy();
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Next search match"));
  });

  await waitFor(() => {
    expect(view.getByText("2 of 5")).toBeTruthy();
  });
});

it("reads a persisted preference after remount", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByText("Preferences"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Increase Type size"));
  });

  await waitFor(() => {
    expect(storage.setItem).toHaveBeenCalledWith(
      "katha.reader.preferences.v1",
      expect.stringContaining("\"typeSize\":20"),
    );
  });

  view.unmount();
  storage.getItem.mockResolvedValueOnce(JSON.stringify({ typeSize: 20, lineHeight: 30, theme: "night" }));
  const remount = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await waitFor(() => {
    expect(remount.getAllByText(story.title).length).toBeGreaterThan(0);
    expect(storage.getItem).toHaveBeenCalledWith("katha.reader.preferences.v1");
  });
  remount.unmount();
});
