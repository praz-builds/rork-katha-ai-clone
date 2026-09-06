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
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
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
    await fireEvent.press(await view.findByText("Continue with 2"));

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
        genres: ["Mystery", "Fantasy"],
        otherGenre: "",
        purpose: "write",
        refine: "novel",
        moment: "chapters",
      },
    });
  });
});
