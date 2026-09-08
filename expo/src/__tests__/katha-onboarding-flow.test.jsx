/* global jest, describe, it, expect */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("@/lib/revenuecat", () => ({
  revenueCatService: { presentPaywall: jest.fn() },
}));

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

jest.mock("@/components/BrandWordmark", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return function BrandWordmark() {
    return React.createElement(Text, null, "Katha");
  };
});

/* eslint-disable import/first */
import KathaOnboardingFlowV2, {
  MIN_GENRE_SELECTIONS,
} from "@/screens/KathaOnboardingFlowV2";
/* eslint-enable import/first */

describe("KathaOnboardingFlowV2", () => {
  it("asks name, genres, purpose, then writer setup before opening writer onboarding", async () => {
    const onWriterPath = jest.fn();
    const view = await render(<KathaOnboardingFlowV2 onWriterPath={onWriterPath} />);

    expect(view.getByText("First, what should we call you?")).toBeTruthy();
    await fireEvent.changeText(view.getByPlaceholderText("Your first name"), "Nikita");
    await fireEvent.press(view.getByText("Continue"));

    expect(
      await view.findByText("Nice to meet you, Nikita. What worlds pull you in?"),
    ).toBeTruthy();
    await fireEvent.press(view.getByLabelText("Mystery genre"));
    await fireEvent.press(view.getByLabelText("Fantasy genre"));
    await fireEvent.press(view.getByLabelText("Adventure genre"));
    await fireEvent.press(await view.findByText("Continue with 3"));

    expect(view.getByText("What brings you to Katha?")).toBeTruthy();
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    expect(onWriterPath).not.toHaveBeenCalled();

    expect(view.getByText("What do you want to write?")).toBeTruthy();
    await fireEvent.press(view.getByText("A full novel"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("What usually stops you?")).toBeTruthy();
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Continue"));

    expect(onWriterPath).toHaveBeenCalledWith({
      initialGenre: "mystery",
      onboarding: {
        name: "Nikita",
        genres: ["Mystery", "Fantasy", "Adventure"],
        otherGenre: "",
        purpose: "write",
        refine: "novel",
        moment: "chapters",
      },
    });
  });

  it("gates the genre screen's Continue button on MIN_GENRE_SELECTIONS, and states that same number in the helper copy", async () => {
    expect(MIN_GENRE_SELECTIONS).toBe(3);

    const view = await render(
      <KathaOnboardingFlowV2 initialScreen="genres" />,
    );

    // The helper copy and the zero-selection CTA both name the constant, not
    // a hardcoded number that could drift from it.
    expect(
      view.getByText(
        `Pick at least ${MIN_GENRE_SELECTIONS} and we'll build your shelf around them.`,
      ),
    ).toBeTruthy();
    expect(view.getByText(`Pick at least ${MIN_GENRE_SELECTIONS}`)).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Mystery genre"));
    await fireEvent.press(view.getByLabelText("Fantasy genre"));
    // One short of the threshold: the CTA counts down, it does not enable.
    expect(view.getByText("Pick 1 more")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Adventure genre"));
    expect(
      view.getByText(`Continue with ${MIN_GENRE_SELECTIONS}`),
    ).toBeTruthy();
  });
});
