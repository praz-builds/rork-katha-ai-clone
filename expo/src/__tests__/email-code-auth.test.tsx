import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockSendEmailCode = jest.fn();
const mockVerifyEmailCode = jest.fn();
// D11: when Supabase's own verify fails, the screen offers the code to
// `reviewer-signin` before it shows an error, so the store reviewer can sign
// in with a fixed code. Everyone else pays one extra round trip to the same
// error line, which is what these tests assert.
const mockReviewerSignIn = jest.fn();

jest.mock("@/lib/session", () => ({
  sendEmailCode: (...args: unknown[]) => mockSendEmailCode(...args),
  verifyEmailCode: (...args: unknown[]) => mockVerifyEmailCode(...args),
  reviewerSignIn: (...args: unknown[]) => mockReviewerSignIn(...args),
}));

// The same passthrough mock `character-onboarding.test.tsx` uses: `StepScroll`
// (from `@/components/onboarding/primitives`) animates its headline through
// `Enter`, and this file is a test of the auth flow, not of that entrance.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    Easing: {
      out: () => passthrough,
      cubic: passthrough,
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withDelay: (_delay: number, value: unknown) => value,
    withTiming: jest.fn(passthrough),
  };
});

// The top bar's Back control is an Ionicon by way of `@/theme`'s icon set.
// Irrelevant to every assertion here, and rendering it pulls a native font
// module into the test environment.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import { codeTooLong, EmailCodeAuth } from "@/components/onboarding/EmailCodeAuth";
/* eslint-enable import/first */

const HEADLINE = "Welcome back.";
const SUB = "Enter your email and we'll send a code.";
const EMAIL = "a@b.com";

beforeEach(() => {
  jest.clearAllMocks();
  mockSendEmailCode.mockResolvedValue(undefined);
  mockVerifyEmailCode.mockResolvedValue(undefined);
  mockReviewerSignIn.mockResolvedValue(false);
});

/** RNTL 14: `render` and `fireEvent` are async, or the assertion runs a frame early. */
type View = Awaited<ReturnType<typeof render>>;

async function mount(onBack = jest.fn(), onVerified = jest.fn()): Promise<
  { view: View; onBack: jest.Mock; onVerified: jest.Mock }
> {
  const view = await render(
    <EmailCodeAuth
      headline={HEADLINE}
      sub={SUB}
      onBack={onBack}
      onVerified={onVerified}
    />,
  );
  return { view, onBack, onVerified };
}

async function reachCodeStep(view: View) {
  await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
  await fireEvent.press(view.getByLabelText("Continue with email"));
  await view.findByLabelText("Verification code");
}

