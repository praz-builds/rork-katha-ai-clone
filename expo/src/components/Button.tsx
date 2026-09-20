import React from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { colors, controls, shadows, spacing, type } from "@/theme";

/**
 * THE text button. There is one, and this is it.
 *
 * ## What this replaced
 *
 * Nothing drew the documented primary CTA. `controls.primaryCtaHeight` (64) at
 * `controls.primaryCtaRadius` (20) was written down in DESIGN_SYSTEM.md
 * section 6 and exported from the theme, and no file in `src/` imported
 * either one. `KathaPrimitives.PrimaryButton` existed, at 52 and `radius.md`,
 * and was imported by nothing — it survived only in three test files that
 * mocked it. Onboarding had its own `Primary` at 56 and `radius.pill`. Every
 * other button in the app was a `Pressable` with a local `StyleSheet` entry,
 * and those had settled at 48, 50, 52, 54 and 56, at three radii, with labels
 * at 15/800, 16/800, `type.body` at 700 and `type.headline` at 700.
 *
 * So the same act — press the orange thing — looked like a different control
 * on almost every screen, and the token that was supposed to prevent that had
 * never been connected to anything. The fix is not a better token. A token
 * only holds if exactly one component reads it, which is what this file is.
 *
 * ## The recipe
 *
 * Height `controls.primaryCtaHeight` (52) at `size="lg"`,
 * `controls.buttonSmHeight` (44) at `size="sm"`. Radius
 * `controls.primaryCtaRadius`, which is `radius.pill`. Label `type.button`
 * (17/700, `fonts.ui`). Primary fills `colors.accent` with white text and
 * carries `shadows.primaryCta`; it goes to `colors.accentPressed` while held,
 * because a colour change reads as a press where an opacity change on a
 * saturated orange mostly reads as a rendering glitch.
 *
 * Full width by default, because a primary CTA that is not full width is a
 * secondary action wearing a primary's clothes.
 *
 * ## What does NOT belong here
 *
 * Chips, filter pills, avatars, segmented tracks, the tab bar and the toggle
 * are all `radius.pill` and none of them is a button. Neither is a
 * destructive control: deleting an account is drawn in `colors.danger` and
 * reporting a story in `colors.premium`, deliberately unlike every other
 * button in the app (see the doc comment on `colors.danger`), and giving them
 * a variant here would be the first step back toward them looking ordinary.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "lg" | "sm";

/**
 * What a caller may pass through `style`: everything a `ViewStyle` has except
 * the recipe.
 *
 * The doc comment above says the recipe is not overridable, and before this
 * type that was only a wish -- the prop was a full `ViewStyle` applied LAST in
 * the style array, so `<Button style={{ minHeight: 64, borderRadius: 20 }} />`
 * quietly redrew the button and no test could see it. Omitting the keys is
 * what makes the sentence true: TypeScript rejects them in an object literal
 * and in a `StyleSheet.create` entry, which is how every call site in the tree
 * passes one.
 *
 * It is a compile-time guard and not a runtime one. A style cast to
 * `ViewStyle`, or flattened through a variable typed as one, still lands --
 * that is the honest limit of it.
 */
export type ButtonLayoutStyle = Omit<
  ViewStyle,
  | "height"
  | "minHeight"
  | "maxHeight"
  | "borderRadius"
  | "borderTopLeftRadius"
  | "borderTopRightRadius"
  | "borderBottomLeftRadius"
  | "borderBottomRightRadius"
  | "borderCurve"
  | "backgroundColor"
  | "borderWidth"
  | "borderColor"
