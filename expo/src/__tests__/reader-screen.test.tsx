import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react-native";
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

it("maps a search match to the page that actually contains it, in a chapter with leading whitespace and a blank line between paragraphs", async () => {
  const filler = (count: number, start: number) =>
    Array.from(
      { length: count },
      (_, index) => `Filler sentence number ${start + index} exists only to occupy space on the page and push the story further along its plot without saying much of anything new.`,
    ).join(" ");
  // Leading whitespace (trimmed away entirely) and a blank line with
  // trailing spaces before it (also collapsed) between paragraphs shift
  // every later character index relative to the raw, un-normalized text.
  const leadingPadding = " \n".repeat(1100);
  const needle = "BEACON";
  const paragraphs = [
    leadingPadding + filler(3, 1),
    `   \n\nthe lighthouse keeper found a ${needle} burning steady in the fog.` + " " + filler(60, 100),
  ];
  const messyStory = {
    ...story,
    chapters: [{ ...story.chapters[0], paragraphs }, ...story.chapters.slice(1)],
  };

  const view = await render(<ReaderScreen story={messyStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });
  await act(async () => {
    await fireEvent.changeText(view.getByLabelText("Find in chapter"), needle);
  });
  await waitFor(() => {
    expect(view.getByText("1 of 1")).toBeTruthy();
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Next search match"));
  });

  await waitFor(() => {
    expect(view.getByText(new RegExp(needle))).toBeTruthy();
  });
});

it("lets a tap in the reading area reach the page instead of only the chrome toggle", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  const toggle = view.getByLabelText("Toggle reader controls");

  // The toggle must be an ancestor of the reading content (so a nested
  // touch target -- a word, a button, selectable text -- gets first refusal
  // during touch negotiation), not a separate layer floating on top of it
  // with nothing underneath.
  expect(within(toggle).getByText(story.title)).toBeTruthy();
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
