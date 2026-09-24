/**
 * The foot of the last page: comments, engagement, and the honest failure of a
 * background save.
 *
 * THREE THINGS WERE WRONG THERE, all reported off the running app.
 *
 * 1. `ReaderScreen` carried three hardcoded comments in a module constant --
 *    "Mira R.", "Dev S." and "Aanya K." discussing a lighthouse metaphor -- and
 *    rendered them under EVERY story. A brand-new story about a nurse in Kochi
 *    ended with three strangers admiring a lighthouse that is not in it, while
 *    the story detail page for the same story correctly reported zero comments.
 * 2. A guest could like, save, follow and comment. All four wrote to local
 *    state that nothing would ever persist, which is a control that looks like
 *    it works and does not.
 * 3. A chapter save that the server refuses now lands after the editor has
 *    closed, so the reader has to be the one to say so -- with a retry that
 *    still holds the writer's text.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockFetchThread = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return { ...actual, fetchThread: (...args: [string]) => mockFetchThread(...args) };
});
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, publishStory: jest.fn().mockResolvedValue(undefined) };
});
jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

const mockSaveChapter = jest.fn();
jest.mock("@/lib/chapter-save", () => {
  const actual = jest.requireActual("@/lib/chapter-save");
  return { ...actual, saveChapter: (...args: unknown[]) => mockSaveChapter(...args) };
});

import { __resetChapterSaveQueue, queueChapterSave } from "@/lib/chapter-save-queue";
import ReaderScreen from "@/screens/ReaderScreen";
import type { Chapter, Story } from "@/types/domain";
/* eslint-enable import/first */

const chapter: Chapter = {
  id: "chapter-1",
  storyId: "story-1",
  title: "The Ward at Night",
  paragraphs: ["The ward in Kochi was quiet for the first time in a week."],
  chapterNumber: 1,
  isPublished: true,
};

const story: Story = {
  id: "story-1",
  title: "The Ward at Night",
  authorId: "author-1",
  genre: "contemporary",
  storyMode: "standalone",
  synopsis: "A nurse in Kochi finishes a long week.",
  chapters: [chapter],
  likes: 12,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

type RenderedView = Awaited<ReturnType<typeof render>>;

/** Walks to the last page, where the engagement block lives. */
async function openChapterEnd(view: RenderedView) {
  await act(async () => {
    fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      fireEvent.press(view.getByLabelText("Next page"));
    });
  }
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  __resetChapterSaveQueue();
  mockFetchThread.mockResolvedValue([]);
  mockSaveChapter.mockResolvedValue({ titleSaved: true });
});

afterEach(() => {
  cleanup();
});

it("shows this story's real comments, and none that belong to another", async () => {
  mockFetchThread.mockResolvedValue([
    {
      id: "c-1",
      parentId: null,
      authorName: "Rhea",
      body: "The ward scene is exactly right.",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      score: 1,
      myVote: 0,
      deleted: false,
    },
  ]);
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openChapterEnd(view);

  await waitFor(() => expect(view.getByText("The ward scene is exactly right.")).toBeTruthy());
  expect(mockFetchThread).toHaveBeenCalledWith("story-1");
  // The seeded strangers are gone from the module, not merely unrendered.
  expect(view.queryByText(/lighthouse metaphor/)).toBeNull();
  expect(view.queryByText("Mira R.")).toBeNull();
  expect(view.queryByTestId("reader-comments-empty")).toBeNull();
});

it("says so, plainly, when a story genuinely has no comments", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openChapterEnd(view);

  await waitFor(() => expect(view.getByTestId("reader-comments-empty")).toBeTruthy());
  expect(view.getByText("Comments (0)")).toBeTruthy();
});

