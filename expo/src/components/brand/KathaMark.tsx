import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path, type PathProps } from "react-native-svg";
import { K_LENGTH, K_PATH, K_VIEWBOX } from "@/brand/kGlyph";
import { colors, motion } from "@/theme";

/**
 * The Katha "K", drawn on.
 *
 * A pen traces the outline, then ink floods it. Both halves are one gesture,
 * not two steps: the fill starts while the pen is still moving (see
 * `fillStartPercent`), so the mark never sits as a hollow outline waiting for
 * something to happen to it.
 *
 * The trace is a dash offset walked from the full perimeter down to zero.
 * React Native has no `getTotalLength()`, so that perimeter cannot be measured
 * from the rendered node — it comes from `K_LENGTH`, baked alongside the path
 * and guarded by a test that re-walks the contour.
 */

/**
 * Below ~300ms the trace reads as a flicker rather than a stroke, and above
 * 4s a brand mark is holding the screen hostage. Callers are clamped rather
 * than rejected: a bad number should still produce a usable mark.
 */
export const DRAW_DURATION_MIN_MS = 300;
export const DRAW_DURATION_MAX_MS = 4000;

/**
 * How long the fill keeps going after the pen lands. Short on purpose — the
 * overlap is what sells the gesture, this is just the ink settling.
 */
const FILL_TAIL_MS = motion.fast;

/** The pen accelerates away and decelerates into the final corner. */
const DRAW_EASING = Easing.inOut(Easing.quad);
/** Ink spreads fast then slows; it never eases in, it is already flowing. */
const FILL_EASING = Easing.out(Easing.quad);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Props = {
  /** Rendered edge length in points. The glyph is square. */
  size?: number;
  /** Milliseconds for the trace, clamped to [300, 4000]. */
  drawDuration?: number;
  /**
   * Percentage of the trace at which the ink starts. At 100 the fill waits for
   * the pen, which is the one setting that breaks the single-gesture reading —
   * available, but not the default.
   */
  fillStartPercent?: number;
  /** Stroke width in viewBox units, so it scales with `size`. */
  strokeWidth?: number;
  color?: string;
  /** Defaults to `color`; split them for an outline in a second tone. */
  fillColor?: string;
  loop?: boolean;
  /** Pause on the finished mark before tracing it again. */
  loopDelay?: number;
  /** Fires once per completed cycle, including under reduced motion. */
  onComplete?: () => void;
  testID?: string;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function KathaMark({
  size = 96,
  drawDuration = 1200,
  fillStartPercent = 70,
  strokeWidth = 3,
  color = colors.accent,
  fillColor,
  loop = false,
  loopDelay = 600,
  onComplete,
  testID,
}: Props) {
  const reduceMotion = useReduceMotion();
  const dashOffset = useSharedValue(K_LENGTH);
  const fillOpacity = useSharedValue(0);

  // Held in a ref so a caller passing an inline arrow does not restart the
  // trace on every parent render.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const draw = clamp(drawDuration, DRAW_DURATION_MIN_MS, DRAW_DURATION_MAX_MS);
  const fillDelay = (draw * clamp(fillStartPercent, 0, 100)) / 100;
  const fillDuration = draw - fillDelay + FILL_TAIL_MS;

  useEffect(() => {
    // Unknown until the platform answers. Starting on the assumption of "no
    // preference" and cancelling a frame later is exactly the flash of motion
    // the setting exists to prevent, so the mark waits, held at its start.
    if (reduceMotion === null) return;

    if (reduceMotion) {
      dashOffset.value = 0;
      fillOpacity.value = 1;
      onCompleteRef.current?.();
      return;
    }

    let live = true;
    let restart: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      // The animation callback can outrun teardown by a frame; nothing after
      // this point may touch a caller that has already gone away.
      if (!live) return;
      onCompleteRef.current?.();
      if (!loop) return;
      restart = setTimeout(() => {
        if (live) play();
      }, loopDelay);
    };

    const play = () => {
      dashOffset.value = K_LENGTH;
      fillOpacity.value = 0;
      dashOffset.value = withTiming(0, { duration: draw, easing: DRAW_EASING });
      fillOpacity.value = withDelay(
        fillDelay,
        withTiming(1, { duration: fillDuration, easing: FILL_EASING }, (done) => {
          "worklet";
          if (done) runOnJS(finish)();
        }),
      );
    };

    play();

    return () => {
      live = false;
      if (restart !== undefined) clearTimeout(restart);
      cancelAnimation(dashOffset);
      cancelAnimation(fillOpacity);
    };
  }, [
    dashOffset,
    draw,
    fillDelay,
    fillDuration,
    fillOpacity,
    loop,
    loopDelay,
    reduceMotion,
  ]);

  const animatedProps = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: dashOffset.value,
    fillOpacity: fillOpacity.value,
  }));

  return (
    <View
      style={[styles.root, { width: size, height: size }]}
      testID={testID}
      // The mark is the brand, not decoration, so it is announced. It is never
      // interactive, so it must not take focus away from what is.
      accessible
      accessibilityRole="image"
      accessibilityLabel="Katha"
      focusable={false}
    >
      <Svg width={size} height={size} viewBox={K_VIEWBOX}>
        <AnimatedPath
          d={K_PATH}
          fill={fillColor ?? color}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={K_LENGTH}
          animatedProps={animatedProps}
        />
      </Svg>
    </View>
  );
}

/* ── Reduced motion ────────────────────────────────────────────────────── */

/** `null` while the platform has not answered yet. */
function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });
    const listener = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (enabled: boolean) => {
        if (active) setReduceMotion(enabled);
      },
    );
    return () => {
      active = false;
      listener?.remove();
    };
  }, []);
  return reduceMotion;
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
  },
});

export default KathaMark;
