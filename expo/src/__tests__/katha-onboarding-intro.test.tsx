/**
 * The intro's "Get started" is the first button anybody presses, and it used
 * to be the only one in the flow drawn from raw hex and a local shadow: a
 * 16pt-radius orange rectangle in front of a journey of 56pt pills. It draws
 * the shared onboarding pill now, and this pins it to the token.
 *
 * It also pins the desktop-width fix (2026-09-25): on a wide or short browser
 * window the intro is a phone-width column that scrolls, rather than 1440pt
 * slides with "Get started" pressed on top of the copy.
 *
 * Reanimated and Gesture Handler run for real here (Gesture Handler's jest
 * setup is in jest.config.js), so the intro is tested as it ships.
 */
import React from "react";
import { Dimensions, StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { LinearGradient: View };
});

/* eslint-disable import/first */
import KathaOnboarding from "@/screens/KathaOnboarding";
import { controls, radius } from "@/theme";
/* eslint-enable import/first */

function setWindow(width: number, height: number) {
  const metrics = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: metrics, screen: metrics });
}

afterEach(() => setWindow(390, 844));

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
    ) as { minHeight?: number; borderRadius?: number };
    expect(cta.minHeight).toBe(controls.onboardingCtaHeight);
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

  it("keeps the slides phone-width on a desktop window", async () => {
    setWindow(1440, 900);
    const view = await render(
      <KathaOnboarding onFinish={jest.fn()} onSignIn={jest.fn()} />,
    );
    const column = StyleSheet.flatten(
      view.getByTestId("intro-column").props.style,
    ) as { width?: number };
    expect(column.width).toBe(controls.introMaxWidth);
  });

  it("is the full width on a phone", async () => {
    setWindow(390, 844);
    const view = await render(
      <KathaOnboarding onFinish={jest.fn()} onSignIn={jest.fn()} />,
    );
    const column = StyleSheet.flatten(
      view.getByTestId("intro-column").props.style,
    ) as { width?: number };
    expect(column.width).toBe(390);
  });

  it("scrolls on a short window instead of pressing Get started onto the copy", async () => {
    setWindow(1280, 640);
    const view = await render(
      <KathaOnboarding onFinish={jest.fn()} onSignIn={jest.fn()} />,
    );
    // The sheet keeps its fixed slots' height however short the window is,
    // and the page it sits in is a scroll view sized to at least the window.
    const sheet = StyleSheet.flatten(
      view.getByTestId("intro-sheet").props.style,
    ) as { minHeight?: number };
    expect(sheet.minHeight).toBeGreaterThanOrEqual(322);
    const page = view.getByTestId("intro-page");
    expect(page.type).toBe("RCTScrollView");
    const content = StyleSheet.flatten(page.props.contentContainerStyle) as {
      minHeight?: number;
    };
    expect(content.minHeight).toBe(640);
  });

  it("gives each 6pt dot a 44pt touch target", async () => {
    const view = await render(
      <KathaOnboarding onFinish={jest.fn()} onSignIn={jest.fn()} />,
    );
    const dot = StyleSheet.flatten(
      view.getByLabelText("Show publish intro").props.style,
    ) as { height?: number };
    expect(dot.height).toBeGreaterThanOrEqual(44);
  });
});
