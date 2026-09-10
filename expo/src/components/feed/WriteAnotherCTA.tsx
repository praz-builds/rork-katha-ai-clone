import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { IconChevronForward, IconPencil } from "@/theme/icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { colors, fonts, radius, shadows, spacing, type } from "@/theme";

/**
 * The invitation to write another story.
 *
 * NOT A SECTION. Every other block on Home is a shelf of things that already
 * exist; this one is the only thing on the page that asks the reader to make
 * something. It therefore sits directly under the greeting, above the first
 * rail, in the slot the old "Continue reading" hero card occupied - the top of
 * the scroll is the only place an invitation is read as an invitation rather
 * than as the footer of whatever section it follows.
 *
 * It replaces a flat pale-peach band with a plus and a chevron: a shape that
 * looked like a settings row and asked for nothing.
 *
 * TWO VARIANTS, ONE SWITCH. The product owner is picking between a loud
 * accent-filled card and a quiet editorial one, so both are built and
 * `WRITE_CTA_VARIANT` below chooses. Everything except the surface treatment -
 * the copy, the anatomy, the tap target, the accessibility label, the motion -
 * is shared, so the choice is genuinely about how it looks and not about which
 * one works.
 */
export type WriteAnotherVariant = "gradient" | "editorial";

/**
 * Which of the two CTA treatments Home renders.
 *
 * Flip this single constant to `"editorial"` to screenshot the other one; no
 * other file changes. It is a module constant rather than a prop because there
 * is exactly one call site and the decision is a design decision, not a
 * per-screen one - the day it is made, the loser is deleted and this constant
 * goes with it.
 */
export const WRITE_CTA_VARIANT: WriteAnotherVariant = "gradient";

const TITLE = "Write another story";
const SUPPORT = "A genre, a name, one idea. Katha writes the rest.";

/** The accent ramp for the gradient variant: the brand orange, warmed and deepened. */
const ACCENT_GRADIENT = [colors.accent, colors.accentPressed] as const;

/**
 * Entrance and press, both on the UI thread.
 *
 * Entrance is a fade and a short rise on mount - `explanation`, in the skill's
 * terms: the card was not there a frame ago and arriving explains where it
 * came from. Press is `feedback` and stays under 150ms per the frequency rule.
 * Both are transform and opacity only, so neither costs a layout pass, and
 * both collapse to their finished state under `useReducedMotion` rather than
 * being skipped halfway.
 */
function useCTAMotion() {
  const reducedMotion = useReducedMotion();
  const enter = useSharedValue(reducedMotion ? 1 : 0);
  const press = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, {
      duration: 320,
      // Strong ease-out. Never ease-in on UI: it delays the moment being watched.
      easing: Easing.bezier(0.23, 1, 0.32, 1),
    });
  }, [enter, reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 12 },
      { scale: 1 - press.value * 0.02 },
    ],
  }));

  const onPressIn = () => {
    if (reducedMotion) return;
    press.value = withTiming(1, { duration: 120 });
  };
  const onPressOut = () => {
    if (reducedMotion) return;
    press.value = withSpring(0, { duration: 400, dampingRatio: 0.9 });
  };

  return { style, onPressIn, onPressOut };
}

