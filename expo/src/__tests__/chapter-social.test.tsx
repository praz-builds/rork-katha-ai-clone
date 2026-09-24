/**
 * The chapter-end social layer: the author card and the comments.
 *
 * What the founder reported off the running app (2026-09-24), and review:
 *
 * 1. Tapping the author's avatar or name did nothing.
 * 2. Comments looked like they only ever showed the viewer's own. The server
 *    read is not viewer-scoped (see `comments/index.test.ts`); what the client
 *    got wrong is that ANY failed read rendered as "Comments (0) / No comments
 *    yet", and a post the server never kept could stay on screen for its
 *    writer alone.
 * 3. The section was drawn on the book page with hairline dividers. It is now
 *    two cards in the app's own colours (contrast: `reading-themes.test.ts`).
 * 4. Follow was local state only, and was offered on your own story.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockFetchThreadPage = jest.fn();
const mockPostComment = jest.fn();

jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return {
    ...actual,
    fetchThreadPage: (...args: unknown[]) => mockFetchThreadPage(...args),
    postComment: (...args: unknown[]) => mockPostComment(...args),
  };
});

const mockSetAuthorFollow = jest.fn();
jest.mock("@/lib/api", () => ({
  setAuthorFollow: (...args: unknown[]) => mockSetAuthorFollow(...args),
}));

import ChapterSocial from "@/components/reader/ChapterSocial";
import { READER_THEMES } from "@/lib/reading-themes";
import type { StoryAuthor } from "@/lib/story-author";
/* eslint-enable import/first */

const HOUR = 60 * 60 * 1000;
const AUTHOR_ID = "3ae4750d-f24a-4dc9-a810-991dae1ce029";

const WRITER: StoryAuthor = {
  displayName: "@mira",
  bio: "Writes about trains.",
  followers: 10,
  isFollowing: null,
  canOpen: true,
  canFollow: true,
  isOwn: false,
};

function serverComment(id: string, authorName: string, body: string, ageMs: number) {
  return {
    id,
    parentId: null,
    authorName,
    body,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
    score: 0,
    myVote: 0,
    deleted: false,
  };
}

function page(comments: ReturnType<typeof serverComment>[], total: number | null = comments.length) {
  return { comments, total };
}

function renderSocial(overrides: Partial<React.ComponentProps<typeof ChapterSocial>> = {}) {
  return render(
    <ChapterSocial
      storyId="story-1"
      authorId={AUTHOR_ID}
      chapterId="chapter-1"
      author={WRITER}
      theme={READER_THEMES.sepia}
      requireSignIn={() => false}
      {...overrides}
    />,
  );
}

