import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { StyleProp, TextInputProps, ViewStyle } from "react-native";

import {
  colors,
  controls,
  onboardingType,
  shadows,
  spacing,
} from "@/theme";

/**
 * The one text field every onboarding screen draws.
 *
 * One recipe, in one place, because the flow shipped with three: the name
 * screen set its input in the display face at headline size, the Craft sheet
 * used the reader serif, and the email screen had its own box. Three fields
 * that looked like three products. Now: `onboardingType.field` (the Create
 * brief's own 16pt UI face), `surface`, a 1.5pt `onboardingBorderStrong`
 * border that turns 2pt accent with the hand-off glow on focus, radius 14, and
 * padding that lands a single line at about 50pt. The eyebrow above and the
 * optional trailing counter are part of the recipe so they cannot drift either.
 */
export type FieldProps = TextInputProps & {
  /** Uppercase eyebrow above the box. Omitted when empty. */
  label?: string;
  /** Right-aligned text on the eyebrow row, e.g. a `12 / 300` counter. */
  trailing?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, trailing, containerStyle, style, onFocus, onBlur, multiline, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      {label || trailing
        ? (
          <View style={styles.eyebrowRow}>
            {label ? <Text style={styles.eyebrow}>{label}</Text> : <View />}
            {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
          </View>
        )
        : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.tertiary}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          focused && styles.focused,
          style,
        ]}
        {...rest}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  eyebrowRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  eyebrow: {
    ...onboardingType.sectionHeader,
    color: colors.tertiary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  trailing: { ...onboardingType.caption, color: colors.tertiary },
  input: {
    ...onboardingType.field,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.onboardingBorderStrong,
    borderRadius: controls.onboardingPlateRadius,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 50,
  },
  multiline: {
    minHeight: 150,
    paddingVertical: spacing.lg,
    borderRadius: controls.onboardingPlateRadius + spacing.tight,
  },
  focused: {
    borderWidth: 2,
    borderColor: colors.accent,
    boxShadow: shadows.onboardingFieldFocus,
  },
});
