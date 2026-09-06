import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, shadows, spacing, type } from "@/theme";
import { REPORT_REASONS } from "@/components/comments/types";
import type { ReportReason } from "@/components/comments/types";

type SheetView = "menu" | "reportReasons" | "reportDone" | "blockConfirm" | "blockDone";

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
}: {
  visible: boolean;
  onClose: () => void;
  storyTitle: string;
  authorName: string;
  onBlockAuthor: () => void;
}) {
  const [view, setView] = useState<SheetView>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);

  // Reset to the top of the sheet every time it is (re)opened.
  useEffect(() => {
    if (visible) {
      setView("menu");
      setReason(null);
    }
  }, [visible]);

  const handleClose = () => {
    onClose();
  };

  const handleConfirmBlock = () => {
    onBlockAuthor();
    setView("blockDone");
  };

  const handleSubmitReport = () => {
    if (!reason) return;
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
                <Text style={styles.optionLabel}>Report story</Text>
              </Pressable>

              <Pressable
                onPress={() => setView("blockConfirm")}
                style={styles.optionRow}
                accessibilityRole="button"
                accessibilityLabel={`Block ${authorName}`}
              >
                <Text style={[styles.optionLabel, styles.destructiveLabel]}>Block author</Text>
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
                style={styles.destructiveButton}
                accessibilityRole="button"
                accessibilityLabel={`Confirm block ${authorName}`}
              >
                <Text style={styles.destructiveButtonLabel}>Block author</Text>
              </Pressable>
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
    justifyContent: "center",
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
