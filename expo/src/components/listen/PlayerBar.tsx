import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  List,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
} from "lucide-react-native";
import { formatClock } from "@/lib/transcript-sync";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The transport under the transcript.
 *
 * Dark, like the reader's chrome, and for the same reason: this is the app
 * operating the book, and it must not read as part of the page above it.
 *
 * Every control here is at least 44x44 and carries its own label -- the
 * scrubber included, which is an `adjustable` with a stepper path for
 * VoiceOver because "drag to 4 minutes 12" is not a gesture a screen-reader
 * user can make.
 */

/** The skip sizes, in the asymmetric shape every podcast player uses. */
export const SKIP_BACK_MS = 10_000;
export const SKIP_FORWARD_MS = 30_000;

/** Offered speeds. 1x is the default and always present. */
export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = typeof PLAYBACK_RATES[number];

/** One nudge of the scrubber for a screen reader, in milliseconds. */
const SCRUB_STEP_MS = 15_000;

const ADJUSTABLE_ACTIONS = [
  { name: "increment" as const },
  { name: "decrement" as const },
];

export type PlayerBarProps = {
  storyTitle: string;
  chapterTitle: string;
  isPlaying: boolean;
  /** Current playhead. */
  positionMs: number;
  /** Measured total, or 0 while the sound has not reported one yet. */
  durationMs: number;
  rate: PlaybackRate;
  hasNextChapter: boolean;
  onTogglePlay: () => void;
  onSeek: (positionMs: number) => void;
  onRateChange: (rate: PlaybackRate) => void;
  onChapters: () => void;
  onNextChapter: () => void;
};

function clampPosition(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(durationMs, Math.max(0, ms));
}

