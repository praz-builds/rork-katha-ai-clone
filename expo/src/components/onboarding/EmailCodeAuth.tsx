import { useCallback, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Primary, StepScroll } from "@/components/onboarding/primitives";
import { sendEmailCode, verifyEmailCode } from "@/lib/session";
import {
  colors,
  controls,
  onboardingType,
  shadows,
  spacing,
  type,
} from "@/theme";

/**
 * Email then a 6-digit code, as its own component.
 *
 * Extracted out of `CharacterOnboarding` so a bare sign-in can use exactly
 * this and nothing else: no bridge, no character sheet, no portrait wait.
 * Every caller supplies the headline/sub for the email step and where the
 * progress row should land (or nothing, for a flow with no progress row at
 * all); the code step's own copy is fixed, because "Check your inbox" is not
 * a decision any caller makes differently.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthStep = "email" | "code";

export function EmailCodeAuth({
  headline,
  sub,
  artwork,
  onBack,
  onVerified,
  steps,
  currentStep,
  codeStep,
  initialStep = "email",
  email: initialEmail = "",
}: {
  headline: string;
  sub: string;
  artwork?: React.ReactNode;
  /**
   * Back from the email step. Back from the code step returns to email,
   * EXCEPT in code-only mode, where there is no email step to return to and
   * Back is the caller's business.
   */
  onBack: () => void;
  /**
   * Fires once, right after `verifyEmailCode` resolves.
   *
   * Carries the verified address rather than nothing, so a caller that needs
   * it for its own result (`CharacterOnboarding` writes it into
   * `CharacterOnboardingResult.email`) does not have to keep a second,
   * shadow copy of state this component already owns. A caller with no use
   * for it, like `SignInScreen`, is free to ignore the argument.
   */
  onVerified: (email: string) => void;
  steps?: number;
  currentStep?: number;
  codeStep?: number;
  /**
   * CODE-ONLY MODE. `"code"` starts on the six-digit step with `email`
   * already sent, for a flow that owns its own email screen and has already
   * called `sendEmailCode` itself - the character onboarding's W5 does, so
   * that the portrait request can be fired in the same press. Without it this
   * component would have to be shown an email box the person just filled in.
   */
  initialStep?: AuthStep;
  /** The address `sendEmailCode` was already called with, in code-only mode. */
  email?: string;
}) {
  const codeOnly = initialStep === "code";
  const [authStep, setAuthStep] = useState<AuthStep>(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  /** Belongs to the step that produced it. Carried across a step it becomes a
   *  complaint about a field that is no longer on screen. */
  const [authError, setAuthError] = useState<string | null>(null);

  const goToEmail = useCallback(() => {
    setAuthError(null);
    // In code-only mode the email box belongs to the caller's own screen, so
    // "back" and "use a different email" both mean "hand the flow back".
    if (codeOnly) {
      onBack();
      return;
    }
    setAuthStep("email");
  }, [codeOnly, onBack]);

  const submitEmail = useCallback(async () => {
    if (!EMAIL_PATTERN.test(email.trim())) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await sendEmailCode(email);
      setCode("");
      setAuthStep("code");
    } catch {
      setAuthError("We could not send that code. Check the address and retry.");
    } finally {
      setAuthBusy(false);
    }
  }, [email]);

  const submitCode = useCallback(async () => {
    if (code.trim().length < 6) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await verifyEmailCode(email, code);
      onVerified(email.trim());
    } catch {
      setAuthError("That code did not match. Try again or resend it.");
    } finally {
      setAuthBusy(false);
    }
  }, [code, email, onVerified]);

  if (authStep === "code") {
    return (
      <StepScroll
        onBack={goToEmail}
        steps={steps}
        currentStep={codeStep}
        art={artwork}
        title="Check your inbox"
        sub={`Enter the 6-digit code we sent to ${email.trim()}.`}
      >
        <View style={styles.section}>
          <Text style={styles.eyebrowDark}>CODE</Text>
          <OtpBoxes value={code} onChangeText={setCode} />
        </View>

        {authError ? <Text style={styles.error}>{authError}</Text> : null}
        <Primary
          label="Verify and continue"
          busy={authBusy}
          disabled={code.trim().length < 6}
          onPress={submitCode}
        />
        <Pressable
          onPress={submitEmail}
          accessibilityRole="button"
          style={styles.resendButton}
        >
          <Text style={styles.quietText}>Resend code</Text>
        </Pressable>
        <Pressable
          onPress={goToEmail}
          accessibilityRole="button"
          style={styles.quietButton}
        >
          <Text style={styles.quietText}>Use a different email</Text>
        </Pressable>
      </StepScroll>
    );
  }

  return (
    <StepScroll
      onBack={onBack}
      steps={steps}
      currentStep={currentStep}
      art={artwork}
      title={headline}
      sub={sub}
    >
      <View style={styles.section}>
        <Text style={styles.eyebrowDark}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="elena@example.com"
          placeholderTextColor={colors.tertiary}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          autoComplete="email"
          accessibilityLabel="Email address"
          style={styles.inlineInput}
        />
      </View>

      {authError ? <Text style={styles.error}>{authError}</Text> : null}
      <Primary
        label="Continue with email"
        busy={authBusy}
        disabled={!EMAIL_PATTERN.test(email.trim())}
        onPress={submitEmail}
      />
      <Text style={styles.legal}>
        By continuing you agree to our Terms and Privacy Policy.
      </Text>
    </StepScroll>
  );
}

function OtpBoxes({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.replace(/\D/g, "").slice(0, 6);

  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={() => inputRef.current?.focus()}
      style={styles.otpShell}
    >
      <View style={styles.otpRow}>
        {Array.from({ length: 6 }, (_, index) => {
          const active = index === digits.length;
          const filled = Boolean(digits[index]);
          return (
            <View
              key={index}
              style={[
                styles.otpCell,
                active && styles.otpCellActive,
                filled && styles.otpCellFilled,
              ]}
            >
              <Text style={styles.otpDigit}>{digits[index] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={digits}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, "").slice(0, 6))}
        accessibilityLabel="Verification code"
        accessibilityHint="Enter the six digit code"
        keyboardType="number-pad"
        maxLength={6}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        style={styles.otpHidden}
        caretHidden
        autoFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** One unit: an eyebrow, its helper line, and the control they head. */
  section: { gap: spacing.related },
  eyebrowDark: { ...onboardingType.sectionHeader, color: colors.ink },
  inlineInput: {
    ...onboardingType.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: controls.formFieldRadius,
    boxShadow: shadows.formField,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: controls.formFieldMinHeight,
  },
  /** `spacing.huge` of hit area under a quiet text control. */
  quietButton: {
    alignSelf: "center",
    minHeight: spacing.huge,
    justifyContent: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  resendButton: {
    alignSelf: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  quietText: { ...type.subhead, color: colors.muted },
  error: { ...type.subhead, color: colors.accentPressed },
  legal: {
    ...type.caption,
    color: colors.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  otpShell: {
    minHeight: controls.otpCellHeight,
    justifyContent: "center",
  },
  otpRow: { flexDirection: "row", gap: spacing.sm },
  otpCell: {
    flex: 1,
    height: controls.otpCellHeight,
    borderRadius: controls.otpCellRadius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.formField,
  },
  otpCellActive: { borderColor: colors.accent },
  otpCellFilled: { borderColor: colors.borderStrong },
  otpDigit: {
    ...onboardingType.body,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 22,
    lineHeight: 26,
  },
  otpHidden: {
    position: "absolute",
    width: "100%",
    height: "100%",
    opacity: 0,
  },
});
