import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronUp, Flag, MessageCircle, MoreHorizontal } from "lucide-react-native";

import { colors, fonts, radius, shadows, spacing, type } from "@/theme";
import { Button } from "@/components/Button";
import type { CommentNode, ReportReason } from "./types";
import { REPORT_REASONS, countDescendants, displayScore } from "./types";

/** Indent stops growing past this depth; deeper replies still exist in the data, they just render flat. */
const MAX_INDENT_DEPTH = 3;
const INDENT_STEP = spacing.md;

/** The floor a report description has to clear. One word is not "what happened". */
export const MIN_REPORT_DETAILS_LENGTH = 10;
/** Matches the `details` column's check constraint in migration 00042. */
export const MAX_REPORT_DETAILS_LENGTH = 2_000;

/**
 * Is this description enough to file a report on?
 *
 * Exported so the rule is one function rather than a condition restated in
 * every sheet that reports something.
 */
export function isReportDescriptionValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_REPORT_DETAILS_LENGTH &&
    trimmed.length <= MAX_REPORT_DETAILS_LENGTH;
}

/**
 * Which ground the thread is drawn on.
 *
 * `light` is the default and is what the story page's comments sheet uses now
 * that the page is on the app's ordinary warm ground. `dark` is kept because
 * the palette pair is the only thing that would have to be reinvented if a
 * dark surface returns; nothing about the thread's behaviour changes with it.
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
  /**
   * Toggle THIS viewer's upvote on a comment. There is no direction argument
   * because there is no other direction: the product has one vote, and a
   * signature that cannot express a downvote is what guarantees the UI can
   * never send one.
   */
  onVote: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  /** Route to a commenter's profile. Absent leaves the byline as plain text. */
  onAuthorPress?: (authorId: string) => void;
  /**
   * File a report. Rejecting means the report did not save, and the sheet
   * says so instead of thanking the reporter for nothing.
   */
  onReport?: (
    commentId: string,
    reason: ReportReason,
    details: string,
  ) => Promise<void> | void;
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
  onAuthorPress,
  onReport,
}: CommentRowProps) {
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const score = displayScore(node);
  const hiddenCount = countDescendants(node);
  const isReplyOpen = replyTargetId === node.id;
  const hasReplies = node.replies.length > 0;
  const beyondCap = depth >= MAX_INDENT_DEPTH;
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_STEP;
  const canSubmitReply = replyDraft.trim().length > 0;
  const palette = COMMENT_PALETTES[tone];
  const authorId = node.authorId;
  const canOpenAuthor = Boolean(onAuthorPress && authorId);

  const openAuthor = () => {
    if (onAuthorPress && authorId) onAuthorPress(authorId);
  };

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
        {/*
          The left column: a face at the top level, and under it the rail that
          collapses the thread.

          The avatar is the first half of the tappable byline - a reader who
          wants to know who wrote something aims at the face, not at the name
          beside it - so it cannot also be the collapse target. The rail keeps
          that job at every depth, which is also where a reader already reaches
          for it.
        */}
        <View style={[styles.gutter, depth === 0 && styles.gutterWithAvatar]}>
          {depth === 0 ? (
            <Pressable
              onPress={canOpenAuthor ? openAuthor : undefined}
              disabled={!canOpenAuthor}
              accessibilityRole={canOpenAuthor ? "button" : undefined}
              accessibilityLabel={
                canOpenAuthor ? `View ${node.authorName}'s profile` : undefined
              }
              testID={`comment-avatar-${node.id}`}
              style={[styles.avatar, { backgroundColor: palette.field }]}
            >
              <Text style={[styles.avatarInitial, { color: palette.ink }]}>
                {node.authorName.trim().charAt(0).toUpperCase() || "?"}
              </Text>
            </Pressable>
          ) : null}
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
            style={styles.gutterRail}
          >
            <View style={[styles.gutterLine, { backgroundColor: palette.line }]} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.header}>
            <Text
              style={[
                styles.author,
                { color: palette.ink },
                canOpenAuthor && styles.authorUnderlined,
              ]}
              onPress={canOpenAuthor ? openAuthor : undefined}
              accessibilityRole={canOpenAuthor ? "link" : undefined}
              accessibilityLabel={
                canOpenAuthor ? `View ${node.authorName}'s profile` : undefined
              }
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
                {/*
                  ONE DIRECTION. The downvote arrow is gone, not disabled: a
                  thread where a reader can push a stranger's comment below
                  zero rewards the fastest reaction rather than the most
                  useful one, and the score it produced said more about who
                  was annoyed than about what was worth reading.
                */}
                <View style={styles.voteGroup}>
                  <Pressable
                    onPress={() => onVote(node.id)}
                    hitSlop={spacing.xs}
                    accessibilityRole="button"
                    accessibilityLabel={
                      node.voteState === "up" ? "Upvoted" : `Upvote, ${score} points`
                    }
                    testID={`comment-upvote-${node.id}`}
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
                    ]}
                  >
                    {score}
                  </Text>
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

                {/*
                  REPORT IS BEHIND THE MENU, NOT ON THE ROW. A Report button
                  sitting next to Reply is a one-tap way to express irritation,
                  and that is what it was used for. Two taps and a description
                  is not a maze; it is the difference between a rage-click and
                  a report a moderator can act on.
                */}
                <Pressable
                  onPress={() => setMenuOpen(true)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel={`More actions for ${node.authorName}'s comment`}
                  testID={`comment-menu-${node.id}`}
                >
                  <MoreHorizontal size={15} color={palette.strong} />
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
                      onAuthorPress={onAuthorPress}
                      onReport={onReport}
                    />
                  ))
                )
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      <CommentOverflowMenu
        visible={menuOpen}
        authorName={node.authorName}
        onClose={() => setMenuOpen(false)}
        onReport={() => {
          setMenuOpen(false);
          setReportOpen(true);
        }}
      />

      <ReportCommentSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={onReport
          ? (reason, details) => onReport(node.id, reason, details)
          : undefined}
      />
    </View>
  );
}