export function PlayerBar({
  storyTitle,
  chapterTitle,
  isPlaying,
  positionMs,
  durationMs,
  rate,
  hasNextChapter,
  onTogglePlay,
  onSeek,
  onRateChange,
  onChapters,
  onNextChapter,
}: PlayerBarProps) {
  const [speedOpen, setSpeedOpen] = useState(false);
  // Measured, never assumed. Until layout reports a width, a touch cannot be
  // mapped to a time and the handler no-ops rather than seeking to zero.
  const [trackWidth, setTrackWidth] = useState(0);

  const percent = durationMs > 0
    ? Math.min(1, Math.max(0, positionMs / durationMs))
    : 0;

  const seekToX = useCallback((locationX: number) => {
    if (trackWidth <= 0 || durationMs <= 0) return;
    const ratio = Math.min(1, Math.max(0, locationX / trackWidth));
    onSeek(ratio * durationMs);
  }, [durationMs, onSeek, trackWidth]);

  const nudge = useCallback((deltaMs: number) => {
    onSeek(clampPosition(positionMs + deltaMs, durationMs));
  }, [durationMs, onSeek, positionMs]);

  return (
    <View style={styles.root} testID="listen-player-bar">
      <View style={styles.titles}>
        <Text style={styles.storyTitle} numberOfLines={1}>{storyTitle}</Text>
        <Text style={styles.chapterTitle} numberOfLines={1}>{chapterTitle}</Text>
      </View>

      <View
        testID="listen-scrubber"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{
          text: durationMs > 0
            ? `${formatClock(positionMs)} of ${formatClock(durationMs)}`
            : "Unknown",
        }}
        accessibilityActions={ADJUSTABLE_ACTIONS}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") {
            nudge(SCRUB_STEP_MS);
          } else if (event.nativeEvent.actionName === "decrement") {
            nudge(-SCRUB_STEP_MS);
          }
        }}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => seekToX(event.nativeEvent.locationX)}
        onResponderMove={(event) => seekToX(event.nativeEvent.locationX)}
        style={styles.track}
      >
        <View style={styles.trackLine} />
        <View style={[styles.trackFill, { width: `${percent * 100}%` }]} />
        <View style={[styles.thumb, { left: `${percent * 100}%` }]} />
      </View>

      <View style={styles.clockRow}>
        <Text style={styles.clock}>{formatClock(positionMs)}</Text>
        <Text style={styles.clock}>
          {durationMs > 0 ? formatClock(durationMs) : "--:--"}
        </Text>
      </View>

      <View style={styles.transportRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip back 10 seconds"
          onPress={() => nudge(-SKIP_BACK_MS)}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <RotateCcw size={22} color={colors.chromeText} />
          <Text style={styles.skipLabel}>10</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause narration" : "Play narration"}
          accessibilityState={{ selected: isPlaying }}
          onPress={onTogglePlay}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          {isPlaying
            ? <Pause size={28} color={colors.chromeSurface} fill={colors.chromeSurface} />
            : <Play size={28} color={colors.chromeSurface} fill={colors.chromeSurface} />}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip forward 30 seconds"
          onPress={() => nudge(SKIP_FORWARD_MS)}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <RotateCw size={22} color={colors.chromeText} />
          <Text style={styles.skipLabel}>30</Text>
        </Pressable>
      </View>

      {speedOpen
        ? (
          <View style={styles.speedRow} testID="listen-speed-options">
            {PLAYBACK_RATES.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Playback speed ${option}x`}
                accessibilityState={{ selected: option === rate }}
                onPress={() => {
                  onRateChange(option);
                  setSpeedOpen(false);
                }}
                style={({ pressed }) => [
                  styles.speedChip,
                  option === rate && styles.speedChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.speedChipText,
                    option === rate && styles.speedChipTextActive,
                  ]}
                >
                  {option}x
                </Text>
              </Pressable>
            ))}
          </View>
        )
        : null}

      <View style={styles.secondaryRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chapter list"
          onPress={onChapters}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <List size={19} color={colors.chromeMuted} />
          <Text style={styles.secondaryText}>Chapters</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed, currently ${rate}x`}
          accessibilityState={{ expanded: speedOpen }}
          onPress={() => setSpeedOpen((open) => !open)}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.speedGlyph}>{rate}x</Text>
          <Text style={styles.secondaryText}>Speed</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next chapter"
          accessibilityState={{ disabled: !hasNextChapter }}
          disabled={!hasNextChapter}
          onPress={onNextChapter}
          style={({ pressed }) => [
            styles.secondary,
            !hasNextChapter && styles.secondaryDisabled,
            pressed && styles.pressed,
          ]}
        >
          <SkipForward size={19} color={colors.chromeMuted} />
          <Text style={styles.secondaryText}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.chromeSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  titles: {
    gap: 2,
    alignItems: "center",
  },
  storyTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 22,
    color: colors.chromeText,
    textAlign: "center",
  },
  chapterTitle: {
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    color: colors.chromeMuted,
    textAlign: "center",
  },
  track: {
    height: 44,
    justifyContent: "center",
  },
  trackLine: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.chromeTrack,
  },
  trackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: colors.chromeText,
  },
  clockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  clock: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.chromeMuted,
    fontVariant: ["tabular-nums"],
  },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxxl,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  skipLabel: {
    position: "absolute",
    fontFamily: fonts.ui,
    fontSize: 9,
    fontWeight: "600",
    color: colors.chromeText,
    marginTop: 1,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.chromeText,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.75,
  },
  speedRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  speedChip: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.chromeTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  speedChipActive: {
    backgroundColor: colors.accent,
  },
  speedChipText: {
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "600",
    color: colors.chromeText,
  },
  speedChipTextActive: {
    color: colors.surface,
  },
  secondaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  secondary: {
    minWidth: 64,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  secondaryDisabled: {
    opacity: 0.4,
  },
  secondaryText: {
    fontFamily: fonts.ui,
    fontSize: 11,
    color: colors.chromeMuted,
  },
  speedGlyph: {
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "600",
    color: colors.chromeMuted,
  },
});
