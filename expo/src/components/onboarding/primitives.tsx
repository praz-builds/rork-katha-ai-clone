import { createContext, useContext, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import {
  colors,
  controls,
  fonts,
  IconBack,
  motion,
  onboardingType,
  radius,
  shadows,
  spacing,
} from "@/theme";

/**
 * The chrome every onboarding-shaped screen shares: a top bar (back control
 * plus the six-bar progress row), a scrolling step frame with an optional
 * headline, and the primary CTA. `CharacterOnboarding` and `EmailCodeAuth`
 * both draw screens built from exactly these pieces, so the pieces live here
 * once rather than being copied twice and drifting.
 */

/**
 * Whether this person has asked the OS for less movement.
 *
 * Read once, into context, at the top of a flow rather than per animated
 * element: the setting does not change mid-flow, and a screen with a dozen
 * `Enter`s would otherwise mount a listener per element and spend its first
 * frames in the wrong state while the promise settled.
 *
 * `false` until the promise answers, and `AccessibilityInfo` always answers
 * asynchronously. So every entrance has to be correct when it starts
 * animating and is THEN told to stop: the reduced-motion branch sets the
 * final value rather than cancelling, and the effect reruns on the flip.
 */
export const ReduceMotionContext = createContext(false);

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return reduceMotion;
}

/** How far a heading travels as it settles. The screen map's 8pt. */
export const HEADER_RISE = 8;

/**
 * One element arriving: a fade, plus an optional rise.
 *
 * UNDER REDUCED MOTION IT RENDERS THE FINAL STATE AND SCHEDULES NOTHING. Not a
 * shorter duration, not an instant `withTiming`: the hooks still run, so the
 * component's shape is identical, but `progress` starts and stays at 1. An
 * element that animates "quickly" for somebody who asked for no animation is
 * still animation.
 */
export function Enter({
  children,
  delay = 0,
  duration = motion.base,
  rise = HEADER_RISE,
  fromScale = 1,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  rise?: number;
  fromScale?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useContext(ReduceMotionContext);
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      // Decelerating, not linear: an element that arrives at a constant speed
      // and stops dead reads as a slide, not as something settling.
      withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, duration, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: rise * (1 - progress.value) },
      { scale: fromScale + (1 - fromScale) * progress.value },
    ],
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
  );
}

/**
 * Where the user is, as short rounded bars rather than circles.
 *
 * Bars because a row of circles at this size reads as a carousel pager, which
 * is a control; these are not tappable and must not invite a tap. The row
 * carries the announcement and the bars are hidden from assistive technology:
 * six "dot" nodes in a swipe order is noise, and the only useful fact is which
 * of how many.
 */
