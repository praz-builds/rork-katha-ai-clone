import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { StoryCard } from "@/components/KathaPrimitives";
import { colors, radius, spacing, type } from "@/theme";
import type { Story } from "@/types/domain";

export type ShelfState = "loading" | "ready" | "error";

/**
 * A list of stories with the three answers it can honestly give.
 *
 * The three states are separate on purpose. Library used to render one list
 * and one empty state, so "we could not reach the server" and "you have not
 * written anything" looked identical: the same grey line telling a writer to
 * create their first story, on top of a shelf full of work. A shelf that
 * cannot load says so and offers the retry.
 */
export default function StoryShelf({
  state,
  stories,
  onStory,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyBody,
  emptyAction,
  loadingLabel,
  testID,
}: {
  state: ShelfState;
  stories: readonly Story[];
  onStory: (id: string) => void;
  onRetry: () => void;
  emptyIcon?: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  /** The one thing worth doing from an empty shelf, if there is one. */
  emptyAction?: { label: string; onPress: () => void };
  loadingLabel: string;
  testID: string;
}) {
  // A shelf that already has something to show keeps showing it while it
  // refreshes. Replacing a populated list with a spinner on every visit is a
  // flash of nothing in exchange for information the reader already had.
  if (state === "loading" && stories.length === 0) {
    return (
      <View style={styles.stateBox} testID={`${testID}-loading`}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.stateText}>{loadingLabel}</Text>
      </View>
    );
  }

  if (state === "error" && stories.length === 0) {
    return (
      <View style={styles.stateBox} testID={`${testID}-error`}>
        <Text style={styles.stateText}>
          We could not load this just now. Your stories are safe.
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (stories.length === 0) {
    return (
      <View style={styles.stateBox} testID={`${testID}-empty`}>
        {emptyIcon}
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.stateText}>{emptyBody}</Text>
        {emptyAction ? (
          <Pressable
            onPress={emptyAction.onPress}
            accessibilityRole="button"
            accessibilityLabel={emptyAction.label}
            testID={`${testID}-empty-action`}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>{emptyAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.stack} testID={`${testID}-list`}>
      {/*
        A refresh that failed over a shelf that already has stories.

        The full-screen error above only fires on an EMPTY shelf, which is
        right -- replacing a shelf full of work with an error box loses the
        work. But the earlier version then said nothing at all: the stale
        list stood there looking current, with no hint the refresh had failed
        and nothing to retry, so a story published a minute ago was simply
        missing with no explanation. This is the narrow version of the same
        message: the stories stay, and the failure is stated above them with
        the retry attached.
      */}
      {state === "error" ? (
        <View style={styles.staleBanner} testID={`${testID}-stale-error`}>
          <Text style={styles.staleText}>
            Showing what we last loaded. The refresh did not go through.
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {stories.map((story) => (
        <StoryCard
          key={story.id}
          story={story}
          onPress={() => onStory(story.id)}
          compact
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  staleBanner: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    alignItems: "center",
    gap: spacing.md,
  },
  staleText: { ...type.subhead, color: colors.muted, textAlign: "center" },
  pressed: { opacity: 0.8 },
  stateBox: {
    paddingVertical: spacing.huge,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyTitle: { ...type.headline, color: colors.ink, textAlign: "center" },
  stateText: {
    ...type.subhead,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryLabel: { ...type.body, fontWeight: "800", color: colors.surface },
  secondaryButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: { ...type.subhead, color: colors.ink, fontWeight: "800" },
});
