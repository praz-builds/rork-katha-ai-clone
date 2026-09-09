import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ChevronDown,
  ChevronUp,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react-native";

import { colors, fonts, radius, shadows, spacing, type } from "@/theme";
import type { CommentNode, ReportReason } from "./types";
import { REPORT_REASONS, countDescendants, displayScore } from "./types";

/** Indent stops growing past this depth; deeper replies still exist in the data, they just render flat. */
const MAX_INDENT_DEPTH = 3;
const INDENT_STEP = spacing.md;

/**
 * Which ground the thread is drawn on.
 *
 * `light` is the default and is what the reader's last page and every light
 * screen use. `dark` is the story detail page's comments sheet, drawn on
 * `colors.chromeSurface`; it swaps the ink, the hairlines and the field fills
 * for their chrome counterparts and adds the avatar column the sheet design
 * calls for. Nothing about the thread's behaviour changes with tone.
 */
export type CommentTone = "light" | "dark";

export type CommentPalette = {
  ink: string;
  muted: string;
  strong: string;
  tertiary: string;
  line: string;
  field: string;
};

export const COMMENT_PALETTES: Record<CommentTone, CommentPalette> = {
  light: {
    ink: colors.ink,
    muted: colors.muted,
    strong: colors.strong,
    tertiary: colors.tertiary,
    line: colors.track,
    field: colors.surface2,
  },
  dark: {
    ink: colors.chromeText,
    muted: colors.chromeMuted,
    strong: colors.chromeText,
    tertiary: colors.chromeMuted,
    line: colors.chromeBorder,
    field: colors.chromeTrack,
  },
};

export interface CommentRowProps {
  node: CommentNode;
  depth: number;
  tone?: CommentTone;
  replyTargetId: string | null;
  replyDraft: string;
  onReplyDraftChange: (text: string) => void;
  onOpenReply: (id: string) => void;
  onCancelReply: () => void;
  onSubmitReply: (parentId: string) => void;
  onVote: (id: string, direction: "up" | "down") => void;
  onToggleCollapse: (id: string) => void;
}

