/**
 * The sign-in code, as the client understands it: exactly six digits.
 *
 * Supabase Auth's "Email OTP length" is a dashboard setting, not code, and
 * Katha's must be 6 (it shipped at Supabase's 8; see the go-live row in
 * `backend/ROADMAP.md`). A project still on 8 sends codes this client refuses,
 * so the setting and this client go live together. Every code entry path in
 * the app -- the onboarding code step, Sign in, and the store reviewer's fixed
 * code, which travels through the same screen -- reads its length from here,
 * so the number lives in one place on the client. `reviewer-signin` on the
 * server checks six digits independently.
 */
export const OTP_LENGTH = 6;

export type OtpInput = {
  /** At most `OTP_LENGTH` digits, nothing else. */
  code: string;
  /**
   * The input carried MORE digits than a code has -- an old 8-digit code, or
   * a paste that caught a second number. Its first six are not the code, so
   * the caller must not fill the boxes with them or submit them: a verify
   * spent on a known-wrong code counts against the rate limit.
   */
  overflow: boolean;
};

/**
 * Normalise whatever the code field received: typed, pasted or autofilled.
 *
 * Mail clients and password managers hand over "123 456", "123-456",
 * "123456\n" or " 123456 ", so everything that is not a digit is dropped
 * before counting. Only then is the length judged.
 */
export function normaliseOtpInput(raw: string): OtpInput {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > OTP_LENGTH) return { code: "", overflow: true };
  return { code: digits, overflow: false };
}

export function isCompleteOtp(code: string): boolean {
  return code.length === OTP_LENGTH && /^\d+$/.test(code);
}
