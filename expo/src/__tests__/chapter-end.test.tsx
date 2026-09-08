/**
 * "What's next?" end-of-chapter branching.
 *
 * `ChapterEnd` is handed a `Story` and the `Chapter` on screen and must, from
 * that alone: offer two concrete AI-suggested directions plus a write-your-own
 * escape hatch, degrade honestly when suggestions cannot be resolved, refuse
 * to offer more chapters once the story has reached its planned ending, and
 * never fire a continuation request twice for one tap-happy reader.
 */

import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import ChapterEnd, { deriveContinuationOptions } from "@/components/reader/ChapterEnd";
import ReaderScreen from "@/screens/ReaderScreen";
import type { Chapter, SeriesState, Story } from "@/types/domain";

// `jest.mock` calls are hoisted above these imports by babel-plugin-jest-hoist
// at compile time regardless of where they appear in the file, so writing
// them after the imports (rather than before, which `import/first` forbids)
// changes nothing about when they take effect.
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));

function makeSeriesState(overrides: Partial<SeriesState> = {}): SeriesState {
  return {
    central_conflict: "A locked attic keeps its secret.",
    protagonist_want: "To hear the old fort song again.",
    relationship_state: "Aaji trusts her more each visit.",
    open_hooks: ["Follow the map fragment found under the floorboard."],
    resolved_hooks: [],
    promised_payoffs: [],
    world_facts: [],
    character_changes: [],
    next_chapter_pressure: "The storm is closing in on the fort.",
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "chapter-2",
    storyId: "story-1",
    title: "Chapter 2: The Attic",
    paragraphs: ["The attic door had not opened in years."],
    chapterNumber: 2,
    chapterRole: "mid_series",
    hookType: "unanswered_question",
    hookText: "The trunk's stuck page waited, unopened.",
    isPublished: true,
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story> = {}): Story {
  const chapter1: Chapter = makeChapter({
    id: "chapter-1",
    title: "Chapter 1: Arrival",
    chapterNumber: 1,
  });
  const chapter2 = makeChapter();
  return {
    id: "story-1",
    title: "The Old Fort",
    authorId: "author-1",
    genre: "adventure",
    storyMode: "series",
    plannedChapterCount: 3,
    beats: [
      "Chapter 1 beat: arrival at the fort.",
      "Chapter 2 beat: the locked attic.",
      "Ask Aaji to open the stuck page and share the old fort song.",
    ],
    seriesState: makeSeriesState(),
    synopsis: "A child rediscovers her grandmother's fort.",
    chapters: [chapter1, chapter2],
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: 0,
    isFeatured: false,
    language: "English",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("deriveContinuationOptions", () => {
  it("reads the next planned beat and an open thread off the story", () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const options = deriveContinuationOptions(story, chapter);

    expect(options).toHaveLength(2);
    expect(options[0].prompt).toBe(
      "Ask Aaji to open the stuck page and share the old fort song.",
    );
    expect(options[1].prompt).toBe(
      "Follow the map fragment found under the floorboard.",
    );
  });

  it("returns nothing usable when the story carries no series data", () => {
    const story = makeStory({ beats: undefined, seriesState: undefined });
    const chapter = makeChapter({ hookText: undefined });
    expect(deriveContinuationOptions(story, chapter)).toHaveLength(0);
  });
});

describe("ChapterEnd", () => {
  it("renders the two suggestions plus write-your-own, always last", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const view = await render(
      <ChapterEnd story={story} chapter={chapter} continueChapter={jest.fn()} />,
    );

    await waitFor(() => {
      expect(view.getByTestId("chapter-end-option-0")).toBeTruthy();
      expect(view.getByTestId("chapter-end-option-1")).toBeTruthy();
    });

    const cards = [
      view.getByTestId("chapter-end-option-0"),
      view.getByTestId("chapter-end-option-1"),
      view.getByTestId("chapter-end-write-own"),
    ];
    // The write-your-own card is the last of the three, every time.
    expect(cards[2].props.accessibilityLabel).toBe(
      "Write your own or get a surprise",
    );
    expect(view.getByText(
      "Ask Aaji to open the stuck page and share the old fort song.",
    )).toBeTruthy();
    expect(view.getByText(
      "Follow the map fragment found under the floorboard.",
    )).toBeTruthy();
  });

  it("shows a finished state and offers no continuation at the final planned chapter", async () => {
    const finalChapter = makeChapter({
      id: "chapter-3",
      chapterNumber: 3,
      title: "Chapter 3: The Song",
    });
    const story = makeStory({
      chapters: [
        makeChapter({ id: "chapter-1", chapterNumber: 1 }),
        makeChapter({ id: "chapter-2", chapterNumber: 2 }),
        finalChapter,
      ],
    });
    const continueChapter = jest.fn();
    const view = await render(
      <ChapterEnd story={story} chapter={finalChapter} continueChapter={continueChapter} />,
    );

    expect(view.getByText("The story is complete")).toBeTruthy();
    expect(view.queryByTestId("chapter-end-option-0")).toBeNull();
    expect(view.queryByTestId("chapter-end-write-own")).toBeNull();
    expect(continueChapter).not.toHaveBeenCalled();
  });

  it("degrades to the write-your-own path with a visible explanation when suggestions fail to resolve", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const resolveOptions = jest.fn().mockRejectedValue(new Error("offline"));
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={chapter}
        resolveOptions={resolveOptions}
        continueChapter={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId("chapter-end-write-own")).toBeTruthy();
    });
    // Honest about why - not a silent, empty gap where two cards should be.
    expect(view.getByText(
      "We couldn't load suggested directions for this chapter.",
    )).toBeTruthy();
    expect(view.queryByTestId("chapter-end-option-0")).toBeNull();
  });

  it("fires exactly one continuation request on a double tap", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    let resolveCall: (value: { chapter: Chapter; model: string }) => void = () => {};
    const continueChapter = jest.fn(() =>
      new Promise<{ chapter: Chapter; model: string }>((resolve) => {
        resolveCall = resolve;
      }));
    const view = await render(
      <ChapterEnd story={story} chapter={chapter} continueChapter={continueChapter} />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-option-0")).toBeTruthy());

    // Two taps as two separate events, each its own `act`, is what a real
    // double tap actually produces - not one JS callback invoked twice in the
    // same synchronous tick.
    const option = view.getByTestId("chapter-end-option-0");
    await act(async () => {
      fireEvent.press(option);
    });
    await act(async () => {
      fireEvent.press(option);
    });

    expect(continueChapter).toHaveBeenCalledTimes(1);
    resolveCall({ chapter: makeChapter({ chapterNumber: 3 }), model: "test" });
    await waitFor(() => expect(view.getByText("New chapter ready")).toBeTruthy());
    expect(continueChapter).toHaveBeenCalledTimes(1);
  });

  it("accepts typed input in the composer and fills one in with the surprise control", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const view = await render(
      <ChapterEnd story={story} chapter={chapter} continueChapter={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-write-own")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-write-own"));
    });
    const input = await view.findByTestId("chapter-end-composer-input");

    await act(async () => {
      fireEvent.changeText(input, "She climbs down to meet the storm.");
    });
    expect(input.props.value).toBe("She climbs down to meet the storm.");

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-surprise"));
    });
    await waitFor(() => {
      const updated = view.getByTestId("chapter-end-composer-input");
      expect(updated.props.value.length).toBeGreaterThan(0);
    });
  });
});

