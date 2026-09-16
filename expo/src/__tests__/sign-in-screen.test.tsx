import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { controls, radius } from "@/theme";

const mockSendEmailCode = jest.fn();
const mockVerifyEmailCode = jest.fn();

jest.mock("@/lib/session", () => ({
  sendEmailCode: (...args: unknown[]) => mockSendEmailCode(...args),
  verifyEmailCode: (...args: unknown[]) => mockVerifyEmailCode(...args),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    Easing: { out: () => passthrough, cubic: passthrough },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withDelay: (_delay: number, value: unknown) => value,
    withTiming: jest.fn(passthrough),
  };
});

jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import SignInScreen from "@/screens/SignInScreen";
/* eslint-enable import/first */

beforeEach(() => {
  jest.clearAllMocks();
  mockSendEmailCode.mockResolvedValue(undefined);
  mockVerifyEmailCode.mockResolvedValue(undefined);
});

describe("SignInScreen", () => {
  it("renders the bare sign-in headline, with no character flow ahead of it", async () => {
    const view = await render(
      <SignInScreen onDone={jest.fn()} onExit={jest.fn()} />,
    );
    view.getByText("Welcome back.");
    view.getByText("Enter your email and we'll send a code.");
    view.getByLabelText("Email address");
  });

  it("calls onDone once the code verifies", async () => {
    const onDone = jest.fn();
    const view = await render(
      <SignInScreen onDone={onDone} onExit={jest.fn()} />,
    );
    await fireEvent.changeText(
      view.getByLabelText("Email address"),
      "a@b.com",
    );
    await fireEvent.press(view.getByLabelText("Continue with email"));
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(view.getByLabelText("Verify and continue"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("calls onExit from the email step's Back", async () => {
    const onExit = jest.fn();
    const view = await render(
      <SignInScreen onDone={jest.fn()} onExit={onExit} />,
    );
    await fireEvent.press(view.getByLabelText("Back"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  /*
    Sign-in draws no button of its own - `EmailCodeAuth` draws the shared
    onboarding pill - and this is what keeps it that way, so a future local
    button on this screen fails here rather than shipping a second recipe.
  */
  it("draws the shared onboarding pill", async () => {
    const view = await render(
      <SignInScreen onDone={jest.fn()} onExit={jest.fn()} />,
    );

    const cta = StyleSheet.flatten(
      view.getByLabelText("Continue with email").props.style,
    ) as { height?: number; borderRadius?: number };
    expect(cta.height).toBe(controls.onboardingCtaHeight);
    expect(cta.borderRadius).toBe(radius.pill);
  });

  /*
    D1. Sign-in reached after a sign-out or a deletion has no session behind
    it, so it must not offer a way back to the tabs: exiting there would render
    Home with no identity and the first `bootstrapUser` would mint the guest
    the product does not have. App.tsx withholds `onExit` for that entry, and
    what this asserts is that withholding it removes the control rather than
    leaving a dead one on screen.
  */
  it("draws no way back when there is no session behind it", async () => {
    const view = await render(<SignInScreen onDone={jest.fn()} />);

    expect(view.queryByLabelText("Back")).toBeNull();
  });

  /*
    P2. `onDone` does the account rebuild -- bootstrap, balance, streak,
    profile, entitlement override -- and App.tsx navigates in its `finally`.
    If this screen did not AWAIT it, the tabs would render against the account
    that just left, and the clearest victim is a tester whose premium override
    only lands when `fetchOwnProfile` resolves: the paywall would flash before
    the member state. It also leaves a live "Verify and continue" under the
    person's thumb for the whole rebuild.
  */
  it("stays busy until the caller's follow-on work settles", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onDone = jest.fn(() => pending);
    const busy = () =>
      view.getByText("Resend code").parent?.props.accessibilityState?.disabled;

    const view = await render(<SignInScreen onDone={onDone} />);
    await fireEvent.changeText(
      view.getByLabelText("Email address"),
      "a@b.com",
    );
    await fireEvent.press(view.getByLabelText("Continue with email"));
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );

    // NOT awaited: awaiting the press would wait on the very promise this test
    // holds open, and deadlock rather than assert.
    const press = fireEvent.press(view.getByLabelText("Verify and continue"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(busy()).toBe(true);

    release();
    await press;
    await waitFor(() => expect(busy()).toBe(false));
  });
});
