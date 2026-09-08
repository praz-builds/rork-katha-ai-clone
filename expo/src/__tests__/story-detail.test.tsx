/**
 * The story landing page.
 *
 * The assertion that matters most here is the chapter list handing back the
 * right INDEX. `onRead(n)` becomes the reader's opening chapter, so an
 * off-by-one puts a reader who tapped "Chapter 2" into chapter 1 - a bug that
 * looks like nothing at all in a screenshot and is only felt while reading.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import { stories } from "@/data/seed";
import type { Story } from "@/types/domain";

const mockSetStoryBookmark = jest.fn();

// The detail screen now persists block/report through @/lib/comments, which
// pulls the Supabase client - and with it native storage - into this suite.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));
jest.mock("@/lib/api", () => ({
  setAuthorFollow: jest.fn(() => Promise.resolve({ on: true, count: 1 })),
  setStoryBookmark: (...args: unknown[]) => mockSetStoryBookmark(...args),
  setStoryLike: jest.fn(() => Promise.resolve({ on: true, count: 1 })),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  const MockIcon = () => null;
  return new Proxy({}, {
    get: () => MockIcon,
  });
});

const series = stories.find((story) => story.chapters.length > 1);
const standalone = stories.find((story) => story.chapters.length === 1);

/** `render` is async in RNTL 14, so every call site awaits this. */
const renderDetail = (story: Story, onRead = jest.fn()) =>
  render(
    <StoryDetailScreen
      story={story}
      onBack={jest.fn()}
      onRead={onRead}
      onAuthor={jest.fn()}
    />,
  );