describe("ReaderScreen renderChapterEnd wiring", () => {
  // Long enough (~3.4k characters) to paginate into several pages under the
  // test environment's default window size, so page one is provably not the
  // last page - a short chapter that happens to fit in one page would make
  // this test pass without checking anything.
  const LONG_PARAGRAPH = "Sentence one continues the story with concrete, specific detail. "
    .repeat(60);
  const longChapter = makeChapter({
    id: "long-chapter-1",
    chapterNumber: 1,
    paragraphs: [LONG_PARAGRAPH, LONG_PARAGRAPH],
  });
  const wiredStory = makeStory({ chapters: [longChapter, makeChapter({ id: "long-chapter-2", chapterNumber: 2 })] });

  it("only calls renderChapterEnd on the chapter's last page, with the chapter on screen", async () => {
    const renderChapterEnd = jest.fn((_chapter: Chapter): React.ReactNode => null);
    const view = await render(
      <ReaderScreen
        story={wiredStory}
        onBack={jest.fn()}
        renderChapterEnd={renderChapterEnd}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });

    // Page one of a multi-page chapter is not the last page.
    expect(renderChapterEnd).not.toHaveBeenCalled();

    // Pressing well past the actual last page is clamped, so this reliably
    // lands on the last page regardless of exactly how many pages this
    // chapter paginates into. Each press gets its own `act` so state commits
    // (and the page count) are current before the next one fires - batching
    // them all into one `act` would fire every press against page one.
    const pressNext = async () => {
      await act(async () => {
        fireEvent.press(view.getByLabelText("Next page"));
      });
    };
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();

    await waitFor(() => expect(renderChapterEnd).toHaveBeenCalled());
    const lastCallChapter = renderChapterEnd.mock.calls[
      renderChapterEnd.mock.calls.length - 1
    ][0];
    expect(lastCallChapter.id).toBe(longChapter.id);
  });
});

