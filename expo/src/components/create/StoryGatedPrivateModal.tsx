import { useEffect } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { colors, radius, shadows, spacing, type } from "@/theme";
import type { StoryPrivateReason } from "@/lib/api";

/**
 * Shown when a story the writer asked to publish came back private.
 *
 * Two shapes of reason, and they are not the same thing. The entity gate is a
 * decision: the idea names a real living person, the rule applied, and the
 * story will not become public. `classification_unavailable` is the absence of
 * a decision - the check did not finish in time - and that story CAN be
 * published later, unchanged. The copy below has to keep them apart, because
 * telling a writer their story names a real person when nobody ever looked is
 * a claim the server did not make.
 *
 * Neither is a warning and neither is a failure the writer can retry here: the
 * story is exactly as finished as it was, every edit is saved, and nothing
 * needs fixing. The modal's only job is to say why, plainly, once.
 *
 * `reason` doubles as the visibility flag - there is nothing to show without
 * one, and a caller clearing it to `null` is how the modal is dismissed from
 * outside as well as from its own button.
 */
export default function StoryGatedPrivateModal({
  reason,
  onAcknowledge,
}: {
  reason: StoryPrivateReason | null;
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
        titleFor(reason) + ". " + bodyFor(reason),
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
          <Text style={styles.title}>{titleFor(reason)}</Text>
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

/**
 * "For now" is the whole difference. A gated story is private permanently and
 * the writer should not be left waiting for it to change; an unchecked one is
 * private until the check runs, and saying otherwise would be a small lie in
 * the direction that makes the writer give up on it.
 */
function titleFor(reason: StoryPrivateReason | null): string {
  return reason === "classification_unavailable"
    ? "Kept private for now"
    : "This one stays private";
}

function bodyFor(reason: StoryPrivateReason | null): string {
  if (reason === "private_individual") {
    return "This story names someone from your own life, so it stays private. It's in your library to read and continue - it just can't be shared or made public.";
  }
  if (reason === "classification_unavailable") {
    // Deliberately says what happened rather than what the story contains.
    // Nothing was found in the idea, because nothing was looked at, and the
    // writer's next step is simply to try publishing again later.
    return "Katha couldn't finish checking this story in time, so it's been kept private for now. It's saved in your library to read and continue, and you can publish it later.";
  }
  return "This story names a real person who's still alive, so it stays private. It's in your library to read and continue - it just can't be shared or made public.";
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