export default function CommentRow({
  node,
  depth,
  tone = "light",
  replyTargetId,
  replyDraft,
  onReplyDraftChange,
  onOpenReply,
  onCancelReply,
  onSubmitReply,
  onVote,
  onToggleCollapse,
}: CommentRowProps) {
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const score = displayScore(node);
  const hiddenCount = countDescendants(node);
  const isReplyOpen = replyTargetId === node.id;
  const hasReplies = node.replies.length > 0;
  const beyondCap = depth >= MAX_INDENT_DEPTH;
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_STEP;
  const canSubmitReply = replyDraft.trim().length > 0;
  const palette = COMMENT_PALETTES[tone];
  const dark = tone === "dark";

  return (
    /*
     * The indent is PADDING, not margin, and that distinction is the whole bug
     * it fixes. A margin on these nested wrappers did not shrink them: each
     * level kept its parent's full width and simply started `indent` further
     * right, so every level pushed its text `indent` past the right edge and
     * the overflow compounded down the tree (12 + 24 + 36 = 72px off-screen at
     * depth 3, measured). Padding lives inside the box, so the wrapper stays
     * exactly parent-width and the text column narrows instead of escaping.
     */
    <View style={[styles.wrap, { paddingLeft: indent }]}>
      <View style={styles.row}>
        <Pressable
          onPress={() => onToggleCollapse(node.id)}
          hitSlop={{ left: spacing.sm, right: spacing.sm, top: 0, bottom: 0 }}
          accessibilityRole="button"
          accessibilityLabel={
            node.collapsed
              ? `Expand thread, ${hiddenCount} ${hiddenCount === 1 ? "reply" : "replies"} hidden`
              : "Collapse thread"
          }
          testID={`comment-gutter-${node.id}`}
          style={styles.gutter}
        >
          {dark && depth === 0 ? (
            /*
              The sheet design leads every top-level comment with an avatar.
              There is no avatar image on the wire, so this is the initial on
              a recessed disc - the same treatment the author card uses. It
              doubles as the collapse target, which is what the gutter is.
            */
            <View
              style={[styles.avatar, { backgroundColor: palette.field }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={[styles.avatarInitial, { color: palette.ink }]}>
                {node.authorName.trim().charAt(0).toUpperCase() || "?"}
              </Text>
            </View>
          ) : (
            <View style={[styles.gutterLine, { backgroundColor: palette.line }]} />
          )}
        </Pressable>

        <View style={styles.body}>
          <View style={styles.header}>
            <Text
              style={[
                styles.author,
                { color: palette.ink },
                dark && styles.authorUnderlined,
              ]}
            >
              {node.authorName}
            </Text>
            <Text style={[styles.dot, { color: palette.tertiary }]}>{"·"}</Text>
            <Text style={[styles.time, { color: palette.muted }]}>{node.timeLabel}</Text>
            {node.chapterNumber ? (
              <>
                <Text style={[styles.dot, { color: palette.tertiary }]}>{"·"}</Text>
                <Text
                  style={[styles.time, { color: palette.muted }]}
                  accessibilityLabel={`On chapter ${node.chapterNumber}`}
                >
                  Chapter {node.chapterNumber}
                </Text>
              </>
            ) : null}
            {node.collapsed ? (
              <Text style={[styles.hiddenCount, { color: palette.tertiary }]}>
                ({hiddenCount} {hiddenCount === 1 ? "reply" : "replies"} hidden)
              </Text>
            ) : null}
          </View>

          {!node.collapsed ? (
            <>
              <Text style={[styles.commentBody, { color: palette.ink }]}>{node.body}</Text>

              <View style={styles.actions}>
                <View style={styles.voteGroup}>
                  <Pressable
                    onPress={() => onVote(node.id, "up")}
                    hitSlop={spacing.xs}
                    accessibilityRole="button"
                    accessibilityLabel={
                      node.voteState === "up" ? "Upvoted" : `Upvote, ${score} points`
                    }
                  >
                    <ChevronUp
                      size={18}
                      color={node.voteState === "up" ? colors.accent : palette.strong}
                    />
                  </Pressable>
                  <Text
                    style={[
                      styles.score,
                      { color: palette.strong },
                      node.voteState === "up" && styles.scoreUp,
                      node.voteState === "down" && styles.scoreDown,
                    ]}
                  >
                    {score}
                  </Text>
                  <Pressable
                    onPress={() => onVote(node.id, "down")}
                    hitSlop={spacing.xs}
                    accessibilityRole="button"
                    accessibilityLabel={
                      node.voteState === "down" ? "Downvoted" : `Downvote, ${score} points`
                    }
                  >
                    <ChevronDown
                      size={18}
                      color={node.voteState === "down" ? colors.premium : palette.strong}
                    />
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => onOpenReply(node.id)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Reply to ${node.authorName}`}
                  testID={`comment-reply-open-${node.id}`}
                >
                  <MessageCircle size={15} color={palette.strong} />
                  <Text style={[styles.actionLabel, { color: palette.strong }]}>Reply</Text>
                </Pressable>

                <Pressable
                  onPress={() => setReportOpen(true)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel={`More actions for ${node.authorName}'s comment`}
                >
                  {dark ? (
                    // The sheet design names the action; the light row keeps
                    // its overflow glyph so the reader's page stays quiet.
                    <Text style={[styles.actionLabel, { color: palette.strong }]}>Report</Text>
                  ) : (
                    <MoreHorizontal size={15} color={palette.strong} />
                  )}
                </Pressable>
              </View>

              {isReplyOpen ? (
                <View style={[styles.replyComposer, { backgroundColor: palette.field }]}>
                  <TextInput
                    value={replyDraft}
                    onChangeText={onReplyDraftChange}
                    placeholder={`Reply to ${node.authorName}...`}
                    placeholderTextColor={palette.tertiary}
                    style={[styles.replyInput, { color: palette.ink }]}
                    multiline
                    autoFocus
                    accessibilityLabel={`Reply to ${node.authorName}`}
                    testID={`comment-reply-input-${node.id}`}
                  />
                  <View style={styles.replyActions}>
                    <Pressable
                      onPress={onCancelReply}
                      style={styles.replyCancelButton}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel reply"
                    >
                      <Text style={[styles.replyCancelLabel, { color: palette.muted }]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => canSubmitReply && onSubmitReply(node.id)}
                      style={[
                        styles.replySubmitButton,
                        !canSubmitReply && styles.replySubmitButtonDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Post reply"
                      accessibilityState={{ disabled: !canSubmitReply }}
                      testID={`comment-reply-submit-${node.id}`}
                    >
                      <Text style={styles.replySubmitLabel}>Reply</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {hasReplies ? (
                beyondCap && !threadExpanded ? (
                  <Pressable
                    onPress={() => setThreadExpanded(true)}
                    style={styles.continueThread}
                    accessibilityRole="button"
                    accessibilityLabel={`Continue this thread, ${hiddenCount} more ${hiddenCount === 1 ? "reply" : "replies"}`}
                  >
                    <Text style={styles.continueThreadLabel}>
                      Continue this thread ({hiddenCount})
                    </Text>
                  </Pressable>
                ) : (
                  node.replies.map((child) => (
                    <CommentRow
                      key={child.id}
                      node={child}
                      depth={depth + 1}
                      tone={tone}
                      replyTargetId={replyTargetId}
                      replyDraft={replyDraft}
                      onReplyDraftChange={onReplyDraftChange}
                      onOpenReply={onOpenReply}
                      onCancelReply={onCancelReply}
                      onSubmitReply={onSubmitReply}
                      onVote={onVote}
                      onToggleCollapse={onToggleCollapse}
                    />
                  ))
                )
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      <ReportCommentSheet visible={reportOpen} onClose={() => setReportOpen(false)} />
    </View>
  );
}

/** Small overflow action sheet: pick a reason, then a confirmation state. */
function ReportCommentSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleClose = () => {
    onClose();
    setReason(null);
    setSubmitted(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss report sheet"
        />
        <View style={sheetStyles.sheet}>
          {submitted ? (
            <>
              <Text style={sheetStyles.title}>Comment reported</Text>
              <Text style={sheetStyles.subtitle}>
                Thanks - our team will take a look.
              </Text>
              <Pressable
                onPress={handleClose}
                style={sheetStyles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={sheetStyles.primaryButtonLabel}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={sheetStyles.title}>Report comment</Text>
              <Text style={sheetStyles.subtitle}>Why are you reporting this?</Text>
              {REPORT_REASONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setReason(option.id)}
                  style={sheetStyles.reasonRow}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === option.id }}
                  accessibilityLabel={option.label}
                >
                  <View
                    style={[
                      sheetStyles.radio,
                      reason === option.id && sheetStyles.radioSelected,
                    ]}
                  />
                  <Text style={sheetStyles.reasonLabel}>{option.label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => reason && setSubmitted(true)}
                style={[
                  sheetStyles.primaryButton,
                  !reason && sheetStyles.primaryButtonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                accessibilityState={{ disabled: !reason }}
              >
                <Text style={sheetStyles.primaryButtonLabel}>Submit report</Text>
              </Pressable>
              <Pressable
                onPress={handleClose}
                style={sheetStyles.cancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={sheetStyles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    paddingVertical: spacing.related,
    gap: spacing.related,
  },
  gutter: {
    width: spacing.lg,
    alignItems: "center",
  },
  gutterLine: {
    width: 2,
    flex: 1,
    minHeight: spacing.xl,
    borderRadius: radius.sm,
    backgroundColor: colors.track,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    // The gutter column is `spacing.lg` wide; the disc is wider on purpose and
    // hangs into the gap, which is what gives the sheet its avatar column.
    marginLeft: -spacing.sm,
    marginRight: spacing.sm,
  },
  avatarInitial: {
    ...type.headline,
    fontFamily: fonts.display,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  author: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
  },
  authorUnderlined: {
    textDecorationLine: "underline",
  },
  dot: {
    ...type.caption,
    color: colors.tertiary,
  },
  time: {
    ...type.caption,
    color: colors.muted,
  },
  hiddenCount: {
    ...type.caption,
    color: colors.tertiary,
  },
  commentBody: {
    ...type.body,
    fontSize: 15,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.related,
  },
  voteGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  score: {
    ...type.caption,
    fontWeight: "700",
    color: colors.strong,
    minWidth: 18,
    textAlign: "center",
  },
  scoreUp: {
    color: colors.accent,
  },
  scoreDown: {
    color: colors.premium,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  actionLabel: {
    ...type.caption,
    fontWeight: "700",
    color: colors.strong,
  },
  replyComposer: {
    marginTop: spacing.related,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.related,
  },
  replyInput: {
    ...type.body,
    fontSize: 14,
    color: colors.ink,
    minHeight: 40,
    padding: 0,
  },
  replyActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  replyCancelButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  replyCancelLabel: {
    ...type.caption,
    fontWeight: "700",
    color: colors.muted,
  },
  replySubmitButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  replySubmitButtonDisabled: {
    backgroundColor: colors.surface2,
  },
  replySubmitLabel: {
    ...type.caption,
    fontWeight: "700",
    color: colors.surface,
  },
  continueThread: {
    marginTop: spacing.related,
    paddingVertical: spacing.xs,
  },
  continueThreadLabel: {
    ...type.caption,
    fontWeight: "700",
    // Accent, not `colors.info`: orange is this app's one interactive colour,
    // and a blue link here reads as though it came from another product.
    color: colors.accent,
  },
});

const sheetStyles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    boxShadow: shadows.overlay,
    gap: spacing.related,
  },
  title: {
    ...type.headline,
    color: colors.ink,
  },
  subtitle: {
    ...type.subhead,
    color: colors.muted,
    marginBottom: spacing.related,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.track,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  reasonLabel: {
    ...type.body,
    fontSize: 15,
    color: colors.ink,
  },
  primaryButton: {
    marginTop: spacing.related,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: {
    backgroundColor: colors.surface2,
  },
  primaryButtonLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
  cancelButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.muted,
  },
});
