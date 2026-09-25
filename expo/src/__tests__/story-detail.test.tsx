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
const mockUseIsSubscribed = jest.fn(() => true);

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
jest.mock("@/lib/entitlements", () => ({
  useIsSubscribed: () => mockUseIsSubscribed(),
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
const renderDetail = (
  story: Story,
  onRead = jest.fn(),
  extra: { isOwn?: boolean; onAuthor?: jest.Mock } = {},
) =>
  render(
    <StoryDetailScreen
      story={story}
      onBack={jest.fn()}
      onRead={onRead}
      onAuthor={extra.onAuthor ?? jest.fn()}
      isOwn={extra.isOwn}
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
  mockUseIsSubscribed.mockReturnValue(true);
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

/**
 * The meta line is one sentence: author, date, likes, comments, and how far
 * along the story is. It is read through the rendered string because the
 * pieces are nested `Text` nodes, and what matters is the sentence a reader
 * sees, not which node holds each word.
 */
const metaText = (view: Awaited<ReturnType<typeof renderDetail>>): string =>
  JSON.stringify(view.toJSON()).replace(/\\"/g, '"');

it("renders the meta line from author, date and chapter progress", async () => {
  const story = withStory({
    storyMode: "series",
    plannedChapterCount: 7,
    chapters: series!.chapters.slice(0, 2),
    publishedOffset: 0,
    likes: 232,
  });
  const view = await renderDetail(story);

  const rendered = metaText(view);
  expect(rendered).toContain(dated(story));
  expect(rendered).toContain("2/7 chapters");
  expect(view.getByLabelText("Open comments")).toBeTruthy();
});

it("says how many chapters exist against the plan, even for one", async () => {
  // "1/7 chapters" is a true statement about a series that has one chapter of
  // seven planned, and it is how a reader learns the story is unfinished.
  const story = withStory({
    storyMode: "series",
    plannedChapterCount: 7,
    chapters: [standalone!.chapters[0]],
  });
  const view = await renderDetail(story);

  expect(metaText(view)).toContain("1/7 chapters");
});

it("calls a one-shot a Standalone", async () => {
  const story = withStory({
    storyMode: "standalone",
    plannedChapterCount: undefined,
    chapters: [standalone!.chapters[0]],
  });
  const view = await renderDetail(story);

  expect(metaText(view)).toContain("Standalone");
});

it("links the author's handle on the meta line to their profile", async () => {
  const onAuthor = jest.fn();
  const view = await renderDetail(standalone!, jest.fn(), { onAuthor });

  const links = view.getAllByLabelText(/View .*'s profile/);
  await fireEvent.press(links[0]);

  expect(onAuthor).toHaveBeenCalledWith(standalone!.authorId);
});

it("opens the comments sheet from the icon in the floating cluster", async () => {
  const view = await renderDetail(standalone!);

  await fireEvent.press(view.getByLabelText("Open comments"));

  await waitFor(() => expect(view.getByLabelText("Close comments")).toBeTruthy());
});

/**
 * "Public" is a claim only the author's own page may make: a reader of
 * someone else's story is already looking at a public one, and a private
 * story never reaches anyone else. So the marker needs both the ownership
 * and the flag, and is absent when either is missing or unknown.
 */
describe("the Public marker", () => {
  it("shows on the writer's own public story", async () => {
    const view = await renderDetail(
      withStory({ isPublic: true }),
      jest.fn(),
      { isOwn: true },
    );
    expect(view.getByLabelText("Public story")).toBeTruthy();
  });

  it("is absent on the writer's own private story", async () => {
    const view = await renderDetail(
      withStory({ isPublic: false }),
      jest.fn(),
      { isOwn: true },
    );
    expect(view.queryByLabelText("Public story")).toBeNull();
  });

  it("is absent when the flag is unknown", async () => {
    const view = await renderDetail(
      withStory({ isPublic: undefined }),
      jest.fn(),
      { isOwn: true },
    );
    expect(view.queryByLabelText("Public story")).toBeNull();
  });

  it("is absent on someone else's story even when public", async () => {
    const view = await renderDetail(withStory({ isPublic: true }));
    expect(view.queryByLabelText("Public story")).toBeNull();
  });
});

describe("the overflow menu", () => {
  it("offers Report, Block author and Download as PDF on someone else's story", async () => {
    const view = await renderDetail(standalone!);
    await fireEvent.press(view.getByLabelText("More options"));

    await waitFor(() => expect(view.getByLabelText("Report story")).toBeTruthy());
    expect(view.getByLabelText(/^Block /)).toBeTruthy();
    expect(view.getByLabelText("Download as PDF")).toBeTruthy();
  });

  it("does not offer the writer a way to block themselves", async () => {
    const view = await renderDetail(standalone!, jest.fn(), { isOwn: true });
    await fireEvent.press(view.getByLabelText("More options"));

    await waitFor(() => expect(view.getByLabelText("Report story")).toBeTruthy());
    expect(view.queryByLabelText(/^Block /)).toBeNull();
    expect(view.getByLabelText("Download as PDF")).toBeTruthy();
  });

  it("sends a non-member to the plan instead of starting a PDF download", async () => {
    mockUseIsSubscribed.mockReturnValue(false);
    const onPaywall = jest.fn();
    const view = await render(
      <StoryDetailScreen
        story={standalone!}
        onBack={jest.fn()}
        onRead={jest.fn()}
        onAuthor={jest.fn()}
        onPaywall={onPaywall}
      />,
    );

    await fireEvent.press(view.getByLabelText("More options"));
    await fireEvent.press(view.getByLabelText("Unlock PDF download with a Katha plan"));
    expect(onPaywall).toHaveBeenCalledTimes(1);
  });
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
  // The count is no longer printed anywhere - the star IS the state - so the
  // label is what says which way the control settled.
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
  });
});

/**
 * The chip row is a shelf, and only genres go on a shelf.
 *
 * It used to carry the story's themes and its content rating too, so a
 * romance labelled itself `Romance · premonition · duty · compassion · fear ·
 * sweet`. Four of those are notes the generator left about the plot and the
 * fifth is a setting; together they buried the one word that told a reader
 * what they were looking at.
 */
it("shows only genres as chips, never themes or the content rating", async () => {
  const story = withStory({
    primaryGenre: "romance",
    tags: ["premonition", "duty", "compassion", "fear"],
    contentRating: "sweet",
    audienceMode: "adult",
  });
  const view = await renderDetail(story);

  expect(view.getByText("Romance")).toBeTruthy();
  for (const noise of ["premonition", "duty", "compassion", "fear", "sweet"]) {
    expect(view.queryByText(noise)).toBeNull();
  }
  expect(view.queryByText("Kids")).toBeNull();
});

/**
 * A generated cover must survive leaving the create studio.
 *
 * This screen and the reader both read only `story.coverImage`, which names a
 * BUNDLED asset and, by its own documentation in `domain.ts`, "only ever
 * belongs to a seed story". `coverImageUrl` -- the cover actually generated for
 * this story -- was ignored by both, and only the create studio read it.
 *
 * So a writer watched their cover appear during creation and then found the
 * genre gradient in its place the moment they opened their own story. Nothing
 * errored: the art was simply never asked for.
 */
describe("the generated cover", () => {
  const GENERATED = "https://example.test/covers/story/cover.png";

  /**
   * Every image URI in the rendered tree.
   *
   * Read off the serialized tree rather than a query helper: RNTL 14 dropped
   * `UNSAFE_queryAllByProps`, and what this test actually cares about is
   * whether the URL reached the tree at all, not which node holds it.
   */
  const uris = (view: Awaited<ReturnType<typeof renderDetail>>): string =>
    JSON.stringify(view.toJSON());

  it("is rendered when the story has one", async () => {
    const view = await renderDetail({
      ...standalone!,
      coverImageUrl: GENERATED,
    } as Story);
    await waitFor(() => expect(uris(view)).toContain(GENERATED));
  });

  it("is preferred over a bundled seed asset", async () => {
    const view = await renderDetail({
      ...standalone!,
      coverImage: undefined,
      coverImageUrl: GENERATED,
    } as Story);
    await waitFor(() => expect(uris(view)).toContain(GENERATED));
  });

  it("is absent, without crashing, when the story has no cover at all", async () => {
    const view = await renderDetail({
      ...standalone!,
      coverImage: undefined,
      coverImageUrl: undefined,
    } as Story);
    await waitFor(() => expect(uris(view)).not.toContain(GENERATED));
  });
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

/**
 * An Educational story says it is unverified fiction.
 *
 * The genre's prompt module works hard at accuracy, but that is guidance to a
 * generator, not a fact check: nothing in the pipeline verifies a claim, so a
 * confident wrong date reaches a reader looking exactly like a correct one.
 * Prompt engineering cannot close that; telling the reader can.
 */
describe("the Educational disclosure", () => {
  const NOTE = /Facts in it are not\s+verified/;

  it("is shown on an educational story", async () => {
    const view = await renderDetail({
      ...standalone!,
      primaryGenre: "educational",
    } as Story);
    await waitFor(() => expect(view.getByText(NOTE)).toBeTruthy());
  });

  it("is shown for a legacy row that carries the genre in `genre` instead", async () => {
    // A disclosure that appears on some educational stories and not others is
    // worse than none: its absence would read as a statement.
    const view = await renderDetail({
      ...standalone!,
      primaryGenre: undefined,
      genre: "educational",
    } as unknown as Story);
    await waitFor(() => expect(view.getByText(NOTE)).toBeTruthy());
  });

  it("is absent on every other genre", async () => {
    const view = await renderDetail({
      ...standalone!,
      primaryGenre: "adventure",
    } as Story);
    await waitFor(() => expect(view.queryByText(NOTE)).toBeNull());
  });
});
