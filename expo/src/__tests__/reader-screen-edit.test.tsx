/**
 * Who gets Edit and Reimagine, and when - and what the chrome does before then.
 *
 * Edit is the author's, over a chapter that is finished. Reimagine is
 * everybody's - a reader of somebody else's story gets a private copy - and is
 * likewise offered only once there is a whole chapter to reimagine. Neither is
 * ever rendered disabled: a greyed control mid-generation is a question the
 * writer cannot answer, so both are simply absent until the chapter lands.
 *
 * The chapter still being written goes further than that: the chrome does not
 * open AT ALL. Nothing in it operates on prose that does not exist yet - you
 * cannot search a chapter that is half written, scrub to a page that has not
 * settled, or narrate an unfinished one - so a tap during generation is
 * deliberately inert rather than raising a tray of controls that cannot be
 * used. It starts working the instant the chapter lands.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockGenerateStoryStreaming = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  let n = 0;
  return {
    ...actual,
    generateStoryStreaming: (...args: unknown[]) =>
      mockGenerateStoryStreaming(...args),
    createGenerationRequestId: () => `reader-screen-edit-${++n}`,
    publishStory: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock("@/lib/draft-storage", () => ({
  loadDraft: jest.fn(),
  saveDraft: jest.fn(),
  clearDraft: jest.fn(),
}));

import { stories } from "@/data/seed";
import {
  __resetGenerationSessions,
  getGeneration,
  provisionalStory,
  startStoryGeneration,
} from "@/lib/generation-session";
import ReaderScreen from "@/screens/ReaderScreen";
import type { CreateDraft, Story } from "@/types/domain";
/* eslint-enable import/first */

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
// The queue is real here on purpose -- these tests exercise the reader's whole
// edit round trip, and the queue is now part of it. Only the network primitive
// underneath it is faked.
jest.mock("@/lib/chapter-save", () => {
  const actual = jest.requireActual("@/lib/chapter-save");
  return { ...actual, saveChapter: jest.fn(() => Promise.resolve({ titleSaved: true })) };
});

const baseStory = stories.find((item) => item.chapters.length > 1)!;

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

it("does not show the Edit control for a story the reader does not own", async () => {
  const view = await render(<ReaderScreen story={baseStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });

  expect(view.queryByLabelText("Edit")).toBeNull();
  // Reimagine is not author-only: a reader rewrites into a private copy of
  // their own (created-flow spec §4), so the control stays.
  expect(view.getByLabelText("Reimagine")).toBeTruthy();
});

it("offers Reimagine to a reader who did not write the story", async () => {
  const onReimagine = jest.fn();
  const view = await render(
    <ReaderScreen story={baseStory} onBack={jest.fn()} onReimagine={onReimagine} />,
  );

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Reimagine"));
  });

  expect(onReimagine).toHaveBeenCalledTimes(1);
});

it("opens the notepad for a story the reader owns and closes it again", async () => {
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });

  await waitFor(() => expect(view.getByText("Edit chapter")).toBeTruthy());
  expect(view.getByLabelText("Chapter text")).toBeTruthy();

  await act(async () => {
    await fireEvent.press(view.getByTestId("edit-chapter-back"));
  });
  await waitFor(() => expect(view.queryByText("Edit chapter")).toBeNull());
});

it("round-trips a chapter with a deliberately blank paragraph, preserving every paragraph's index", async () => {
  jest.useFakeTimers();
  const ownStory = { ...baseStory, authorId: "me" };
  const view = await render(<ReaderScreen story={ownStory} onBack={jest.fn()} />);

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });
  await waitFor(() => expect(view.getByLabelText("Chapter text")).toBeTruthy());

  // Paragraph 0, an intentionally blank paragraph 1, then paragraph 2 - the
  // exact `join("\n\n")` shape a real chapter with a deliberate blank line
  // between two paragraphs produces. Splitting on `/\n\s*\n/` and dropping
  // empty parts would collapse the blank one away and pull "Paragraph two."
  // down an index.
  const withBlankParagraph = "Paragraph zero.\n\n\n\nParagraph two.";
  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), withBlankParagraph);
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });
  await act(async () => {
    jest.runAllTimers();
  });
  await waitFor(() => expect(view.queryByText("Edit chapter")).toBeNull());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Edit"));
  });
  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(withBlankParagraph)
  );
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// The chapter that is still being written
// ---------------------------------------------------------------------------

/** Long enough that the settle rule releases several finished pages. */
const PARAGRAPH =
  "She pushed it open and the hinges gave without a sound, which was the " +
  "first thing that felt wrong about it. Beyond the frame the library went " +
  "on exactly as it did on the other side, the same shelves, the same brass " +
  "lamps, the same dust turning slowly in the same slant of afternoon light, " +
  "and that was the second.\n\n";
const REVEALED = "The door was not there yesterday.\n\n" + PARAGRAPH.repeat(9);

