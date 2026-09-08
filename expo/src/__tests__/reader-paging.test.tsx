/**
 * The reader turns pages horizontally instead of scrolling a chapter to the
 * bottom, opens on a warm reading surface with the controls hidden, and opens
 * the chapter with a title rather than dropping straight into prose.
 *
 * WHAT THESE TESTS CANNOT PROVE. The test renderer does not run native
 * gestures or native paging: no real swipe happens, `pagingEnabled` snapping
 * is not simulated, and `scrollTo` on the pager is issued against a ref the
 * renderer does not expose. So the swipe cases here fire the
 * `momentumScrollEnd` the platform would fire once a swipe has settled and
 * assert on what the screen does with it. That covers the offset-to-page
 * arithmetic and the state sync in both directions; it does not cover whether
 * a finger drag on a device actually reaches the pager, nor whether a word tap
 * survives the native touch negotiation between the pager and the word
 * underneath it. Both of those need a device or a detox-style run.
 */
jest.mock(
  "@react-native-async-storage/async-storage",
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
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

const mockSavePhrase = jest.fn();
const mockUnsavePhrase = jest.fn();
const mockListSavedPhrases = jest.fn();

jest.mock("@/lib/phrases", () => {
  const actual = jest.requireActual("@/lib/phrases");
  return {
    ...actual,
    savePhrase: (...args: [unknown]) => mockSavePhrase(...args),
    unsavePhrase: (...args: [string]) => mockUnsavePhrase(...args),
    listSavedPhrases: () => mockListSavedPhrases(),
  };
});

/* eslint-disable import/first */
import React from "react";
import { AccessibilityInfo, Alert, BackHandler, Platform, StyleSheet } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import PhraseCaptureReader from "@/components/reader/PhraseCaptureReader";
import { stories } from "@/data/seed";
import { colors } from "@/theme";
import type { Story } from "@/types/domain";
import ReaderScreen from "@/screens/ReaderScreen";
/* eslint-enable import/first */

const story = stories.find((item) => item.chapters.length > 1)!;

/**
 * A chapter long enough to paginate. The seed chapters fit on a single page at
 * the test renderer's window size, and a one-page chapter cannot show whether
 * page turns work at all.
 */
const LONG_BODY = Array.from(
  { length: 260 },
  (_, index) => `The lighthouse keeper counted lamp number ${index} and wrote the tally into the salt-stained ledger by the window before the fog came back in off the water.`,
).join(" ");
const pagedStory: Story = {
  ...story,
  chapters: [{ ...story.chapters[0], paragraphs: [LONG_BODY] }, ...story.chapters.slice(1)],
};

/**
 * How many pages the chapter actually paginated into, read off the page
 * footers. Every mounted page renders one, and the chrome's Pages readout uses
 * the same wording, so the count is taken from the "of N" all of them share
 * rather than from how many nodes matched.
 */
function pageCountFrom(footers: readonly { props: Record<string, unknown> }[]): number {
  const label = (footers[0].props.children as string[]).join("");
  return Number(/of (\d+)/.exec(label)![1]);
}

/**
 * A `momentumScrollEnd` as the platform reports one after a settled swipe.
 * The page width is supplied in `layoutMeasurement` rather than assumed from
 * the test window, because that is the value the screen divides by.
 */
const PAGE_WIDTH = 400;
function settledSwipeTo(pageIndex: number) {
  return {
    nativeEvent: {
      contentOffset: { x: pageIndex * PAGE_WIDTH, y: 0 },
      layoutMeasurement: { width: PAGE_WIDTH, height: 800 },
      contentSize: { width: PAGE_WIDTH * 20, height: 800 },
    },
  };
}

function readerBackground(tree: unknown): string | undefined {
  const node = tree as { props: { style: never } };
  return (StyleSheet.flatten(node.props.style) as { backgroundColor?: string }).backgroundColor;
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockListSavedPhrases.mockResolvedValue([]);
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as never);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("lays the chapter out as one horizontal, snapping page per computed page", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);

  const pager = view.getByTestId("reader-pager");
  expect(pager.props.horizontal).toBe(true);
  expect(pager.props.pagingEnabled).toBe(true);

  // One page column is mounted per page the paginator produced, so the
  // pager's scroll offsets and the page indices are the same coordinate.
  const pageCount = pageCountFrom(view.getAllByText(/^Page \d+ of \d+$/));
  expect(pageCount).toBeGreaterThan(2);
  for (let number = 1; number <= pageCount; number += 1) {
    expect(view.getAllByText(`Page ${number} of ${pageCount}`).length).toBeGreaterThan(0);
  }
  // One footer per page, plus the chrome's own readout of the same wording.
  expect(view.getAllByText(/^Page \d+ of \d+$/)).toHaveLength(pageCount + 1);
});

