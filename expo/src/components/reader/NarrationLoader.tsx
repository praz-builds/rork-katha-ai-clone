import { useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Rect } from "react-native-svg";
import { colors, motion, radius, spacing, type } from "@/theme";

/**
 * The wait while a chapter's narration is being prepared.
 *
 * This is the first state of the full-screen player: the cover sits above it,
 * this sits below it, and the line under the art says what the pipeline is
 * doing right now. It is deliberately NOT `CraftingLoader` — that screen is
 * about a story being written, and its brand mark says "Katha is thinking".
 * A reader who pressed Listen is waiting on something else entirely: a voice.
 * The art here has to say *sound*, not *authorship*.
 *
 * ## The seam
 *
 * Two props carry everything the player needs:
 *
 * - `stage` — the real pipeline stage, as an id. Drives the message, the
 *   accessibility position, and the reduced-motion progress fill.
 * - `message` — an explicit override, when the player has something truer to
 *   say than the stage's default line.
 *
 * `variant` picks the art. It exists so the three can be compared side by side
 * (`localhost:8090/?preview=narration-loader`) and so one can be chosen
 * without touching the player. Once product picks one, the player can simply
 * stop passing it and the default takes over.
 *
 * ## What never happens here
 *
 * No countdown, no percentage, no "about 15 seconds". Narration goes to a
 * third-party endpoint whose queue depth the app cannot see; `audio-status`
 * answers `PENDING` or `COMPLETED` and nothing in between. A screen that
 * promises a number it cannot know is lying on the one occasion the user is
 * watching it most closely.
 */

/* ── Stages ────────────────────────────────────────────────────────────── */

/**
 * The real stages a narration request passes through, in order.
 *
 * Each maps to something the backend genuinely does, so the player can drive
 * this from status rather than from a stopwatch:
 *
 * | id           | what is actually happening                                        |
 * |--------------|-------------------------------------------------------------------|
 * | `voice`      | resolving the voice and looking for a cached reading (`generate-audio` hits `findReadyChapterAudio` before anything else) |
 * | `requesting` | the (chapter, voice) row is claimed and a RunPod job is started    |
 * | `generating` | `audio-status` is answering `PENDING` — the model is speaking      |
 * | `finishing`  | audio bytes are back and are being stored for instant replay       |
 *
 * The wording is plain, warm and honest. No exclamation marks, no duration.
 */
export const NARRATION_STAGES = [
  { id: "voice", message: "Checking which voice reads this one" },
  { id: "requesting", message: "Asking for a reading of this chapter" },
  { id: "generating", message: "The voice is reading it now" },
  { id: "finishing", message: "Almost ready, saving it so it replays instantly" },
] as const;

export type NarrationStageId = (typeof NARRATION_STAGES)[number]["id"];

/** Position of a stage in the pipeline, clamped. Unknown ids fall back to 0. */
export function narrationStageIndex(stage: NarrationStageId | number): number {
  const raw = typeof stage === "number"
    ? stage
    : NARRATION_STAGES.findIndex((s) => s.id === stage);
  if (raw < 0) return 0;
  return Math.min(raw, NARRATION_STAGES.length - 1);
}

/** The line for a stage. The player may override it with `message`. */
export function narrationMessageFor(stage: NarrationStageId | number): string {
  return NARRATION_STAGES[narrationStageIndex(stage)].message;
}

/* ── Variants ──────────────────────────────────────────────────────────── */

/**
 * - `waveform` — a voice, warming up. Seven bars breathing around a centre.
 * - `halo` — headphones with sound leaving them, ring after ring.
 * - `passage` — this chapter's lines, with a reading light travelling across.
 */
export const NARRATION_LOADER_VARIANTS = [
  "waveform",
  "halo",
  "passage",
] as const;

export type NarrationLoaderVariant =
  (typeof NARRATION_LOADER_VARIANTS)[number];

export const NARRATION_LOADER_VARIANT_LABELS: Record<
  NarrationLoaderVariant,
  string
> = {
  waveform: "Waveform, a voice warming up",
  halo: "Halo, sound leaving the headphones",
  passage: "Passage, a reading light crossing the lines",
};

/* ── Motion constants ──────────────────────────────────────────────────── */

