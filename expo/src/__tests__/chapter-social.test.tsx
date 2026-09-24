/**
 * The chapter-end social layer: the author card and the comments.
 *
 * Three things the founder reported off the running app (2026-09-24):
 *
 * 1. Tapping the author's avatar or name did nothing. The row was a plain
 *    View; the reader had no way to reach `AuthorScreen` at all.
 * 2. Comments looked like they only ever showed the viewer's own. The server
 *    read is not viewer-scoped (see `comments/index.test.ts`); what the client
 *    got wrong is that ANY failed read rendered as "Comments (0) / No comments
 *    yet", and a post the server never kept could stay on screen as if it had
 *    been -- visible to exactly one person.
 * 3. The section was drawn on the book page with hairline dividers. It is now
 *    two cards in the app's own colours. The contrast of those colours is
 *    checked in `reading-themes.test.ts`.
 */

/* eslint-disable import/first */
import React from "react";
import { Alert } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockFetchThread = jest.fn();
const mockPostComment = jest.fn();

jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return {
    ...actual,
    fetchThread: (...args: unknown[]) => mockFetchThread(...args),
    postComment: (...args: unknown[]) => mockPostComment(...args),
  };
});

const mockSetAuthorFollow = jest.fn();
jest.mock("@/lib/api", () => ({
  setAuthorFollow: (...args: unknown[]) => mockSetAuthorFollow(...args),
}));

import ChapterSocial from "@/components/reader/ChapterSocial";
import { READER_THEMES } from "@/lib/reading-themes";
/* eslint-enable import/first */

const HOUR = 60 * 60 * 1000;

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

function renderSocial(overrides: Partial<React.ComponentProps<typeof ChapterSocial>> = {}) {
  return render(
    <ChapterSocial
      storyId="story-1"
      authorId="author-uuid"
      chapterId="chapter-1"
      author={{ displayName: "Katha AI", bio: "The house account." }}
      theme={READER_THEMES.sepia}
      requireSignIn={() => false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockFetchThread.mockResolvedValue([]);
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
    expect(onAuthor).toHaveBeenCalledTimes(1);
    expect(onAuthor).toHaveBeenCalledWith("author-uuid");
    expect(view.getByLabelText("View Katha AI's profile")).toBeTruthy();
  });

  it("does not navigate when Follow is pressed", async () => {
    const onAuthor = jest.fn();
    const view = await renderSocial({ onAuthor });

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(onAuthor).not.toHaveBeenCalled();
    expect(view.getByText("Following")).toBeTruthy();
  });

  it("saves the follow, and takes it back if the server refuses", async () => {
    const view = await renderSocial({ author: { displayName: "Katha AI", followers: 10 } });

    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    expect(mockSetAuthorFollow).toHaveBeenCalledWith("author-uuid", true, 11);
    expect(view.getByText("Following")).toBeTruthy();

    mockSetAuthorFollow.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-follow"));
    });
    await waitFor(() => expect(view.getByText("Following")).toBeTruthy());
    expect(mockSetAuthorFollow).toHaveBeenLastCalledWith("author-uuid", false, 9);
  });

  it("starts from the follow the story already carries", async () => {
    const view = await renderSocial({ initialFollowing: true });
    expect(view.getByText("Following")).toBeTruthy();
  });

  it("is not a button when there is nowhere to go", async () => {
    const view = await renderSocial();
    expect(view.queryByTestId("reader-author")).toBeNull();
    expect(view.getByText("Katha AI")).toBeTruthy();
  });
});

describe("the comments", () => {
  it("shows every reader's comments, newest first", async () => {
    mockFetchThread.mockResolvedValue([
      serverComment("c-old", "Rhea", "Older one.", 5 * HOUR),
      serverComment("c-new", "Dev", "Newer one.", 1 * HOUR),
    ]);
    const view = await renderSocial();

    await waitFor(() => expect(view.getByText("Comments (2)")).toBeTruthy());
    expect(mockFetchThread).toHaveBeenCalledWith("story-1");
    const texts = view.getAllByText(/one\.$/).map((node) => node.props.children);
    expect(texts).toEqual(["Newer one.", "Older one."]);
  });

  it("never reports a failed read as an empty thread, and retries", async () => {
    mockFetchThread.mockRejectedValueOnce(new Error("401"));
    const view = await renderSocial();

    await waitFor(() => expect(view.getByTestId("reader-comments-failed")).toBeTruthy());
    expect(view.queryByTestId("reader-comments-empty")).toBeNull();
    expect(view.queryByText("Comments (0)")).toBeNull();
    expect(view.getByText("Comments")).toBeTruthy();

    mockFetchThread.mockResolvedValueOnce([serverComment("c-1", "Rhea", "Loved it.", HOUR)]);
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comments-retry"));
    });
    await waitFor(() => expect(view.getByText("Loved it.")).toBeTruthy());
    expect(view.getByText("Comments (1)")).toBeTruthy();
    expect(mockFetchThread).toHaveBeenCalledTimes(2);
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
    expect(view.queryByText("You")).toBeNull();
  });

  it("takes back a comment the server did not keep, instead of showing it to its writer alone", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockPostComment.mockResolvedValue(null);
    const view = await renderSocial();
    await waitFor(() => expect(view.getByTestId("reader-comments-empty")).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Only I would see this.");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("reader-comment-send"));
    });

    await waitFor(() => expect(alert).toHaveBeenCalledWith("Comment not posted", expect.any(String)));
    expect(view.queryByText("Only I would see this.")).toBeNull();
    // The words come back to the box, so nothing typed is lost.
    expect(view.getByLabelText("Add a comment").props.value).toBe("Only I would see this.");
    alert.mockRestore();
  });

  it("sends a guest to sign-in without posting", async () => {
    const requireSignIn = jest.fn(() => true);
    const view = await renderSocial({ requireSignIn });

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Add a comment"), "Hello.");
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
