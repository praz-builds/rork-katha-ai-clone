import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { KathaMark } from "@/components/brand/KathaMark";
import { colors, fonts, spacing } from "@/theme";
import { Button } from "@/components/Button";

/**
 * The wait before a chapter can be heard.
 *
 * ## The seam
 *
 * **The animation and the rotating messages are injected, not owned.** A
 * separate design pass is producing the real loading animation and its message
 * list, and the product owner picks a variant. When that lands:
 *
 * - the chosen animation drops into the `art` prop (a single node, sized to sit
 *   inside a 180pt-tall block; it replaces `<NarrationLoaderPlaceholderArt />`
 *   entirely, and that component and its `defaultProps` usage can be deleted);
 * - the chosen copy drops into the `messages` prop as a plain string array.
 *
 * Nothing else on this screen has to change, and no caller other than
 * `ListenScreen` passes these, so the swap is two lines at one call site.
 *
 * ## What the messages are, and are not
 *
 * `status` and `detail` are the *honest* lines: they come from
 * `listenCopy(phase)` and change only when the work genuinely changes stage.
 * `messages` is the optional flavour rail beneath them, and it is explicitly
 * decorative -- it rotates on a timer, it says nothing about progress, and it
 * must never be used to imply a stage. Keeping the two apart is why a rotating
 * message list can be chosen on taste without anyone having to check whether it
 * is telling the truth.
 */

/** How long each flavour message holds before the next one. */
export const MESSAGE_ROTATE_MS = 4000;

export type NarrationLoaderProps = {
  /** The honest status line. Changes with the real stage. */
  status: string;
  /** The honest expectation under it. */
  detail: string;
  /**
   * The animation. Omit for the placeholder below.
   *
   * @see the seam note at the top of this file.
   */
  art?: ReactNode;
  /** Decorative rotating copy. Omit for none. */
  messages?: readonly string[];
  /** Override the rotation cadence. Rarely useful outside tests. */
  messageRotateMs?: number;
  /** The way out, when there is one to offer (Try again, or Read instead). */
  action?: { label: string; onPress: () => void };
  /** A quieter second action beside it. */
  secondaryAction?: { label: string; onPress: () => void };
};

/**
 * The placeholder art: the Katha mark drawing itself, on loop.
 *
 * Deliberately the plainest thing that is still ours. It is here so the screen
 * is complete and shippable before the designed animation exists, and it is the
 * first thing to delete when that animation arrives. `KathaMark` already
 * respects reduced motion internally (it settles on the finished mark instead
 * of tracing), so this needs no motion guard of its own.
 */
export function NarrationLoaderPlaceholderArt() {
  return (
    <KathaMark
      size={84}
      loop
      loopDelay={700}
      color={colors.accent}
      testID="narration-loader-placeholder-art"
    />
  );
}

export function NarrationLoader({
  status,
  detail,
  art,
  messages,
  messageRotateMs = MESSAGE_ROTATE_MS,
  action,
  secondaryAction,
}: NarrationLoaderProps) {
  const [messageAt, setMessageAt] = useState(0);

  const rotating = messages && messages.length > 1;
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(
      () => setMessageAt((at) => (at + 1) % messages.length),
      messageRotateMs,
    );
    return () => clearInterval(timer);
  }, [messageRotateMs, messages, rotating]);

  // The status line is the one thing a screen reader must not miss when it
  // changes: without this, a blind reader hears "Finding your narrator" once
  // and then silence through the entire wait, which is the exact complaint
  // that produced this screen.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(status);
  }, [status]);

  return (
    <View style={styles.root} testID="narration-loader">
      <View style={styles.art}>{art ?? <NarrationLoaderPlaceholderArt />}</View>
      <View style={styles.lines}>
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {status}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {messages && messages.length > 0
          ? (
            <Text style={styles.message} accessibilityElementsHidden>
              {messages[messageAt % messages.length]}
            </Text>
          )
          : null}
      </View>
      {action || secondaryAction
        ? (
          <View style={styles.actions}>
            {action
              ? (
                <Button
                  label={action.label}
                  onPress={action.onPress}
                  style={styles.action}
                />
              )
              : null}
            {secondaryAction
              ? (
                <Button
                  label={secondaryAction.label}
                  onPress={secondaryAction.onPress}
                  variant="ghost"
                  size="sm"
                  style={styles.secondaryAction}
                />
              )
              : null}
          </View>
        )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    gap: spacing.betweenGroups,
  },
  art: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  lines: {
    alignItems: "center",
    gap: spacing.related,
  },
  status: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
    textAlign: "center",
  },
  detail: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
    maxWidth: 320,
  },
  message: {
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    color: colors.tertiary,
    textAlign: "center",
    maxWidth: 320,
    marginTop: spacing.sm,
  },
  actions: {
    alignItems: "center",
    gap: spacing.md,
  },
  /*
    Layout only for both. They sit centred under a failed narration, so they
    keep their 180pt floor -- two buttons the width of their own labels under
    a centred paragraph read as links, not as the way out.
  */
  action: { minWidth: 180 },
  secondaryAction: { minWidth: 180 },
});