/** The skill's strong ease-out; Reanimated's built-ins are too weak. */
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/** One bar's rise-and-fall. Slow enough to read as breath, not as a spinner. */
const BAR_MS = 620;
/** One ring's whole life, from the earcups to the edge of the halo. */
const RING_MS = 2000;
/** One pass of the reading light across the lines. */
const SWEEP_MS = 2200;

/**
 * The reduced-motion breath.
 *
 * Reduced motion means fewer and gentler, not frozen. Every variant drops its
 * translation and scale and keeps one slow opacity change, because a wait
 * screen that is completely still is indistinguishable from a wait screen that
 * has crashed — which is the worst thing this component could say.
 *
 * `ReduceMotion.Never` is deliberate and is the whole point: Reanimated's
 * default (`ReduceMotion.System`) would snap this animation to its final value
 * for exactly the users it exists for.
 */
const BREATH_MS = 1600;
const BREATH_MIN = 0.55;

/* ── Component ─────────────────────────────────────────────────────────── */

export type NarrationLoaderProps = {
  /** Which art to draw. Default `halo`, chosen by the product owner. */
  variant?: NarrationLoaderVariant;
  /**
   * The stage the pipeline is actually in. Drives the default message, the
   * reduced-motion progress fill, and the announced position.
   */
  stage?: NarrationStageId | number;
  /** Overrides the stage's line, when the player knows something truer. */
  message?: string;
  /**
   * An optional second line. It must never promise a duration — the app cannot
   * see the provider's queue, so a number here would be invented.
   */
  hint?: string;
  /** Art box edge, in points. Default 132. */
  size?: number;
  testID?: string;
};

