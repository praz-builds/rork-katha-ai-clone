import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing, type } from "@/theme";
import CommentRow from "./CommentRow";
import type { CommentNode, SortMode } from "./types";
import {
  addReply,
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

export default function CommentThread({
  authorName,
}: {
  storyId: string;
  authorName: string;
}) {
  const [tree, setTree] = useState<CommentNode[]>(MOCK_COMMENTS);
  const [sortMode, setSortMode] = useState<SortMode>("top");
  const [composerText, setComposerText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  const sorted = useMemo(() => sortTopLevel(tree, sortMode), [tree, sortMode]);
  const total = useMemo(() => countAll(tree), [tree]);
  const canPost = composerText.trim().length > 0;

  const handlePostRoot = () => {
    const trimmed = composerText.trim();
    if (!trimmed) return;
    setTree((current) => addRootComment(current, createComment("You", trimmed)));
    setComposerText("");
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
  };

  const handleVote = (id: string, direction: "up" | "down") => {
    setTree((current) => applyVote(current, id, direction));
  };

  const handleToggleCollapse = (id: string) => {
    setTree((current) => collapse(current, id));
  };

  return (
    <View style={styles.container}>
      <View style={styles.composerRow}>
        <TextInput
          value={composerText}
          onChangeText={setComposerText}
          placeholder="Add a comment..."
          placeholderTextColor={colors.tertiary}
          style={styles.composerInput}
          multiline
          accessibilityLabel="Write a comment"
        />
        <Pressable
          onPress={handlePostRoot}
          disabled={!canPost}
          style={[styles.postButton, !canPost && styles.postButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !canPost }}
        >
          <Text style={styles.postButtonLabel}>Post</Text>
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.count}>
          {total} {total === 1 ? "comment" : "comments"}
        </Text>
        <View style={styles.sortTabs}>
          <Pressable
            onPress={() => setSortMode("top")}
            accessibilityRole="button"
            accessibilityLabel="Sort by top"
            accessibilityState={{ selected: sortMode === "top" }}
          >
            <Text style={[styles.sortTab, sortMode === "top" && styles.sortTabActive]}>
              Top
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortMode("new")}
            accessibilityRole="button"
            accessibilityLabel="Sort by new"
            accessibilityState={{ selected: sortMode === "new" }}
          >
            <Text style={[styles.sortTab, sortMode === "new" && styles.sortTabActive]}>
              New
            </Text>
          </Pressable>
        </View>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No comments yet</Text>
          <Text style={styles.emptySub}>
            Be the first to tell {authorName} what you thought.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sorted.map((node, index) => (
            <View
              key={node.id}
              style={index > 0 ? styles.rootDivider : undefined}
            >
              <CommentRow
                node={node}
                depth={0}
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
