import { useCallback, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Primary, StepScroll } from "@/components/onboarding/primitives";
import { isCompleteOtp, normaliseOtpInput, OTP_LENGTH } from "@/lib/otp";
import { reviewerSignIn, sendEmailCode, verifyEmailCode } from "@/lib/session";
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

/**
 * Said when a paste or autofill carries more digits than a code has. Almost
 * always an old 8-digit code from before the switch to 6, so the line says
 * what a code looks like and where to find the right one.
 */
export const CODE_TOO_LONG =
  `That has more than ${OTP_LENGTH} digits. Paste just the ${OTP_LENGTH}-digit code from the newest email.`;

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
   *
   * Optional: when this screen is the only way
   * forward -- sign-in reached after a sign-out, where there is no session to
   * go back to -- there is no back arrow to draw.
   */
  onBack?: () => void;
  /**
   * Fires once, right after `verifyEmailCode` resolves.
   *
   * Carries the verified address rather than nothing, so a caller that needs
   * it for its own result (`CharacterOnboarding` writes it into
   * `CharacterOnboardingResult.email`) does not have to keep a second,
   * shadow copy of state this component already owns. A caller with no use
   * for it, like `SignInScreen`, is free to ignore the argument.
   *
   * May return a promise, and if it does this screen stays
   * busy until it settles: the caller's follow-on work -- bootstrapping the
   * session, refreshing the balance, fetching the profile -- has to finish
   * before the app moves on, and until it does the person is still looking at
   * this screen with a live button under their thumb.
   */
  onVerified: (email: string) => void | Promise<void>;
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
  /**
   * Refs, not state, because the auto-submit fires from inside the same
   * change event that completed the code: state set there is not visible to
   * the submit it triggers. `busyRef` stops a second verify while one is in
   * flight (a sixth digit and a Verify tap in the same second); `verifiedRef`
   * stops any verify after one has succeeded, so `onVerified` runs once even
   * if the caller is slow to navigate away; `autoSubmittedRef` remembers which
   * code was auto-submitted, so a wrong code is not re-sent on every render.
   */
  const busyRef = useRef(false);
  const verifiedRef = useRef(false);
  const autoSubmittedRef = useRef<string | null>(null);

  const goToEmail = useCallback(() => {
    setAuthError(null);
    // In code-only mode the email box belongs to the caller's own screen, so
    // "back" and "use a different email" both mean "hand the flow back".
    if (codeOnly) {
      onBack?.();
      return;
    }
    setAuthStep("email");
  }, [codeOnly, onBack]);

  const submitEmail = useCallback(async () => {
    // `Resend code` calls this too, and that button sits on a screen where the
    // primary action is already in flight. A second send while the first is
    // open issues a second code and invalidates the one the user is reading.
    if (authBusy) return;
    if (!EMAIL_PATTERN.test(email.trim())) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await sendEmailCode(email);
      setCode("");
      autoSubmittedRef.current = null;
      setAuthStep("code");
    } catch {
      setAuthError("We could not send that code. Check the address and retry.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, email]);

  const submitCode = useCallback(async (candidate: string = code) => {
    if (busyRef.current || verifiedRef.current) return;
    if (!isCompleteOtp(candidate)) return;
    busyRef.current = true;
    setAuthBusy(true);
    setAuthError(null);
    try {
      // ONLY the code check is allowed to fall through to the reviewer path.
      // `onVerified` used to sit in this same `try`, which meant a failure
      // while rebuilding the account -- work that happens AFTER the person is
      // authenticated -- was answered by attempting a second sign-in and then
      // blaming their code for it.
      let verified = false;
      try {
        await verifyEmailCode(email, candidate);
        verified = true;
      } catch {
        // The reviewer's fixed code (D11). Tried only after the real OTP
        // refused, and the function answers 401 for every address but the
        // reviewer's, so for anyone else this is one extra round trip on the
        // way to the same error line.
        verified = await reviewerSignIn(email, candidate).catch(() => false);
      }

      if (!verified) {
        setAuthError("That code did not match. Try again or resend it.");
        return;
      }
      verifiedRef.current = true;

      try {
        await onVerified(email.trim());
      } catch {
        // Authenticated already, so this is the caller's rebuild failing, not
        // the credential. Saying "that code did not match" here would be a
        // lie about the one thing that did work, and the caller navigates
        // regardless -- every screen tolerates a profile that did not load.
      }
    } finally {
      busyRef.current = false;
      setAuthBusy(false);
    }
  }, [code, email, onVerified]);

  /**
   * Every keystroke, paste and autofill lands here. A code that arrives
   * complete -- the sixth digit typed, or all six pasted or filled from the
   * mail -- is verified without a second tap on Verify.
   */
  const changeCode = useCallback((raw: string) => {
    const { code: next, overflow } = normaliseOtpInput(raw);
    if (overflow) {
      setCode("");
      autoSubmittedRef.current = null;
      setAuthError(CODE_TOO_LONG);
      return;
    }
    setCode(next);
    // The "more than 6 digits" line is about a paste that is gone once they
    // type; any other error stays until the next verify answers.
    setAuthError((current) => (current === CODE_TOO_LONG ? null : current));
    if (!isCompleteOtp(next)) {
      // Editing the code re-arms the auto-submit, so correcting one digit
      // back to the same six is an explicit retry.
      autoSubmittedRef.current = null;
      return;
    }
    if (autoSubmittedRef.current === next) return;
    autoSubmittedRef.current = next;
    void submitCode(next);
  }, [submitCode]);

  if (authStep === "code") {
    return (
      <StepScroll
        onBack={goToEmail}
        steps={steps}
        currentStep={codeStep}
        art={artwork}
        title="Check your inbox"
        sub={`Enter the ${OTP_LENGTH}-digit code we sent to ${email.trim()}.`}
      >
        <View style={styles.section}>
          <Text style={styles.eyebrowDark}>CODE</Text>
          <OtpBoxes value={code} onChangeText={changeCode} />
        </View>

        {authError ? <Text style={styles.error}>{authError}</Text> : null}
        <Primary
          label="Verify and continue"
          busy={authBusy}
          disabled={!isCompleteOtp(code)}
          onPress={() => submitCode()}
        />
        <Pressable
          onPress={submitEmail}
          accessibilityRole="button"
          accessibilityState={{ disabled: authBusy }}
          disabled={authBusy}
          style={[styles.resendButton, authBusy && styles.resendButtonBusy]}
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
  const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH);

  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={() => inputRef.current?.focus()}
      style={styles.otpShell}
    >
      <View style={styles.otpRow}>
        {Array.from({ length: OTP_LENGTH }, (_, index) => {
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
        // The RAW text goes up, unfiltered. Filtering here, or a
        // `maxLength={6}`, runs before the parent can tell "123 456" (a code,
        // with a space) from "12345678" (not a code): the platform truncates a
        // paste to six characters first, so "123 456" arrived as "123 45" and
        // an 8-digit code arrived as a plausible, wrong, six.
        onChangeText={onChangeText}
        accessibilityLabel="Verification code"
        accessibilityHint={`Enter the ${OTP_LENGTH}-digit code`}
        keyboardType="number-pad"
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
  resendButtonBusy: { opacity: 0.4 },
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