export function NarrationLoader({
  variant = "halo",
  stage = "voice",
  message,
  hint,
  size = 132,
  testID = "narration-loader",
}: NarrationLoaderProps) {
  const reduced = useReducedMotion();
  const index = narrationStageIndex(stage);
  const line = message ?? NARRATION_STAGES[index].message;
  // 1-based, so the first stage already lights something. A wait that starts
  // with nothing lit reads as "nothing has happened yet".
  const progress = (index + 1) / NARRATION_STAGES.length;

  const art = { reduced, progress, size };

  return (
    <View
      style={styles.root}
      testID={testID}
      // A bare View is not an accessibility element on either platform, so
      // without this VoiceOver and TalkBack walk straight past the only thing
      // on screen that says what is happening.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Preparing narration"
      accessibilityValue={{
        min: 0,
        max: NARRATION_STAGES.length,
        now: index + 1,
        text: line,
      }}
    >
      <View style={[styles.art, { width: size, height: size }]}>
        {variant === "waveform" ? <WaveformArt {...art} /> : null}
        {variant === "halo" ? <HaloArt {...art} /> : null}
        {variant === "passage" ? <PassageArt {...art} /> : null}
      </View>
      <Message line={line} reduced={reduced} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/* ── Shared: the reduced-motion breath ─────────────────────────────────── */

function useBreath(reduced: boolean) {
  const breath = useSharedValue(1);

  useEffect(() => {
    if (!reduced) {
      breath.set(1);
      return;
    }
    breath.set(
      withRepeat(
        withTiming(BREATH_MIN, {
          duration: BREATH_MS,
          easing: EASE_IN_OUT,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(breath);
  }, [breath, reduced]);

  return useAnimatedStyle(() => ({ opacity: breath.get() }));
}

type ArtProps = { reduced: boolean; progress: number; size: number };

/* ── Variant 1: waveform ───────────────────────────────────────────────── */

/**
 * Seven bars breathing around a centre — a voice, warming up.
 *
 * The tallest bars are in the middle and the profile falls away symmetrically,
 * which is what a level meter on a spoken voice actually looks like. It says
 * "someone is about to speak" without borrowing a single music cliché.
 */
const BAR_COUNT = 7;
/** Resting and peak heights as a fraction of the art box. Centre-weighted. */
const BAR_PROFILE = [
  { rest: 0.16, peak: 0.34 },
  { rest: 0.26, peak: 0.52 },
  { rest: 0.4, peak: 0.74 },
  { rest: 0.5, peak: 0.92 },
  { rest: 0.4, peak: 0.7 },
  { rest: 0.26, peak: 0.48 },
  { rest: 0.16, peak: 0.3 },
];

function WaveformArt({ reduced, progress, size }: ArtProps) {
  const breathStyle = useBreath(reduced);
  const lit = Math.round(progress * BAR_COUNT);

  return (
    <Animated.View style={[styles.waveRow, breathStyle]}>
      {BAR_PROFILE.map((p, i) => (
        <WaveBar
          key={i}
          rest={p.rest * size}
          peak={p.peak * size}
          // Staggered so the row reads as a travelling breath rather than
          // seven bars agreeing with each other.
          delay={i * 90}
          reduced={reduced}
          // Under reduced motion the row stops moving, so the fill has to
          // carry the progress instead: one more bar takes the accent every
          // time a real stage completes.
          lit={!reduced || i < lit}
        />
      ))}
    </Animated.View>
  );
}

function WaveBar({
  rest,
  peak,
  delay,
  reduced,
  lit,
}: {
  rest: number;
  peak: number;
  delay: number;
  reduced: boolean;
  lit: boolean;
}) {
  const height = useSharedValue(rest);

  useEffect(() => {
    if (reduced) {
      height.set(rest);
      return;
    }
    height.set(
      withDelay(
        delay,
        withRepeat(
          withTiming(peak, { duration: BAR_MS, easing: EASE_IN_OUT }),
          -1,
          true,
        ),
      ),
    );
    return () => cancelAnimation(height);
  }, [delay, height, peak, reduced, rest]);

  // `height` rather than `scaleY` on purpose. This bar is absolutely
  // positioned and childless — the one case the animation rules exempt —
  // and scaling would smear its rounded cap into an ellipse.
  const animated = useAnimatedStyle(() => ({ height: height.get() }));

  return (
    <View style={styles.barSlot}>
      <Animated.View
        style={[styles.bar, lit ? styles.barLit : styles.barDim, animated]}
      />
    </View>
  );
}

/* ── Variant 2: halo ───────────────────────────────────────────────────── */

/**
 * Headphones with sound leaving them, ring after ring.
 *
 * The closest of the three to the reference, and the most literal: the object
 * in the middle is the thing the reader is about to put on, and the rings are
 * the sound arriving. Rings expand and fade rather than spin — a spin would be
 * a loading indicator wearing a costume.
 */
const RING_COUNT = 3;

function HaloArt({ reduced, progress, size }: ArtProps) {
  const breathStyle = useBreath(reduced);
  const lit = Math.round(progress * RING_COUNT);
  const glyph = size * 0.42;

  return (
    <Animated.View style={[styles.center, breathStyle]}>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <Ring
          key={i}
          size={size}
          delay={i * (RING_MS / RING_COUNT)}
          reduced={reduced}
          // Static radii under reduced motion, so the three rings read as a
          // stack rather than as one ring that stopped.
          restScale={0.58 + i * 0.21}
          lit={!reduced || i < lit}
        />
      ))}
      <Headphones size={glyph} />
    </Animated.View>
  );
}

function Ring({
  size,
  delay,
  reduced,
  restScale,
  lit,
}: {
  size: number;
  delay: number;
  reduced: boolean;
  restScale: number;
  lit: boolean;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      t.set(0);
      return;
    }
    t.set(
      withDelay(
        delay,
        withRepeat(
          withTiming(1, { duration: RING_MS, easing: Easing.linear }),
          -1,
          false,
        ),
      ),
    );
    return () => cancelAnimation(t);
  }, [delay, reduced, t]);

  const animated = useAnimatedStyle(() => {
    const p = t.get();
    return {
      // Leaves the earcups rather than appearing at an arbitrary radius, and
      // fades in over the first tenth so a ring never pops into existence.
      transform: [{ scale: 0.36 + p * 0.64 }],
      opacity: 0.6 * Math.min(p / 0.1, 1) * (1 - p),
    };
  });

  const still = { transform: [{ scale: restScale }], opacity: lit ? 0.5 : 0.2 };

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        reduced ? still : animated,
      ]}
    />
  );
}

/** Headband over two earcups. Drawn, not an asset, so it scales anywhere. */
function Headphones({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M10 30 V25 a14 14 0 0 1 28 0 V30"
        stroke={colors.strong}
        strokeWidth={3.2}
        strokeLinecap="round"
        fill="none"
      />
      <Rect
        x={5.5}
        y={27}
        width={9}
        height={14}
        rx={4.5}
        fill={colors.accent}
      />
      <Rect
        x={33.5}
        y={27}
        width={9}
        height={14}
        rx={4.5}
        fill={colors.accent}
      />
    </Svg>
  );
}

/* ── Variant 3: passage ────────────────────────────────────────────────── */