it("a settled swipe moves the reader forward and the Pages control follows it", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const pageCount = pageCountFrom(view.getAllByText(/^Page \d+ of \d+$/));
  expect(pageCount).toBeGreaterThan(2);

  await act(async () => {
    fireEvent(view.getByTestId("reader-pager"), "momentumScrollEnd", settledSwipeTo(2));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  // The slider is the only place `pageIndex` is reported as an accessibility
  // value, so this reads the control's own state rather than a page footer
  // that every mounted page renders.
  await waitFor(() => {
    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({
      min: 1,
      max: pageCount,
      now: 3,
    });
  });
});

it("the Pages control still drives the pager, so the sync runs both ways", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const pageCount = pageCountFrom(view.getAllByText(/^Page \d+ of \d+$/));

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Next page"));
  });
  await waitFor(() => {
    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({ min: 1, max: pageCount, now: 2 });
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Previous page"));
  });
  await waitFor(() => {
    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({ min: 1, max: pageCount, now: 1 });
  });
});

it("opens the chapter with its title, once, on the first page only", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);

  // The opener belongs to the chapter's first page. Every page of the chapter
  // is mounted at once, so a title rendered per page would appear as many
  // times as there are pages.
  expect(view.getAllByText(story.chapters[0].title)).toHaveLength(1);
  expect(view.getByText(`Chapter ${story.chapters[0].chapterNumber}`)).toBeTruthy();
});

it("opens on the warm reading surface rather than a near-white page", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await waitFor(() => {
    expect(readerBackground(view.toJSON())).toBe(colors.sepia);
  });
});

it("keeps the controls hidden until the reader asks for them", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  // The find bar renders only while the chrome is visible, so its absence on
  // arrival is the observable half of "controls hidden by default".
  expect(view.queryByLabelText("Find in chapter")).toBeNull();

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });
  expect(view.getByLabelText("Find in chapter")).toBeTruthy();

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  expect(view.queryByLabelText("Find in chapter")).toBeNull();
});

it("Android hardware back dismisses the overlay before it leaves the story", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  let handler: (() => boolean) | null = null;
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation(((_event: string, next: () => boolean) => {
      handler = next;
      return { remove: jest.fn() };
    }) as never);

  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  const press = () => (handler as unknown as () => boolean)();

  // Nothing open: the press is handed back to the navigator unchanged.
  expect(press()).toBe(false);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });

  // Search first, then the chrome, then out of the story.
  await act(async () => {
    expect(press()).toBe(true);
  });
  expect(view.queryByLabelText("Find in chapter")).toBeNull();
  await act(async () => {
    expect(press()).toBe(true);
  });
  expect(press()).toBe(false);
});

it("a word is still tappable with the pager mounted, and each word keeps one index", async () => {
  // Long enough to paginate into several pages, so the pager has real
  // neighbours mounted around the page being tapped.
  const body = Array.from(
    { length: 40 },
    (_, index) => `The lighthouse keeper counted lamp number ${index} and wrote the tally into the salt-stained ledger by the window.`,
  ).join(" ");
  const longStory: Story = {
    ...story,
    chapters: [{ ...story.chapters[0], paragraphs: [body] }],
  };
  mockSavePhrase.mockResolvedValue({
    id: "saved-1",
    phrase: "lighthouse",
    sentence: body,
    storyId: longStory.id,
    storyTitle: longStory.title,
    chapterId: longStory.chapters[0].id,
    createdAt: new Date().toISOString(),
    dueAt: new Date().toISOString(),
    reviewCount: 0,
  });

  const view = await render(<PhraseCaptureReader story={longStory} onBack={jest.fn()} />);

  // Chapter-absolute, not page-local: several pages are mounted at once, and
  // a page-local index would give two of them a word numbered 1.
  expect(view.getAllByTestId("reader-word-1")).toHaveLength(1);

  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-word-1"));
  });

  await waitFor(() => expect(mockSavePhrase).toHaveBeenCalledTimes(1));
  expect(mockSavePhrase.mock.calls[0][0]).toMatchObject({ phrase: "lighthouse" });
});
