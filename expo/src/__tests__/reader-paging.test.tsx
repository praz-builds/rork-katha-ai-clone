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

/* eslint-disable import/first */
import React from "react";
import { AccessibilityInfo, Alert, BackHandler, Platform, StyleSheet } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { authorFor, stories } from "@/data/seed";
import { setViewerId } from "@/lib/ownership";
import { colors, genreLabels } from "@/theme";
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
  //
  // The footer says "Page 3", not "Page 3 of 19". The total is a moving
  // number while a chapter is being written and watching it climb reads like
  // the book growing under you; the page you are on is the part that is
  // stable and the part a reader uses.
  const labels = view.getAllByTestId(/^reader-page-label-\d+$/);
  expect(labels.length).toBeGreaterThan(2);
  expect(labels[0]).toHaveTextContent("Page 1");
  expect(labels[1]).toHaveTextContent("Page 2");
  expect(labels[2]).toHaveTextContent("Page 3");
  // No page carries a running total any more.
  expect(view.queryAllByText(/^Page \d+ of \d+$/)).toHaveLength(1);
});

it("a settled swipe moves the reader forward and the Pages control follows it", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const pageCount = view.getAllByTestId(/^reader-page-label-\d+$/).length;
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

it("on web, where no momentum end ever fires, a swipe that comes to rest still moves the Pages control", async () => {
  // react-native-web accepts `onMomentumScrollEnd` and never calls it: the
  // browser has no such event, and a swipe snaps by CSS scroll-snap with only
  // `scroll` events to show for it. The reader could turn to the last page
  // and the Pages control still said "Page 1". So only `scroll` fires here.
  jest.replaceProperty(Platform, "OS", "web");
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const pageCount = view.getAllByTestId(/^reader-page-label-\d+$/).length;
  const lastPage = pageCount - 1;

  await act(async () => {
    // Mid-swipe frames, then the snapped resting offset.
    fireEvent.scroll(view.getByTestId("reader-pager"), settledSwipeTo(0.6));
    fireEvent.scroll(view.getByTestId("reader-pager"), settledSwipeTo(lastPage));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  await waitFor(() => {
    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({
      min: 1,
      max: pageCount,
      now: pageCount,
    });
  });
});

it("on web, a settle still pending when the chapter changes is dropped, not committed against the new chapter", async () => {
  jest.useFakeTimers();
  try {
    jest.replaceProperty(Platform, "OS", "web");
    // BOTH chapters paginate: a one-page chapter 2 would clamp the stale
    // offset to page 0 and this could not fail without the fix.
    const twoPaged: Story = {
      ...story,
      chapters: story.chapters.map((item) => ({ ...item, paragraphs: [LONG_BODY] })),
    };
    const view = await render(<ReaderScreen story={twoPaged} onBack={jest.fn()} />);
    const pageCount = view.getAllByTestId(/^reader-page-label-\d+$/).length;
    expect(pageCount).toBeGreaterThan(2);

    // A swipe comes to rest on the last page of chapter 1...
    await act(async () => {
      fireEvent.scroll(view.getByTestId("reader-pager"), settledSwipeTo(pageCount - 1));
    });
    // ...and chapter 2 is opened before the settle window closes.
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Chapters"));
    });
    await act(async () => {
      await fireEvent.press(
        view.getByLabelText(`Open chapter ${twoPaged.chapters[1].chapterNumber}: ${twoPaged.chapters[1].title}`),
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({ now: 1 });
  } finally {
    jest.useRealTimers();
  }
});

it("the Pages control still drives the pager, so the sync runs both ways", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const pageCount = view.getAllByTestId(/^reader-page-label-\d+$/).length;

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
  // is mounted at once, so a title rendered per page would appear as many times
  // as there are pages. Two is the opener plus the chrome's own top bar, which
  // is mounted (transparent) whether or not the chrome is showing.
  expect(view.getAllByText(story.chapters[0].title)).toHaveLength(2);
  // The "Chapter N" eyebrow is gone from the page. The number lives in the
  // chrome and the Chapters sheet, where it is a way to navigate rather than a
  // label printed over prose.
  expect(view.queryByText(`Chapter ${story.chapters[0].chapterNumber}`)).toBeNull();
});

/**
 * The reader's first page is a title page, and it is the same title page for
 * everybody's story.
 *
 * It used to fork on ownership: somebody ELSE's story opened with a cover
 * thumbnail, a genre line and a byline above the title, on the theory that a
 * story you have not chosen yet needs introducing. It does -- on the story
 * page, which every tap now lands on first. By the time the reader opens, the
 * cover has been seen and the decision has been made.
 */
describe("the reader's first page carries no cover, genre or byline", () => {
  const COVER = "https://example.test/covers/opener/cover.png";
  const author = authorFor(story.authorId);

  afterEach(() => setViewerId(null));

  async function openerOf(theirs: Story) {
    const view = await render(<ReaderScreen story={theirs} onBack={jest.fn()} />);
    await waitFor(() => view.getByTestId("reader-page-body-0"));
    return view;
  }

  it("for somebody else's story", async () => {
    // The case the old fork existed for: not the viewer's story, no live
    // generation session. This is what used to draw all three.
    const view = await openerOf({ ...pagedStory, coverImageUrl: COVER });

    expect(JSON.stringify(view.toJSON())).not.toContain(COVER);
    expect(view.queryByText(genreLabels[pagedStory.genre])).toBeNull();
    expect(view.queryByText(`by ${author.displayName}`)).toBeNull();
  });

  it("for your own story", async () => {
    setViewerId(pagedStory.authorId);
    const view = await openerOf({ ...pagedStory, coverImageUrl: COVER });

    expect(JSON.stringify(view.toJSON())).not.toContain(COVER);
    expect(view.queryByText(genreLabels[pagedStory.genre])).toBeNull();
    expect(view.queryByText(`by ${author.displayName}`)).toBeNull();
  });
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

it("Android hardware back peels off overlays, then leaves the reader — never the app", async () => {
  // This test previously asserted `press()` returned `false` when nothing was
  // open, on the reasoning that a navigator would take over. There is no
  // navigator: screens are a `useState` switch in `App.tsx`, so `false` runs
  // Android's platform default and finishes the activity. The reader's back
  // button closed the whole app, and this test asserted that it did.
  jest.replaceProperty(Platform, "OS", "android");
  let handler: (() => boolean) | null = null;
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation(((_event: string, next: () => boolean) => {
      handler = next;
      return { remove: jest.fn() };
    }) as never);

  const onBack = jest.fn();
  const view = await render(<ReaderScreen story={story} onBack={onBack} />);
  const press = () => (handler as unknown as () => boolean)();

  // Nothing open: leave the reader, and tell Android we handled it. Returning
  // false here is what closed the app.
  expect(press()).toBe(true);
  expect(onBack).toHaveBeenCalledTimes(1);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Search chapter"));
  });

  // Search first, then the chrome — neither of which should leave the story.
  await act(async () => {
    expect(press()).toBe(true);
  });
  expect(view.queryByLabelText("Find in chapter")).toBeNull();
  expect(onBack).toHaveBeenCalledTimes(1);

  await act(async () => {
    expect(press()).toBe(true);
  });
  expect(onBack).toHaveBeenCalledTimes(1);

  // Only now, with everything closed, does the press exit the reader.
  expect(press()).toBe(true);
  expect(onBack).toHaveBeenCalledTimes(2);
});

it("the page body is natively selectable plain text, with no per-word targets", async () => {
  // A reader who wants a passage long-presses it and gets the system's own
  // Copy / Share, which needs the page to be one selectable Text holding plain
  // prose rather than a run of pressable words.
  const body = Array.from(
    { length: 40 },
    (_, index) => `The lighthouse keeper counted lamp number ${index} and wrote the tally into the salt-stained ledger by the window.`,
  ).join(" ");
  const longStory: Story = {
    ...story,
    chapters: [{ ...story.chapters[0], paragraphs: [body] }],
  };

  const view = await render(<ReaderScreen story={longStory} onBack={jest.fn()} />);

  const page = view.getByTestId("reader-page-body-0");
  expect(page.props.selectable).toBe(true);
  expect(view.queryAllByTestId(/^reader-word-/)).toHaveLength(0);
  expect(view.getAllByText(/lighthouse keeper/).length).toBeGreaterThan(0);
});

/**
 * The blank page.
 *
 * A page outside the render window draws an empty body, and the window used
 * to be centred on `pageIndex`, which only moved when `onMomentumScrollEnd`
 * fired. That event never fires for a trackpad or a mouse wheel and lags a
 * fast fling, so jumping to page three -- by flinging, or by dragging the page
 * slider -- landed on a page whose prose had never been asked to render. The
 * reader saw "Page 3 of 9" over nothing at all.
 */
it("a page jumped to directly still has its prose", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);
  const labels = view.getAllByTestId(/^reader-page-label-\d+$/);
  expect(labels.length).toBeGreaterThan(3);

  const bodyOf = (index: number) =>
    view.getByTestId(`reader-page-body-${index}`);

  // A scroll with no momentum end -- exactly what a wheel or trackpad
  // produces -- must still bring the destination page's prose with it.
  await act(async () => {
    fireEvent.scroll(view.getByTestId("reader-pager"), settledSwipeTo(3));
  });

  await waitFor(() => {
    expect(bodyOf(3).props.children).toBeTruthy();
  });
});

it("the page slider lands on prose, not on an empty page", async () => {
  const view = await render(<ReaderScreen story={pagedStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  // Three forward taps, with no scroll event of any kind in between: the
  // window has to follow the committed page as well as the live offset.
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Next page"));
    });
  }

  await waitFor(() => {
    expect(view.getByTestId("reader-page-body-3").props.children).toBeTruthy();
  });
});
