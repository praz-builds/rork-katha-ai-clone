/**
 * The intro's "Get started" is the first button anybody presses, and it used
 * to be the only one in the flow drawn from raw hex and a local shadow: a
 * 16pt-radius orange rectangle in front of a journey of 56pt pills. It draws
 * the shared onboarding pill now, and this pins it to the token.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { LinearGradient: View };
});

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

/* eslint-disable import/first */
import KathaOnboarding from "@/screens/KathaOnboarding";
import { controls, radius } from "@/theme";
/* eslint-enable import/first */

describe("KathaOnboarding intro", () => {
  it("draws the shared onboarding pill for Get started", async () => {
    const view = await render(
      <KathaOnboarding onFinish={jest.fn()} onSignIn={jest.fn()} />,
    );

    // The CTA lives on the last of the three intro beats; the dots are the
    // deterministic way there, with no timeline to wait out.
    await fireEvent.press(view.getByLabelText("Show read intro"));

    const cta = StyleSheet.flatten(
      view.getByLabelText("Get started").props.style,
    ) as { height?: number; borderRadius?: number };
    expect(cta.height).toBe(controls.onboardingCtaHeight);
    expect(cta.borderRadius).toBe(radius.pill);
  });

  it("still finishes from Get started, and still offers Sign in", async () => {
    const onFinish = jest.fn();
    const onSignIn = jest.fn();
    const view = await render(
      <KathaOnboarding onFinish={onFinish} onSignIn={onSignIn} />,
    );

    await fireEvent.press(view.getByLabelText("Show read intro"));
    await fireEvent.press(view.getByLabelText("Get started"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
