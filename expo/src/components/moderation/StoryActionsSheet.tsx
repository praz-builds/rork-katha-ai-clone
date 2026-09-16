import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ban, Check, Download, Flag } from "lucide-react-native";

import { colors, radius, shadows, spacing, type } from "@/theme";
import {
  MAX_STORY_REPORT_DETAILS_LENGTH,
  STORY_REPORT_REASONS,
} from "@/components/comments/types";
import type { StoryReportReason } from "@/components/comments/types";

type SheetView = "menu" | "reportReasons" | "reportDone" | "blockConfirm" | "blockDone";
type MaybePromise<T> = T | Promise<T>;

/**
 * Bottom sheet for the two moderation actions available from a story: report
 * the story, or block its author. Both destructive/consequential steps get an
 * in-sheet confirmation state rather than `Alert.alert` - the app renders on
 * web in the dev server and a native confirm() dialog blocks the page.
 *
 * The report step is the "Report story" form: four reasons as option rows,
 * an optional details field, and a Cancel / Submit Report footer. Details are
 * optional here, unlike a comment report, because the reasons already say
 * what is wrong -- a moderator can act on "inappropriate cover image" with
 * nothing else written.
 */
export default function StoryActionsSheet({
  visible,
  onClose,
  storyTitle,
  authorName,
  onBlockAuthor,
  onSubmitReport,
  onDownloadPdf,
  canBlockAuthor = true,
}: {
  visible: boolean;
  onClose: () => void;
  storyTitle: string;
  authorName: string;
  onBlockAuthor: () => MaybePromise<boolean | void>;
  /**
   * Persist the report. It receives the reason and whatever the reporter
   * wrote in Details, trimmed -- possibly an empty string, because details are
   * optional for a story. Rejecting means the report did not save, and the
   * sheet says so rather than thanking the reporter for nothing.
   *
   * Optional so the sheet still works in isolation and in tests; when absent
   * the sheet shows its confirmation and files nothing.
   */
  onSubmitReport?: (
    reason: StoryReportReason,
    details: string,
  ) => Promise<void> | void;
  /** "Download as PDF". The sheet closes first; the platform's dialog takes over. Absent hides the row. */
  onDownloadPdf?: () => void;
  /** False for the story's own author - you cannot block yourself, so the row is not offered. */
  canBlockAuthor?: boolean;
}) {
  const [view, setView] = useState<SheetView>("menu");
  const [reason, setReason] = useState<StoryReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Reset to the top of the sheet every time it is (re)opened.
  useEffect(() => {
    if (visible) {
      setView("menu");
      setReason(null);
      setDetails("");
      setReportBusy(false);
      setReportError(null);
      setBlockBusy(false);
      setBlockError(null);
    }
  }, [visible]);

  const handleClose = () => {
    onClose();
  };

  const handleConfirmBlock = async () => {
    setBlockBusy(true);
    setBlockError(null);
    try {
      const blocked = await onBlockAuthor();
      if (blocked === false) {
        setBlockError("That block did not save. Check your connection and try again.");
        return;
      }
      setView("blockDone");
    } catch {
      setBlockError("That block did not save. Check your connection and try again.");
    } finally {
      setBlockBusy(false);
    }
  };

  const canSubmitReport = Boolean(reason) && !reportBusy;

  /**
   * A report needs a reason; the details are the reporter's to add or not.
   * The confirmation is shown only if the write actually happened.
   *
   * It used to show the "thanks" screen regardless, on the argument that a
   * report is a one-way signal. That argument is fine for a report that
   * reached the server and wrong for one that did not: the reporter walks away
   * believing something is being looked at, and nothing is.
   */
  const handleSubmitReport = async () => {
    if (!reason || reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      await onSubmitReport?.(reason, details.trim());
      setView("reportDone");
    } catch {
      setReportError(
        "That report did not save. Check your connection and try again.",
      );
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet}>
          {view === "menu" ? (
            <>
              <Text style={styles.title} numberOfLines={1}>
                {storyTitle}
              </Text>
              <Text style={styles.subtitle}>by {authorName}</Text>

              <Pressable
                onPress={() => setView("reportReasons")}
                style={styles.optionRow}
                accessibilityRole="button"
                accessibilityLabel="Report story"
              >
                <Flag size={18} color={colors.strong} />
                <Text style={styles.optionLabel}>Report story</Text>
              </Pressable>

              {canBlockAuthor ? (
                <Pressable
                  onPress={() => setView("blockConfirm")}
                  style={styles.optionRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Block ${authorName}`}
                >
                  <Ban size={18} color={colors.premium} />
                  <Text style={[styles.optionLabel, styles.destructiveLabel]}>Block author</Text>
                </Pressable>
              ) : null}

              {onDownloadPdf ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    onDownloadPdf();
                  }}
                  style={styles.optionRow}
                  accessibilityRole="button"
                  accessibilityLabel="Download as PDF"
                >
                  <Download size={18} color={colors.strong} />
                  <Text style={styles.optionLabel}>Download as PDF</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleClose}
                style={styles.cancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {view === "reportReasons" ? (
            <>
              <Text style={styles.title}>Report story</Text>
              <Text style={styles.subtitle}>
                Tell us what is wrong with this story.
              </Text>
              <View style={styles.reasonList} accessibilityRole="radiogroup">
                {STORY_REPORT_REASONS.map((option) => {
                  const selected = reason === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => setReason(option.id)}
                      style={({ pressed }) => [
                        styles.reasonRow,
                        selected && styles.reasonRowSelected,
                        pressed && styles.reasonRowPressed,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, selected }}
                      accessibilityLabel={option.label}
                      testID={`story-report-reason-${option.id}`}
                    >
                      <Text
                        style={[
                          styles.reasonLabel,
                          selected && styles.reasonLabelSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <View style={[styles.radio, selected && styles.radioSelected]}>
                        {selected ? (
                          <Check size={13} color={colors.surface} strokeWidth={3} />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Details (optional)</Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Anything that would help us take a look."
                placeholderTextColor={colors.tertiary}
                style={styles.detailsInput}
                multiline
                maxLength={MAX_STORY_REPORT_DETAILS_LENGTH}
                accessibilityLabel="Describe the problem"
                testID="story-report-details-input"
              />
              {reportError ? <Text style={styles.error}>{reportError}</Text> : null}
              <View style={styles.footer}>
                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [
                    styles.footerCancel,
                    pressed && styles.footerPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.footerCancelLabel}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmitReport}
                  disabled={!canSubmitReport}
                  style={({ pressed }) => [
                    styles.footerSubmit,
                    !canSubmitReport && styles.footerSubmitDisabled,
                    pressed && canSubmitReport && styles.footerPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit report"
                  accessibilityState={{ disabled: !canSubmitReport }}
                  testID="story-report-submit"
                >
                  <Text
                    style={[
                      styles.footerSubmitLabel,
                      !canSubmitReport && styles.footerSubmitLabelDisabled,
                    ]}
                  >
                    {reportBusy ? "Sending..." : "Submit Report"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {view === "reportDone" ? (
            <>
              <Text style={styles.title}>Story reported</Text>
              <Text style={styles.subtitle}>
                Thanks for letting us know - our team will take a look.
              </Text>
              <Pressable
                onPress={handleClose}
                style={styles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={styles.primaryButtonLabel}>Done</Text>
              </Pressable>
            </>
          ) : null}

          {view === "blockConfirm" ? (
            <>
              <Text style={styles.title}>Block {authorName}?</Text>
              <Text style={styles.subtitle}>
                You won&apos;t see stories by {authorName} anymore. You can undo this later
                from your settings.
              </Text>
              <Pressable
                onPress={handleConfirmBlock}
                disabled={blockBusy}
                style={styles.destructiveButton}
                accessibilityRole="button"
                accessibilityLabel={`Confirm block ${authorName}`}
                accessibilityState={{ disabled: blockBusy }}
              >
                <Text style={styles.destructiveButtonLabel}>
                  {blockBusy ? "Blocking..." : "Block author"}
                </Text>
              </Pressable>
              {blockError ? <Text style={styles.error}>{blockError}</Text> : null}
              <Pressable
                onPress={() => setView("menu")}
                style={styles.cancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {view === "blockDone" ? (
            <>
              <Text style={styles.title}>Author blocked</Text>
              <Text style={styles.subtitle}>
                You won&apos;t see stories by {authorName} anymore.
              </Text>
              <Pressable
                onPress={handleClose}
                style={styles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text style={styles.primaryButtonLabel}>Done</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  destructiveLabel: {
    color: colors.premium,
  },

  /* ── Report form: option rows per DESIGN.md "Option Row" ──
     Radius 18, 1.5pt border, the whole row is the target, and the selected
     state is fill + border + filled radio with a check, never orange alone. */
  reasonList: {
    gap: spacing.sm,
  },
  reasonRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  reasonRowPressed: {
    opacity: 0.85,
  },
  reasonLabel: {
    ...type.body,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  reasonLabelSelected: {
    color: colors.ink,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
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
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.related,
    textAlignVertical: "top",
  },
  footer: {
    marginTop: spacing.related,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  footerCancel: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  footerCancelLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.strong,
  },
  footerSubmit: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  footerSubmitDisabled: {
    backgroundColor: colors.surface2,
  },
  footerSubmitLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
  footerSubmitLabelDisabled: {
    color: colors.tertiary,
  },
  footerPressed: {
    opacity: 0.85,
  },

  primaryButton: {
    marginTop: spacing.related,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
  destructiveButton: {
    marginTop: spacing.related,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.premium,
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveButtonLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
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