it("sends a guest to sign-in instead of pretending to engage", async () => {
  const onRequireSignIn = jest.fn();
  const view = await render(
    <ReaderScreen story={story} onBack={jest.fn()} onRequireSignIn={onRequireSignIn} />,
  );
  await openChapterEnd(view);
  await waitFor(() => expect(view.getByTestId("reader-follow")).toBeTruthy());

  // Like, save and share are no longer at the end of a chapter -- a strip of
  // counters under the last sentence is the worst moment to ask somebody to
  // rate what they just read. What is still here, and still gated, is
  // following the author and posting a comment.
  expect(view.queryByTestId("reader-like")).toBeNull();
  expect(view.queryByTestId("reader-save")).toBeNull();

  await act(async () => {
    fireEvent.press(view.getByTestId("reader-follow"));
  });
  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Add a comment"), "Lovely.");
    fireEvent.press(view.getByTestId("reader-comment-send"));
  });

  expect(onRequireSignIn).toHaveBeenCalledTimes(2);
  // And nothing moved: no "Following", no posted comment.
  expect(view.getByText("Follow")).toBeTruthy();
  expect(view.queryByText("Lovely.")).toBeNull();
});

it("leaves reading itself completely open to a guest", async () => {
  const onRequireSignIn = jest.fn();
  const view = await render(
    <ReaderScreen story={story} onBack={jest.fn()} onRequireSignIn={onRequireSignIn} />,
  );

  await act(async () => {
    fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Preferences"));
  });

  // Chrome, preferences and page turning are not engagement and are not gated.
  expect(onRequireSignIn).not.toHaveBeenCalled();
});

/*
  The author card at the end of a chapter was a plain View: tapping the avatar
  or the name did nothing, and the reader had no prop to navigate with. It now
  hands the story's author id to `onAuthor`, which App wires to AuthorScreen
  exactly as the story page's author row does.
*/
it("opens the author's profile from the chapter-end author card", async () => {
  const onAuthor = jest.fn();
  const view = await render(
    <ReaderScreen story={story} onBack={jest.fn()} onAuthor={onAuthor} />,
  );
  await openChapterEnd(view);
  await waitFor(() => expect(view.getByTestId("reader-author")).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId("reader-author"));
  });
  expect(onAuthor).toHaveBeenCalledWith("author-1");
});

it("engages normally with no gate supplied", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);
  await openChapterEnd(view);
  await waitFor(() => expect(view.getByTestId("reader-follow")).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId("reader-follow"));
  });
  expect(view.getByText("Following")).toBeTruthy();
});

/*
  The other half of the optimistic save. The editor is gone by the time the
  request settles, so a refusal has to surface here -- and a Retry has to
  re-send the words the writer typed, not whatever is on the page.
*/
it("reports a background save that was refused, and retries with the same text", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Could not reach the server."));
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  const input = {
    storyId: "story-1",
    chapterId: "chapter-1",
    chapterNumber: 1,
    body: "The ward in Kochi was quiet, and she noticed.",
    isPublished: true,
  };
  await act(async () => {
    queueChapterSave(input);
  });

  await waitFor(() => expect(view.getByTestId("reader-save-failed")).toBeTruthy());
  expect(view.getByText("Could not reach the server.")).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByTestId("reader-save-retry"));
  });
  expect(mockSaveChapter).toHaveBeenLastCalledWith(input);
  await waitFor(() => expect(view.queryByTestId("reader-save-failed")).toBeNull());
});

it("never shows a banner for a background save that succeeded", async () => {
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    queueChapterSave({
      storyId: "story-1",
      chapterId: "chapter-1",
      chapterNumber: 1,
      body: "Quietly persisted.",
      isPublished: true,
    });
  });

  expect(view.queryByTestId("reader-save-failed")).toBeNull();
});

it("lets the writer dismiss a failure they have decided to live with", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline."));
  const view = await render(<ReaderScreen story={story} onBack={jest.fn()} />);

  await act(async () => {
    queueChapterSave({
      storyId: "story-1",
      chapterId: "chapter-1",
      chapterNumber: 1,
      body: "Kept locally.",
      isPublished: true,
    });
  });
  await waitFor(() => expect(view.getByTestId("reader-save-failed")).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId("reader-save-dismiss"));
  });
  expect(view.queryByTestId("reader-save-failed")).toBeNull();
});
