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
import type { CommentNode, SortMode } from "./types";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  buildThread,
  fetchThread,
  postComment,
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
  authorName,
  tone = "light",
  composerPosition = "top",
  onCountChange,
}: {
  storyId: string;
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
}) {
  const remote = isSupabaseConfigured;
  const palette = COMMENT_PALETTES[tone];
  const [tree, setTree] = useState<CommentNode[]>(remote ? [] : MOCK_COMMENTS);
  const [loading, setLoading] = useState(remote);
  const [failed, setFailed] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
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

  const sorted = useMemo(() => sortTopLevel(tree, sortMode), [tree, sortMode]);
  const total = useMemo(() => countAll(tree), [tree]);
  const canPost = composerText.trim().length > 0;

  useEffect(() => {
    onCountChange?.(total);
  }, [onCountChange, total]);

  const handlePostRoot = () => {
    const trimmed = composerText.trim();
    if (!trimmed) return;
    setTree((current) => addRootComment(current, createComment("You", trimmed)));
    setComposerText("");
    if (remote) {
      postComment(storyId, trimmed)
        .then(() => {
          setWriteFailed(false);
          return reload();
        })
        .catch(() => setWriteFailed(true));
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
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    setTree((current) => addReply(current, parentId, createComment("You", trimmed)));
    setReplyTargetId(null);
    setReplyDraft("");
    if (remote) {
      postComment(storyId, trimmed, parentId)
        .then(() => {
          setWriteFailed(false);
          return reload();
        })
        .catch(() => setWriteFailed(true));
    }
  };

  const handleVote = (id: string, direction: "up" | "down") => {
    if (pendingVoteIds.current.has(id) || pendingVotes[id]) return;
    setTree((current) => {
      const next = applyVote(current, id, direction);
      if (remote) {
        // Send the vote the tree ARRIVED AT, not the direction pressed: the
        // control is tri-state, so pressing "up" on an already-upvoted comment
        // means "remove my vote" (0), and sending +1 there would leave the row
        // set while the UI shows it cleared.
        const node = findNode(next, id);
        const value = node?.voteState === "up"
          ? 1
          : node?.voteState === "down"
          ? -1
          : 0;
        pendingVoteIds.current.add(id);
        setPendingVotes((all) => ({ ...all, [id]: true }));
        voteOnComment(id, value)
          .then(() => {
            setWriteFailed(false);
            return reload();
          })
          .catch(() => setWriteFailed(true))
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
      <Pressable
        onPress={handlePostRoot}
        disabled={!canPost}
        style={[
          styles.postButton,
          !canPost && { backgroundColor: palette.field },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Post comment"
        accessibilityState={{ disabled: !canPost }}
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
        <Text style={styles.writeError}>
          That action did not save. Check your connection and try again.
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