describe("EmailCodeAuth", () => {
  it("renders the headline and sub on the email step, with no progress row by default", async () => {
    const { view } = await mount();
    view.getByText(HEADLINE);
    view.getByText(SUB);
    view.getByLabelText("Email address");
    expect(view.queryByRole("progressbar")).toBeNull();
  });

  it("keeps a send failure on the email step", async () => {
    mockSendEmailCode.mockRejectedValueOnce(new Error("offline"));
    const { view } = await mount();
    await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
    await fireEvent.press(view.getByLabelText("Continue with email"));

    await view.findByText(
      "We could not send that code. Check the address and retry.",
    );
    // Still the email step: the code box never appeared.
    view.getByLabelText("Email address");
    expect(view.queryByLabelText("Verification code")).toBeNull();
  });

  it("keeps a verify failure on the code step, with the code still editable", async () => {
    // Every code refused: the second one typed below is complete too, and
    // submits itself.
    mockVerifyEmailCode.mockRejectedValue(new Error("no match"));
    const { view, onVerified } = await mount();
    await reachCodeStep(view);

    // The sixth digit submits on its own; there is no Verify tap here.
    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "111111",
    );

    await view.findByText("That code did not match. Try again or resend it.");
    // The box is still there and still takes input, not replaced by an error
    // screen.
    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "222222",
    );
    expect(view.getByLabelText("Verification code").props.value).toBe(
      "222222",
    );
    expect(onVerified).not.toHaveBeenCalled();
    // The fallback was tried, and it said no.
    expect(mockReviewerSignIn).toHaveBeenCalledWith(EMAIL, "111111");
  });

  // D11: the store reviewer's fixed code is verified by `reviewer-signin`,
  // never by Supabase's OTP, so a failed verify is not the end of the attempt.
  it("lets the reviewer through on the fixed code when the OTP fails", async () => {
    mockVerifyEmailCode.mockRejectedValueOnce(new Error("no match"));
    mockReviewerSignIn.mockResolvedValueOnce(true);
    const { view, onVerified } = await mount();
    await reachCodeStep(view);

    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "424242",
    );

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(EMAIL));
    expect(
      view.queryByText("That code did not match. Try again or resend it."),
    ).toBeNull();
  });

  it("resends by calling sendEmailCode a second time", async () => {
    const { view } = await mount();
    await reachCodeStep(view);
    expect(mockSendEmailCode).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByText("Resend code"));
    expect(mockSendEmailCode).toHaveBeenCalledTimes(2);
    expect(mockSendEmailCode).toHaveBeenLastCalledWith(EMAIL);
  });

  it("verifies and calls onVerified once, with the verified email", async () => {
    const { view, onVerified } = await mount();
    await reachCodeStep(view);
    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "123456",
    );
    // A Verify tap after the auto-submit already succeeded is a no-op, not a
    // second sign-in and a second `onVerified`.
    await fireEvent.press(view.getByLabelText("Verify and continue"));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(onVerified).toHaveBeenCalledWith(EMAIL);
    expect(mockVerifyEmailCode).toHaveBeenCalledWith(EMAIL, "123456");
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1);
  });

  it("returns to the email step from the code step's Back, and calls onBack only from the email step", async () => {
    const { view, onBack } = await mount();
    await reachCodeStep(view);

    await fireEvent.press(view.getByLabelText("Back"));
    view.getByLabelText("Email address");
    expect(onBack).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("starts on the code step with a pre-sent email, and hands Back to the caller", async () => {
    // Code-only mode: the caller (character onboarding's W5) collected the
    // address and called `sendEmailCode` itself, so there is no email step to
    // send from and none to walk back to.
    const onBack = jest.fn();
    const view = await render(
      <EmailCodeAuth
        initialStep="code"
        email={EMAIL}
        headline="Check your inbox"
        sub={`Enter the 6-digit code we sent to ${EMAIL}.`}
        onBack={onBack}
        onVerified={jest.fn()}
      />,
    );

    view.getByLabelText("Verification code");
    expect(view.queryByLabelText("Email address")).toBeNull();
    // The component did not re-send: the caller already did.
    expect(mockSendEmailCode).not.toHaveBeenCalled();
    // And it verifies against the address it was handed, not an empty one.
    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(view.getByLabelText("Verify and continue"));
    await waitFor(() =>
      expect(mockVerifyEmailCode).toHaveBeenCalledWith(EMAIL, "123456")
    );

    await fireEvent.press(view.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("returns to the email step from Use a different email", async () => {
    const { view } = await mount();
    await reachCodeStep(view);

    await fireEvent.press(view.getByText("Use a different email"));
    view.getByLabelText("Email address");
  });
});

/**
 * Supabase sends a 6-digit code, and people paste it rather than type it. What
 * a mail client or password manager hands over is rarely six bare digits.
 */
describe("EmailCodeAuth -- a 6-digit code, pasted or typed", () => {
  it("does not let the field truncate a formatted paste before it is read", async () => {
    const { view } = await mount();
    await reachCodeStep(view);
    // `maxLength={6}` cut "123 456" to "123 45" -- five digits, no code --
    // before any normalising code ever saw it.
    const input = view.getByLabelText("Verification code");
    expect(input.props.maxLength ?? Infinity).toBeGreaterThan(
      "123 456\n".length,
    );
  });

  it.each([
    ["with a space", "123 456"],
    ["with a trailing newline", "123456\n"],
    ["with a dash and padding", " 123-456 "],
  ])("verifies a code pasted %s, without a Verify tap", async (_label, pasted) => {
    const { view, onVerified } = await mount();
    await reachCodeStep(view);

    await fireEvent.changeText(view.getByLabelText("Verification code"), pasted);

    await waitFor(() =>
      expect(mockVerifyEmailCode).toHaveBeenCalledWith(EMAIL, "123456")
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1);
  });

  it("submits once, on the sixth typed digit", async () => {
    const { view } = await mount();
    await reachCodeStep(view);
    const input = view.getByLabelText("Verification code");

    for (const partial of ["1", "12", "123", "1234", "12345"]) {
      await fireEvent.changeText(input, partial);
    }
    expect(mockVerifyEmailCode).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "123456");
    await waitFor(() => expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1));
  });

  it("refuses an 8-digit paste: no verify, empty boxes, and says why", async () => {
    const { view, onVerified } = await mount();
    await reachCodeStep(view);

    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "12345678",
    );

    await view.findByText(codeTooLong());
    expect(codeTooLong()).toBe(
      "That has more than 6 digits. Paste just the 6-digit code from the newest email.",
    );
    // Its first six are not the code; spending a verify on them only burns
    // the rate limit.
    expect(mockVerifyEmailCode).not.toHaveBeenCalled();
    expect(mockReviewerSignIn).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(view.getByLabelText("Verification code").props.value).toBe("");
  });

  it("says 6-digit code on the code step", async () => {
    const { view } = await mount();
    await reachCodeStep(view);
    view.getByText(`Enter the 6-digit code we sent to ${EMAIL}.`);
  });

  it("sends a code pasted while a verify is in flight once that verify fails", async () => {
    let refuse!: (error: Error) => void;
    mockVerifyEmailCode.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { refuse = reject; }),
    );
    const { view, onVerified } = await mount();
    await reachCodeStep(view);
    const input = view.getByLabelText("Verification code");

    await fireEvent.changeText(input, "111111");
    await waitFor(() => expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1));
    // The right code arrives while the wrong one is still being checked.
    await fireEvent.changeText(input, "222222");
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1);

    refuse(new Error("no match"));

    // No Verify tap: the waiting code goes out on its own.
    await waitFor(() =>
      expect(mockVerifyEmailCode).toHaveBeenLastCalledWith(EMAIL, "222222")
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(2);
  });

  it("retries the same code from Verify after the auto-submit was refused", async () => {
    mockVerifyEmailCode.mockRejectedValueOnce(new Error("no match"));
    const { view, onVerified } = await mount();
    await reachCodeStep(view);

    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "654321",
    );
    await view.findByText("That code did not match. Try again or resend it.");

    await fireEvent.press(view.getByLabelText("Verify and continue"));
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(2);
  });
});
