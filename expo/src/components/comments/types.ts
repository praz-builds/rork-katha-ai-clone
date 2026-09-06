/**
 * Local, in-memory shape for a Reddit-style comment thread.
 *
 * THERE IS NO BACKEND FOR THIS YET. The real `comments` table only has
 * `id, user_id, story_id, chapter_id, content, created_at` - no parent, no
 * votes, no reports. Every mutation the UI needs (voting, replying,
 * collapsing) is written here as a small PURE function over an immutable
 * tree, so a future server swap is "replace the body of these functions with
 * a network call", not "rewrite the component". `CommentThread.tsx` never
 * mutates a `CommentNode` in place - it always calls one of these and
 * replaces its state with the result.
 */

export type VoteState = "none" | "up" | "down";

export type SortMode = "top" | "new";

export type ReportReason =
  | "spam"
  | "harassment"
  | "sexualContentMinors"
  | "other";

export const REPORT_REASONS: readonly { id: ReportReason; label: string }[] = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "sexualContentMinors", label: "Sexual content involving minors" },
  { id: "other", label: "Other" },
];

export interface CommentNode {
  id: string;
  authorName: string;
  body: string;
  /** Epoch ms, used only to order "New". */
  createdAtMs: number;
  /** Pre-formatted relative time, e.g. "2h ago" - matches the mock's display copy. */
  timeLabel: string;
  /**
   * The comment's score BEFORE the current viewer's own vote is applied.
   * `voteState` is layered on top at render/compute time via `displayScore`,
   * so the arithmetic for a vote toggle can never drift: the base never
   * mutates, only which of {none, up, down} the viewer currently holds does.
   */
  baseScore: number;
  voteState: VoteState;
  collapsed: boolean;
  replies: CommentNode[];
}

/** +1 for an active upvote, -1 for an active downvote, 0 otherwise. */
export function voteDelta(state: VoteState): number {
  if (state === "up") return 1;
  if (state === "down") return -1;
  return 0;
}

/**
 * The net score to display: the stored base plus whatever the viewer's own
 * vote currently contributes. Deriving it this way - rather than mutating a
 * running total on every click - is what keeps the classic "up -> down should
 * move by 2" bug from creeping in: up shows base+1, down shows base-1, so the
 * transition between them is always exactly 2 with no special-cased math.
 */
export function displayScore(node: CommentNode): number {
  return node.baseScore + voteDelta(node.voteState);
}

/** Recursively apply `fn` to the node with `id`, leaving every other node's identity untouched. */
function updateNode(
  nodes: CommentNode[],
  id: string,
  fn: (node: CommentNode) => CommentNode,
): CommentNode[] {
  return nodes.map((node) => {
    if (node.id === id) return fn(node);
    if (node.replies.length === 0) return node;
    const nextReplies = updateNode(node.replies, id, fn);
    return nextReplies === node.replies ? node : { ...node, replies: nextReplies };
  });
}

/**
 * Tri-state vote toggle: none -> up -> none, none -> down -> none, and
 * pressing the opposite direction while already voted flips straight across
 * (up -> down or down -> up) rather than requiring two taps. Pressing the
 * SAME direction again clears the vote.
 */
export function applyVote(
  tree: CommentNode[],
  id: string,
  direction: Exclude<VoteState, "none">,
): CommentNode[] {
  return updateNode(tree, id, (node) => ({
    ...node,
    voteState: node.voteState === direction ? "none" : direction,
  }));
}

/** Toggle whether a comment's subtree is collapsed. */
export function collapse(tree: CommentNode[], id: string): CommentNode[] {
  return updateNode(tree, id, (node) => ({ ...node, collapsed: !node.collapsed }));
}

/** Append a reply under `parentId`, and make sure that parent is expanded so the new reply is visible. */
export function addReply(
  tree: CommentNode[],
  parentId: string,
  reply: CommentNode,
): CommentNode[] {
  return updateNode(tree, parentId, (node) => ({
    ...node,
    collapsed: false,
    replies: [...node.replies, reply],
  }));
}

/** Add a new root-level comment at the top of the thread. */
export function addRootComment(tree: CommentNode[], comment: CommentNode): CommentNode[] {
  return [comment, ...tree];
}

/** Count every reply nested under `node`, at any depth. */
/** Depth-first lookup by id. Returns undefined when the id is not in the tree. */
export function findNode(
  tree: readonly CommentNode[],
  id: string,
): CommentNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findNode(node.replies, id);
    if (found) return found;
  }
  return undefined;
}

export function countDescendants(node: CommentNode): number {
  return node.replies.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

/** Count every comment in the whole tree, roots included. */
export function countAll(tree: CommentNode[]): number {
  return tree.reduce((sum, node) => sum + 1 + countDescendants(node), 0);
}

/**
 * Sort ONLY the top level, per the spec: sort applies to the thread's roots,
 * not to how replies order under a comment.
 */
export function sortTopLevel(tree: CommentNode[], mode: SortMode): CommentNode[] {
  const copy = [...tree];
  if (mode === "new") {
    copy.sort((a, b) => b.createdAtMs - a.createdAtMs);
  } else {
    copy.sort((a, b) => displayScore(b) - displayScore(a));
  }
  return copy;
}

let localCommentCounter = 0;

/** Build a brand-new, unvoted comment ready to insert via `addReply`/`addRootComment`. */
export function createComment(authorName: string, body: string): CommentNode {
  localCommentCounter += 1;
  return {
    id: `local-${Date.now()}-${localCommentCounter}`,
    authorName,
    body,
    createdAtMs: Date.now(),
    timeLabel: "Just now",
    baseScore: 0,
    voteState: "none",
    collapsed: false,
    replies: [],
  };
}
