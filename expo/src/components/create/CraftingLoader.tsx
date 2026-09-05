import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type EasingFunction,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Pattern,
  Rect,
  Circle as PatternDot,
} from "react-native-svg";
import { colors, fonts, motion, radius, spacing } from "@/theme";

/**
 * The wait while a story is actually being written.
 *
 * Geometry, colour and timing here are a port of the approved reference at
 * `katha-crafting-loader.html`. Where a design token carries the reference's
 * exact value the token is used; where it does not, the literal from the
 * reference is kept in `REFERENCE` below rather than snapped to the nearest
 * token, because the reference is the sign-off artefact for this screen.
 *
 * The composition sits on a screen where the work may finish in 400ms or take
 * thirty seconds. `stage` advances when a stage genuinely completes; the rings
 * spin because something is in flight, not to suggest progress they do not
 * know about.
 */

/** The real stages of a story start, in the order the server completes them. */
export const CRAFTING_STAGES = [
  { id: "context", label: "Getting the context" },
  { id: "character", label: "Understanding the character" },
  { id: "conflict", label: "Shaping the conflict" },
  { id: "arc", label: "Building the story arc" },
] as const;

export type CraftingStageId = typeof CRAFTING_STAGES[number]["id"];

/**
 * Four stages inside the wait, so every message is actually read.
 *
 * The reference HTML cycles over 12s at 3000ms a stage. That was built as a
 * looping showcase, where the loop repeating is the point. Here the wait is
 * finite and short: it is held to `CRAFTING_MIN_MS` in the writer flow, and at
 * 3000ms a stage only the first two of the four ever appeared before the
 * blueprint replaced them. A user who never sees "shaping the conflict" or
 * "building the story arc" is told less about what Katha did, not more.
 *
 * So the cadence is derived from the wait rather than inherited from the
 * showcase: one full pass through the stages fits inside the floor. Four
 * stages, 1250ms each, 5000ms total. Fast enough to read, slow enough that the
 * words register rather than flicker.
 */
export const AUTO_CYCLE_MS = 1250;

/**
 * The reference's bar starts at 4% rather than 0, so the fill reads as a bar
 * and not as an empty track. With that head start, `0.04 + i / count` lands on
 * the reference's keyframes exactly for the four-stage list — 4%, 29%, 54%,
 * 79%, 100% — and stays sane for a caller that overrides `stages`.
 */
const BAR_HEAD_START = 0.04;

function cycleFill(step: number, count: number): number {
  return Math.min(BAR_HEAD_START + step / count, 1);
}

/**
 * Literals from the reference that no theme token carries. Kept here, named,
 * so a later token pass can find them in one place.
 */
const REFERENCE = {
  /** `radial-gradient(circle, #E4D8C4 1px, ...)` on the dotted ground. */
  dot: "#E4D8C4",
  trackOuter: "#E9E1D5",
  /** Exactly `colors.border`, spelled through the token. */
  trackMiddle: colors.border,
  trackInner: "#F2EBE1",
  /** The K disc's ground — a shade warmer than `colors.surface2`. */
  disc: "#F7EFE3",
  barTrack: "#EAE1D4",
} as const;

const RING_SIZE = 200;
const RINGS = [
  // radius, dash, gap, stroke opacity, ms per turn, direction
  { r: 90, dash: 142, gap: 424, opacity: 1, duration: 2600, clockwise: true },
  { r: 69, dash: 98, gap: 336, opacity: 0.6, duration: 2000, clockwise: false },
  { r: 48, dash: 62, gap: 240, opacity: 0.4, duration: 1400, clockwise: true },
] as const;

const TRACKS = [
  { r: 90, color: REFERENCE.trackOuter },
  { r: 69, color: REFERENCE.trackMiddle },
  { r: 48, color: REFERENCE.trackInner },
] as const;

/** `animation: barFill 12s linear` — the cycled bar sweeps, it does not step. */
const CYCLE_BAR_EASING: EasingFunction = Easing.linear;
/** The measured bar settles, because a real stage lands rather than sweeps. */
const STAGE_BAR_EASING: EasingFunction = Easing.out(Easing.cubic);

type Props = {
  /**
   * Index of the stage currently in flight. Clamped, so a caller that runs off
   * the end of the list shows the last stage rather than an empty headline.
   */
  stage?: number;
  /** Optional override, for a flow whose stages are not a story start. */
  stages?: readonly { id: string; label: string }[];
  /**
   * Hides the bar entirely. A caller with neither real stages nor a cycle has
   * nothing behind a bar at all, and should pass false.
   */
  showProgress?: boolean;
  /**
   * Cycle the headline on a timer instead of taking it from `stage`, at the
   * reference's `AUTO_CYCLE_MS`.
   *
   * For the one wait that is a single request: the model genuinely is doing all
   * four of these things, but it reports none of them, so there is no honest
   * stage to advance on.
   */
  autoCycle?: boolean;
  /**
   * Override the cycle interval, and switch cycling on. Prefer `autoCycle`:
   * the reference's 3s cadence is what product signed off, and a caller that
   * names its own number silently drifts from it.
   */
  autoCycleMs?: number;
};

