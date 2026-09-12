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
});
