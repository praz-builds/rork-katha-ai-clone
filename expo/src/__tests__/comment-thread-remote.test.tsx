/**
 * The server-backed comment thread.
 *
 * `comment-thread.test.tsx` covers the offline fallback. This file covers the
 * path that actually runs in production: rows fetched from the `comments`
 * function, optimistic writes, and reconciliation.
 *
 * The load-bearing assertion is the VOTE VALUE. The control is tri-state, so
 * pressing "up" on a comment the viewer has already upvoted means "remove my
 * vote" and must send 0. Sending +1 there leaves the database row set while
 * the UI shows it cleared - a divergence nobody notices until a reload puts
 * the vote back.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: true,
}));

const mockFetchThread = jest.fn<Promise<unknown>, [string]>();
const mockPostComment = jest.fn<
  Promise<unknown>,
  [string, string, (string | undefined)?]
>();
const mockVoteOnComment = jest.fn<Promise<unknown>, [string, number]>();

jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return {
    ...actual,
    // Tuple types, not `unknown[]`: a spread argument has to be a tuple or a
    // rest parameter, and this also pins each mock to the real signature.
    fetchThread: (...args: [string]) => mockFetchThread(...args),
    postComment: (...args: [string, string, (string | undefined)?]) =>
      mockPostComment(...args),
    voteOnComment: (...args: [string, number]) => mockVoteOnComment(...args),
  };
});

/* eslint-disable import/first */
import CommentThread from "@/components/comments/CommentThread";
/* eslint-enable import/first */

const serverRow = (over: Record<string, unknown>) => ({
  parentId: null,
  authorName: "Reader",
  body: "body",
  createdAt: new Date().toISOString(),
  score: 0,
  myVote: 0,
  deleted: false,
  ...over,
});

beforeEach(() => {
  mockFetchThread.mockReset();
  mockPostComment.mockReset().mockResolvedValue({});
  mockVoteOnComment.mockReset().mockResolvedValue(undefined);
});

it("renders the thread the server returned, not the mock", async () => {
  mockFetchThread.mockResolvedValue([
    serverRow({ id: "s1", body: "From the database", authorName: "Ada" }),
  ]);

  const view = await render(<CommentThread storyId="story-1" authorName="Zoe" />);

  await waitFor(() => expect(view.getByText("From the database")).toBeTruthy());
  expect(mockFetchThread).toHaveBeenCalledWith("story-1");
  // The mock thread must not leak into the server-backed path.
  expect(view.queryByText(/lighthouse metaphor is beautiful/)).toBeNull();
});

it("offers a retry when the thread cannot load", async () => {
  mockFetchThread.mockRejectedValueOnce(new Error("offline"));
  const view = await render(<CommentThread storyId="story-1" authorName="Zoe" />);

  await waitFor(() =>
    expect(view.getByText("Comments could not load")).toBeTruthy()
  );

  mockFetchThread.mockResolvedValueOnce([
    serverRow({ id: "s1", body: "Recovered" }),
  ]);
  await fireEvent.press(view.getByLabelText("Retry loading comments"));
  await waitFor(() => expect(view.getByText("Recovered")).toBeTruthy());
});

it("sends a new root comment to the server", async () => {
  mockFetchThread.mockResolvedValue([]);
  const view = await render(<CommentThread storyId="story-7" authorName="Zoe" />);
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  const composer = view.getByPlaceholderText(/Add a comment/i);
  await fireEvent.changeText(composer, "  real thoughts  ");
  await fireEvent.press(view.getByLabelText(/post comment/i));

  // No chapter: a comment written from the story page is about the story, and
  // the thread must not invent a chapter for it.
  await waitFor(() =>
    expect(mockPostComment).toHaveBeenCalledWith(
      "story-7",
      "real thoughts",
      undefined,
      undefined,
    )
  );
});