export function CraftingLoader({
  stage = 0,
  stages = CRAFTING_STAGES,
  showProgress = true,
  autoCycle = false,
  autoCycleMs,
}: Props) {
  const reduceMotion = useReduceMotion();
  const [cycled, setCycled] = useState(0);

  const cycling = autoCycle || autoCycleMs !== undefined;
  const cycleMs = autoCycleMs ?? AUTO_CYCLE_MS;

  // Reduced motion is a request about animation, not about information. The
  // headline still advances; `Headline` drops the cross-fade instead. Gating
  // this on `reduceMotion` left the one honest signal on the screen reading
  // "Getting the context" for the entire wait, for exactly the users who have
  // no spinning ring to tell them anything is happening.
  useEffect(() => {
    if (!cycling) return;
    const timer = setInterval(
      () => setCycled((value) => (value + 1) % stages.length),
      cycleMs,
    );
    return () => clearInterval(timer);
  }, [cycleMs, cycling, stages.length]);

  const raw = cycling ? cycled : stage;
  const index = Math.min(Math.max(raw, 0), stages.length - 1);
  const current = stages[index];

  // A bar driven by a timer reports elapsed time through a known sequence of
  // named stages — not measured progress. That distinction is real and it has
  // not gone away: during auto-cycle the model is doing all four of these
  // things and reporting none of them, so the bar's position is an estimate
  // the screen cannot check. Showing it anyway is an explicit product
  // decision, taken against the approved reference, which puts the bar and
  // the cycling headline on one synchronised loop. The two are driven from
  // the same clock here so they can never disagree with each other.
  //
  // The `stage` path remains the honest mode and remains the default: when a
  // caller has real server stages, the bar reports positions something
  // actually measured. Prefer it wherever the work reports its own progress.
  const cycledBar = showProgress && cycling;
  const measuredBar = showProgress && !cycling;

  return (
    <View
      style={styles.root}
      // Without this the role and the value are dropped: a plain View is not
      // an accessibility element on either platform, so VoiceOver and
      // TalkBack walk past the progressbar and read the decorative rings
      // instead of the one thing on this screen that says what is happening.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Crafting your story"
      // The cycled bar is a timer, so it is still not announced as a position.
      // A screen reader that is told "2 of 4" is being told something was
      // measured; the stage name is the whole of what is actually known.
      accessibilityValue={cycling
        ? { text: current.label }
        : { min: 0, max: stages.length, now: index + 1, text: current.label }}
    >
      <DottedGround />
      <View style={styles.stage}>
        <Rings reduceMotion={reduceMotion} />
        <Headline label={current.label} reduceMotion={reduceMotion} />
        {cycledBar
          ? (
            <ProgressBar
              value={cycleFill(index + 1, stages.length)}
              from={cycleFill(index, stages.length)}
              duration={cycleMs}
              easing={CYCLE_BAR_EASING}
              reduceMotion={reduceMotion}
            />
          )
          : null}
        {measuredBar
          ? (
            <ProgressBar
              value={(index + 1) / stages.length}
              reduceMotion={reduceMotion}
            />
          )
          : null}
      </View>
    </View>
  );
}

/* ── The rings ─────────────────────────────────────────────────────────── */

function Rings({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <View style={styles.rings}>
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        style={StyleSheet.absoluteFill}
      >
        {TRACKS.map((track) => (
          <Circle
            key={track.r}
            cx={100}
            cy={100}
            r={track.r}
            stroke={track.color}
            strokeWidth={2}
            fill="none"
          />
        ))}
      </Svg>

      {RINGS.map((ring) => (
        <SpinningArc key={ring.r} ring={ring} reduceMotion={reduceMotion} />
      ))}

      <BreathingDisc reduceMotion={reduceMotion} />
    </View>
  );
}

