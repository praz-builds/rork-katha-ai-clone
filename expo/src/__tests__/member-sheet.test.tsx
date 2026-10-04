/**
 * The member sheet is where Profile and Credits send a subscriber when the
 * Customer Center cannot open. Google Play's Subscriptions policy wants a
 * member to have a WORKING way to manage or cancel; the sheet used to end in
 * a plain line of text saying where to go.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Linking, Platform } from "react-native";

jest.mock("@/lib/revenuecat", () => ({
  revenueCatService: {
    profile: { activeSubscriptions: ["ai.katha.sub.yearly:yearly"] },
  },
}));

/* eslint-disable import/first */
import MemberSheet from "@/components/profile/MemberSheet";
/* eslint-enable import/first */

function withPlatform(os: string): () => void {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
  return () => Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
}

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

it("links an Android member to their Katha subscription in Google Play", async () => {
  const restore = withPlatform("android");
  try {
    const view = await render(<MemberSheet visible onClose={() => undefined} />);
    const link = view.getByTestId("member-sheet-manage");
    expect(view.getByText("Manage or cancel in Google Play")).toBeTruthy();
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith(
      "https://play.google.com/store/account/subscriptions?sku=ai.katha.sub.yearly&package=ai.katha.createstories",
    );
  } finally {
    restore();
  }
});

it("links an iOS member to Apple's subscriptions page", async () => {
  const view = await render(<MemberSheet visible onClose={() => undefined} />);
  await fireEvent.press(view.getByTestId("member-sheet-manage"));
  expect(openURL).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions");
});

it("keeps web to a line, with no link to a store it is not running in", async () => {
  const restore = withPlatform("web");
  try {
    const view = await render(<MemberSheet visible onClose={() => undefined} />);
    expect(view.queryByTestId("member-sheet-manage")).toBeNull();
    expect(view.getByText("Manage or cancel any time from the store you subscribed on.")).toBeTruthy();
  } finally {
    restore();
  }
});

it("shows a trial member their plan, that it is a trial, and when it ends", async () => {
  const view = await render(
    <MemberSheet
      visible
      onClose={() => undefined}
      profile={{
        entitlements: {
          active: {
            katha: {
              productIdentifier: "ai.katha.sub.yearly:yearly",
              periodType: "TRIAL",
              expirationDate: "2026-10-07T10:00:00Z",
              willRenew: true,
            },
          },
        },
      }}
    />,
  );
  expect(view.getByTestId("member-sheet-plan")).toBeTruthy();
  expect(view.getByText("Yearly plan")).toBeTruthy();
  expect(view.getByTestId("member-sheet-status").props.children).toMatch(/^Free trial until /);
  expect(view.getByText("50 credits a month")).toBeTruthy();
});

it("gives a weekly member the weekly grant", async () => {
  const view = await render(
    <MemberSheet
      visible
      onClose={() => undefined}
      profile={{
        entitlements: {
          active: {
            katha: {
              productIdentifier: "ai.katha.sub.weekly:weekly",
              periodType: "NORMAL",
              expirationDate: "2026-10-11T10:00:00Z",
              willRenew: true,
            },
          },
        },
      }}
    />,
  );
  expect(view.getByText("Weekly plan")).toBeTruthy();
  expect(view.getByText("20 credits a week")).toBeTruthy();
  expect(view.queryByText("50 credits a month")).toBeNull();
});