/** Resolves only when told to, so a test can act while a request is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockFetchThreadPage.mockResolvedValue(page([]));
  mockSetAuthorFollow.mockImplementation((_id: string, on: boolean, count: number) =>
    Promise.resolve({ on, count }));
});

afterEach(() => {
  cleanup();
});

describe("the author card", () => {
  it("opens the author's profile from the avatar and name", async () => {
    const onAuthor = jest.fn();
    const view = await renderSocial({ onAuthor });

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-author"));
    });
    expect(onAuthor).toHaveBeenCalledWith(AUTHOR_ID);
    expect(view.getByLabelText("View @mira's profile")).toBeTruthy();
  });

  it.each(["", "me", "kathaai"])("is not a link for an id with no profile behind it (%j)", async (authorId) => {
    const onAuthor = jest.fn();
    const view = await renderSocial({
      onAuthor,
      authorId,
      author: { ...WRITER, displayName: "A Katha writer", canOpen: false, canFollow: false },
    });
    expect(view.queryByTestId("reader-author")).toBeNull();
    expect(view.queryByTestId("reader-follow")).toBeNull();
    expect(onAuthor).not.toHaveBeenCalled();
  });

  it("offers no Follow on your own story", async () => {
    const view = await renderSocial({
      author: { displayName: "You", followers: 0, isFollowing: null, canOpen: true, canFollow: false, isOwn: true },
    });
    expect(view.getByText("You")).toBeTruthy();
    expect(view.queryByTestId("reader-follow")).toBeNull();
  });

  it("does not navigate when Follow is pressed", async () => {
    const onAuthor = jest.fn();
    const view = await renderSocial({ onAuthor });

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(onAuthor).not.toHaveBeenCalled();
    expect(view.getByText("Following")).toBeTruthy();
    expect(view.getByTestId("reader-follow").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("saves the follow, and takes it back if the server refuses", async () => {
    const view = await renderSocial();

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(mockSetAuthorFollow).toHaveBeenCalledWith(AUTHOR_ID, true, 11);
    expect(view.getByText("Following")).toBeTruthy();

    mockSetAuthorFollow.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    await waitFor(() => expect(view.getByText("Following")).toBeTruthy());
    expect(mockSetAuthorFollow).toHaveBeenLastCalledWith(AUTHOR_ID, false, 9);
  });

  it("drops a second tap while the first follow is in flight", async () => {
    const pending = deferred<{ on: boolean; count: number }>();
    mockSetAuthorFollow.mockReturnValueOnce(pending.promise);
    const view = await renderSocial();

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(mockSetAuthorFollow).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ on: true, count: 11 });
    });
    expect(view.getByText("Following")).toBeTruthy();
  });

  it("starts from the server's follow", async () => {
    const view = await renderSocial({ author: { ...WRITER, isFollowing: true } });
    expect(view.getByText("Following")).toBeTruthy();
  });

  it("never lets a late profile answer override a tap made first", async () => {
    // The profile has not answered yet (null); the reader follows.
    const view = await renderSocial({ author: { ...WRITER, isFollowing: null } });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(view.getByText("Following")).toBeTruthy();

    // Then the profile lands, read before the follow was saved.
    await act(async () => {
      view.rerender(
        <ChapterSocial
          storyId="story-1"
          authorId={AUTHOR_ID}
          chapterId="chapter-1"
          author={{ ...WRITER, isFollowing: false }}
          theme={READER_THEMES.sepia}
          requireSignIn={() => false}
        />,
      );
    });
    expect(view.getByText("Following")).toBeTruthy();
  });
});

describe("the comments", () => {
  it("shows every reader's comments, newest first, under the server's count", async () => {
    mockFetchThreadPage.mockResolvedValue(
      page([
        serverComment("c-old", "Rhea", "Older one.", 5 * HOUR),
        serverComment("c-new", "Dev", "Newer one.", 1 * HOUR),
      ], 140),
    );
    const view = await renderSocial();

    await waitFor(() => expect(view.getByText("Comments (140)")).toBeTruthy());
    expect(mockFetchThreadPage).toHaveBeenCalledWith("story-1");
    const texts = view.getAllByText(/one\.$/).map((node) => node.props.children);
    expect(texts).toEqual(["Newer one.", "Older one."]);
  });

  it("shows no number when the server gave none", async () => {
    mockFetchThreadPage.mockResolvedValue(page([serverComment("c-1", "Rhea", "Hi.", HOUR)], null));
    const view = await renderSocial();
    await waitFor(() => expect(view.getByText("Hi.")).toBeTruthy());
    expect(view.getByText("Comments")).toBeTruthy();
  });

  it("never reports a failed read as an empty thread, and retries", async () => {
    mockFetchThreadPage.mockRejectedValueOnce(new Error("401"));
    const view = await renderSocial();

    await waitFor(() => expect(view.getByTestId("reader-comments-failed")).toBeTruthy());
    expect(view.queryByTestId("reader-comments-empty")).toBeNull();
    expect(view.queryByText("Comments (0)")).toBeNull();

    mockFetchThreadPage.mockResolvedValueOnce(page([serverComment("c-1", "Rhea", "Loved it.", HOUR)]));
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comments-retry"));
    });
    await waitFor(() => expect(view.getByText("Loved it.")).toBeTruthy());
    expect(view.getByText("Comments (1)")).toBeTruthy();
  });

  it("clears the last story's comments the moment the story changes", async () => {
    mockFetchThreadPage.mockResolvedValueOnce(page([serverComment("c-1", "Rhea", "About story one.", HOUR)]));
    const view = await renderSocial();
    await waitFor(() => expect(view.getByText("About story one.")).toBeTruthy());

    mockFetchThreadPage.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      view.rerender(
        <ChapterSocial
          storyId="story-2"
          authorId={AUTHOR_ID}
          chapterId="chapter-9"
          author={WRITER}
          theme={READER_THEMES.sepia}
          requireSignIn={() => false}
        />,
      );
    });
    expect(view.queryByText("About story one.")).toBeNull();
  });

  it("replaces the optimistic row with the server's own row", async () => {
    mockPostComment.mockResolvedValue(serverComment("c-9", "prasanna", "Kept.", 0));
    const view = await renderSocial();
    await waitFor(() => expect(view.getByTestId("reader-comments-empty")).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Kept.");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comment-send"));
    });

    await waitFor(() => expect(view.getByText("prasanna")).toBeTruthy());
    expect(mockPostComment).toHaveBeenCalledWith("story-1", "Kept.", undefined, "chapter-1");
    expect(view.getByText("Comments (1)")).toBeTruthy();
  });

  it("takes back a comment the server did not keep, and says so on the page", async () => {
    mockPostComment.mockResolvedValue(null);
    const view = await renderSocial();
    await waitFor(() => expect(view.getByTestId("reader-comments-empty")).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Only I would see this.");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comment-send"));
    });

    // Inline, not an Alert: `Alert.alert` does nothing on web.
    await waitFor(() => expect(view.getByTestId("reader-comment-failed")).toBeTruthy());
    expect(view.queryByText("Only I would see this.")).toBeNull();
    expect(view.getByLabelText("Add a comment").props.value).toBe("Only I would see this.");
  });

  it("does not overwrite a newer draft when an earlier post fails", async () => {
    const pending = deferred<null>();
    mockPostComment.mockReturnValueOnce(pending.promise);
    const view = await renderSocial();
    await waitFor(() => expect(view.getByTestId("reader-comments-empty")).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "First.");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comment-send"));
    });
    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Second, still typing");
    });
    await act(async () => {
      pending.resolve(null);
    });

    expect(view.getByLabelText("Add a comment").props.value).toBe("Second, still typing");
    expect(view.getByTestId("reader-comment-failed")).toBeTruthy();
  });

  it("sends a guest to sign-in without posting", async () => {
    const requireSignIn = jest.fn(() => true);
    const view = await renderSocial({ requireSignIn });

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Hello.");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comment-send"));
    });
    expect(requireSignIn).toHaveBeenCalledTimes(1);
    expect(mockPostComment).not.toHaveBeenCalled();
  });
});

describe("the surface", () => {
  it("draws both cards off the page, with no border", async () => {
    const view = await renderSocial();
    for (const id of ["reader-author-card", "reader-comments-card"]) {
      const style = Object.assign({}, ...[view.getByTestId(id).props.style].flat(Infinity));
      expect(style.backgroundColor).toBe(READER_THEMES.sepia.social.surface);
      expect(style.backgroundColor).not.toBe(READER_THEMES.sepia.background);
      expect(style.borderWidth).toBeUndefined();
      expect(style.boxShadow).toBeTruthy();
    }
  });
});
