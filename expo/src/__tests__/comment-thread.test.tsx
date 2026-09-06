import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy(
    {},
    {
      get: () => () => ReactModule.createElement(ReactModule.Fragment),
    },
  );
});

/* eslint-disable import/first */
import CommentThread from "@/components/comments/CommentThread";
import {
  addReply,
  applyVote,
  collapse,
  createComment,
  displayScore,
} from "@/components/comments/types";
import type { CommentNode } from "@/components/comments/types";
/* eslint-enable import/first */

function makeComment(overrides: Partial<CommentNode> = {}): CommentNode {
  return {
    id: "c1",
    authorName: "Test User",
    body: "Hello world",
    createdAtMs: Date.now(),
    timeLabel: "1h ago",
    baseScore: 10,
    voteState: "none",
    collapsed: false,
    replies: [],
    ...overrides,
  };
}

describe("vote arithmetic (types.ts pure helpers)", () => {
  it("goes none -> up -> none", () => {
    const start = [makeComment({ voteState: "none", baseScore: 10 })];
    const upped = applyVote(start, "c1", "up");
    expect(upped[0].voteState).toBe("up");
    expect(displayScore(upped[0])).toBe(11);

    const cleared = applyVote(upped, "c1", "up");
    expect(cleared[0].voteState).toBe("none");
    expect(displayScore(cleared[0])).toBe(10);
  });

  it("goes none -> down -> none", () => {
    const start = [makeComment({ voteState: "none", baseScore: 10 })];
    const downed = applyVote(start, "c1", "down");
    expect(downed[0].voteState).toBe("down");
    expect(displayScore(downed[0])).toBe(9);

    const cleared = applyVote(downed, "c1", "down");
    expect(cleared[0].voteState).toBe("none");
    expect(displayScore(cleared[0])).toBe(10);
  });

  it("flips up -> down by exactly 2", () => {
    const start = [makeComment({ voteState: "up", baseScore: 10 })];
    expect(displayScore(start[0])).toBe(11);

    const flipped = applyVote(start, "c1", "down");
    expect(flipped[0].voteState).toBe("down");
    expect(displayScore(flipped[0])).toBe(9);

    // The whole point of the exercise: the visible score must have moved by
    // exactly 2, not 1 (a naive "just add the new delta" implementation
    // botches this).
    expect(displayScore(start[0]) - displayScore(flipped[0])).toBe(2);
  });

  it("flips down -> up by exactly 2", () => {
    const start = [makeComment({ voteState: "down", baseScore: 10 })];
    expect(displayScore(start[0])).toBe(9);

    const flipped = applyVote(start, "c1", "up");
    expect(flipped[0].voteState).toBe("up");
    expect(displayScore(flipped[0])).toBe(11);
    expect(displayScore(flipped[0]) - displayScore(start[0])).toBe(2);
  });

  it("never mutates the input tree", () => {
    const start = [makeComment({ voteState: "none", baseScore: 10 })];
    const snapshotBefore = JSON.stringify(start);
    applyVote(start, "c1", "up");
    expect(JSON.stringify(start)).toBe(snapshotBefore);
  });
});

describe("addReply (types.ts pure helper)", () => {
  it("adds a reply at depth under the right parent, without touching siblings", () => {
    const tree: CommentNode[] = [
      makeComment({ id: "root-1", replies: [] }),
      makeComment({ id: "root-2", replies: [] }),
    ];

    const reply = createComment("Replier", "a reply");
    const next = addReply(tree, "root-1", reply);

    expect(next[0].replies).toHaveLength(1);
    expect(next[0].replies[0].body).toBe("a reply");
    expect(next[0].replies[0].authorName).toBe("Replier");
    // Sibling root untouched.
    expect(next[1].replies).toHaveLength(0);
    // Original tree left alone (immutability).
    expect(tree[0].replies).toHaveLength(0);
  });

  it("adds a reply nested several levels deep", () => {
    const tree: CommentNode[] = [
      makeComment({
        id: "root",
        replies: [
          makeComment({
            id: "child",
            replies: [makeComment({ id: "grandchild", replies: [] })],
          }),
        ],
      }),
    ];

    const reply = createComment("Deep Replier", "deep reply");
    const next = addReply(tree, "grandchild", reply);

    expect(next[0].replies[0].replies[0].replies).toHaveLength(1);
    expect(next[0].replies[0].replies[0].replies[0].body).toBe("deep reply");
  });

  it("expands the parent when a reply lands on a collapsed comment", () => {
    const tree: CommentNode[] = [makeComment({ id: "root", collapsed: true, replies: [] })];
    const next = addReply(tree, "root", createComment("Someone", "hi"));
    expect(next[0].collapsed).toBe(false);
  });
});

