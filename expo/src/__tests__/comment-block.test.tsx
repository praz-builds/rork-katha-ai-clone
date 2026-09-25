/**
 * Block, from a comment's ⋮ menu.
 *
 * Play's User Generated Content policy asks for report AND block wherever
 * strangers' words appear. Before this, `user_blocks` existed and the thread
 * read honoured it, but nothing in the comment UI could write a row, so the
 * only way to stop seeing somebody's comments was to stop reading.
 *
 * What is pinned here:
 * - the menu offers Block for somebody else's comment and not for your own;
 * - Block confirms before it writes, and on success that person's comments
 *   leave the thread at once while replies other people wrote to them stay;
 * - a failed write says so and hides nothing;
 * - a guest is asked to sign in, exactly as Report asks them;
 * - a block made elsewhere (the story sheet, the reader) hides their comments
 *   here too.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

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
const mockBlockAuthor = jest.fn<Promise<unknown>, [string]>();

jest.mock("@/lib/comments", () => {
  const actual = jest.requireActual("@/lib/comments");
  return {
    ...actual,
    fetchThread: (...args: [string]) => mockFetchThread(...args),
    blockAuthor: (...args: [string]) => mockBlockAuthor(...args),
  };
});

/* eslint-disable import/first */
import CommentThread from "@/components/comments/CommentThread";
import { removeAuthor, type CommentNode } from "@/components/comments/types";
import {
  clearBlockedAuthors,
  getBlockedAuthorIds,
  rememberBlocked,
} from "@/lib/blocks";
import { setViewerId } from "@/lib/ownership";
/* eslint-enable import/first */

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  parentId: null,
  authorName: "Reader",
  body: "body",
  createdAt: new Date().toISOString(),
  score: 0,
  myVote: 0,
  deleted: false,
  ...over,
});

const THREAD = [
  row({ id: "c-ada", authorId: ADA, authorName: "Ada", body: "Ada says a cruel thing" }),
  row({ id: "c-bea", parentId: "c-ada", authorId: BEA, authorName: "Bea", body: "Bea answers Ada" }),
  row({ id: "c-mine", authorId: ME, authorName: "Me", body: "My own comment" }),
];

beforeEach(() => {
  clearBlockedAuthors();
  setViewerId(ME);
  mockFetchThread.mockReset().mockResolvedValue(THREAD);
  mockBlockAuthor.mockReset().mockResolvedValue({ blocked: true });
});

afterAll(() => setViewerId(null));

async function renderThread(props: Partial<React.ComponentProps<typeof CommentThread>> = {}) {
  const view = await render(
    <CommentThread storyId="story-1" authorName="Zoe" {...props} />,
  );
  await waitFor(() => expect(view.getByText("Ada says a cruel thing")).toBeTruthy());
  return view;
}

it("blocks a commenter after a confirmation, and their comments leave the thread", async () => {
  const view = await renderThread();

  await fireEvent.press(view.getByTestId("comment-menu-c-ada"));
  await fireEvent.press(view.getByLabelText("Block Ada"));
  // Nothing is written until the reader confirms.
  expect(mockBlockAuthor).not.toHaveBeenCalled();
  expect(view.getByText("Block Ada?")).toBeTruthy();

  // After the block the server no longer returns Ada's rows.
  mockFetchThread.mockResolvedValue(THREAD.filter((r) => r.id !== "c-ada"));
  await fireEvent.press(view.getByLabelText("Confirm block Ada"));

  await waitFor(() => expect(mockBlockAuthor).toHaveBeenCalledWith(ADA));
  await waitFor(() => expect(view.queryByText("Ada says a cruel thing")).toBeNull());
  // Bea's reply was not written by Ada, so it stays.
  expect(view.getByText("Bea answers Ada")).toBeTruthy();
  expect(getBlockedAuthorIds().has(ADA)).toBe(true);
});

it("does not offer Block on the viewer's own comment", async () => {
  const view = await renderThread();

  await fireEvent.press(view.getByTestId("comment-menu-c-mine"));
  expect(view.getByLabelText("Report comment")).toBeTruthy();
  expect(view.queryByTestId("comment-menu-block")).toBeNull();
});

it("says so when the block does not save, and hides nothing", async () => {
  mockBlockAuthor.mockRejectedValueOnce(new Error("offline"));
  const view = await renderThread();

  await fireEvent.press(view.getByTestId("comment-menu-c-ada"));
  await fireEvent.press(view.getByLabelText("Block Ada"));
  await fireEvent.press(view.getByLabelText("Confirm block Ada"));

  await waitFor(() =>
    expect(
      view.getByText("That block did not save. Check your connection and try again."),
    ).toBeTruthy()
  );
  expect(view.getByText("Ada says a cruel thing")).toBeTruthy();
  expect(getBlockedAuthorIds().has(ADA)).toBe(false);
});

it("asks a guest to sign in instead of blocking", async () => {
  const onRequireSignIn = jest.fn();
  const view = await renderThread({ canEngage: false, onRequireSignIn });

  await fireEvent.press(view.getByTestId("comment-menu-c-ada"));
  await fireEvent.press(view.getByLabelText("Block Ada"));
  await fireEvent.press(view.getByLabelText("Confirm block Ada"));

  await waitFor(() => expect(onRequireSignIn).toHaveBeenCalled());
  expect(mockBlockAuthor).not.toHaveBeenCalled();
  expect(view.getByText("Ada says a cruel thing")).toBeTruthy();
});

it("hides the comments of somebody blocked elsewhere in the app", async () => {
  const view = await renderThread();

  await act(async () => {
    rememberBlocked(ADA);
  });

  expect(view.queryByText("Ada says a cruel thing")).toBeNull();
  expect(view.getByText("Bea answers Ada")).toBeTruthy();
});

describe("removeAuthor", () => {
  const node = (id: string, authorId: string, replies: CommentNode[] = []): CommentNode => ({
    id,
    authorId,
    authorName: id,
    body: id,
    createdAtMs: 0,
    timeLabel: "now",
    baseScore: 0,
    voteState: "none",
    collapsed: false,
    replies,
  });

  it("promotes other people's replies to a removed comment instead of dropping them", () => {
    const tree = [
      node("root", BEA, [node("ada-1", ADA, [node("bea-2", BEA)])]),
      node("ada-root", ADA, [node("me-1", ME)]),
    ];
    const next = removeAuthor(tree, ADA);
    expect(next.map((n) => n.id)).toEqual(["root", "bea-2", "me-1"]);
    expect(next[0].replies).toEqual([]);
  });

  it("returns the same tree when the author wrote nothing in it", () => {
    const tree = [node("root", BEA)];
    expect(removeAuthor(tree, ADA)).toBe(tree);
  });
});
