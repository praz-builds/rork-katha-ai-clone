import { useEffect } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { colors, radius, shadows, spacing, type } from "@/theme";
import type { StoryGatingReason } from "@/lib/api";

/**
 * Shown BEFORE generation when the writer switched a story to public and
 * shaping has already classified their idea as naming a real living person -
 * a living public figure or someone from their own life. The server would
 * force the story private either way (migration 00050); this tells them now,
 * while changing the idea is free, rather than after a credit has been spent.
 *
 * Same shell and tone as `StoryGatedPrivateModal`: an explanation, not a
 * warning. No "policy", no "violation", no apology. Two ways out, and both
 * are the writer's: keep the story and let it stay private, or go back and
 * change the idea. Hardware back reads as "change my idea", the safer of the
 * two because it spends nothing.
 */
export default function PublicEntityWarningModal({
  reason,
  onKeepPrivate,
  onChangeIdea,
}: {
  reason: StoryGatingReason | null;
  /** Generate anyway, as a private story. */
  onKeepPrivate: () => void;
  /** Close and return to the brief without generating. */
  onChangeIdea: () => void;
}) {
  const visible = reason !== null;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility?.(
        `${TITLE}. ${bodyFor(reason)}`,
      );
    }
  }, [visible, reason]);

  if (!reason) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onChangeIdea}
    >
      <View
        style={styles.root}
        accessibilityViewIsModal
        accessibilityLabel="This story cannot be public"
        accessibilityRole="alert"
      >
        <Pressable
          style={styles.backdrop}
          onPress={onChangeIdea}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="public-entity-warning-backdrop"
        />
        <View style={styles.card}>
          <Text style={styles.title}>{TITLE}</Text>
          <Text style={styles.body}>{bodyFor(reason)}</Text>
          <Pressable
            onPress={onKeepPrivate}
            style={styles.primary}
            accessibilityRole="button"
            accessibilityLabel="Keep it private and write the story"
            hitSlop={8}
          >
            <Text style={styles.primaryLabel}>Keep it private</Text>
          </Pressable>
          <Pressable
            onPress={onChangeIdea}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel="Change my idea"
            hitSlop={8}
          >
            <Text style={styles.secondaryLabel}>Change my idea</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const TITLE = "This one can't be public";

export function bodyFor(reason: StoryGatingReason | null): string {
  return reason === "private_individual"
    ? "Your idea names someone from your own life. Katha can write it, but it will stay private in your library - it can't be shared or made public."
    : "Your idea names a real person who's still alive. Katha can write it, but it will stay private in your library - it can't be shared or made public.";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.related,
    boxShadow: shadows.overlay,
  },
  title: {
    ...type.headline,
    color: colors.ink,
  },
  body: {
    ...type.body,
    color: colors.muted,
  },
  primary: {
    marginTop: spacing.related,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    ...type.body,
    fontWeight: "600",
    color: colors.ink,
  },
});
