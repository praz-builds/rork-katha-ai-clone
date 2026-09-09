import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ban, Download, Flag } from "lucide-react-native";

import { colors, radius, shadows, spacing, type } from "@/theme";
import { REPORT_REASONS } from "@/components/comments/types";
import type { ReportReason } from "@/components/comments/types";

type SheetView = "menu" | "reportReasons" | "reportDone" | "blockConfirm" | "blockDone";
type MaybePromise<T> = T | Promise<T>;

/**
 * Bottom sheet for the two moderation actions available from a story: report
 * the story, or block its author. Both destructive/consequential steps get an
 * in-sheet confirmation state rather than `Alert.alert` - the app renders on
 * web in the dev server and a native confirm() dialog blocks the page.
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
   * Persist the report. Optional so the sheet still works in isolation and in
   * tests; when absent the sheet shows its confirmation and files nothing.
   */
  onSubmitReport?: (reason: ReportReason) => void;
  /** "Download as PDF". The sheet closes first; the platform's dialog takes over. Absent hides the row. */
  onDownloadPdf?: () => void;
  /** False for the story's own author - you cannot block yourself, so the row is not offered. */
  canBlockAuthor?: boolean;
}) {
  const [view, setView] = useState<SheetView>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Reset to the top of the sheet every time it is (re)opened.
  useEffect(() => {
    if (visible) {
      setView("menu");
      setReason(null);
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

  const handleSubmitReport = () => {
    if (!reason) return;
    // The confirmation is shown regardless of whether the write succeeds.
    // A report is a one-way signal to moderators, not a transaction the
    // reporter is waiting on, and telling someone their report failed invites
    // them to file it repeatedly - which the duplicate constraint rejects
    // anyway.
    onSubmitReport?.(reason);
    setView("reportDone");
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
              <Text style={styles.subtitle}>Why are you reporting this story?</Text>
              {REPORT_REASONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setReason(option.id)}
                  style={styles.reasonRow}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === option.id }}
                  accessibilityLabel={option.label}
                >
                  <View
                    style={[styles.radio, reason === option.id && styles.radioSelected]}
                  />
                  <Text style={styles.reasonLabel}>{option.label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={handleSubmitReport}
                style={[styles.primaryButton, !reason && styles.primaryButtonDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                accessibilityState={{ disabled: !reason }}
              >
                <Text style={styles.primaryButtonLabel}>Submit report</Text>
              </Pressable>
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
