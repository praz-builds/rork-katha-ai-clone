/**
 * Get credits (D8, D9, D10), tested on what it promises rather than on layout.
 *
 * This is a money screen, and the failures that matter here are all the same
 * shape: a number on it that nothing on the server agrees with. The seeded
 * three-row ledger this screen used to render was exactly that, so the ledger
 * assertions below are about provenance -- the rows come from the `ledger`
 * action and from nowhere else, and a failed read says so instead of showing
 * a plausible history.
 *
 * The other two are entitlement mistakes: sending a paying member to a
 * paywall, and offering a Purchase button on web, where RevenueCat is
 * disabled and the tap cannot go anywhere.
 */
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockFetchOwnProfile = jest.fn();
const mockFetchLedger = jest.fn();
const mockFetchCreditClaims = jest.fn();
const mockBootstrapUser = jest.fn();
const mockPresentCustomerCenter = jest.fn();
const mockFindPackageByProductId = jest.fn();
const mockPurchasePackage = jest.fn();
const revenueCatState = { premium: false, available: true };

jest.mock("react-native-safe-area-context", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/lib/session", () => ({
  bootstrapUser: (...args: unknown[]) => mockBootstrapUser(...args),
}));
jest.mock("@/lib/profile", () => {
  const actual = jest.requireActual("@/lib/profile");
  return {
    ...actual,
    fetchOwnProfile: (...args: unknown[]) => mockFetchOwnProfile(...args),
    fetchLedger: (...args: unknown[]) => mockFetchLedger(...args),
  };
});
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    fetchCreditClaims: (...args: unknown[]) => mockFetchCreditClaims(...args),
  };
});
jest.mock("@/lib/revenuecat", () => ({
  revenueCatService: {
    get isPremium() {
      return revenueCatState.premium;
    },
    get isAvailable() {
      return revenueCatState.available;
    },
    subscribe: () => () => undefined,
    presentCustomerCenter: (...args: unknown[]) => mockPresentCustomerCenter(...args),
    findPackageByProductId: (...args: unknown[]) => mockFindPackageByProductId(...args),
    purchasePackage: (...args: unknown[]) => mockPurchasePackage(...args),
  },
}));

/* eslint-disable import/first */
import CreditsScreen from "@/screens/CreditsScreen";
import { WEB_PURCHASE_NOTE } from "@/components/credits/CreditPacksSheet";
import { CREDIT_PACKS } from "@/lib/pricing";
import { ownProfile } from "@/test-support/profileFixtures";
/* eslint-enable import/first */

const props = () => ({
  credits: 7,
  onBack: jest.fn(),
  onPaywall: jest.fn(),
  onJourney: jest.fn(),
  onBalance: jest.fn(),
});

beforeEach(() => {
  revenueCatState.premium = false;
  revenueCatState.available = true;
  mockFetchOwnProfile.mockReset().mockResolvedValue(ownProfile({ currentStreak: 3 }));
  mockFetchLedger.mockReset().mockResolvedValue([]);
  mockFetchCreditClaims.mockReset().mockResolvedValue({
    claims: [],
    remaining: { today: 1, month: 6 },
  });
  mockBootstrapUser.mockReset().mockResolvedValue(null);
  mockPresentCustomerCenter.mockReset().mockResolvedValue(true);
  mockFindPackageByProductId.mockReset().mockResolvedValue(null);
  mockPurchasePackage.mockReset().mockResolvedValue(null);
});

afterEach(cleanup);

it("lays out paid options, the explanation, the free ways and the history", async () => {
  const view = await render(<CreditsScreen {...props()} />);

  await waitFor(() => view.getByTestId("credits-plus"));
  // The balance the app holds, in the pill.
  expect(view.getByTestId("credits-balance")).toBeTruthy();
  expect(view.getByText("7")).toBeTruthy();
  for (const section of ["Paid options", "How credits work", "Free credits", "History"]) {
    expect(view.getByText(section)).toBeTruthy();
  }
  expect(view.getByTestId("credits-packs")).toBeTruthy();
  expect(view.getByTestId("how-credits-work")).toBeTruthy();
  expect(view.getByTestId("credits-streak")).toBeTruthy();
  expect(view.getByTestId("credits-feedback")).toBeTruthy();
  expect(view.getByTestId("credits-invite")).toBeTruthy();
});

// D7: the row never sends somebody who already pays to a screen selling it.
it("takes a free account to the paywall", async () => {
  const free = props();
  const view = await render(<CreditsScreen {...free} />);
  await waitFor(() => view.getByTestId("credits-plus"));
  fireEvent.press(view.getByTestId("credits-plus"));
  expect(free.onPaywall).toHaveBeenCalledTimes(1);
  expect(mockPresentCustomerCenter).not.toHaveBeenCalled();
});