// Two findings from review.
//
// A story with no `plannedChapterCount` was offered a continuation forever,
// while `continue-story` resolves a missing count to 3 and refuses anything
// past it -- the client promising what the backend had already decided against.
//
// And the production caller omitted `onChapterReady`, so a successful
// continuation showed a confirmation and went nowhere: the chapter was never
// added to app state, so it could not be read. A "What's next?" that produces
// a chapter you cannot reach is worse than no button at all.
describe("agreeing with the server about where a series ends", () => {
  it("treats a story with no planned count as finished at the server's default", async () => {
    const story = makeStory({ plannedChapterCount: undefined });
    const third = makeChapter({ id: "chapter-3", chapterNumber: 3 });
    story.chapters = [...story.chapters, third];

    const view = await render(
      <ChapterEnd story={story} chapter={third} continueChapter={jest.fn()} />,
    );

    await waitFor(() =>
      expect(view.queryByTestId("chapter-end-option-0")).toBeNull()
    );
  });

  it("still offers a continuation before that default is reached", async () => {
    const story = makeStory({ plannedChapterCount: undefined });
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        continueChapter={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByTestId("chapter-end-option-0")).toBeTruthy()
    );
  });
});

// The offline walkthrough cannot honour a direction, and must say so.
//
// With no backend configured, `continueStory` returns canned prose, so a
// suggested or typed next step is accepted by the UI and does not shape the
// text. Silently returning prose that ignores the reader's choice teaches them
// the feature does not work; saying so is the honest option, and faking
// direction-sensitive text would be a worse lie.
describe("the offline continuation is honest about itself", () => {
  it("says the direction was not used when the chapter came from the stub", async () => {
    const story = makeStory();
    const stub = jest.fn(async () => ({
      chapter: makeChapter({ id: "chapter-3", chapterNumber: 3 }),
      model: "mock",
    }));

    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        continueChapter={stub as never}
      />,
    );

    await waitFor(() => expect(view.getByTestId("chapter-end-option-0")).toBeTruthy());
    await fireEvent.press(view.getByTestId("chapter-end-option-0"));

    await waitFor(() => expect(view.getByText(/direction you chose was not used/i)).toBeTruthy());
  });

  it("says nothing extra when a real model wrote the chapter", async () => {
    const story = makeStory();
    const real = jest.fn(async () => ({
      chapter: makeChapter({ id: "chapter-3", chapterNumber: 3 }),
      model: "meta/muse-spark-1.3",
    }));

    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        continueChapter={real as never}
      />,
    );

    await waitFor(() => expect(view.getByTestId("chapter-end-option-0")).toBeTruthy());
    await fireEvent.press(view.getByTestId("chapter-end-option-0"));

    await waitFor(() => expect(view.getByText(/New chapter ready/i)).toBeTruthy());
    expect(view.queryByText(/direction you chose was not used/i)).toBeNull();
  });
});