const LIVE_DRAFT: CreateDraft = {
  primaryGenre: "adventure",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "A child finds a door in an old library that was not there yesterday.",
  language: "English",
  visibility: "private",
  characters: [],
  isSeries: false,
};

const FINISHED_STORY: Story = {
  id: "story-live-1",
  title: "The Quiet Door",
  authorId: "me",
  genre: "adventure",
  storyMode: "standalone",
  synopsis: "A child finds a door.",
  chapters: [{
    id: "chapter-live-1",
    storyId: "story-live-1",
    title: "The Quiet Door",
    paragraphs: REVEALED.trim().split("\n\n"),
    chapterNumber: 1,
    chapterRole: "standalone",
    isPublished: false,
  }],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

/**
 * A generation whose stream this test drives by hand.
 *
 * The transport is not what is under test here - `create-streaming-integration`
 * drives a real SSE response end to end - so the handlers are captured and
 * called directly, which keeps this file about what the reader does with the
 * prose rather than about how it arrived.
 */
function liveSession() {
  let handlers: { onDelta: (chunk: string) => void } = { onDelta: () => {} };
  let finish: (story: Story) => void = () => {};
  mockGenerateStoryStreaming.mockImplementation((
    _draft: unknown,
    _requestId: unknown,
    given: { onDelta: (chunk: string) => void },
  ) => {
    handlers = given;
    return new Promise<Story>((resolve) => {
      finish = resolve;
    });
  });
  const session = startStoryGeneration({ draft: LIVE_DRAFT });
  return {
    id: session.id,
    async write(chunk: string) {
      await act(async () => {
        handlers.onDelta(chunk);
        await Promise.resolve();
      });
    },
    async complete() {
      await act(async () => {
        finish(FINISHED_STORY);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

async function renderLive(sessionId: string) {
  const session = getGeneration(sessionId)!;
  return await render(
    <ReaderScreen
      story={provisionalStory(session)!}
      liveSessionId={sessionId}
      onBack={jest.fn()}
      onReimagine={jest.fn()}
    />,
  );
}

describe("the chrome while the chapter is still being written", () => {
  beforeEach(() => {
    __resetGenerationSessions();
    mockGenerateStoryStreaming.mockReset();
  });

  afterEach(() => {
    __resetGenerationSessions();
  });

  it("does not open on a tap, and opens on the very next one after the chapter lands", async () => {
    const live = liveSession();
    await live.write(REVEALED);
    const view = await renderLive(live.id);

    // The reader is reading: settled pages, and the last one says the rest is
    // still coming.
    await waitFor(() => expect(view.getByTestId("reader-pager")).toBeTruthy());
    expect(view.getByLabelText("Still writing")).toBeTruthy();

    // A tap does nothing. Not a disabled tray, not a tray with three of six
    // controls in it - nothing.
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });
    expect(view.queryByLabelText("Edit")).toBeNull();
    expect(view.queryByLabelText("Reimagine")).toBeNull();
    // The chrome's own tray is mounted at all times and animated in and out,
    // so its presence in the tree proves nothing either way. The find bar is
    // rendered only while the chrome is actually open, which makes its absence
    // the observable half of "the tray did not come up".
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Search chapter"));
    });
    expect(view.queryByLabelText("Find in chapter")).toBeNull();

    await live.complete();
    await waitFor(() => expect(view.queryByLabelText("Still writing")).toBeNull());

    // And the tap that was refused a moment ago now works, first time. The
    // refused tap must not have been banked as a toggle: if it had, this one
    // would close a tray the reader never saw open.
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });
    await waitFor(() => expect(view.getByLabelText("Edit")).toBeTruthy());
    expect(view.getByLabelText("Reimagine")).toBeTruthy();
  });

  /**
   * The page label names the page and nothing else.
   *
   * It used to read "Page 1 of 4 · writing", which put two moving numbers in
   * front of the reader: a total that climbs as the chapter is written, and a
   * status that repeats what the writing tail already says at the point where
   * the writing is actually happening. Watching "of 4" become "of 9" while
   * you read is the book growing under you.
   */
  it("names the page it is on, without a running total or a status", async () => {
    const live = liveSession();
    await live.write(REVEALED);
    const view = await renderLive(live.id);

    await waitFor(() =>
      expect(view.getByTestId("reader-page-label-0")).toHaveTextContent("Page 1")
    );
    expect(view.queryByText(/· writing/)).toBeNull();
    // No page CARRIES a running total. The chrome's slider readout still
    // shows one, and should: it is a navigation control in one fixed place at
    // the foot of the screen, where knowing how far through you are is the
    // whole point. What the reader objected to was the total riding along
    // with the prose, at a different height on every page.
    for (const label of view.getAllByTestId(/^reader-page-label-\d+$/)) {
      expect(label).not.toHaveTextContent(/of \d+/);
    }

    await live.complete();
    // Still just the page, once the chapter has landed.
    await waitFor(() =>
      expect(view.getByTestId("reader-page-label-0")).toHaveTextContent("Page 1")
    );
  });
});
