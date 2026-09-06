/**
 * The client half of persistent comments.
 *
 * The server returns the thread FLAT - one row per comment carrying its
 * `parentId` - and this module assembles the tree. That split is deliberate.
 * A server that returns a nested payload has to decide the shape of every
 * thread before it knows how the client will draw it, and it re-sends whole
 * subtrees on every poll. A flat list is cheap to page, cheap to cache, and
 * lets the client re-sort ("Top" vs "New") without another round trip.
 *
 * Everything here is pure and synchronous except the four network calls at the
 * bottom, so the interesting logic - ordering, orphan handling, the viewer's
 * own vote - is testable without a server.
 */
import { supabase } from "@/lib/supabase";
import type {
  CommentNode,
  ReportReason,
  SortMode,
  VoteState,
} from "@/components/comments/types";

/** One row exactly as the `comments` edge function returns it. */
export type ServerComment = {
  id: string;
  parentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  /** Net score from `comments.score`, maintained by a DB trigger. */
  score: number;
  /** The CALLING user's own vote, never anyone else's. */
  myVote: -1 | 0 | 1;
  /** Soft-deleted comments keep their place so replies do not orphan. */
  deleted: boolean;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative time, to the coarsest unit that is still true.
 *
 * "2h ago" rather than "2h 14m ago": in a comment thread the reader is placing
 * a comment relative to the others, not timing it. Anything under a minute is
 * "just now" because a comment posted seconds ago and one posted 40 seconds
 * ago are the same event to a reader.
 */
export function formatRelativeTime(createdAtMs: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - createdAtMs);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

function voteStateFrom(myVote: -1 | 0 | 1): VoteState {
  if (myVote === 1) return "up";
  if (myVote === -1) return "down";
  return "none";
}

/**
 * Assemble flat rows into the tree the UI renders.
 *
 * ORPHANS ARE PROMOTED, NOT DROPPED. A reply whose parent is missing from this
 * page - because the parent was hard-deleted, or simply falls outside the rows
 * fetched - is attached at the root instead of being silently discarded.
 * Dropping it loses a real person's words because of a paging boundary; the
 * worst case of promoting it is a comment that reads slightly out of context.
 *
 * A cycle (a comment that is its own ancestor) cannot happen through the API,
 * but a corrupt row must not hang the render, so parents are resolved through
 * a visited set and any row that cannot reach the root is promoted too.
 */
export function buildThread(
  rows: readonly ServerComment[],
  nowMs: number = Date.now(),
): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const row of rows) {
    const createdAtMs = Date.parse(row.createdAt);
    byId.set(row.id, {
      id: row.id,
      authorName: row.authorName,
      body: row.deleted ? "[deleted]" : row.body,
      createdAtMs: Number.isNaN(createdAtMs) ? 0 : createdAtMs,
      timeLabel: formatRelativeTime(
        Number.isNaN(createdAtMs) ? nowMs : createdAtMs,
        nowMs,
      ),
      // The server's `score` already excludes nothing: it is the net total
      // INCLUDING this viewer's vote. `baseScore` must exclude it, or the
      // viewer's own vote gets counted twice the moment `displayScore` adds
      // it back. This subtraction is the seam between the two models.
      baseScore: row.score - row.myVote,
      voteState: voteStateFrom(row.myVote),
      collapsed: false,
      replies: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent && !isAncestor(node, parent, byId, rows)) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** True when `candidate` is `node` itself or sits below it - i.e. a cycle. */
function isAncestor(
  node: CommentNode,
  candidate: CommentNode,
  byId: Map<string, CommentNode>,
  rows: readonly ServerComment[],
): boolean {
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const seen = new Set<string>();
  let cursor: string | null | undefined = candidate.id;
  while (cursor && !seen.has(cursor)) {
    if (cursor === node.id) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** Order the top level. Replies keep server order, which is chronological. */
export function sortThread(
  nodes: readonly CommentNode[],
  mode: SortMode,
): CommentNode[] {
  const copy = [...nodes];
  copy.sort((a, b) =>
    mode === "new"
      ? b.createdAtMs - a.createdAtMs
      : (b.baseScore + (b.voteState === "up" ? 1 : b.voteState === "down" ? -1 : 0)) -
        (a.baseScore + (a.voteState === "up" ? 1 : a.voteState === "down" ? -1 : 0))
  );
  return copy;
}

/**
 * One row exactly as the `comments` edge function puts it on the wire.
 *
 * Snake_case, because that is what the function returns straight from
 * Postgres. It is mapped once, here, rather than leaking column names through
 * the UI: `deleted_at` is a timestamp the client never renders, `content` is
 * `body` everywhere on this side, and `author_display_name` is optional for a
 * guest who has no profile row.
 */
type WireComment = {
  id: string;
  parent_id: string | null;
  author_display_name: string | null;
  content: string;
  created_at: string;
  score: number | null;
  my_vote: number | null;
  deleted_at: string | null;
};

export function fromWire(row: WireComment): ServerComment {
  const vote = row.my_vote === 1 || row.my_vote === -1 ? row.my_vote : 0;
  return {
    id: row.id,
    parentId: row.parent_id,
    // A guest has no profile display name. "Reader" is the neutral fallback;
    // rendering an empty byline or a raw uuid would be worse.
    authorName: row.author_display_name?.trim() || "Reader",
    body: row.content,
    createdAt: row.created_at,
    score: row.score ?? 0,
    myVote: vote,
    deleted: row.deleted_at !== null,
  };
}

async function invokeComments<T>(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    path,
    init.method === "GET" ? { method: "GET" } : { body: init.body },
  );
  if (error) throw error;
  return data as T;
}

export async function fetchThread(storyId: string): Promise<ServerComment[]> {
  const params = new URLSearchParams({ story_id: storyId });
  const data = await invokeComments<{ comments?: WireComment[] }>(
    `comments?${params.toString()}`,
    { method: "GET" },
  );
  return (data?.comments ?? []).map(fromWire);
}

export async function postComment(
  storyId: string,
  content: string,
  parentId?: string,
): Promise<ServerComment | null> {
  const data = await invokeComments<{ comment?: WireComment }>("comments", {
    method: "POST",
    body: {
      action: "post",
      story_id: storyId,
      parent_id: parentId ?? null,
      content,
    },
  });
  return data?.comment ? fromWire(data.comment) : null;
}

/** `value` of 0 removes the viewer's vote. */
export function voteOnComment(
  commentId: string,
  value: -1 | 0 | 1,
): Promise<unknown> {
  return invokeComments("comments", {
    method: "POST",
    body: { action: "vote", comment_id: commentId, value },
  });
}

export function reportContent(
  target: { commentId?: string; storyId?: string },
  reason: ReportReason,
  details?: string,
): Promise<unknown> {
  return invokeComments("comments", {
    method: "POST",
    body: {
      action: "report",
      comment_id: target.commentId ?? null,
      story_id: target.storyId ?? null,
      reason,
      details: details ?? null,
    },
  });
}

export function blockAuthor(blockedId: string): Promise<unknown> {
  return invokeComments("comments", {
    method: "POST",
    body: { action: "block", blocked_id: blockedId },
  });
}

export function unblockAuthor(blockedId: string): Promise<unknown> {
  return invokeComments("comments", {
    method: "POST",
    body: { action: "unblock", blocked_id: blockedId },
  });
}