export default function WriteAnotherCTA({
  onPress,
  heading = TITLE,
  support = SUPPORT,
  tone = "loud",
}: {
  onPress: () => void;
  /** What this card says right now. See `lib/home-cta.ts` for the states. */
  heading?: string;
  support?: string;
  /**
   * `loud` is an offer and wears the gradient. `quiet` is a status, a
   * reminder or a paywall door -- none of which should be the brightest
   * thing on Home, and the last of which would be a dark pattern if it were.
   */
  tone?: "loud" | "quiet";
}) {
  const { style, onPressIn, onPressOut } = useCTAMotion();

  return (
    <Animated.View style={[styles.wrap, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={heading}
        accessibilityHint={support}
        testID="write-another-cta"
        style={styles.press}
      >
        {tone === "loud"
          ? <GradientFace heading={heading} support={support} />
          : <EditorialFace heading={heading} support={support} />}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Variant A. The card is the accent: an orange field with white type and a
 * translucent glyph plate, so the one thing on Home that costs a credit is
 * also the one thing on Home that is a colour.
 */
function GradientFace(
  { heading, support }: { heading: string; support: string },
) {
  return (
    <LinearGradient
      colors={ACCENT_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradientCard}
      testID="write-another-face-gradient"
    >
      {/* NO PLATE BEHIND THE GLYPH. A filled square around the icon reads as a
          second control inside the card -- a button on a button -- and on the
          accent field it was a lightened box whose edge competed with the
          card's own. The mark alone is the mark. */}
      <IconPencil size={22} color={colors.surface} />
      {/* NO EYEBROW. It read "New story", which is false in four of the five
          states this card now has, and it carried the generation sparkle --
          a glyph that means "the AI is working", on a button that asks you to
          start. Dropping the row is also where the card's height comes down
          from, which is the reduction that was actually wanted: the width is
          load-bearing, because it aligns this card's edges with every rail
          below it. */}
      <View style={styles.copy}>
        <Text style={styles.gradientTitle} numberOfLines={1}>{heading}</Text>
        <Text style={styles.gradientSupport} numberOfLines={2}>{support}</Text>
      </View>
      <View style={styles.gradientArrow} importantForAccessibility="no">
        <IconChevronForward size={16} color={colors.accent} />
      </View>
    </LinearGradient>
  );
}

/**
 * Variant B. A plain white card - the same invitation spoken at the volume of
 * the rest of the page. Quieter than A, and it does not compete with the cover
 * art in the rail underneath it.
 *
 * NO ORANGE EDGE. It carried a 5pt accent rail down its leading edge, and the
 * card already says everything that rail was saying: the accent is on the
 * pencil and on the arrow, which are the two things a reader looks at. A third
 * accent element on a card this small stops reading as emphasis and starts
 * reading as a border around a chip.
 */
function EditorialFace(
  { heading, support }: { heading: string; support: string },
) {
  return (
    <View style={styles.editorialCard} testID="write-another-face-editorial">
      {/* Same as the gradient face: the outline mark in the accent, with no
          tinted plate around it. */}
      <IconPencil size={22} color={colors.accent} />
      <View style={styles.copy}>
        <Text style={styles.editorialTitle} numberOfLines={1}>{heading}</Text>
        <Text style={styles.editorialSupport} numberOfLines={2}>{support}</Text>
      </View>
      <View style={styles.editorialArrow} importantForAccessibility="no">
        <IconChevronForward size={18} color={colors.surface} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.related,
  },
  // The whole card is one tap target and it is far taller than 44.
  press: { borderRadius: radius.xl },

  copy: { flex: 1 },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  /* ── Variant A: gradient ── */
  gradientCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    boxShadow: shadows.raised,
  },
  gradientEyebrow: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.accentSoft,
  },
  gradientTitle: {
    marginTop: 2,
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.surface,
  },
  gradientSupport: {
    marginTop: spacing.xs,
    ...type.caption,
    fontFamily: fonts.ui,
    lineHeight: 17,
    color: colors.accentSoft,
  },
  gradientArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },

  /* ── Variant B: editorial ── */
  editorialCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    // Symmetric now that the rail is gone; the extra leading pad existed only
    // to clear it.
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
    overflow: "hidden",
  },
  editorialEyebrow: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.accent,
  },
  editorialTitle: {
    marginTop: 2,
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.ink,
  },
  editorialSupport: {
    marginTop: spacing.xs,
    ...type.caption,
    fontFamily: fonts.ui,
    lineHeight: 17,
    color: colors.muted,
  },
  editorialArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
});