it("tags a comment written from inside a chapter with that chapter", async () => {
  // The reader's thread knows which chapter it was opened from, and sends it,
  // so a long thread can show what each comment is actually about. Without
  // this the `Chapter n` tag has nothing to render and every comment reads as
  // though it were about the story as a whole.
  mockFetchThread.mockResolvedValue([]);
  const view = await render(
    <CommentThread storyId="story-7" chapterId="chapter-3" authorName="Zoe" />,
  );
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  await fireEvent.changeText(
    view.getByPlaceholderText(/Add a comment/i),
    "this chapter broke me",
  );
  await fireEvent.press(view.getByLabelText(/post comment/i));

  await waitFor(() =>
    expect(mockPostComment).toHaveBeenCalledWith(
      "story-7",
      "this chapter broke me",
      undefined,
      "chapter-3",
    )
  );
});

it("keeps a loaded thread visible when a comment write fails", async () => {
  mockFetchThread.mockResolvedValue([
    serverRow({ id: "s1", body: "Still visible", authorName: "Ada" }),
  ]);
  mockPostComment.mockRejectedValueOnce(new Error("offline"));
  const view = await render(<CommentThread storyId="story-7" authorName="Zoe" />);
  await waitFor(() => expect(view.getByText("Still visible")).toBeTruthy());

  await fireEvent.changeText(view.getByPlaceholderText(/Add a comment/i), "new thought");
  await fireEvent.press(view.getByLabelText(/post comment/i));

  await waitFor(() =>
    expect(
      view.getByText("Your comment did not save. It is back in the box - try again."),
    ).toBeTruthy()
  );
  expect(view.getByText("Still visible")).toBeTruthy();
  expect(view.queryByText("Comments could not load")).toBeNull();
});

/**
 * THE BUG THE OWNER HIT: he wrote a comment and it was not saved.
 *
 * The optimistic row was added and never taken back, so a write that 401'd
 * (an anonymous session, which is what the `comments` function refuses) left
 * the comment sitting in the thread looking posted. He closed the app
 * believing it had gone somewhere. The failure notice was a small line above
 * the list; the comment underneath it was the thing he was looking at.
 *
 * The comment now goes away and the text goes back into the composer.
 */
it("takes back a comment whose write failed and returns the text to the composer", async () => {
  mockFetchThread.mockResolvedValue([]);
  mockPostComment.mockRejectedValueOnce(new Error("401"));
  const view = await render(<CommentThread storyId="story-7" authorName="Zoe" />);
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  const composer = view.getByPlaceholderText(/Add a comment/i);
  await fireEvent.changeText(composer, "the thing I wrote");
  await fireEvent.press(view.getByLabelText(/post comment/i));

  await waitFor(() =>
    expect(
      view.getByText("Your comment did not save. It is back in the box - try again."),
    ).toBeTruthy()
  );
  // It is not still in the thread pretending to be posted...
  expect(view.queryByText("the thing I wrote")).toBeNull();
  // ...and it was not thrown away either.
  expect(view.getByPlaceholderText(/Add a comment/i).props.value).toBe(
    "the thing I wrote",
  );
});

/**
 * ANONYMOUS SESSIONS ARE STOPPED BEFORE THE WRITE, NOT BY IT.
 *
 * The `comments` function requires auth, so a guest's comment was always going
 * to 401. Asking them to sign in first is the fix; the rollback above is the
 * backstop for every other reason a write can fail.
 */
it("asks an anonymous viewer to sign in instead of posting", async () => {
  mockFetchThread.mockResolvedValue([]);
  const onRequireSignIn = jest.fn();
  const view = await render(
    <CommentThread
      storyId="story-7"
      authorName="Zoe"
      canEngage={false}
      onRequireSignIn={onRequireSignIn}
    />,
  );
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  await fireEvent.changeText(
    view.getByPlaceholderText(/Add a comment/i),
    "a guest's thought",
  );
  await fireEvent.press(view.getByLabelText(/post comment/i));

  expect(onRequireSignIn).toHaveBeenCalled();
  expect(mockPostComment).not.toHaveBeenCalled();
  // Nothing was optimistically shown either: a guest must not watch their
  // comment appear and then vanish.
  expect(view.queryByText("a guest's thought")).toBeNull();
});

