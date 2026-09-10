import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { colors, controls, motion, radius, shadows } from "@/theme";

/**
 * The one switch in the app.
 *
 * WHY THIS EXISTS. Every toggle on the create brief was React Native's
 * `Switch` with a spread of colour props. That control paints its own thumb
 * and its own off-state fill from the PLATFORM palette, so a prop the caller
 * forgets is not a missing colour, it is iOS green: the Kids Mode row shipped
 * an orange track with a GREEN thumb, reported off a screenshot as "I don't
 * know why we have green in the app". Green is in no token file here and
 * never was. A component that can only be correct when four props are passed
 * correctly at four call sites will be wrong at one of them; this one draws
 * every pixel itself, from `@/theme`, and has no platform fallback to fall
 * back to.
 *
 * THE LOOK is the onboarding selection treatment (`KathaOnboardingFlowV2`'s
 * option rows and genre chips): accent when on, warm neutral when off, white
 * knob. Onboarding carries a private `C` palette of raw hex; those values are
 * NOT copied here. `C.orange` is `colors.accent` to the digit, and the rest
 * resolve to the neutral ramp, so the look is ported through tokens and the
 * next palette change reaches this control for free.
 *
 * DISABLED READS AS DISABLED, NOT AS OFF. "Make it public" is disabled for a
 * signed-out writer, and a disabled control drawn in the off colours tells
 * them the story is private BY THEIR CHOICE, which is a lie they cannot act
 * on. So a disabled toggle keeps its position and keeps a tint of its state -
 * `accentSoft` when on, `border` when off - and drops the thumb's shadow, so
 * it reads as flat and inert rather than as switched off.
 */

/** Track travel: how far the thumb slides between off and on. */
const TRAVEL =
  controls.toggleTrackWidth - controls.toggleThumb - controls.toggleInset * 2;

export type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** The accessible name. Required: a switch with no name is unusable by voice. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ToggleProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    const target = value ? 1 : 0;
    // Reduced motion still changes state, it just arrives rather than travels.
    progress.value = reducedMotion
      ? target
      : withTiming(target, { duration: motion.fast });
  }, [value, reducedMotion, progress]);

  // The "on" fill is a second track cross-faded over the first rather than an
  // interpolated colour: one shared value drives both the fade and the slide,
  // and no colour maths runs on the UI thread.
  const fillStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      testID={testID}
      // The control is 52 x 32; the target it answers to is 44 x 44, per the
      // platform minimum. The extra height is hit area, not layout: the row
      // it sits in is already at least this tall.
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.pressable, style]}
    >
      <View style={[styles.track, disabled && styles.trackDisabled]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, disabled && styles.fillDisabled, fillStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, disabled && styles.thumbDisabled, thumbStyle]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    minWidth: controls.toggleHitTarget,
    minHeight: controls.toggleHitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  /*
    OFF HAS TO LOOK OFF.

    The off track was `borderStrong` (#D7D5D0) carrying a white thumb, on a
    #F3F2EF page. Three near-identical warm neutrals stacked on each other:
    the owner read the Kids Mode row as switched ON when it was off, and they
    were right to -- the only cue distinguishing the two states was which end
    a white circle sat at, against a track barely darker than the page.

    So the off state is now recessed rather than merely pale: a darker track
    with an inset edge, and a thumb that carries a border so its position
    reads at a glance. The on state is unchanged -- accent fill, and now
    obviously different from this.
  */
  track: {
    width: controls.toggleTrackWidth,
    height: controls.toggleTrackHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: controls.toggleInset,
    justifyContent: "center",
    overflow: "hidden",
  },
  trackDisabled: {
    backgroundColor: colors.border,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  fillDisabled: {
    backgroundColor: colors.accentSoft,
  },
  thumb: {
    width: controls.toggleThumb,
    height: controls.toggleThumb,
    borderRadius: controls.toggleThumb / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    boxShadow: shadows.card,
  },
  thumbDisabled: {
    backgroundColor: colors.surface2,
    boxShadow: undefined,
  },
});

export default Toggle;