function ProgressBars({ steps, current }: { steps: number; current: number }) {
  return (
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${steps}`}
      accessibilityValue={{ min: 1, max: steps, now: current }}
    >
      {Array.from({ length: steps }, (_, index) => (
        <View
          key={index}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.progressBar,
            // Three states, not two. A row where "done" and "not yet" share one
            // colour says how many steps there are and nothing about how far
            // through them somebody is, which is the only thing a progress row
            // is for.
            index + 1 < current && styles.progressBarDone,
            index + 1 === current && styles.progressBarActive,
          ]}
        />
      ))}
    </View>
  );
}

export function OnboardingTopBar({
  onBack,
  steps,
  currentStep,
}: {
  onBack?: () => void;
  steps?: number;
  currentStep?: number;
}) {
  const showProgress = Boolean(steps && currentStep);
  return (
    <View style={styles.fixedTopBar}>
      {onBack
        ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.backTile}
          >
            <IconBack size={20} color={colors.strong} />
          </Pressable>
        )
        : <View style={styles.iconButton} />}
      {showProgress
        ? <ProgressBars steps={steps!} current={currentStep!} />
        : null}
      <View style={styles.iconButton} />
    </View>
  );
}

/**
 * How a screen's art, title and sub arrive, when they arrive at all.
 *
 * Absent means they are simply there: a form screen does not animate its own
 * heading, because a person walking back to fix a field does not want the
 * screen to introduce itself again.
 */
export type HeaderEnter = { rise?: number; subDelay?: number };

export function StepScroll({
  children,
  art,
  title,
  sub,
  onBack,
  steps,
  currentStep,
  enter,
}: {
  children: React.ReactNode;
  /** Anything that belongs above the headline rather than below it. */
  art?: React.ReactNode;
  title?: string;
  sub?: string;
  onBack?: () => void;
  steps?: number;
  currentStep?: number;
  enter?: HeaderEnter;
}) {
  const showProgress = Boolean(steps && currentStep);
  return (
    <View style={styles.stepFrame}>
      <OnboardingTopBar
        onBack={onBack}
        steps={showProgress ? steps : undefined}
        currentStep={showProgress ? currentStep : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {art
          ? (enter
            ? <Enter duration={motion.base} rise={0}>{art}</Enter>
            : art)
          : null}
        {/* One group, not two siblings: the sub is the second line of the
            heading, and as a sibling of the scroll container it sat as far
            from the title as it did from the first control.

            The two lines animate separately INSIDE the group rather than as
            one block, so the sub follows the title by its stagger while the
            spacing between them stays the group's. */}
        {title || sub
          ? (
            <View style={styles.headerGroup}>
              {title
                ? (
                  <Enter
                    rise={enter?.rise ?? HEADER_RISE}
                    duration={enter ? motion.base : 0}
                  >
                    <Text style={styles.title} accessibilityRole="header">
                      {title}
                    </Text>
                  </Enter>
                )
                : null}
              {sub
                ? (
                  <Enter
                    delay={enter?.subDelay ?? 0}
                    rise={enter?.rise ?? HEADER_RISE}
                    duration={enter ? motion.base : 0}
                  >
                    <Text style={styles.sub}>{sub}</Text>
                  </Enter>
                )
                : null}
            </View>
          )
          : null}
        {children}
      </ScrollView>
    </View>
  );
}

export function Primary({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      style={({ pressed }) => [
        styles.primary,
        pressed && styles.primaryPressed,
        (disabled || busy) && styles.primaryDisabled,
      ]}
    >
      {busy
        ? <ActivityIndicator color={colors.surface} />
        : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepFrame: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.xxxl,
    // Room under the last control for a fixed CTA and a home indicator.
    paddingBottom: spacing.huge + spacing.xxxl,
    gap: spacing.betweenGroups,
  },
  fixedTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xxxl,
    height: spacing.huge,
    marginBottom: spacing.md,
  },
  /**
   * 44 x 44 on a cream plate, radius 14. The plate is what makes the control
   * findable on an illustration-heavy screen: a bare chevron over the W3
   * portrait stage or the W6 glow has no edge of its own and reads as
   * decoration.
   */
  backTile: {
    width: controls.onboardingPlate,
    height: controls.onboardingPlate,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: controls.onboardingPlateRadius,
    backgroundColor: colors.onboardingPlate,
  },
  iconButton: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: controls.onboardingPillGap,
  },
  /**
   * 22 x 5, radius 3, from the 2026-09-11 character hand-off. The width is
   * constant across the three states: a current bar that is wider than its
   * neighbours moves every bar after it by four points on each step, and a row
   * that reflows as you walk it reads as a layout bug rather than as progress.
   */
  progressBar: {
    width: controls.onboardingPillWidth,
    height: controls.onboardingPillHeight,
    // The row can hold eight now (the reader's count), and eight at 22pt
    // with their gaps is 211pt against the 200pt a 360pt phone leaves
    // between the two 48pt icon slots. Shrinkable, so the bars scale down
    // together rather than spilling right of centre; on a 390 they never
    // shrink at all.
    flexShrink: 1,
    minWidth: 0,
    // 3, the hand-off value: a 5pt bar fully rounded reads as a dash, and
    // squared off it reads as a tick. No token sits at 3.
    borderRadius: 3,
    backgroundColor: colors.onboardingBorder,
  },
  progressBarDone: { backgroundColor: colors.onboardingBorderStrong },
  progressBarActive: { backgroundColor: colors.accent },
  headerGroup: { gap: spacing.related },
  title: { ...onboardingType.title, color: colors.ink },
  sub: { ...onboardingType.helper, color: colors.muted },
  // The hand-off CTA (W3 to W7): a 56pt pill, not the app's 64pt primary. Every
  // screen in this flow draws it, the code screen included, so the recipe
  // lives here rather than in each step.
  primary: {
    marginTop: spacing.md,
    height: controls.onboardingCtaHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.onboardingCta,
  },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryDisabled: { opacity: 0.4 },
  // 17/700 in the UI face: the hand-off's CTA label, not the app's `headline`
  // (18/600). Every onboarding screen inherits this, so the weight lives here.
  primaryText: {
    fontFamily: fonts.ui,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    color: colors.surface,
  },
});