/**
 * The chapter's own lines, with a reading light travelling across them.
 *
 * The most product-specific of the three: it draws the thing being narrated,
 * not the machinery narrating it, and the light moving left to right is the
 * one gesture everybody already reads as "being read".
 */
const LINE_WIDTHS = [1, 0.84, 0.62, 0.92, 0.5];
const SWEEP_WIDTH = 64;

/**
 * The accent at an alpha, derived from the token rather than restating its hex.
 *
 * A gradient needs `rgba()` and the theme carries `#RRGGBB`, which is exactly
 * how a second, stale copy of the brand orange gets into a file.
 */
const accentAlpha = (alpha: number) => {
  const hex = colors.accent.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function PassageArt({ reduced, progress, size }: ArtProps) {
  const breathStyle = useBreath(reduced);
  const lit = Math.round(progress * LINE_WIDTHS.length);
  const x = useSharedValue(-SWEEP_WIDTH);

  useEffect(() => {
    if (reduced) {
      x.set(-SWEEP_WIDTH);
      return;
    }
    x.set(
      withRepeat(
        withTiming(size, { duration: SWEEP_MS, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(x);
  }, [reduced, size, x]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
  }));

  return (
    <Animated.View style={[styles.center, breathStyle]}>
      {/* The light is clipped to the block of lines, not to the art box: a
          beam that overshoots the text reads as a glow behind the screen
          rather than as something passing over the words. */}
      <View style={[styles.passage, { width: size }]}>
        {LINE_WIDTHS.map((w, i) => (
          <View
            key={i}
            style={[
              styles.line,
              { width: size * w },
              // Reduced motion loses the light, so the lines themselves take
              // the accent one at a time as real stages complete.
              reduced && i < lit ? styles.lineLit : null,
            ]}
          />
        ))}
        {reduced ? null : (
          <Animated.View pointerEvents="none" style={[styles.sweep, sweep]}>
            <LinearGradient
              colors={[accentAlpha(0), accentAlpha(0.55), accentAlpha(0)]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

/* ── The line under the art ────────────────────────────────────────────── */

/**
 * Cross-fades on a real stage change, and announces it.
 *
 * The announcement is why this is more than an opacity trick: a reader using a
 * screen reader gets nothing from a breathing waveform, and this sentence is
 * the only thing here that tells them the wait is moving.
 */
function Message({ line, reduced }: { line: string; reduced: boolean }) {
  const opacity = useSharedValue(1);
  const rise = useSharedValue(0);
  const previous = useRef(line);

  useEffect(() => {
    if (previous.current === line) return;
    previous.current = line;
    AccessibilityInfo.announceForAccessibility?.(line);
    // The fade survives reduced motion — an opacity change explaining a state
    // change is exactly what the guidance keeps. Only the rise is dropped.
    opacity.set(0);
    opacity.set(
      withTiming(1, { duration: motion.base, reduceMotion: ReduceMotion.Never }),
    );
    if (reduced) return;
    rise.set(5);
    rise.set(withTiming(0, { duration: motion.base }));
  }, [line, opacity, reduced, rise]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: rise.get() }],
  }));

  return (
    <Animated.View style={[styles.messageBox, animated]}>
      <Text style={styles.message} accessibilityLiveRegion="polite">
        {line}
      </Text>
    </Animated.View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  art: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  waveRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: spacing.sm,
  },
  barSlot: {
    width: 8,
    height: "100%",
    justifyContent: "flex-end",
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
  },
  barLit: { backgroundColor: colors.accent },
  barDim: { backgroundColor: colors.borderStrong },

  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: colors.accent,
  },

  passage: {
    justifyContent: "center",
    gap: spacing.md,
    overflow: "hidden",
    paddingVertical: spacing.xs,
  },
  line: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  lineLit: { backgroundColor: colors.accent },
  sweep: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: SWEEP_WIDTH,
  },

  messageBox: {
    // Close to the art on purpose: the line names what the picture is doing,
    // so a wide gap reads as two unrelated things stacked up.
    marginTop: spacing.md,
    minHeight: 22,
    justifyContent: "center",
  },
  message: {
    ...type.body,
    color: colors.muted,
    textAlign: "center",
  },
  hint: {
    ...type.caption,
    color: colors.tertiary,
    textAlign: "center",
    marginTop: spacing.related,
  },
});

export default NarrationLoader;
