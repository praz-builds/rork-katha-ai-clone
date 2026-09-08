import { useEffect } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { colors, radius, shadows, spacing, type } from "@/theme";
import type { StoryGatingReason } from "@/lib/api";

/**
 * Shown when the entity visibility gate has just kept a story private -
 * `publish-story` refused to publish it because its idea names a real living
 * person, and the request never went any further. This is not a warning and
 * not a failure the writer can retry: the story is exactly as finished as it
 * was, every edit is saved, and nothing needs fixing. The modal's only job is
 * to say why, plainly, once.
 *
 * `reason` doubles as the visibility flag - there is nothing to show without
 * one, and a caller clearing it to `null` is how the modal is dismissed from
 * outside as well as from its own button.
 */
export default function StoryGatedPrivateModal({
  reason,
  onAcknowledge,
}: {
  reason: StoryGatingReason | null;
  onAcknowledge: () => void;
}) {
  const visible = reason !== null;
  const reducedMotion = useReducedMotion();

  // Announced rather than focus-forced: a screen reader user hears why the
  // moment the modal opens, but nothing here moves their cursor for them or
  // strands them somewhere they cannot leave. The single button below and the
  // hardware back gesture (`onRequestClose`) both reach the same exit.
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility?.(
        "This story stays private. " + bodyFor(reason),
      );
    }
  }, [visible, reason]);

  if (!reason) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onAcknowledge}
    >
      <View
        style={styles.root}
        accessibilityViewIsModal
        accessibilityLabel="Story kept private"
        accessibilityRole="alert"
      >
        <Pressable
          style={styles.backdrop}
          onPress={onAcknowledge}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="story-gated-private-backdrop"
        />
        <View style={styles.card}>
          <Text style={styles.title}>This one stays private</Text>
          <Text style={styles.body}>{bodyFor(reason)}</Text>
          <Pressable
            onPress={onAcknowledge}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel="Got it, close this explanation"
            hitSlop={8}
          >
            <Text style={styles.buttonLabel}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function bodyFor(reason: StoryGatingReason | null): string {
  return reason === "private_individual"
    ? "This story names someone from your own life, so it stays private. It's in your library to read and continue - it just can't be shared or made public."
    : "This story names a real person who's still alive, so it stays private. It's in your library to read and continue - it just can't be shared or made public.";
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
    borderRadius: radius.xl,
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
  button: {
    marginTop: spacing.related,
    minHeight: 44,
    minWidth: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: {
    ...type.body,
    fontWeight: "700",
    color: colors.surface,
  },
});