describe("collapse (types.ts pure helper)", () => {
  it("toggles a comment's collapsed state", () => {
    const tree: CommentNode[] = [makeComment({ id: "root", collapsed: false })];
    const collapsed = collapse(tree, "root");
    expect(collapsed[0].collapsed).toBe(true);

    const expanded = collapse(collapsed, "root");
    expect(expanded[0].collapsed).toBe(false);
  });
});

describe("CommentThread component", () => {
  const renderThread = () =>
    render(<CommentThread storyId="story-1" authorName="Mira R." />);

  it("renders the seeded mock thread with nesting", async () => {
    const view = await renderThread();
    expect(view.getByText(/This story had me hooked/)).toBeTruthy();
  });

  it("rejects an empty or whitespace-only root comment", async () => {
    const view = await renderThread();
    const field = view.getByLabelText("Write a comment");

    await fireEvent.changeText(field, "   ");
    const postButton = view.getByLabelText("Post comment");
    expect(postButton.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(postButton);
    // Whitespace-only submission must not appear in the thread.
    expect(view.queryByText("   ")).toBeNull();
  });

  it("posts a non-empty root comment and clears the composer", async () => {
    const view = await renderThread();
    const field = view.getByLabelText("Write a comment");

    await fireEvent.changeText(field, "A brand new top-level comment");
    await fireEvent.press(view.getByLabelText("Post comment"));

    expect(view.getByText("A brand new top-level comment")).toBeTruthy();
  });

  it("opens a reply composer under a comment and adds the reply", async () => {
    const view = await renderThread();

    // "seed-1" is the top-level "Mira R." comment; target it by its stable
    // testID rather than by label, since the seed data also has a nested
    // reply authored by "Mira R." with the same accessible name.
    await fireEvent.press(view.getByTestId("comment-reply-open-seed-1"));
    const replyField = view.getByTestId("comment-reply-input-seed-1");
    await fireEvent.changeText(replyField, "A fresh reply at depth");
    await fireEvent.press(view.getByTestId("comment-reply-submit-seed-1"));

    expect(view.getByText("A fresh reply at depth")).toBeTruthy();
  });

  it("collapses a comment's subtree on gutter tap, and reports what it hid", async () => {
    const view = await renderThread();

    // "seed-1" ("Mira R.") has a two-deep reply chain under it in the seed
    // data. The seed also includes one comment ("seed-3") that starts
    // pre-collapsed, which already shows one "hidden" count - so assert the
    // count of matches grows by one rather than asserting on total presence.
    const bodyBefore = view.getByText(/This story had me hooked/);
    expect(bodyBefore).toBeTruthy();
    expect(view.getAllByText(/replies hidden/)).toHaveLength(1);

    await fireEvent.press(view.getByTestId("comment-gutter-seed-1"));

    expect(view.queryByText(/This story had me hooked/)).toBeNull();
    expect(view.getAllByText(/2 replies hidden/)).toHaveLength(2);
  });

  it("exposes Top/New sort controls at the top level", async () => {
    const view = await renderThread();
    expect(view.getByLabelText("Sort by top")).toBeTruthy();
    expect(view.getByLabelText("Sort by new")).toBeTruthy();
  });
});