>;

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  disabled = false,
  loading = false,
  fullWidth = true,
  testID,
  accessibilityLabel,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * A lucide element drawn before the label, `spacing.sm` clear of it. Pass
   * the element rather than the component so the caller keeps control of the
   * glyph's size and colour: Read and Listen want 19pt in `colors.surface`,
   * a secondary wants `colors.strong`, and a button cannot guess.
   */
  icon?: ReactNode;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks the press. Still announced as disabled. */
  loading?: boolean;
  fullWidth?: boolean;
  testID?: string;
  /** Defaults to `label`. Give one when the label alone is not the whole act ("Read" -> "Read story"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * Layout only — margins, `flex`, `alignSelf`, `width`. The recipe (height,
   * radius, fill, border) is not passable: `ButtonLayoutStyle` omits those
   * keys, so the claim above is enforced rather than asserted. See the note on
   * that type for the one hole it leaves.
   */
  style?: StyleProp<ButtonLayoutStyle>;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      /*
        `busy` as well as `disabled`, and they are different facts: disabled
        means "not available", busy means "you already pressed this and it is
        working". A screen reader that only ever hears "dimmed" cannot tell a
        purchase in flight from a form that is not filled in yet.
      */
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "sm" ? styles.sizeSm : styles.sizeLg,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        fullWidth ? styles.fullWidth : styles.hugContent,
        pressed && !blocked && pressedStyle[variant],
        blocked && disabledStyle[variant],
        style,
      ]}
    >
      {/*
        THE SPINNER REPLACES THE ICON, NOT THE LABEL.

        A spinner on its own says "wait" and nothing else. The label is what
        says what is being waited FOR, and a button whose caller sets
        `label={busy ? "Saving" : "Save"}` has already gone to the trouble of
        writing that word -- swapping the whole content for a spinner threw it
        away and made the busy branch of every such ternary unreachable, which
        is dead code that reads as live.

        So the spinner takes the icon's slot: same row, same `gap`, label
        intact. The width still moves when the word does, which it would
        anyway, and `accessibilityState.busy` carries the same fact to anyone
        not looking at it.
      */}
      {loading
        ? (
          <ActivityIndicator
            size="small"
            color={variant === "primary" ? colors.surface : colors.strong}
          />
        )
        : icon}
      <Text
        style={[
          size === "sm" ? styles.labelSm : styles.labelLg,
          labelColor[variant],
          blocked && styles.labelBlocked,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: controls.primaryCtaRadius,
  },
  /*
   * `minHeight`, not `height`. A few labels in the app are a whole sentence --
   * the credit sheet's Purchase carries the pack and the price, and its web
   * fallback is a full line of explanation -- and a fixed height clips the
   * second line rather than wrapping it. The floor is what matters; growing
   * past it is correct behaviour, not drift.
   */
  sizeLg: { minHeight: controls.primaryCtaHeight, paddingVertical: spacing.sm },
  sizeSm: { minHeight: controls.buttonSmHeight, paddingVertical: spacing.xs },
  /**
   * `alignSelf: "stretch"` rather than `width: "100%"`. A full-width button is
   * as wide as whatever contains it, and `100%` inside a row with a gap
   * overflows by exactly the gap.
   */
  fullWidth: { alignSelf: "stretch" },
  hugContent: { alignSelf: "flex-start" },

  primary: {
    backgroundColor: colors.accent,
    boxShadow: shadows.primaryCta,
  },
  /** The answer to a primary in the same row: same shape, no fill, a real edge. */
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  /** Text on the page. No plate, no edge — the label and the target only. */
  ghost: { backgroundColor: "transparent" },

  primaryPressed: { backgroundColor: colors.accentPressed },
  secondaryPressed: { backgroundColor: colors.surface2 },
  ghostPressed: { opacity: 0.6 },

  /**
   * Disabled is drawn as a grey plate rather than as a faded orange. A primary
   * at 40% opacity still reads as the accent, so the button looks pressable
   * and does nothing; `borderStrong` says plainly that it is not ready.
   */
  primaryDisabled: { backgroundColor: colors.borderStrong, boxShadow: "none" },
  secondaryDisabled: { borderColor: colors.border },
  ghostDisabled: { opacity: 0.4 },

  labelLg: { ...type.button, textAlign: "center" },
  labelSm: { ...type.buttonSmall, textAlign: "center" },
  labelPrimary: { color: colors.surface },
  labelSecondary: { color: colors.ink },
  labelGhost: { color: colors.accent },
  labelBlocked: { color: colors.tertiary },
});

/**
 * Variant lookups, so the render path stays a flat list of style slots rather
 * than a ladder of ternaries that has to be read twice to be trusted.
 */
const pressedStyle = {
  primary: styles.primaryPressed,
  secondary: styles.secondaryPressed,
  ghost: styles.ghostPressed,
} as const;

const disabledStyle = {
  primary: styles.primaryDisabled,
  secondary: styles.secondaryDisabled,
  ghost: styles.ghostDisabled,
} as const;

const labelColor = {
  primary: styles.labelPrimary,
  secondary: styles.labelSecondary,
  ghost: styles.labelGhost,
} as const;

/**
 * The recipe, exported so `button-recipe.test.ts` can assert it rather than
 * restate it. A test that hardcodes 52 passes a rename of the token; one that
 * reads this fails the day the component stops consuming it.
 */
export const BUTTON_RECIPE = {
  lg: controls.primaryCtaHeight,
  sm: controls.buttonSmHeight,
  radius: controls.primaryCtaRadius,
} as const;
