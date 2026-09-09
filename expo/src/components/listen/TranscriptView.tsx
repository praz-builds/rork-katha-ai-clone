import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { TranscriptLine } from "@/lib/transcript-sync";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The chapter's words, following the narration.
 *
 * Three states per line, and they are the whole point of the screen: the line
 * being read is full-strength ink on a soft accent ground, the lines already
 * read are dimmed, and the lines still to come sit at normal reading weight.
 * A reader who looks up mid-chapter can find their place in one glance.
 *
 * ## Following, and giving up following
 *
 * The view scrolls itself to keep the current line near the top third. The
 * moment the reader drags it themselves, following stops -- scrolling a
 * transcript out from under someone who is reading ahead is worse than
 * losing the highlight -- and a "Back to the line" control appears to hand it
 * back. Following resumes on its own if the reader taps a line to seek,
 * because that is an explicit statement about where they want to be.
 *
 * The highlight's timing is an approximation. See the header of
 * `lib/transcript-sync.ts`.
 */

export type TranscriptViewProps = {
  lines: readonly TranscriptLine[];
  /** -1 when there is nothing to highlight (no duration known yet). */
  activeIndex: number;
  /** Tapping a line seeks the audio to where that line is estimated to start. */
  onSeekToLine?: (index: number) => void;
  /** Extra bottom padding so the player bar never covers the last lines. */
  bottomInset?: number;
};

/** Where in the viewport the active line is parked, as a fraction of height. */
const FOLLOW_ANCHOR = 0.32;

export function TranscriptView({
  lines,
  activeIndex,
  onSeekToLine,
  bottomInset = 0,
}: TranscriptViewProps) {
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<number, number>>({});
  const viewportHeight = useRef(0);
  const [following, setFollowing] = useState(true);

  const scrollToActive = useCallback(() => {
    const y = offsets.current[activeIndex];
    if (y === undefined || viewportHeight.current <= 0) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - viewportHeight.current * FOLLOW_ANCHOR),
      animated: !reducedMotion,
    });
  }, [activeIndex, reducedMotion]);

  useEffect(() => {
    if (!following || activeIndex < 0) return;
    scrollToActive();
  }, [activeIndex, following, scrollToActive]);

  const handleLinePress = useCallback((index: number) => {
    setFollowing(true);
    onSeekToLine?.(index);
  }, [onSeekToLine]);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        testID="transcript-scroll"
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xxxl + bottomInset },
        ]}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
        }}
        // A drag is the reader taking over. Momentum and programmatic scrolls
        // do not count, or the view would stop following itself.
        onScrollBeginDrag={() => setFollowing(false)}
        scrollEventThrottle={16}
      >
        {lines.map((line) => {
          const isActive = line.index === activeIndex;
          const isRead = activeIndex >= 0 && line.index < activeIndex;
          return (
            <Pressable
              key={line.index}
              testID={`transcript-line-${line.index}`}
              accessibilityRole="button"
              accessibilityLabel={line.text}
              accessibilityHint="Play from this line"
              accessibilityState={{ selected: isActive }}
              onPress={() => handleLinePress(line.index)}
              onLayout={(event) => {
                offsets.current[line.index] = event.nativeEvent.layout.y;
              }}
              style={[
                styles.line,
                line.startsParagraph && line.index > 0 && styles.paragraphStart,
                isActive && styles.lineActive,
              ]}
            >
              <Text
                style={[
                  styles.text,
                  isRead && styles.textRead,
                  isActive && styles.textActive,
                ]}
              >
                {line.text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!following && activeIndex >= 0
        ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the line being read"
            onPress={() => {
              setFollowing(true);
              scrollToActive();
            }}
            style={({ pressed }) => [
              styles.resume,
              pressed && styles.resumePressed,
            ]}
          >
            <Text style={styles.resumeText}>Back to the line</Text>
          </Pressable>
        )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  line: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: -spacing.md,
    borderRadius: radius.md,
    // 44pt minimum target: a line of transcript is tappable to seek, so it is
    // a control, not just prose.
    minHeight: 44,
    justifyContent: "center",
  },
  paragraphStart: {
    marginTop: spacing.lg,
  },
  lineActive: {
    backgroundColor: colors.accentSoft,
  },
  text: {
    fontFamily: fonts.reader,
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
  },
  textRead: {
    color: colors.tertiary,
  },
  textActive: {
    color: colors.ink,
    fontWeight: "600",
  },
  resume: {
    position: "absolute",
    alignSelf: "center",
    bottom: spacing.lg,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.chromeSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  resumePressed: {
    opacity: 0.85,
  },
  resumeText: {
    fontFamily: fonts.ui,
    fontWeight: "600",
    fontSize: 14,
    color: colors.chromeText,
  },
});
