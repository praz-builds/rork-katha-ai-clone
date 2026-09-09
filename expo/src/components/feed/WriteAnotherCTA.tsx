import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, PenLine, Sparkles } from "lucide-react-native";
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
  variant = WRITE_CTA_VARIANT,
}: {
  onPress: () => void;
  variant?: WriteAnotherVariant;
}) {
  const { style, onPressIn, onPressOut } = useCTAMotion();

  return (
    <Animated.View style={[styles.wrap, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel="Write another story"
        accessibilityHint={SUPPORT}
        testID="write-another-cta"
        style={styles.press}
      >
        {variant === "gradient" ? <GradientFace /> : <EditorialFace />}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Variant A. The card is the accent: an orange field with white type and a
 * translucent glyph plate, so the one thing on Home that costs a credit is
 * also the one thing on Home that is a colour.
 */
function GradientFace() {
  return (
    <LinearGradient
      colors={ACCENT_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradientCard}
      testID="write-another-face-gradient"
    >
      <View style={styles.gradientGlyph}>
        <PenLine size={20} color={colors.surface} />
      </View>
      <View style={styles.copy}>
        <View style={styles.eyebrowRow}>
          <Sparkles size={12} color={colors.accentSoft} />
          <Text style={styles.gradientEyebrow}>New story</Text>
        </View>
        <Text style={styles.gradientTitle}>{TITLE}</Text>
        <Text style={styles.gradientSupport}>{SUPPORT}</Text>
      </View>
      <View style={styles.gradientArrow} importantForAccessibility="no">
        <ArrowRight size={18} color={colors.accent} />
      </View>
    </LinearGradient>
  );
}

/**
 * Variant B. A white card with an accent rail on its leading edge - the same
 * invitation spoken at the volume of the rest of the page. Quieter than A, and
 * it does not compete with the cover art in the rail underneath it.
 */
function EditorialFace() {
  return (
    <View style={styles.editorialCard} testID="write-another-face-editorial">
      <LinearGradient
        colors={ACCENT_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.editorialRail}
      />
      <View style={styles.editorialGlyph}>
        <PenLine size={20} color={colors.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.editorialEyebrow}>New story</Text>
        <Text style={styles.editorialTitle}>{TITLE}</Text>
        <Text style={styles.editorialSupport}>{SUPPORT}</Text>
      </View>
      <View style={styles.editorialArrow} importantForAccessibility="no">
        <ArrowRight size={18} color={colors.surface} />
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
  gradientGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    // A lightened plate on the accent field. Deliberately an alpha of the
    // surface token rather than a new hex: it is "white, mostly transparent",
    // which is a treatment, not a colour the system needs to name.
    backgroundColor: "rgba(255,255,255,0.22)",
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
    paddingVertical: spacing.lg,
    paddingLeft: spacing.lg + spacing.xs,
    paddingRight: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
    overflow: "hidden",
  },
  editorialRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  editorialGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
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
