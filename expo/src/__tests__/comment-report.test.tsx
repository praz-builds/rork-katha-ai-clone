/**
 * What a reader can do TO a comment.
 *
 * Three changes, all of them about the gap between an impulse and a
 * consequence:
 *
 * - Report is behind a three-dot menu, not a button beside Reply. A button
 *   there is a one-tap way to express irritation, and that is what it was.
 * - A report needs a description. A reason enum on its own is a bucket name a
 *   moderator cannot act on.
 * - There is no downvote. Not disabled, not hidden: absent.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import CommentRow, {
  isReportDescriptionValid,
} from "@/components/comments/CommentRow";
import type { CommentNode } from "@/components/comments/types";
/* eslint-enable import/first */

const node = (overrides: Partial<CommentNode> = {}): CommentNode => ({
  id: "c1",
  authorId: "user-9",
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

const renderRow = (
  comment: CommentNode = node(),
  handlers: {
    onVote?: jest.Mock;
    onReport?: jest.Mock;
    onAuthorPress?: jest.Mock;
  } = {},
) =>
  render(
    <CommentRow
      node={comment}
      depth={0}
      replyTargetId={null}
      replyDraft=""
      onReplyDraftChange={jest.fn()}
      onOpenReply={jest.fn()}
      onCancelReply={jest.fn()}
      onSubmitReply={jest.fn()}
      onVote={handlers.onVote ?? jest.fn()}
      onToggleCollapse={jest.fn()}
      onAuthorPress={handlers.onAuthorPress}
      onReport={handlers.onReport}
    />,
  );

/* ─────────────────────────── No downvote ─────────────────────────── */

describe("voting", () => {
  it("offers one direction and no other", async () => {
    const view = await renderRow();
    expect(view.getByLabelText(/^Upvote/)).toBeTruthy();
    expect(view.queryByLabelText(/Downvote/)).toBeNull();
    expect(view.queryByLabelText("Downvoted")).toBeNull();
  });

  it("reports the press as a plain toggle with no direction to get wrong", async () => {
    const onVote = jest.fn();
    const view = await renderRow(node(), { onVote });

    await fireEvent.press(view.getByLabelText(/^Upvote/));

    expect(onVote).toHaveBeenCalledWith("c1");
    // One argument. The signature itself is what makes a downvote
    // unrepresentable from this row.
    expect(onVote.mock.calls[0]).toHaveLength(1);
  });
});

/* ───────────────────────── Report behind a menu ───────────────────────── */

describe("reporting a comment", () => {
  it("is not offered as a button on the row", async () => {
    const view = await renderRow();
    expect(view.queryByText("Report")).toBeNull();
    expect(view.getByLabelText("More actions for toma's comment")).toBeTruthy();
  });

  it("opens from the three-dot menu", async () => {
    const view = await renderRow();

    await fireEvent.press(view.getByLabelText("More actions for toma's comment"));
    await waitFor(() => expect(view.getByLabelText("Report comment")).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Report comment"));

    await waitFor(() =>
      expect(view.getByText("Why are you reporting this?")).toBeTruthy()
    );
  });

  const openReport = async (handlers: Parameters<typeof renderRow>[1] = {}) => {
    const view = await renderRow(node(), handlers);
    await fireEvent.press(view.getByLabelText("More actions for toma's comment"));
    await fireEvent.press(view.getByLabelText("Report comment"));
    await waitFor(() =>
      expect(view.getByText("Why are you reporting this?")).toBeTruthy()
    );
    return view;
  };

  it("refuses to send a reason with no description", async () => {
    const onReport = jest.fn().mockResolvedValue(undefined);
    const view = await openReport({ onReport });

    await fireEvent.press(view.getByLabelText("Harassment"));
    await fireEvent.press(view.getByLabelText("Submit report"));

    expect(onReport).not.toHaveBeenCalled();
    expect(
      view.getByText("A report needs a description before it can be sent."),
    ).toBeTruthy();
  });

  it("refuses a description that is a single word", async () => {
    const onReport = jest.fn().mockResolvedValue(undefined);
    const view = await openReport({ onReport });

    await fireEvent.press(view.getByLabelText("Harassment"));
    await fireEvent.changeText(view.getByTestId("report-details-input"), "bad");
    await fireEvent.press(view.getByLabelText("Submit report"));

    expect(onReport).not.toHaveBeenCalled();
  });

  it("refuses a description with no reason chosen", async () => {
    const onReport = jest.fn().mockResolvedValue(undefined);
    const view = await openReport({ onReport });

    await fireEvent.changeText(
      view.getByTestId("report-details-input"),
      "they posted my home address in a reply",
    );
    await fireEvent.press(view.getByLabelText("Submit report"));

    expect(onReport).not.toHaveBeenCalled();
  });

  it("sends the reason and the trimmed description together", async () => {
    const onReport = jest.fn().mockResolvedValue(undefined);
    const view = await openReport({ onReport });

    await fireEvent.press(view.getByLabelText("Harassment"));
    await fireEvent.changeText(
      view.getByTestId("report-details-input"),
      "  they posted my home address in a reply  ",
    );
    await fireEvent.press(view.getByLabelText("Submit report"));

    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith(
        "c1",
        "harassment",
        "they posted my home address in a reply",
      )
    );
    await waitFor(() => expect(view.getByText("Comment reported")).toBeTruthy());
  });

  /**
   * The confirmation is evidence. It must not appear over a write that did not
   * happen - the old sheet showed "thanks, we'll look at it" unconditionally,
   * including for reports that never left the device.
   */
  it("says the report failed instead of thanking the reporter", async () => {
    const onReport = jest.fn().mockRejectedValue(new Error("offline"));
    const view = await openReport({ onReport });

    await fireEvent.press(view.getByLabelText("Spam"));
    await fireEvent.changeText(
      view.getByTestId("report-details-input"),
      "this is the same link posted twelve times",
    );
    await fireEvent.press(view.getByLabelText("Submit report"));

    await waitFor(() =>
      expect(
        view.getByText("That report did not save. Check your connection and try again."),
      ).toBeTruthy()
    );
    expect(view.queryByText("Comment reported")).toBeNull();
  });

  /**
   * The same rule, for the case where there is no handler at all. Optional
   * chaining made "no `onReport` supplied" indistinguishable from "the write
   * succeeded", so a host that had not wired reporting up yet showed the
   * reporter a thank-you for a report that went nowhere.
   */
  it("does not thank the reporter when nothing is wired up to receive it", async () => {
    const view = await openReport({});

    await fireEvent.press(view.getByLabelText("Spam"));
    await fireEvent.changeText(
      view.getByTestId("report-details-input"),
      "this is the same link posted twelve times",
    );
    await fireEvent.press(view.getByLabelText("Submit report"));

    await waitFor(() =>
      expect(
        view.getByText("That report did not save. Check your connection and try again."),
      ).toBeTruthy()
    );
    expect(view.queryByText("Comment reported")).toBeNull();
  });
});

describe("isReportDescriptionValid", () => {
  it("rejects blank, whitespace and one-word descriptions", () => {
    expect(isReportDescriptionValid("")).toBe(false);
    expect(isReportDescriptionValid("     ")).toBe(false);
    expect(isReportDescriptionValid("spam")).toBe(false);
  });

  it("accepts a sentence and rejects an essay past the column's cap", () => {
    expect(isReportDescriptionValid("they posted my address")).toBe(true);
    expect(isReportDescriptionValid("a".repeat(2000))).toBe(true);
    expect(isReportDescriptionValid("a".repeat(2001))).toBe(false);
  });
});

/* ──────────────────────── Tappable author ──────────────────────── */

describe("the commenter's name and avatar", () => {
  it("routes to that person's profile", async () => {
    const onAuthorPress = jest.fn();
    const view = await renderRow(node(), { onAuthorPress });

    const links = view.getAllByLabelText("View toma's profile");
    expect(links.length).toBeGreaterThanOrEqual(2); // the avatar and the name
    await fireEvent.press(links[0]);
    expect(onAuthorPress).toHaveBeenCalledWith("user-9");
  });

  it("stays plain text when the wire carried no author id", async () => {
    const onAuthorPress = jest.fn();
    const view = await renderRow(
      node({ authorId: undefined }),
      { onAuthorPress },
    );
    expect(view.queryByLabelText("View toma's profile")).toBeNull();
  });
});