const dated = (story: Story) => {
  const date = new Date();
  date.setDate(date.getDate() - story.publishedOffset);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const withStory = (overrides: Partial<Story>): Story => ({
  ...standalone!,
  ...overrides,
  chapters: overrides.chapters ?? standalone!.chapters,
  tags: overrides.tags ?? standalone!.tags,
});

beforeEach(() => {
  mockSetStoryBookmark.mockReset();
  mockSetStoryBookmark.mockImplementation((
    _storyId: string,
    on: boolean,
    count: number,
  ) => Promise.resolve({ on, count }));
});

it("has a series to test against in the seed catalogue", () => {
  // Guards the two tests below: if seed data ever loses its multi-chapter
  // stories, they would pass vacuously instead of failing loudly.
  expect(series).toBeDefined();
  expect(standalone).toBeDefined();
});

it("shows the title and the primary read action", async () => {
  const view = await renderDetail(series!);
  expect(view.getByText(series!.title)).toBeTruthy();
  expect(view.getByLabelText("Read story")).toBeTruthy();
});

it("opens the chapter the reader actually tapped", async () => {
  const onRead = jest.fn();
  const view = await renderDetail(series!, onRead);

  const last = series!.chapters[series!.chapters.length - 1];
  await fireEvent.press(
    view.getByLabelText(
      `Read chapter ${last.chapterNumber}: ${last.title}`,
    ),
  );

  expect(onRead).toHaveBeenCalledWith(series!.chapters.length - 1);
});

it("offers a single-chapter story a start action, not a chapter list", async () => {
  const view = await renderDetail(standalone!);
  expect(view.getByLabelText("Read story")).toBeTruthy();
  expect(view.queryByLabelText(/^Read chapter/)).toBeNull();
});

it("renders the meta line from date, format and chapter progress", async () => {
  const story = withStory({
    storyMode: "series",
    plannedChapterCount: 7,
    chapters: series!.chapters.slice(0, 2),
    publishedOffset: 0,
  });
  const view = await renderDetail(story);

  expect(view.getByText(`${dated(story)} · Series (2/7)`)).toBeTruthy();
});

it("does not render misleading chapter progress for one chapter", async () => {
  const story = withStory({
    storyMode: "series",
    plannedChapterCount: 7,
    chapters: [standalone!.chapters[0]],
  });
  const view = await renderDetail(story);

  expect(view.getByText(`${dated(story)} · Series`)).toBeTruthy();
  expect(view.queryByText(/\(1\/7\)/)).toBeNull();
});

it("falls back to the opening paragraph when the first line is absent", async () => {
  const opening = "The elevator opened on a floor nobody had built.";
  const story = withStory({
    chapters: [{
      ...standalone!.chapters[0],
      firstLine: undefined,
      paragraphs: [opening, "The hallway smelled like fresh paint."],
    }],
  });
  const view = await renderDetail(story);

  expect(view.getByText(`${opening} The hallway smelled like fresh paint.`))
    .toBeTruthy();
});

// Listen must not open a flow that cannot play anything. Generation sits behind
// an entitlement gate that defaults closed and the reader has no path that
// triggers it, so a published chapter with no audio is NOT listenable yet.
it("explains unavailable narration without crashing", async () => {
  const story = withStory({
    chapters: [{
      ...standalone!.chapters[0],
      audioUrl: undefined,
      audioUrls: undefined,
      isPublished: false,
    }],
  });
  const view = await renderDetail(story);

  await fireEvent.press(view.getByLabelText("Listen to story"));

  expect(view.getByText("Narration is not ready for this story yet."))
    .toBeTruthy();
});

// A published chapter with no audio must also say so, rather than opening a
// reader that can only show an alert. Widening this was a mistake: it promised
// narration the product cannot currently produce.
it("says so for a published chapter that has no audio yet", async () => {
  const onRead = jest.fn();
  const story = withStory({
    chapters: [{
      ...standalone!.chapters[0],
      audioUrl: undefined,
      audioUrls: undefined,
      isPublished: true,
    }],
  });
  const view = await renderDetail(story, onRead);

  await fireEvent.press(view.getByLabelText("Listen to story"));

  expect(view.getByText("Narration is not ready for this story yet."))
    .toBeTruthy();
  expect(onRead).not.toHaveBeenCalled();
});

// And the mirror: a chapter that HAS audio still opens the reader in listen
// mode, so the check above cannot pass by refusing everything.
it("opens the reader in listen mode when narration exists", async () => {
  const onRead = jest.fn();
  const story = withStory({
    chapters: [{
      ...standalone!.chapters[0],
      audioUrl: "https://example.test/audio/chapter-1.mp3",
    }],
  });
  const view = await renderDetail(story, onRead);

  await fireEvent.press(view.getByLabelText("Listen to story"));

  await waitFor(() => expect(onRead).toHaveBeenCalled());
  expect(onRead.mock.calls[0][1]).toMatchObject({ mode: "listen" });
});

it("deduplicates a double tap on save and settles on one saved state", async () => {
  mockSetStoryBookmark.mockImplementation(() =>
    new Promise<{ on: boolean; count: number }>(() => {})
  );
  const view = await renderDetail(standalone!);
  const save = view.getByLabelText("Save story");

  await fireEvent.press(save);
  await fireEvent.press(save);

  expect(mockSetStoryBookmark).toHaveBeenCalledTimes(1);
  expect(view.getByText(String(standalone!.bookmarks + 1))).toBeTruthy();
  expect(view.getByLabelText("Remove saved story")).toBeTruthy();
  view.unmount();
});

it("rolls back a failed save request", async () => {
  mockSetStoryBookmark.mockImplementation(() => {
    throw new Error("not yet deployed");
  });
  const view = await renderDetail(standalone!);

  fireEvent.press(view.getByLabelText("Save story"));

  await waitFor(() => {
    expect(view.getByLabelText("Save story")).toBeTruthy();
    expect(view.getByText(String(standalone!.bookmarks))).toBeTruthy();
  });
});

it("renders the real content rating and omits absent flags", async () => {
  const story = withStory({
    contentRating: "sweet",
    audienceMode: "adult",
  });
  const view = await renderDetail(story);

  expect(view.getAllByText("sweet").length).toBeGreaterThan(0);
  expect(view.queryByText("Kids")).toBeNull();
});

/**
 * Two findings from review, both about state this screen was inventing rather
 * than reading.
 *
 * Every engagement control started at `false`, so a reader who had already
 * liked a story saw an unfilled heart and their next tap sent `on: true` for a
 * like that already existed. And `onRead` has always carried a mode, but the
 * call site dropped it, so Listen opened the reader silently and was
 * indistinguishable from Read.
 */
describe("state the screen reads rather than assumes", () => {
  it("shows a story the viewer already saved as saved", async () => {
    const saved = await renderDetail({
      ...standalone!,
      viewerHasBookmarked: true,
    } as Story);
    // The label is the state: "Remove saved story" only renders when the
    // screen believes this viewer has already saved it.
    await waitFor(() =>
      expect(saved.getByLabelText("Remove saved story")).toBeTruthy()
    );

    const unsaved = await renderDetail({
      ...standalone!,
      viewerHasBookmarked: false,
    } as Story);
    await waitFor(() =>
      expect(unsaved.getByLabelText("Save story")).toBeTruthy()
    );
  });

  it("tells the caller which of Read and Listen was pressed", async () => {
    const onRead = jest.fn();
    const view = await renderDetail(standalone! as Story, onRead);

    await fireEvent.press(view.getByLabelText("Read story"));
    await waitFor(() => expect(onRead).toHaveBeenCalled());
    expect(onRead.mock.calls[0][1]).toMatchObject({ mode: "read" });
  });
});