it("asks an anonymous viewer to sign in instead of voting", async () => {
  mockFetchThread.mockResolvedValue([
    serverRow({ id: "s1", body: "vote target", score: 5, myVote: 0 }),
  ]);
  const onRequireSignIn = jest.fn();
  const view = await render(
    <CommentThread
      storyId="story-1"
      authorName="Zoe"
      canEngage={false}
      onRequireSignIn={onRequireSignIn}
    />,
  );
  await waitFor(() => expect(view.getByText("vote target")).toBeTruthy());

  await fireEvent.press(view.getByLabelText(/^Upvote/));

  expect(onRequireSignIn).toHaveBeenCalled();
  expect(mockVoteOnComment).not.toHaveBeenCalled();
});

it("does not send an empty comment", async () => {
  mockFetchThread.mockResolvedValue([]);
  const view = await render(<CommentThread storyId="story-7" authorName="Zoe" />);
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  await fireEvent.changeText(view.getByPlaceholderText(/Add a comment/i), "   ");
  await fireEvent.press(view.getByLabelText(/post comment/i));

  expect(mockPostComment).not.toHaveBeenCalled();
});

/**
 * ONE DIRECTION, AND ONLY EVER 1 OR 0 ON THE WIRE.
 *
 * The vote API still accepts -1 - it has to, for rows written before the
 * downvote was removed - so "we took the arrow out of the UI" is not the same
 * claim as "this UI cannot send a downvote". This asserts the second one: the
 * control is gone, and every value that leaves the thread is 1 or 0.
 */
it("sends the vote the control lands on, and never a downvote", async () => {
  mockFetchThread
    .mockResolvedValueOnce([
      serverRow({ id: "s1", body: "vote target", score: 5, myVote: 0 }),
    ])
    .mockResolvedValueOnce([
      serverRow({ id: "s1", body: "vote target", score: 6, myVote: 1 }),
    ])
    .mockResolvedValueOnce([
      serverRow({ id: "s1", body: "vote target", score: 5, myVote: 0 }),
    ]);
  const view = await render(<CommentThread storyId="story-1" authorName="Zoe" />);
  await waitFor(() => expect(view.getByText("vote target")).toBeTruthy());

  // There is no downvote control at all - not a disabled one, not a hidden
  // one. It cannot be pressed because it does not exist.
  expect(view.queryByLabelText(/Downvote/)).toBeNull();
  expect(view.queryByLabelText("Downvoted")).toBeNull();

  // none -> up sends +1
  await fireEvent.press(view.getByLabelText(/^Upvote/));
  await waitFor(() => expect(mockVoteOnComment).toHaveBeenLastCalledWith("s1", 1));
  await waitFor(() => expect(view.getByLabelText("Upvoted")).toBeTruthy());

  // up -> pressing up again CLEARS, and must send 0, not +1.
  await fireEvent.press(view.getByLabelText("Upvoted"));
  await waitFor(() => expect(mockVoteOnComment).toHaveBeenLastCalledWith("s1", 0));

  // Whatever the sequence, -1 never left the client.
  for (const call of mockVoteOnComment.mock.calls) {
    expect([0, 1]).toContain(call[1]);
  }
});

it("ignores repeated vote taps while the previous vote is still saving", async () => {
  let resolveVote!: () => void;
  mockFetchThread.mockResolvedValue([
    serverRow({ id: "s1", body: "vote target", score: 5, myVote: 0 }),
  ]);
  mockVoteOnComment.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveVote = () => resolve(undefined);
    }),
  );
  const view = await render(<CommentThread storyId="story-1" authorName="Zoe" />);
  await waitFor(() => expect(view.getByText("vote target")).toBeTruthy());

  await fireEvent.press(view.getByLabelText(/^Upvote/));
  await fireEvent.press(view.getByLabelText("Upvoted"));
  expect(mockVoteOnComment).toHaveBeenCalledTimes(1);

  resolveVote();
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalledTimes(2));
});