it("takes a member to the customer center, never to the paywall", async () => {
  revenueCatState.premium = true;
  const member = props();
  const view = await render(<CreditsScreen {...member} />);
  await waitFor(() => view.getByTestId("credits-plus"));
  expect(view.getByText("You're a Katha member")).toBeTruthy();
  fireEvent.press(view.getByTestId("credits-plus"));
  await waitFor(() => expect(mockPresentCustomerCenter).toHaveBeenCalledTimes(1));
  expect(member.onPaywall).not.toHaveBeenCalled();
});

// D2: the rung and its payout are the server's ladder, read through the
// profile, not a constant this card keeps for itself.
it("names the next streak rung and what it pays", async () => {
  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("credits-streak"));
  // Day 3 of a streak: the next rung is 5, paying 4.
  expect(view.getByTestId("credits-next-rung").props.children.join("")).toBe("+4");
  expect(view.getByText("credits at day 5")).toBeTruthy();
  expect(view.getByText("Read or write every day. Up to 30 credits across the ladder.")).toBeTruthy();
});

// D8: five packs, from the store when it has them and from the canonical
// list when it does not, and on web the button says so rather than failing
// on the tap.
it("opens the packs sheet and disables purchase where the store cannot be reached", async () => {
  revenueCatState.available = false;
  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("credits-packs"));
  fireEvent.press(view.getByTestId("credits-packs"));

  await waitFor(() => view.getByTestId("credit-packs-purchase"));
  for (const pack of CREDIT_PACKS) {
    expect(view.getByTestId(`credit-pack-${pack.credits}`)).toBeTruthy();
    expect(view.getByText(pack.fallbackPrice)).toBeTruthy();
  }
  const button = view.getByTestId("credit-packs-purchase");
  expect(button.props.accessibilityState.disabled).toBe(true);
  expect(view.getByText(WEB_PURCHASE_NOTE)).toBeTruthy();
  // The store was never asked, because it cannot answer.
  expect(mockFindPackageByProductId).not.toHaveBeenCalled();
});

// A purchase in flight is BUSY, which is a different fact from a purchase
// that is unavailable. The refactor to the shared Button passed only
// `disabled`, so mid-purchase a screen reader heard "dimmed" and could not
// tell a charge being processed from a button that was never live.
it("announces a purchase in flight as busy, not merely disabled", async () => {
  mockFindPackageByProductId.mockImplementation(async (sku: string) => ({
    identifier: sku,
    product: { identifier: sku, priceString: "$4.99", price: 4.99 },
  }));
  let settle: (() => void) | undefined;
  mockPurchasePackage.mockImplementation(
    () => new Promise<null>((resolve) => { settle = () => resolve(null); }),
  );

  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("credits-packs"));
  fireEvent.press(view.getByTestId("credits-packs"));
  await waitFor(() =>
    expect(view.getByTestId("credit-packs-purchase").props.accessibilityState.disabled)
      .toBe(false)
  );

  fireEvent.press(view.getByTestId("credit-packs-purchase"));
  await waitFor(() => {
    const state = view.getByTestId("credit-packs-purchase").props.accessibilityState;
    expect(state.busy).toBe(true);
    expect(state.disabled).toBe(true);
  });

  settle?.();
  await waitFor(() =>
    expect(view.getByTestId("credit-packs-purchase").props.accessibilityState.busy).toBe(false)
  );
});

// The whole point of the ledger rewrite: these rows exist on the server or
// they are not shown at all.
it("renders the ledger rows the server returned", async () => {
  mockFetchLedger.mockResolvedValue([
    { id: "l1", amount: 2, reason: "streak", createdAt: "2026-09-08T00:00:00Z" },
    { id: "l2", amount: -1, reason: "chapter", createdAt: "2026-09-07T00:00:00Z" },
  ]);
  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("ledger"));
  expect(view.getByText("+2")).toBeTruthy();
  expect(view.getByText("-1")).toBeTruthy();
});

it("says the history could not be read rather than showing a plausible one", async () => {
  mockFetchLedger.mockRejectedValue(new Error("offline"));
  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("ledger-unavailable"));
  expect(view.queryByTestId("ledger")).toBeNull();
});

// D10: the code is the server's, shown only once it exists.
it("shows the invite code the profile carries", async () => {
  mockFetchOwnProfile.mockResolvedValue(
    ownProfile({
      referralCode: "ada42",
      referral: { invited: 2, credited: 1, monthRemaining: 2 },
    }),
  );
  const view = await render(<CreditsScreen {...props()} />);
  await waitFor(() => view.getByTestId("credits-invite-code"));
  expect(view.getByTestId("credits-invite-code").props.children).toBe("ada42");
  expect(view.getByTestId("credits-invite-share")).toBeTruthy();
});
