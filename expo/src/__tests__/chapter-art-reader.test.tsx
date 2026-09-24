/**
 * Chapter art in the reader.
 *
 * A writer who ticks *Chapter cover: auto-generated per chapter* pays an extra
 * credit per chapter (`source-of-truth/CREDITS_AND_PRICING.md` §1) and the
 * picture is drawn on a background task well after the chapter is readable. So
 * the interesting case is not "does the image render" -- it is what the page
 * does in the window where the chapter exists and the picture does not yet.
 *
 * The opener's height is an input to pagination (`firstPageOffset`), so a
 * frame that appears when the URL arrives would re-wrap page one under a
 * reader who is mid-sentence. These tests pin that page one's prose is the
 * same before and after the picture lands.
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
import { AccessibilityInfo, Alert } from "react-native";
import { cleanup, render, waitFor } from "@testing-library/react-native";
import { stories } from "@/data/seed";
import type { Chapter, Story } from "@/types/domain";
import ReaderScreen from "@/screens/ReaderScreen";
/* eslint-enable import/first */

const seed = stories.find((item) => item.chapters.length > 1)!;

/** Long enough to paginate: a one-page chapter cannot show a reflow. */
const BODY = Array.from(
  { length: 240 },
  (_, index) => `The ferry left the jetty at ${index} past the hour and the fog took it before the bell had finished ringing over the water.`,
).join(" ");

const ART_URL = "https://example.test/covers/story/chapters/2.png";

/** A second chapter of an illustrated story, with or without its picture yet. */
function storyWith(
  options: { illustrateChapters?: boolean; imageUrl?: string },
): Story {
  const chapter: Chapter = {
    ...seed.chapters[0],
    chapterNumber: 2,
    paragraphs: [BODY],
    imageUrl: options.imageUrl,
  };
  return {
    ...seed,
    coverImageUrl: "https://example.test/covers/story/cover.png",
    illustrateChapters: options.illustrateChapters,
    chapters: [chapter],
  };
}

/**
 * The text a host element actually rendered.
 *
 * Walks the rendered host tree, not the element's `props.children`: the page
 * body's children are a memoised `PageWords` component, whose words exist only
 * once it has rendered.
 */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  const host = node as { children?: unknown[] } | null;
  return (host?.children ?? []).map(textOf).join("");
}

/**
 * Page one of a story, with the reader torn down again before returning.
 *
 * Unmounted rather than left standing, because these tests compare two renders
 * of the same chapter and a reader left mounted keeps timers and async state
 * running underneath the next one.
 */
async function pageOneOf(story: Story): Promise<string> {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  // `waitFor`, not a bare query: the reader paginates after its preferences
  // have loaded, and the second mount in one test does not get the first
  // mount's already-settled effects for free.
  const body = await waitFor(() => view.getByTestId("reader-page-body-0"));
  const text = textOf(body);
  view.unmount();
  return text;
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

it("shows a chapter's own illustration at the top of the chapter", async () => {
  const view = await render(
    <ReaderScreen story={storyWith({ illustrateChapters: true, imageUrl: ART_URL })} onBack={jest.fn()} />,
  );

  const art = view.getByLabelText(/^Illustration for /);
  expect(art.props.source).toMatchObject({ uri: ART_URL });
});

it("holds the picture's space before the picture exists, so page one never reflows", async () => {
  // The background art task has not finished: the chapter is readable and its
  // `image_url` is still null.
  const waiting = await render(
    <ReaderScreen story={storyWith({ illustrateChapters: true })} onBack={jest.fn()} />,
  );
  expect(waiting.queryByLabelText(/^Illustration for /)).toBeNull();
  waiting.unmount();

  const beforeArt = await pageOneOf(storyWith({ illustrateChapters: true }));
  // The same chapter on the next read of the story, picture attached.
  const afterArt = await pageOneOf(
    storyWith({ illustrateChapters: true, imageUrl: ART_URL }),
  );
  expect(afterArt).toBe(beforeArt);
});

it("a story with no chapter illustrations gives page one the space back", async () => {
  const withoutFrame = await pageOneOf(storyWith({}));
  const withFrame = await pageOneOf(storyWith({ illustrateChapters: true }));
  // The reserved frame is real space, not a no-op: an unillustrated story fits
  // more prose on page one than an illustrated one does.
  expect(withFrame.length).toBeLessThan(withoutFrame.length);
});

it("chapter one's art is the cover, and the cover never reaches the reader's first page", async () => {
  // The reader's first page is a title page: no cover, no genre, no byline
  // (see the opener). Chapter one's illustration IS the story cover, so a
  // plate drawn here would put the cover back on page one by the back door.
  const coverUrl = "https://example.test/covers/story/cover.png";
  const story: Story = {
    ...seed,
    coverImageUrl: coverUrl,
    illustrateChapters: true,
    chapters: [{
      ...seed.chapters[0],
      chapterNumber: 1,
      paragraphs: [BODY],
      imageUrl: coverUrl,
    }],
  };
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  expect(view.queryByLabelText(/^Illustration for /)).toBeNull();
});
