/**
 * The flat-rows-to-tree seam.
 *
 * Two things here are easy to get wrong and expensive to notice in production:
 * the double-counted vote (the server's `score` already includes the viewer's
 * own vote, so `baseScore` must subtract it back out) and the dropped orphan
 * (a reply whose parent falls outside the fetched page must not vanish).
 */
import {
  buildThread,
  formatRelativeTime,
  reportContent,
  sortThread,
} from "@/lib/comments";
import { supabase } from "@/lib/supabase";
import type { ServerComment } from "@/lib/comments";
import { displayScore } from "@/components/comments/types";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));

const NOW = Date.parse("2026-09-06T12:00:00.000Z");

const row = (over: Partial<ServerComment> & { id: string }): ServerComment => ({
  parentId: null,
  authorName: "Reader",
  body: "text",
  createdAt: new Date(NOW - 60_000).toISOString(),
  score: 0,
  myVote: 0,
  deleted: false,
  ...over,
});

describe("buildThread", () => {
  it("nests replies under their parent", () => {
    const tree = buildThread([
      row({ id: "a" }),
      row({ id: "b", parentId: "a" }),
      row({ id: "c", parentId: "b" }),
    ], NOW);

    expect(tree).toHaveLength(1);
    expect(tree[0].replies[0].id).toBe("b");
    expect(tree[0].replies[0].replies[0].id).toBe("c");
  });

  it("does not double-count the viewer's own vote", () => {
    // Server score 10 INCLUDES this viewer's +1. Displayed score must stay 10,
    // not 11. If baseScore kept the server value, every voter would see their
    // own vote twice.
    const [node] = buildThread([row({ id: "a", score: 10, myVote: 1 })], NOW);
    expect(node.baseScore).toBe(9);
    expect(node.voteState).toBe("up");
    expect(displayScore(node)).toBe(10);
  });

  it("keeps a downvoted comment's arithmetic straight", () => {
    const [node] = buildThread([row({ id: "a", score: 4, myVote: -1 })], NOW);
    expect(node.baseScore).toBe(5);
    expect(displayScore(node)).toBe(4);
  });

  it("promotes an orphan instead of dropping it", () => {
    // "b" points at a parent that is not in this page. Losing it would delete
    // a real comment from view because of a paging boundary.
    const tree = buildThread([
      row({ id: "a" }),
      row({ id: "b", parentId: "missing" }),
    ], NOW);
    expect(tree.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("survives a cycle rather than hanging", () => {
    const tree = buildThread([
      row({ id: "a", parentId: "b" }),
      row({ id: "b", parentId: "a" }),
    ], NOW);
    expect(tree.length).toBeGreaterThan(0);
  });

  it("shows a soft-deleted comment as a tombstone, keeping its replies", () => {
    const tree = buildThread([
      row({ id: "a", deleted: true, body: "scrubbed" }),
      row({ id: "b", parentId: "a", body: "still here" }),
    ], NOW);
    expect(tree[0].body).toBe("[deleted]");
    expect(tree[0].replies[0].body).toBe("still here");
  });
});

describe("sortThread", () => {
  it("orders Top by displayed score and New by recency", () => {
    const rows = [
      row({ id: "old-high", score: 50, createdAt: new Date(NOW - 5 * 86_400_000).toISOString() }),
      row({ id: "new-low", score: 1, createdAt: new Date(NOW - 60_000).toISOString() }),
    ];
    const tree = buildThread(rows, NOW);
    expect(sortThread(tree, "top")[0].id).toBe("old-high");
    expect(sortThread(tree, "new")[0].id).toBe("new-low");
  });
});

describe("formatRelativeTime", () => {
  it("uses the coarsest unit that is still true", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
  });

  it("never renders a negative age from a clock skew", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("just now");
  });
});


/* ───────────────────────────── reportContent ───────────────────────────── */

describe("reportContent", () => {
  const invoke = supabase.functions.invoke as jest.Mock;

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("files a story report with no details key when nothing was written", async () => {
    await reportContent({ storyId: "s1" }, "inappropriate_cover", "   ");
    expect(invoke).toHaveBeenCalledWith("comments", {
      body: {
        action: "report",
        comment_id: null,
        story_id: "s1",
        reason: "inappropriate_cover",
      },
    });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("details");
  });

  it("sends trimmed details on a story report when the reporter wrote some", async () => {
    await reportContent({ storyId: "s1" }, "copyright", "  Lifted wholesale.  ");
    expect(invoke.mock.calls[0][1].body).toMatchObject({
      story_id: "s1",
      reason: "copyright",
      details: "Lifted wholesale.",
    });
  });

  it("still refuses a comment report with no description", async () => {
    await expect(reportContent({ commentId: "c1" }, "spam", " "))
      .rejects.toThrow("A report needs a description");
    expect(invoke).not.toHaveBeenCalled();
  });
});
