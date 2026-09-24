import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { DottedGround } from "@/components/brand/DottedGround";
import { KathaMark } from "@/components/brand/KathaMark";
import { colors, motion, type } from "@/theme";

/**
 * The wait while a story is actually being written.
 *
 * The composition is the mark on the dotted ground with the stage name under
 * it, and nothing else. The rings, the disc behind the K and the progress bar
 * were all retired by product decision: three of the four things on the screen
 * were describing the same fact — that something is happening — and the bar
 * was claiming more than that, since during a cycle nothing on this screen has
 * measured anything.
 *
 * The screen may finish in 400ms or take thirty seconds. `stage` advances when
 * a stage genuinely completes; the mark below redraws while work is in
 * flight, and deliberately says nothing about how much of it is left.
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
 * finite and, when the shape request was warmed while the writer typed, can
 * be over almost at once. At 3000ms a stage only the first two of the four
 * ever appeared before the blueprint replaced them. (There is no longer a
 * `CRAFTING_MIN_MS` floor holding the screen open; it went when the warming
 * did, so the cadence is the only thing making these stages readable.) A user
 * who never sees "shaping the conflict" or "building the story arc" is told
 * less about what Katha did, not more.
 *
 * So the cadence is derived from the wait rather than inherited from the
 * showcase: one full pass through the stages fits inside 5000ms. Four stages,
 * 1250ms each. Fast enough to read, slow enough that the words register rather
 * than flicker.
 *
 * **One pass, then it holds.** The cycle used to be modulo, and at the waits
 * this screen actually sees — `shape-story` measured at 8-11s in onboarding —
 * that meant the writer read "Getting the context" for the second time. The
 * list is a claim about what is being done in order; starting it again is the
 * screen withdrawing that claim. It now stops on the last stage, and the
 * redrawing mark carries the fact that something is still happening.
 */
export const AUTO_CYCLE_MS = 1250;

/** The mark at the size it holds a screen on its own. */
const MARK_SIZE = 72;

/**
 * The beat between draws. Long enough that the repeat reads as a pulse rather
 * than a spinner restarting.
 */
const LOOP_DELAY_MS = 600;

type Props = {
  /**
   * Index of the stage currently in flight. Clamped, so a caller that runs off
   * the end of the list shows the last stage rather than an empty headline.
   */
  stage?: number;
  /** Optional override, for a flow whose stages are not a story start. */
  stages?: readonly { id: string; label: string }[];
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
   * the reference's cadence is what product signed off, and a caller that
   * names its own number silently drifts from it.
   */
  autoCycleMs?: number;
};

export function CraftingLoader({
  stage = 0,
  stages = CRAFTING_STAGES,
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
  // no motion at all to tell them anything is happening.
  useEffect(() => {
    if (!cycling) return;
    const timer = setInterval(
      () => setCycled((value) => Math.min(value + 1, stages.length - 1)),
      cycleMs,
    );
    return () => clearInterval(timer);
  }, [cycleMs, cycling, stages.length]);

  const raw = cycling ? cycled : stage;
  const index = Math.min(Math.max(raw, 0), stages.length - 1);
  const current = stages[index];

  return (
    <View
      style={styles.root}
      // Without this the role and the value are dropped: a plain View is not
      // an accessibility element on either platform, so VoiceOver and
      // TalkBack walk past the progressbar and read the decorative ground
      // instead of the one thing on this screen that says what is happening.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Crafting your story"
      // A cycled headline is a timer, so it is not announced as a position. A
      // screen reader that is told "2 of 4" is being told something was
      // measured; the stage name is the whole of what is actually known. The
      // `stage` path is the honest mode and stays the default: there the
      // position reports something the server measured.
      accessibilityValue={cycling
        ? { text: current.label }
        : { min: 0, max: stages.length, now: index + 1, text: current.label }}
    >
      <DottedGround />
      <View style={styles.stage}>
        <LoopingMark />
        <Headline label={current.label} reduceMotion={reduceMotion} />
      </View>
    </View>
  );
}

/* ── The mark ──────────────────────────────────────────────────────────── */

/**
 * The K draws itself on, over and over, for as long as the work runs.
 *
 * The repeating draw is this screen's progress signal — it is what the three
 * spinning rings used to be. It is a better one than they were: the rings
 * turned at a fixed rate whatever was happening behind them, whereas this runs
 * exactly as long as the generation runs and stops when it stops.
 *
 * `loopDelay` is the beat between passes. It is deliberately unhurried: a mark
 * that restarts the instant it lands reads as a spinner, and this screen can be
 * up for thirty seconds.
 */
function LoopingMark() {
  return (
    <KathaMark
      size={MARK_SIZE}
      color={colors.accent}
      loop
      loopDelay={LOOP_DELAY_MS}
    />
  );
}

/* ── Headline ──────────────────────────────────────────────────────────── */

/**
 * Cross-fades on a real stage change, and announces it.
 *
 * The announcement is the reason this is not just an opacity trick: a person
 * using a screen reader gets no value from a breathing mark, and the stage name
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
  headline: {
    marginTop: 34,
    height: 34,
    justifyContent: "center",
  },
  headlineText: {
    // The create heading face (`type.createTitle`, Hanken bold) at the 22
    // this fixed-height slot was drawn for; 26 would outgrow the 34pt row.
    ...type.createTitle,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
    textAlign: "center",
  },
});

export default CraftingLoader;
