import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing, type } from "@/theme";
import CommentRow, { COMMENT_PALETTES } from "./CommentRow";
import type { CommentTone } from "./CommentRow";
import type { CommentNode, ReportReason, SortMode } from "./types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { blockAuthorEverywhere, useBlockedAuthorIds } from "@/lib/blocks";
import { getViewerId } from "@/lib/ownership";
import {
  buildThread,
  fetchThread,
  postComment,
  reportContent,
  voteOnComment,
} from "@/lib/comments";
import {
  addReply,
  findNode,
  addRootComment,
  applyVote,
  collapse,
  countAll,
  createComment,
  removeAuthor,
  removeComment,
  sortTopLevel,
} from "./types";

/**
 * Module-level mock thread. There is no threaded-comments backend yet (see
 * the note in `./types.ts`), so this demonstrates nesting, a live vote, and a
 * pre-collapsed subtree until a real fetch replaces it.
 */
const MOCK_COMMENTS: CommentNode[] = [
  {
    id: "seed-1",
    authorName: "Mira R.",
    body: "This story had me hooked from the first line. The lighthouse metaphor is beautiful.",
    createdAtMs: Date.now() - 2 * 60 * 60 * 1000,
    timeLabel: "2h ago",
    baseScore: 24,
    voteState: "none",
    collapsed: false,
    replies: [
      {
        id: "seed-1-1",
        authorName: "Dev S.",
        body: "Agreed - the pacing in chapter two sold it for me.",
        createdAtMs: Date.now() - 100 * 60 * 1000,
        timeLabel: "1h ago",
        baseScore: 6,
        voteState: "none",
        collapsed: false,
        replies: [
          {
            id: "seed-1-1-1",
            authorName: "Mira R.",
            body: "Right? I reread that chapter twice.",
            createdAtMs: Date.now() - 90 * 60 * 1000,
            timeLabel: "1h ago",
            baseScore: 3,
            voteState: "none",
            collapsed: false,
            replies: [],
          },
        ],
      },
    ],
  },
  {
    id: "seed-2",
    authorName: "Aanya K.",
    body: "I want a sequel to this. What happens to the lighthouse keeper?",
    createdAtMs: Date.now() - 24 * 60 * 60 * 1000,
    timeLabel: "1d ago",
    baseScore: 41,
    voteState: "up",
    collapsed: false,
    replies: [
      {
        id: "seed-2-1",
        authorName: "Katha Author",
        body: "Working on it! No promises on timing yet.",
        createdAtMs: Date.now() - 20 * 60 * 60 * 1000,
        timeLabel: "20h ago",
        baseScore: 15,
        voteState: "none",
        collapsed: false,
        replies: [
          {
            id: "seed-2-1-1",
            authorName: "Priya M.",
            body: "Take your time, the world is worth the wait.",
            createdAtMs: Date.now() - 18 * 60 * 60 * 1000,
            timeLabel: "18h ago",
            baseScore: 4,
            voteState: "none",
            collapsed: false,
            replies: [
              {
                id: "seed-2-1-1-1",
                authorName: "Aanya K.",
                body: "Seconded. Quality over speed.",
                createdAtMs: Date.now() - 17 * 60 * 60 * 1000,
                timeLabel: "17h ago",
                baseScore: 2,
                voteState: "none",
                collapsed: false,
                replies: [
                  {
                    id: "seed-2-1-1-1-1",
                    authorName: "Dev S.",
                    body: "This is the way.",
                    createdAtMs: Date.now() - 16 * 60 * 60 * 1000,
                    timeLabel: "16h ago",
                    baseScore: 1,
                    voteState: "none",
                    collapsed: false,
                    replies: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "seed-3",
    authorName: "Rohan T.",
    body: "The ending genuinely surprised me. Sharing this with my book club.",
    createdAtMs: Date.now() - 5 * 24 * 60 * 60 * 1000,
    timeLabel: "5d ago",
    baseScore: 9,
    voteState: "none",
    collapsed: true,
    replies: [
      {
        id: "seed-3-1",
        authorName: "Sam W.",
        body: "Which part surprised you most?",
        createdAtMs: Date.now() - 4 * 24 * 60 * 60 * 1000,
        timeLabel: "4d ago",
        baseScore: 2,
        voteState: "none",
        collapsed: false,
        replies: [
          {
            id: "seed-3-1-1",
            authorName: "Rohan T.",
            body: "No spoilers here, but the last page especially.",
            createdAtMs: Date.now() - 3 * 24 * 60 * 60 * 1000,
            timeLabel: "3d ago",
            baseScore: 1,
            voteState: "none",
            collapsed: false,
            replies: [],
          },
        ],
      },
    ],
  },
];

/**
 * The thread is server-backed when Supabase is configured, and falls back to
 * the mock above when it is not.
 *
 * The fallback is not laziness: the app runs against an unconfigured Supabase
 * in local development and in tests, and a comment section that renders an
 * error there teaches everyone to ignore the error. When there is no backend,
 * the mock is the honest thing to show - it is clearly demo content, and the
 * component exercises exactly the same code paths.
 *
 * Writes are OPTIMISTIC and then RECONCILED by refetching. The optimistic step
 * is what makes voting feel instant; the refetch is what stops the client's
 * idea of a score drifting from the database's, because `comments.score` is
 * maintained by a trigger and is the only authority on it.
 */
export default function CommentThread({
  storyId,
  chapterId,
  authorName,
  tone = "light",
  composerPosition = "top",
  onCountChange,
  canEngage = true,
  onRequireSignIn,
  onAuthorPress,
}: {
  storyId: string;
  /**
   * The chapter the reader is on, when this thread is opened from inside a
   * chapter rather than from the story page. It is sent with anything written
   * here, so the thread can show which chapter each comment is about. Absent
   * from the story page, whose comments are about the story as a whole.
   */
  chapterId?: string;
  authorName: string;
  /** `dark` for the detail page's comments sheet. See `CommentTone`. */
  tone?: CommentTone;
  /**
   * Where the "Add a comment" composer sits. `top` is the reader's inline
   * preview, where the invitation to comment leads; `bottom` is the sheet,
   * where the list is the thing and the composer is pinned under it.
   */
  composerPosition?: "top" | "bottom";
  /** Reports the total comment count whenever it changes, so a caller can show it elsewhere. */
  onCountChange?: (count: number) => void;
  /**
   * May this viewer write? False for an anonymous session.
   *
   * Reading a thread stays open to everyone. Writing does not, and the gate
   * lives here rather than at the network edge on purpose: an anonymous viewer
   * used to type a comment, watch it appear, and lose it - the write 401'd,
   * the optimistic row stayed on screen, and nothing said otherwise. The
   * control is still visible; pressing it asks them to sign in.
   */
  canEngage?: boolean;
  /** Called instead of writing, when `canEngage` is false. */
  onRequireSignIn?: () => void;
  /** Route to a commenter's profile from their byline or avatar. */
  onAuthorPress?: (authorId: string) => void;
}) {
  const remote = isSupabaseConfigured;
  const palette = COMMENT_PALETTES[tone];
  const [tree, setTree] = useState<CommentNode[]>(remote ? [] : MOCK_COMMENTS);
  const [loading, setLoading] = useState(remote);
  const [failed, setFailed] = useState(false);
  const [writeFailed, setWriteFailed] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("top");
  const [composerText, setComposerText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [pendingVotes, setPendingVotes] = useState<Record<string, boolean>>({});
  const pendingVoteIds = useRef(new Set<string>());

  const reload = useCallback(async () => {
    if (!remote) return;
    try {
      setTree(buildThread(await fetchThread(storyId)));
      setFailed(false);
    } catch {
      // Deliberately not an Alert: a failed comment load must never block the
      // story the reader actually came for.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [remote, storyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A block made anywhere this session (this thread, the story's ⋮ sheet, the
  // reader) hides that person's comments here at once, before the refetch
  // that makes the server say the same.
  const blocked = useBlockedAuthorIds();
  const visibleTree = useMemo(() => {
    let next = tree;
    for (const authorId of blocked) next = removeAuthor(next, authorId);
    return next;
  }, [tree, blocked]);
  const sorted = useMemo(
    () => sortTopLevel(visibleTree, sortMode),
    [visibleTree, sortMode],
  );
  const total = useMemo(() => countAll(visibleTree), [visibleTree]);
  const canPost = composerText.trim().length > 0;

  useEffect(() => {
    onCountChange?.(total);
  }, [onCountChange, total]);

  const handlePostRoot = () => {
    if (!canEngage) {
      onRequireSignIn?.();
      return;
    }
    const trimmed = composerText.trim();
    if (!trimmed) return;
    const optimistic = createComment("You", trimmed);
    setTree((current) => addRootComment(current, optimistic));
    setComposerText("");
    if (remote) {
      postComment(storyId, trimmed, undefined, chapterId)
        .then(() => {
          setWriteFailed(null);
          return reload();
        })
        .catch(() => {
          // TAKE THE COMMENT BACK. Leaving it on screen is exactly what made a
          // failed write look like a successful one: the writer saw their words
          // in the thread, left, and came back to find them gone. The text goes
          // back into the composer so they can send it again rather than
          // retype it.
          setTree((current) => removeComment(current, optimistic.id));
          setComposerText(trimmed);
          setWriteFailed(
            "Your comment did not save. It is back in the box - try again.",
          );
        });
    }
  };

  const handleOpenReply = (id: string) => {
    setReplyTargetId(id);
    setReplyDraft("");
  };

  const handleCancelReply = () => {
    setReplyTargetId(null);
    setReplyDraft("");
  };

  const handleSubmitReply = (parentId: string) => {
    if (!canEngage) {
      onRequireSignIn?.();
      return;
    }
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    const optimistic = createComment("You", trimmed);
    setTree((current) => addReply(current, parentId, optimistic));
    setReplyTargetId(null);
    setReplyDraft("");
    if (remote) {
      postComment(storyId, trimmed, parentId, chapterId)
        .then(() => {
          setWriteFailed(null);
          return reload();
        })
        .catch(() => {
          setTree((current) => removeComment(current, optimistic.id));
          setReplyTargetId(parentId);
          setReplyDraft(trimmed);
          setWriteFailed(
            "Your reply did not save. It is back in the box - try again.",
          );
        });
    }
  };

  /**
   * File a report on one comment.
   *
   * It THROWS on failure rather than swallowing, because the sheet's
   * confirmation screen is the reporter's only evidence the report exists and
   * must not appear over a write that never happened. `reportContent` itself
   * rejects a blank description, so the required-description rule holds even
   * for a caller that forgets to check.
   */
  const handleReport = async (
    commentId: string,
    reason: ReportReason,
    details: string,
  ) => {
    if (!canEngage) {
      onRequireSignIn?.();
      throw new Error("Sign in to report a comment.");
    }
    if (!remote) return;
    await reportContent({ commentId }, reason, details);
  };

  /**
   * Block the person who wrote a comment.
   *
   * A guest is asked to sign in, exactly as Report asks them: a block belongs
   * to an account. Rejects when the write fails, so the menu can say so; on
   * success every comment by that person leaves the thread at once (through
   * the block store) and the refetch brings the server's copy.
   */
  const handleBlock = async (authorId: string) => {
    if (!canEngage) {
      onRequireSignIn?.();
      return;
    }
    await blockAuthorEverywhere(authorId);
    setTree((current) => removeAuthor(current, authorId));
    if (remote) void reload();
  };

  /** One direction only. See the note on `CommentRowProps.onVote`. */
  const handleVote = (id: string) => {
    if (!canEngage) {
      onRequireSignIn?.();
      return;
    }
    if (pendingVoteIds.current.has(id) || pendingVotes[id]) return;
    setTree((current) => {
      const next = applyVote(current, id, "up");
      if (remote) {
        // Send the vote the tree ARRIVED AT, not "I pressed up": the control is
        // a toggle, so pressing it on an already-upvoted comment means "remove
        // my vote" (0), and sending +1 there would leave the row set while the
        // UI shows it cleared.
        //
        // The only two values this expression can produce are 1 and 0. There is
        // no branch that yields -1, which is what makes a downvote impossible
        // from this UI rather than merely absent from it.
        const value = findNode(next, id)?.voteState === "up" ? 1 : 0;
        pendingVoteIds.current.add(id);
        setPendingVotes((all) => ({ ...all, [id]: true }));
        voteOnComment(id, value)
          .then(() => {
            setWriteFailed(null);
            return reload();
          })
          .catch(() => {
            // Put the vote back. A score on screen must never claim a vote the
            // server did not record; the toggle is its own inverse.
            setTree((rolledBack) => applyVote(rolledBack, id, "up"));
            setWriteFailed(
              "That vote did not save. Check your connection and try again.",
            );
          })
          .finally(() => {
            pendingVoteIds.current.delete(id);
            setPendingVotes((all) => {
              const nextPending = { ...all };
              delete nextPending[id];
              return nextPending;
            });
          });
      }
      return next;
    });
  };

  const handleToggleCollapse = (id: string) => {
    setTree((current) => collapse(current, id));
  };

  const composer = (
    <View style={styles.composerRow}>
      <TextInput
        value={composerText}
        onChangeText={setComposerText}
        placeholder="Add a comment..."
        placeholderTextColor={palette.tertiary}
        style={[
          styles.composerInput,
          { backgroundColor: palette.field, color: palette.ink },
        ]}
        multiline
        accessibilityLabel="Write a comment"
      />
      {/*
        Disabled ONLY for an empty box. An anonymous viewer keeps a live
        button, because a dead control teaches nothing: pressing it is how they
        find out that commenting needs an account.
      */}
      <Pressable
        onPress={handlePostRoot}
        disabled={canEngage && !canPost}
        style={[
          styles.postButton,
          canEngage && !canPost && { backgroundColor: palette.field },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Post comment"
        accessibilityState={{ disabled: canEngage && !canPost }}
      >
        <Text style={styles.postButtonLabel}>Post</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      {composerPosition === "top" ? composer : null}

      <View style={styles.metaRow}>
        <Text style={[styles.count, { color: palette.ink }]}>
          {total} {total === 1 ? "comment" : "comments"}
        </Text>
        <View style={styles.sortTabs}>
          <Pressable
            onPress={() => setSortMode("top")}
            accessibilityRole="button"
            accessibilityLabel="Sort by top"
            accessibilityState={{ selected: sortMode === "top" }}
          >
            <Text style={[styles.sortTab, { color: palette.muted }, sortMode === "top" && styles.sortTabActive]}>
              Top
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortMode("new")}
            accessibilityRole="button"
            accessibilityLabel="Sort by new"
            accessibilityState={{ selected: sortMode === "new" }}
          >
            <Text style={[styles.sortTab, { color: palette.muted }, sortMode === "new" && styles.sortTabActive]}>
              New
            </Text>
          </Pressable>
        </View>
      </View>

      {writeFailed ? (
        <Text style={styles.writeError} accessibilityRole="alert">
          {writeFailed}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : failed ? (
        /*
         * A failed load is stated and made retryable rather than swallowed.
         * The composer above stays usable: a reader who cannot SEE the thread
         * can still leave a comment, and the write path is independent of the
         * read path.
         */
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>Comments could not load</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void reload();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading comments"
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>No comments yet</Text>
          <Text style={[styles.emptySub, { color: palette.muted }]}>
            Be the first to tell {authorName} what you thought.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sorted.map((node, index) => (
            <View
              key={node.id}
              style={index > 0
                ? [styles.rootDivider, { borderTopColor: palette.line }]
                : undefined}
            >
              <CommentRow
                node={node}
                depth={0}
                tone={tone}
                replyTargetId={replyTargetId}
                replyDraft={replyDraft}
                onReplyDraftChange={setReplyDraft}
                onOpenReply={handleOpenReply}
                onCancelReply={handleCancelReply}
                onSubmitReply={handleSubmitReply}
                onVote={handleVote}
                onToggleCollapse={handleToggleCollapse}
                onAuthorPress={onAuthorPress}
                onReport={handleReport}
                onBlock={handleBlock}
                viewerId={getViewerId()}
              />
            </View>
          ))}
        </View>
      )}

      {composerPosition === "bottom" ? composer : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.betweenGroups,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.related,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.related,
    ...type.body,
    fontSize: 14,
    color: colors.ink,
  },
  postButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  postButtonDisabled: {
    backgroundColor: colors.surface2,
  },
  postButtonLabel: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.surface,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  count: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
  },
  sortTabs: {
    flexDirection: "row",
    gap: spacing.md,
  },
  sortTab: {
    ...type.caption,
    fontWeight: "700",
    color: colors.muted,
  },
  sortTabActive: {
    color: colors.accent,
  },
  list: {
    gap: 0,
  },
  rootDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.track,
    marginTop: spacing.related,
    paddingTop: spacing.related,
  },
  retryLabel: {
    ...type.caption,
    fontWeight: "700",
    color: colors.accent,
    marginTop: spacing.related,
  },
  writeError: {
    ...type.caption,
    color: colors.accentPressed,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxxl,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...type.headline,
    color: colors.ink,
  },
  emptySub: {
    ...type.subhead,
    color: colors.muted,
    textAlign: "center",
  },
});
