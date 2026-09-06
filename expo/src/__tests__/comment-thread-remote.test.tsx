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

  await waitFor(() =>
    expect(mockPostComment).toHaveBeenCalledWith("story-7", "real thoughts")
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
    expect(view.getByText("That action did not save. Check your connection and try again."))
      .toBeTruthy()
  );
  expect(view.getByText("Still visible")).toBeTruthy();
  expect(view.queryByText("Comments could not load")).toBeNull();
});

it("does not send an empty comment", async () => {
  mockFetchThread.mockResolvedValue([]);
  const view = await render(<CommentThread storyId="story-7" authorName="Zoe" />);
  await waitFor(() => expect(mockFetchThread).toHaveBeenCalled());

  await fireEvent.changeText(view.getByPlaceholderText(/Add a comment/i), "   ");
  await fireEvent.press(view.getByLabelText(/post comment/i));

  expect(mockPostComment).not.toHaveBeenCalled();
});

it("sends the vote the control lands on, including clearing to 0", async () => {
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

  // none -> up sends +1
  await fireEvent.press(view.getByLabelText(/^Upvote/));
  await waitFor(() => expect(mockVoteOnComment).toHaveBeenLastCalledWith("s1", 1));
  await waitFor(() => expect(view.getByLabelText("Upvoted")).toBeTruthy());

  // up -> pressing up again CLEARS, and must send 0, not +1.
  await fireEvent.press(view.getByLabelText("Upvoted"));
  await waitFor(() => expect(mockVoteOnComment).toHaveBeenLastCalledWith("s1", 0));

  // none -> down sends -1
  await fireEvent.press(view.getByLabelText(/^Downvote/));
  await waitFor(() => expect(mockVoteOnComment).toHaveBeenLastCalledWith("s1", -1));
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
