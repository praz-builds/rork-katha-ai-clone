/**
 * The story as it is being written.
 *
 * This is the screen the streaming work exists for. Generation takes about the
 * same total time it always did; what changed is that the first sentence
 * arrives in a few seconds instead of at the end, and the reader spends the
 * remainder reading rather than waiting. A person reads at roughly 250 words a
 * minute, so a chapter finishes generating long before they finish reading it,
 * and the rest of the wait disappears underneath the reading.
 *
 * Two things this deliberately does not do.
 *
 * It does not animate a cursor or type character by character. The text already
 * arrives in real chunks at a real rate; adding a second, fake rhythm on top
 * would make it slower than it is and would be the same lie as a timed progress
 * bar.
 *
 * It does not auto-scroll once the reader has scrolled themselves. Yanking the
 * viewport away from somebody mid-sentence is worse than letting new text
 * arrive below the fold, so following is abandoned the moment they take
 * control and is not resumed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing, type } from "@/theme";

/**
 * What the server is doing right now.
 *
 * These come from real pipeline transitions, not a timer. `writing` is the
 * moment the first token lands, which is also the moment this component
 * replaces the loader, so it is never displayed.
 */
const STAGE_LABEL: Record<string, string> = {
  context: "Getting the context",
  writing: "Writing",
  shaping: "Shaping the chapter",
  art: "Drawing the cover",
};

export interface StreamingProseProps {
  /** The prose received so far. Paragraphs separated by blank lines. */
  text: string;
  /** The latest stage reported by the server, if any. */
  stage?: string;
  /** A heading above the prose, e.g. the story title once it is known. */
  title?: string;
  /**
   * Set when generation failed after prose had already been shown. The text
   * stays on screen: erasing something the reader has already read is worse
   * than leaving it unfinished.
   */
  errorMessage?: string | null;
  /**
   * Called when the reader dismisses a failure.
   *
   * Required alongside `errorMessage`: a screen that reports a failure and
   * offers no way off it is a dead end, and this one has no navigation of its
   * own because it normally exits by finishing.
   */
  onDismissError?: () => void;
  /** Label for the dismiss action. */
  dismissLabel?: string;
  testID?: string;
}

export default function StreamingProse({
  text,
  stage,
  title,
  errorMessage,
  onDismissError,
  dismissLabel = "Back",
  testID,
}: StreamingProseProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [following, setFollowing] = useState(true);

  // Splitting on blank lines matches how every other surface renders a chapter,
  // so the handoff from this view to the editor does not reflow the text.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  useEffect(() => {
    if (!following) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [text, following]);

  // A drag is the reader taking over. `onScroll` alone cannot be used for this:
  // it also fires for the programmatic scroll above, which would immediately
  // switch following off on the first chunk.
  const onScrollBeginDrag = useCallback(() => setFollowing(false), []);

  const label = errorMessage
    ? null
    : STAGE_LABEL[stage ?? ""] ?? STAGE_LABEL.writing;

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        onScrollBeginDrag={onScrollBeginDrag}
        scrollEventThrottle={16}
      >
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {paragraphs.map((paragraph, index) => (
          <Text
            key={index}
            style={styles.paragraph}
            testID={`streaming-paragraph-${index}`}
          >
            {paragraph}
          </Text>
        ))}
      </ScrollView>

      {errorMessage
        ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            {onDismissError
              ? (
                <Pressable
                  onPress={onDismissError}
                  accessibilityRole="button"
                  style={styles.dismissButton}
                  testID="streaming-dismiss-error"
                >
                  <Text style={styles.dismissText}>{dismissLabel}</Text>
                </Pressable>
              )
              : null}
          </View>
        )
        : (
          <View style={styles.statusBar}>
            <Text style={styles.statusText}>{label}</Text>
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  title: {
    ...type.title,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  // Matched to the editor's paragraph style on purpose: the reader should not
  // see the text reflow when generation finishes and the editor takes over.
  paragraph: {
    fontFamily: fonts.reader,
    color: colors.ink,
    fontSize: 18,
    lineHeight: 31,
  },
  statusBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
  },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  dismissButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  dismissText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "800",
    color: colors.accent,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.heart,
  },
});
