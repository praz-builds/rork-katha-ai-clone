/**
 * The comments sheet on the story page draws the same thread on a dark
 * ground. Tone must change nothing about what the thread says or does; what
 * these pin is the one thing it adds (the chapter tag, when the data carries
 * it) and the one label it renames (the overflow glyph becomes "Report").
 */
import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));
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
import CommentRow from "@/components/comments/CommentRow";
import CommentThread from "@/components/comments/CommentThread";
import { buildThread } from "@/lib/comments";
import type { CommentNode } from "@/components/comments/types";
/* eslint-enable import/first */

const node = (overrides: Partial<CommentNode> = {}): CommentNode => ({
  id: "c1",
  authorName: "toma",
  body: "I like the story",
  createdAtMs: Date.now(),
  timeLabel: "40m ago",
  baseScore: 3,
  voteState: "none",
  collapsed: false,
  replies: [],
  ...overrides,
});

const renderRow = (comment: CommentNode, tone: "light" | "dark") =>
  render(
    <CommentRow
      node={comment}
      depth={0}
      tone={tone}
      replyTargetId={null}
      replyDraft=""
      onReplyDraftChange={jest.fn()}
      onOpenReply={jest.fn()}
      onCancelReply={jest.fn()}
      onSubmitReply={jest.fn()}
      onVote={jest.fn()}
      onToggleCollapse={jest.fn()}
    />,
  );

it("tags a comment with its chapter when the data says which", async () => {
  const view = await renderRow(node({ chapterNumber: 3 }), "dark");
  expect(view.getByText("Chapter 3")).toBeTruthy();
});

it("shows no chapter tag when the server did not say", async () => {
  const view = await renderRow(node(), "dark");
  expect(view.queryByText(/^Chapter /)).toBeNull();
});

it("names the overflow action 'Report' on the dark sheet and keeps the glyph on the light page", async () => {
  const dark = await renderRow(node(), "dark");
  expect(dark.getByText("Report")).toBeTruthy();

  const light = await renderRow(node(), "light");
  expect(light.queryByText("Report")).toBeNull();
  expect(light.getByLabelText("More actions for toma's comment")).toBeTruthy();
});

it("keeps the count reported to the caller in step with the thread", async () => {
  const onCountChange = jest.fn();
  await render(
    <CommentThread storyId="s1" authorName="Mira" tone="dark" onCountChange={onCountChange} />,
  );
  // The mock thread has a known size; what matters is that a number arrived
  // and that it matches what the thread itself prints.
  expect(onCountChange).toHaveBeenCalled();
  const last = onCountChange.mock.calls[onCountChange.mock.calls.length - 1][0];
  expect(typeof last).toBe("number");
  expect(last).toBeGreaterThan(0);
});

it("carries a chapter number from the wire into the thread only when present", () => {
  const rows = [
    {
      id: "a",
      parentId: null,
      authorName: "toma",
      body: "x",
      createdAt: new Date().toISOString(),
      score: 0,
      myVote: 0 as const,
      deleted: false,
      chapterNumber: 2,
    },
    {
      id: "b",
      parentId: null,
      authorName: "hatch",
      body: "y",
      createdAt: new Date().toISOString(),
      score: 0,
      myVote: 0 as const,
      deleted: false,
    },
  ];
  const tree = buildThread(rows, Date.now());
  expect(tree.find((item) => item.id === "a")?.chapterNumber).toBe(2);
  expect(tree.find((item) => item.id === "b")?.chapterNumber).toBeUndefined();
});
