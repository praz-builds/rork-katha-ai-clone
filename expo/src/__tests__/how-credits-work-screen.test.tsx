/**
 * How credits work, as its own screen.
 *
 * WHAT THIS IS GUARDING. Profile used to point two rows at one destination:
 * "Credits, get more" and "How credits work" both opened Get credits, at the
 * top, which leads with Paid options. The row that promised an explanation
 * answered with a shop. The split is only worth anything if this screen
 * actually carries the prices and carries nothing to buy, so both halves are
 * asserted -- a regression that quietly reintroduced a purchase control here
 * would rebuild the problem without failing any other test.
 *
 * The prices themselves are `HowCreditsWork`'s, lifted from
 * `source-of-truth/CREDITS_AND_PRICING.md` §1; this file does not restate them
 * and should not, or a price change would have to be made in three places.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/* eslint-disable import/first */
import HowCreditsWorkScreen from "@/screens/HowCreditsWorkScreen";
import { PRICE_ROWS } from "@/components/credits/HowCreditsWork";
/* eslint-enable import/first */

afterEach(cleanup);

it("shows the prices under its own heading", async () => {
  const view = await render(<HowCreditsWorkScreen onBack={jest.fn()} />);

  // A heading, so the screen's one landmark is reachable from the rotor. It
  // was plain text, which on a screen that is nothing but a title and a price
  // list left heading navigation with nowhere to go at all.
  expect(view.getByText("How credits work").props.accessibilityRole).toBe("header");
  expect(view.getByTestId("how-credits-work-screen")).toBeTruthy();
  expect(view.getByTestId("how-credits-work")).toBeTruthy();
  // Every priced action the document lists reaches the screen. Asserting the
  // labels rather than a count means an added row has to actually render.
  for (const row of PRICE_ROWS) {
    expect(view.getByText(row.label)).toBeTruthy();
  }
});

it("has nothing to buy on it", async () => {
  const view = await render(<HowCreditsWorkScreen onBack={jest.fn()} />);

  for (const bought of ["credits-plus", "credits-packs", "credits-balance"]) {
    expect(view.queryByTestId(bought)).toBeNull();
  }
});

it("goes back", async () => {
  const onBack = jest.fn();
  const view = await render(<HowCreditsWorkScreen onBack={onBack} />);

  fireEvent.press(view.getByLabelText("Back"));
  expect(onBack).toHaveBeenCalledTimes(1);
});

// Where Back goes is not this screen's decision and so is not tested here.
// The screen is reachable from Profile's row and from Get credits' secondary
// button; `returnTo` on the `how-credits-work` Screen variant is a required
// field, so the compiler makes both call sites state which, and App.tsx
// branches on it. A missing case is a typecheck failure, which is a stronger
// guarantee than an assertion here would be.