function SpinningArc({
  ring,
  reduceMotion,
}: {
  ring: typeof RINGS[number];
  reduceMotion: boolean;
}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      rotation.value = 0;
      return;
    }
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(ring.clockwise ? 360 : -360, {
        duration: ring.duration,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [reduceMotion, ring.clockwise, ring.duration, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      >
        <Circle
          cx={100}
          cy={100}
          r={ring.r}
          stroke={colors.accent}
          strokeOpacity={ring.opacity}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={`${ring.dash} ${ring.gap}`}
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** `breathe 2.8s ease-in-out infinite`, so 1400ms each way, 1 → 1.03. */
function BreathingDisc({ reduceMotion }: { reduceMotion: boolean }) {
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      breath.value = 0;
      return;
    }
    breath.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [breath, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(breath.value, [0, 1], [1, 1.03]) }],
  }));

  return (
    <Animated.View style={[styles.disc, animatedStyle]}>
      <Text style={styles.discLetter} allowFontScaling={false}>K</Text>
    </Animated.View>
  );
}

/* ── Headline ──────────────────────────────────────────────────────────── */

/**
 * Cross-fades on a real stage change, and announces it.
 *
 * The announcement is the reason this is not just an opacity trick: a person
 * using a screen reader gets no value from a spinning ring, and the stage name
 * is the only thing on this screen that tells them the wait is progressing.
 */
function Headline({
  label,
  reduceMotion,
}: {
  label: string;
  reduceMotion: boolean;
}) {
  const opacity = useSharedValue(1);
  const rise = useSharedValue(0);
  const previous = useRef(label);

  useEffect(() => {
    if (previous.current === label) return;
    previous.current = label;
    AccessibilityInfo.announceForAccessibility?.(label);
    if (reduceMotion) return;
    opacity.value = 0;
    rise.value = 5;
    opacity.value = withTiming(1, { duration: motion.base });
    rise.value = withTiming(0, { duration: motion.base });
  }, [label, opacity, reduceMotion, rise]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }],
  }));

  return (
    <Animated.View style={[styles.headline, animatedStyle]}>
      <Text style={styles.headlineText} accessibilityLiveRegion="polite">
        {label}
      </Text>
    </Animated.View>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────── */

function ProgressBar({
  value,
  from,
  duration = motion.slow,
  easing = STAGE_BAR_EASING,
  reduceMotion,
}: {
  value: number;
  /**
   * Snap here before sweeping. Only the cycle passes it, and only its wrap
   * from the last stage back to the first actually moves: every other step
   * starts exactly where the previous sweep ended.
   */
  from?: number;
  duration?: number;
  easing?: EasingFunction;
  reduceMotion: boolean;
}) {
  const width = useSharedValue(from ?? value);

  useEffect(() => {
    // Reduced motion drops the sweep, not the reading: the bar still shows
    // where this stage leaves it.
    if (reduceMotion) {
      width.value = value;
      return;
    }
    if (from !== undefined) width.value = from;
    width.value = withTiming(value, { duration, easing });
    return () => cancelAnimation(width);
  }, [duration, easing, from, reduceMotion, value, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${Math.round(width.value * 100)}%`,
  }));

  return (
    <View
      style={styles.barTrack}
      testID="crafting-progress"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[styles.barFill, animatedStyle]}
        testID="crafting-progress-fill"
      />
    </View>
  );
}

/* ── Ground ────────────────────────────────────────────────────────────── */

/**
 * One tiled SVG pattern rather than a grid of views. A 32pt grid across a tall
 * phone is several hundred nodes if each dot is its own element, on a screen
 * whose whole job is to stay smooth.
 */
function DottedGround() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern
          id="katha-dots"
          width={32}
          height={32}
          patternUnits="userSpaceOnUse"
        >
          <PatternDot
            cx={1.5}
            cy={1.5}
            r={1}
            fill={REFERENCE.dot}
            fillOpacity={0.5}
          />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#katha-dots)" />
    </Svg>
  );
}

/* ── Reduced motion ────────────────────────────────────────────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      active = false;
      listener?.remove();
    };
  }, []);
  return reduceMotion;
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // The reference's `padding: 0 40px`; no spacing token carries 40.
    paddingHorizontal: 40,
  },
  rings: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: REFERENCE.disc,
    alignItems: "center",
    justifyContent: "center",
  },
  discLetter: {
    // The static 800 instance, not the variable family plus a `fontWeight`.
    // The latter cannot work: RN has no weight-axis control, so it rendered at
    // 400. The axis tops out at 800, so 900 was never reachable either.
    fontFamily: fonts.brandHeavy,
    fontSize: 41,
    lineHeight: 41, // `line-height: 1`
    color: colors.accent,
  },
  headline: {
    marginTop: 34,
    height: 34,
    justifyContent: "center",
  },
  headlineText: {
    fontFamily: fonts.display,
    fontWeight: "700",
    fontSize: 21,
    color: colors.ink,
    textAlign: "center",
  },
  barTrack: {
    marginTop: spacing.xl,
    width: RING_SIZE,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: REFERENCE.barTrack,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});

export default CraftingLoader;
