import { Pressable, StyleSheet, Text } from "react-native";

import { Button } from "@/components/Button";
import { colors, radius, spacing, type } from "@/theme";

/**
 * "Block this person?" -- the one confirmation every block goes through.
 *
 * Drawn inside whichever sheet asked (the story's ⋮ sheet, a comment's ⋮
 * menu) rather than as an `Alert`: the app runs on web in the dev server,
 * where a native confirm() blocks the page, and the sheet it replaces is
 * already the reader's context.
 *
 * The confirm is `colors.premium`, deliberately unlike every other button in
 * the app (DESIGN.md, "Button"), so a block is never pressed by muscle
 * memory. It is the one control here not drawn by `Button`, and
 * `button-recipe.test.ts` lists it by name for that reason.
 *
 * The copy says where the undo is. "You can undo this later from your
 * settings" used to promise a screen that did not exist.
 */
export default function BlockConfirm({
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** Who is being blocked, as the reader knows them. */
  name: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Text style={styles.title}>Block {name}?</Text>
      <Text style={styles.subtitle}>
        You won&apos;t see {name}&apos;s stories or comments anymore. You can
        unblock them from Profile, under Blocked accounts.
      </Text>
      <Pressable
        onPress={onConfirm}
        disabled={busy}
        style={styles.destructiveButton}
        accessibilityRole="button"
        accessibilityLabel={`Confirm block ${name}`}
        accessibilityState={{ disabled: busy, busy }}
        testID="block-confirm"
      >
        <Text style={styles.destructiveButtonLabel}>
          {busy ? "Blocking..." : "Block"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
    </>
  );
}

/** The sentence a failed block shows, in every sheet that offers one. */
export const BLOCK_FAILED_MESSAGE =
  "That block did not save. Check your connection and try again.";

const styles = StyleSheet.create({
  title: {
    ...type.headline,
    color: colors.ink,
  },
  subtitle: {
    ...type.subhead,
    color: colors.muted,
    marginBottom: spacing.related,
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
});