/** The three-dot menu. One item today; it is a menu so Report is never one tap away. */
function CommentOverflowMenu({
  visible,
  authorName,
  onClose,
  onReport,
}: {
  visible: boolean;
  authorName: string;
  onClose: () => void;
  onReport: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
        />
        <View style={sheetStyles.sheet}>
          <Text style={sheetStyles.title} numberOfLines={1}>
            {authorName}&apos;s comment
          </Text>
          <Pressable
            onPress={onReport}
            style={sheetStyles.optionRow}
            accessibilityRole="button"
            accessibilityLabel="Report comment"
          >
            <Flag size={18} color={colors.strong} />
            <Text style={sheetStyles.optionLabel}>Report</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={sheetStyles.cancelButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={sheetStyles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Pick a reason, then SAY WHAT HAPPENED.
 *
 * The description is not optional and the submit button stays disabled until
 * there is one. It is also the only part of a report a moderator can act on:
 * "harassment" names a bucket, "he posted my address in the third reply"
 * names the thing to look at.
 */
export function ReportCommentSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit?: (reason: ReportReason, details: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Every reopen starts clean. A half-written report from the last comment
  // must never be attached to this one.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails("");
      setBusy(false);
      setError(null);
      setSubmitted(false);
    }
  }, [visible]);

  const describedEnough = isReportDescriptionValid(details);
  const canSubmit = Boolean(reason) && describedEnough && !busy;

  const handleSubmit = async () => {
    if (!reason || !describedEnough || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Not `onSubmit?.(...)`. Optional chaining made a missing handler look
      // exactly like a successful write, and the sheet then said "Comment
      // reported - our team will take a look" about a report that had gone
      // nowhere at all. A sheet with nothing behind it fails like any other
      // failure to write.
      if (!onSubmit) throw new Error("No report handler");
      await onSubmit(reason, details.trim());
      setSubmitted(true);
    } catch {
      // A report the reporter believes was filed and was not is worse than a
      // visible failure, so this says so and leaves what they wrote in place.
      setError("That report did not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.backdrop}
          onPress={onClose}
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
              <Button
                label="Done"
                onPress={onClose}
                style={sheetStyles.primaryButton}
              />
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

              <Text style={sheetStyles.fieldLabel}>What happened?</Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Describe the problem in a sentence or two."
                placeholderTextColor={colors.tertiary}
                style={sheetStyles.detailsInput}
                multiline
                maxLength={MAX_REPORT_DETAILS_LENGTH}
                accessibilityLabel="Describe the problem"
                testID="report-details-input"
              />
              <Text style={sheetStyles.fieldHint}>
                {describedEnough
                  ? "Thanks - this is what a moderator reads first."
                  : "A report needs a description before it can be sent."}
              </Text>

              {error ? <Text style={sheetStyles.error}>{error}</Text> : null}

              <Button
                label={busy ? "Sending..." : "Submit report"}
                accessibilityLabel="Submit report"
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={sheetStyles.primaryButton}
              />
              <Pressable
                onPress={onClose}
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
  /* Wide enough for the 40px avatar at the top level. */
  gutterWithAvatar: {
    width: 40,
  },
  gutterRail: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
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
  optionRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.track,
  },
  optionLabel: {
    ...type.body,
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
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
  fieldLabel: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
    marginTop: spacing.related,
  },
  detailsInput: {
    ...type.body,
    fontSize: 15,
    color: colors.ink,
    minHeight: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.related,
    textAlignVertical: "top",
  },
  fieldHint: {
    ...type.caption,
    color: colors.muted,
  },
  /** Layout only; the recipe is `Button`'s. */
  primaryButton: { marginTop: spacing.related },
  error: {
    ...type.caption,
    color: colors.accentPressed,
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
