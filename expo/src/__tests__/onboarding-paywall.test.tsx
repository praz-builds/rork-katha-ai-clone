/**
 * The one paywall, tested on what it sells rather than on how it looks.
 *
 * The screens this replaces both got the selling wrong in ways a render test
 * would have caught: one led with a $49.99 yearly card whose CTA said "Create
 * my story" (so the button did not say what the money bought), and both kept a
 * duration selected while the CTA described a different one.
 *
 * The 2026-09-11 hand-off then removed the free trial, monthly and the More
 * options disclosure from this screen. Those removals are asserted negatively
 * here — "trial" and "monthly" must not be rendered at all — because the way
 * they come back is a well-meaning edit to a card, not a decision anybody
 * records.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking, Platform } from "react-native";

const mockGetOfferings = jest.fn();
const mockPurchasePackage = jest.fn();
const mockPresentCustomerCenter = jest.fn();
/** What the service reports after a purchase attempt. Mutable per test. */
const mockRevenueCatState: {
  premium: boolean;
  available: boolean;
  reason: string | undefined;
} = { premium: false, available: false, reason: undefined };
const mockRestorePurchases = jest.fn();
const mockActivate = jest.fn();

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/lib/revenuecat", () => ({
  revenueCatService: {
    // No offering: the off-store path, which is what review and web walk.
    getOfferings: (...args: unknown[]) => mockGetOfferings(...args),
    purchasePackage: (...args: unknown[]) => mockPurchasePackage(...args),
    presentCustomerCenter: (...args: unknown[]) => mockPresentCustomerCenter(...args),
    restorePurchases: (...args: unknown[]) => mockRestorePurchases(...args),
    get isPremium() {
      return mockRevenueCatState.premium;
    },
    get isAvailable() {
      return mockRevenueCatState.available;
    },
    get unavailableReason() {
      return mockRevenueCatState.reason;
    },
    activate: (...args: unknown[]) => mockActivate(...args),
    profile: null,
    subscribe: () => () => undefined,
  },
}));

/* eslint-disable import/first */
import {
  cancelLine,
  OnboardingPaywall,
  renewalLine,
} from "@/components/onboarding/OnboardingPaywall";
import { TESTIMONIALS } from "@/data/testimonials";
import i18n from "@/i18n";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
/* eslint-enable import/first */

let mockOpenURL: jest.SpyInstance;

async function renderPaywall(
  overrides: Partial<React.ComponentProps<typeof OnboardingPaywall>> = {},
) {
  const onSubscribed = jest.fn();
  const onDismiss = jest.fn();
  const view = await render(
    <OnboardingPaywall
      characterName="Mira"
      portraitUrl={null}
      purpose="write"
      onSubscribed={onSubscribed}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return { view, onSubscribed, onDismiss };
}

/** Every string in the rendered tree, in render order. */
function flatText(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(flatText);
  if (node && typeof node === "object" && "children" in node) {
    return flatText((node as { children: unknown }).children);
  }
  return [];
}

beforeEach(() => {
  mockGetOfferings.mockReset().mockResolvedValue(null);
  mockPurchasePackage.mockReset();
  mockPresentCustomerCenter.mockReset().mockResolvedValue(true);
  mockRevenueCatState.premium = false;
  mockRevenueCatState.available = false;
  mockRevenueCatState.reason = undefined;
  mockActivate.mockReset().mockResolvedValue(undefined);
  mockRestorePurchases.mockReset().mockResolvedValue(null);
  mockOpenURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

afterEach(() => {
  mockOpenURL.mockRestore();
});

/** Render as the Android build: the store the policy lines are written for. */
function asAndroid(): () => void {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
  return () =>
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
}

describe("OnboardingPaywall", () => {
  it("arrives on the yearly plan, with weekly beside it", async () => {
    const { view } = await renderPaywall();
    // The canonical prices, as the fallback the store has not overridden. The
    // period rides inside the price node, so the match is on the substring.
    expect(view.getAllByText(/\$59/)[0]).toBeTruthy();
    expect(view.getAllByText(/\$5\.99/)[0]).toBeTruthy();
    expect(view.getByText("SAVE 80%")).toBeTruthy();
    expect(view.getByText("20 credits a week")).toBeTruthy();

    const [weekly, yearly] = view.getAllByRole("radio");
    expect(weekly.props.accessibilityState.selected).toBe(false);
    expect(yearly.props.accessibilityState.selected).toBe(true);
  });

  it("moves the selection to weekly on a tap, and leaves the badge behind", async () => {
    const { view } = await renderPaywall();
    await fireEvent.press(view.getByText("WEEKLY"));

    const [weekly, yearly] = view.getAllByRole("radio");
    expect(weekly.props.accessibilityState.selected).toBe(true);
    expect(yearly.props.accessibilityState.selected).toBe(false);
    // The discount claim belongs to the yearly price, not to the selection.
    expect(view.getByText("SAVE 80%")).toBeTruthy();
  });

  it("names the product on the button, never a trial or a third duration", async () => {
    const { view } = await renderPaywall();
    expect(view.getByText("Unlock Katha")).toBeTruthy();
    // Replaced by the Subscriptions-policy line: it promised "no
    // commitments" on a plan paid a year up front, and never said it renews.
    expect(view.queryByText(/no commitments/)).toBeNull();
    // Removed 2026-09-11: no trial, no monthly, no More options disclosure.
    expect(view.queryByText(/trial/i)).toBeNull();
    expect(view.queryByText(/monthly/i)).toBeNull();
    expect(view.queryByText(/More options/i)).toBeNull();
    expect(view.queryByText("$12.99")).toBeNull();
  });

  it("promises only what we ship", async () => {
    const { view } = await renderPaywall();
    expect(view.getByText("50 credits a month")).toBeTruthy();
    expect(view.getByText("Unlimited portraits and reimagines")).toBeTruthy();
    expect(view.getByText("Premium voices")).toBeTruthy();
    expect(view.getByText("Download as PDF")).toBeTruthy();
    // The claims pricing struck out, and the trial-credit promise no grant issues.
    expect(view.queryByText(/Priority generation/)).toBeNull();
    expect(view.queryByText(/Trial gives you/)).toBeNull();
  });

  it("speaks the writer's copy for a writer", async () => {
    const { view } = await renderPaywall();
    expect(view.getByText("Mira is ready. Give them a story.")).toBeTruthy();
    expect(view.getByText("Hear Mira's story read aloud")).toBeTruthy();
    expect(view.getByText("Mira looks the same in every chapter")).toBeTruthy();
  });

  // "both" is a reader for copy purposes: somebody who reads and writes is
  // still being invited into the story, not handed a character to write for.
  it.each(["read", "both"] as const)(
    "speaks the reader's copy for purpose %s",
    async (purpose) => {
      const { view } = await renderPaywall({ purpose });
      expect(view.getByText("Mira is ready. Step into the story.")).toBeTruthy();
      expect(view.getByText("Hear your story read aloud")).toBeTruthy();
    },
  );

  it("drops the character entirely when there is not one", async () => {
    // The in-app entry from Home or Credits: no character, so no promise about
    // one. This is the case the old headline prop got wrong by passing a
    // character-voiced string with an empty name behind it.
    const { view } = await renderPaywall({ characterName: "", purpose: "read" });
    expect(view.getByText("Katha is ready when you are.")).toBeTruthy();
    expect(view.getByText("Hear your stories read aloud")).toBeTruthy();
    expect(view.getByText("Your characters look the same in every chapter")).toBeTruthy();
    // No character means no onboarding purpose to speak in: the in-app entry
    // is opened by writers and readers alike, so the sub names neither.
    expect(view.getByText("Unlock Katha and start tonight.")).toBeTruthy();
    expect(view.queryByText(/start (reading|writing) tonight/)).toBeNull();
    // And no lead is promised on the credits line: there is no character.
    expect(view.getByText("About 16 full chapters, every month")).toBeTruthy();
    expect(view.queryByText(/with you as the lead/)).toBeNull();
  });

  it("speaks to the reader as the character, not about a third person", async () => {
    const { view } = await renderPaywall({ purpose: "read" });
    expect(view.getByText("You look the same in every chapter")).toBeTruthy();
    expect(view.queryByText("Mira looks the same in every chapter")).toBeNull();
    expect(
      view.getByText("About 16 chapters with you as the lead, every month"),
    ).toBeTruthy();
    expect(view.getByText("Unlock Katha and start reading tonight.")).toBeTruthy();
    expect(view.queryByText(/start writing tonight/)).toBeNull();
  });

  it("keeps the writer's sub for a writer", async () => {
    const { view } = await renderPaywall();
    expect(view.getByText("Unlock Katha and start writing tonight.")).toBeTruthy();
    expect(view.getByText("About 16 full chapters, every month")).toBeTruthy();
  });

  it("leaves by the close and only by the close", async () => {
    const { view, onDismiss } = await renderPaywall();
    // Removed 2026-09-12: the quiet "Not now" sat directly under the CTA and
    // competed with it. One dismiss, in the top bar, from frame one.
    expect(view.queryByText("Not now")).toBeNull();
    await fireEvent.press(view.getByLabelText("Close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  /**
   * The yearly note is the price divided by 365, not a string anybody typed.
   * The literal it replaced ("$4.92 a month, billed yearly") outlived a
   * pricing change on this screen once already, which is the whole argument
   * for deriving it — so the old literal is asserted gone as well.
   */
  it("derives the yearly note from the yearly price", async () => {
    const { view } = await renderPaywall();
    expect(view.getByText("$0.16 a day")).toBeTruthy();
    expect(view.queryByText(/billed yearly/)).toBeNull();
    expect(view.queryByText("$4.92 a month, billed yearly")).toBeNull();
  });

  it("takes the daily figure and the currency from the store when there is an offering", async () => {
    // A non-US storefront: a different number AND a different symbol, on the
    // side that storefront puts it. A hardcoded "$0.16" passes the test above
    // and fails this one.
    mockGetOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          {
            packageType: "ANNUAL",
            product: { price: 73, priceString: "73,00 €" },
          },
        ],
      },
    });
    const { view } = await renderPaywall();
    await waitFor(() => expect(view.getAllByText(/73,00/)[0]).toBeTruthy());
    expect(view.getByText("0.20€ a day")).toBeTruthy();
  });

  it("shows all eight testimonials, after the benefits", async () => {
    const { view } = await renderPaywall();
    // One visible card per persona. Counting the names is what catches a
    // persona dropped from the data file.
    expect(TESTIMONIALS).toHaveLength(8);
    for (const item of TESTIMONIALS) {
      expect(view.getAllByText(item.name)).toHaveLength(1);
    }
    // The row is drawn twice for the marquee loop; the second copy is hidden
    // from assistive technology, which is why the names above count once each.
    expect(view.getByTestId("testimonial-rail-row")).toBeTruthy();
    expect(
      view.getByTestId("testimonial-rail-loop-copy", {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();

    // ORDER, asserted on the rendered tree rather than on a testID: the rail
    // moved below the benefits on 2026-09-12 because a screen that opens with
    // other people's habits has not yet said what it sells, and the way that
    // regresses is a block moved back up by somebody who never read this note.
    const text = flatText(view.toJSON());
    expect(text.indexOf("50 credits a month")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("50 credits a month")).toBeLessThan(
      text.indexOf(TESTIMONIALS[0].name),
    );
  });

  it("reports the weekly grant when weekly is the card that was chosen", async () => {
    const { view, onSubscribed } = await renderPaywall();
    await fireEvent.press(view.getByLabelText(/^weekly,/));
    await fireEvent.press(view.getByLabelText("Unlock Katha"));
    await waitFor(() =>
      expect(onSubscribed).toHaveBeenCalledWith({ credits: 20, plan: "weekly" })
    );
  });

  it("never grants premium off-store in a shipped build whose store answered with nothing", async () => {
    // The off-store completion below exists for review and for web. In a
    // production native build the same path would hand premium to anyone
    // whose offerings lookup failed -- no purchase, no receipt -- so there it
    // has to fail loudly instead.
    mockRevenueCatState.available = true;
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const { view, onSubscribed } = await renderPaywall();
      await fireEvent.press(view.getByLabelText("Unlock Katha"));
      await waitFor(() =>
        expect(view.getByText("Purchase didn't go through. Try again."))
          .toBeTruthy()
      );
      expect(onSubscribed).not.toHaveBeenCalled();
      expect(mockPurchasePackage).not.toHaveBeenCalled();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  /**
   * A shipped build with no RevenueCat key: what every Android user saw
   * before the key existed. It used to be a live button that answered every
   * tap with "Purchase didn't go through. Try again." -- a retry that could
   * never work. Now the button is off and the screen says why.
   */
  it("disables the button and says why when a shipped build has no store", async () => {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const { view, onSubscribed } = await renderPaywall();
      const button = view.getByLabelText("Unlock Katha");
      expect(button.props.accessibilityState.disabled).toBe(true);
      expect(
        view.getByText(
          "Subscriptions aren't available in this version of the app yet. Reading stays free.",
        ),
      ).toBeTruthy();
      await fireEvent.press(button);
      expect(onSubscribed).not.toHaveBeenCalled();
      expect(mockGetOfferings).toHaveBeenCalledTimes(1); // the price lookup, not a purchase
      expect(view.queryByText("Purchase didn't go through. Try again.")).toBeNull();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  it("treats a cancelled store sheet as a cancel, even once the entitlement reads premium", async () => {
    // `purchasePackage` resolves null on a user cancel. Before it did, it
    // resolved with the OLD profile, and a premium user who cancelled read as
    // a purchase: `isPremium` was true, so they were granted a plan they had
    // just declined. The entitlement is not the signal; the resolution is —
    // so the flag is flipped mid-attempt here, and the cancel still wins.
    mockGetOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          { packageType: "ANNUAL", product: { price: 59, priceString: "$59" } },
        ],
      },
    });
    mockPurchasePackage.mockImplementation(() => {
      mockRevenueCatState.premium = true;
      return Promise.resolve(null);
    });
    const { view, onSubscribed } = await renderPaywall();
    await waitFor(() => expect(view.getAllByText(/\$59/)[0]).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Unlock Katha"));
    await waitFor(() => expect(mockPurchasePackage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        view.getByLabelText("Unlock Katha").props.accessibilityState.busy,
      ).toBeFalsy()
    );
    expect(onSubscribed).not.toHaveBeenCalled();
    expect(view.queryByText("Purchase didn't go through. Try again.")).toBeNull();
  });

  // D7: a member who lands on the paywall is shown the plan they hold, not a
  // screen selling it to them again.
  it("shows a member state instead of the offer to somebody who already pays", async () => {
    mockRevenueCatState.premium = true;
    const { view } = await renderPaywall();

    await waitFor(() => expect(view.getByTestId("paywall-member-state")).toBeTruthy());
    expect(view.getByText("You're a Katha member")).toBeTruthy();
    expect(view.queryByLabelText("Unlock Katha")).toBeNull();
    expect(view.queryByText(/\$/)).toBeNull();

    await fireEvent.press(view.getByLabelText("Manage subscription"));
    await waitFor(() => expect(mockPresentCustomerCenter).toHaveBeenCalledTimes(1));
  });

  // Web, and any build where the SDK never configured: the Customer Center
  // cannot open, so the screen says where the subscription is managed instead
  // of leaving the button doing nothing.
  it("tells a member where to manage when the Customer Center cannot open", async () => {
    mockRevenueCatState.premium = true;
    mockPresentCustomerCenter.mockResolvedValue(false);
    const { view } = await renderPaywall();

    await waitFor(() => expect(view.getByTestId("paywall-member-state")).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Manage subscription"));
    // Native with no Customer Center: the store's own subscriptions page.
    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        "https://apps.apple.com/account/subscriptions",
      )
    );
  });

  // Customer Center is optional in the dashboard; when it throws, a member
  // used to get "not available right now" and no way to cancel.
  it("sends a member to the store when the Customer Center throws", async () => {
    mockRevenueCatState.premium = true;
    mockPresentCustomerCenter.mockRejectedValue(new Error("Customer Center not configured"));
    const { view } = await renderPaywall();

    await waitFor(() => expect(view.getByTestId("paywall-member-state")).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Manage subscription"));
    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions")
    );
    expect(view.queryByText(/not available right now/)).toBeNull();
  });

  it("completes off-store so the flow can be walked without RevenueCat", async () => {
    const { view, onSubscribed } = await renderPaywall();
    await fireEvent.press(view.getByLabelText("Unlock Katha"));
    await waitFor(() => expect(onSubscribed).toHaveBeenCalledTimes(1));
    // What was bought, not just that something was: the welcome animation
    // counts up to this number, and a boolean here sent a subscriber to a
    // screen celebrating the free grant of three.
    expect(onSubscribed).toHaveBeenCalledWith({ credits: 50, plan: "yearly" });
    expect(mockPurchasePackage).not.toHaveBeenCalled();
    // The button releases itself afterwards. Asserted rather than ignored so
    // the simulated path cannot leave a permanently busy CTA behind it.
    await waitFor(() =>
      expect(
        view.getByLabelText("Unlock Katha").props.accessibilityState.busy,
      ).toBe(false)
    );
  });

  /**
   * GOOGLE PLAY SUBSCRIPTIONS POLICY. The screen must state the price and
   * the period of the plan being bought, that it renews automatically, and
   * how to cancel -- beside the button -- and it must offer Restore, a way to
   * manage the subscription, and the Terms and Privacy documents.
   */
  it("states the selected plan's price, period, auto-renewal and where to cancel", async () => {
    const restore = asAndroid();
    try {
      const { view } = await renderPaywall();
      expect(view.getByTestId("paywall-renewal-terms")).toBeTruthy();
      expect(
        view.getByText(
          "$59 a year, renews automatically until you cancel. Cancel anytime in Google Play.",
        ),
      ).toBeTruthy();
      await fireEvent.press(view.getByLabelText(/^weekly,/));
      expect(
        view.getByText(
          "$5.99 a week, renews automatically until you cancel. Cancel anytime in Google Play.",
        ),
      ).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("uses the store's own price in the renewal line", async () => {
    mockGetOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          { packageType: "ANNUAL", product: { price: 4990, priceString: "₹4,990" } },
        ],
      },
    });
    const { view } = await renderPaywall();
    await waitFor(() =>
      expect(view.getByText(/^₹4,990 a year, renews automatically/)).toBeTruthy()
    );
  });

  it("offers Restore, Manage subscriptions, Terms and Privacy under the button", async () => {
    const restore = asAndroid();
    try {
      const { view } = await renderPaywall();
      await fireEvent.press(view.getByLabelText("Terms"));
      expect(mockOpenURL).toHaveBeenCalledWith(TERMS_URL);
      await fireEvent.press(view.getByLabelText("Privacy"));
      expect(mockOpenURL).toHaveBeenCalledWith(PRIVACY_URL);
      await fireEvent.press(view.getByLabelText("Manage subscriptions"));
      expect(mockOpenURL).toHaveBeenCalledWith(
        "https://play.google.com/store/account/subscriptions",
      );
    } finally {
      restore();
    }
  });

  it("restores through the store and says what it found", async () => {
    mockRevenueCatState.available = true;
    const { view } = await renderPaywall();
    await fireEvent.press(view.getByLabelText("Restore purchases"));
    await waitFor(() => expect(mockRestorePurchases).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByText("No active plan on this store account.")).toBeTruthy()
    );
    // Let the restore's own `finally` settle inside the test (no act() warning).
    await waitFor(() =>
      expect(view.getByLabelText("Unlock Katha").props.accessibilityState.busy).toBeFalsy()
    );
  });

  // CodeAnt: on web "Manage subscriptions" opened Google Play, a store the
  // page is not running in. Web says where to manage instead.
  it("does not send web to Google Play from Manage subscriptions", async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });
    try {
      const { view } = await renderPaywall();
      await fireEvent.press(view.getByLabelText("Manage subscriptions"));
      expect(mockOpenURL).not.toHaveBeenCalled();
      expect(view.getByText("Manage or cancel from the store you subscribed on.")).toBeTruthy();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
    }
  });

  /**
   * A keyed build that could not reach the store at start-up is offline, not
   * out of date: the copy says so, the button stays live, and a tap retries
   * the store before giving up.
   */
  it("blames the connection, not the version, when the store failed to start", async () => {
    mockRevenueCatState.reason = "failed";
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const { view, onSubscribed } = await renderPaywall();
      const offline = "Couldn't reach the store. Check your connection and try again.";
      expect(view.getByText(offline)).toBeTruthy();
      expect(view.queryByText(/in this version of the app/)).toBeNull();
      const button = view.getByLabelText("Unlock Katha");
      expect(button.props.accessibilityState.disabled).toBeFalsy();
      await fireEvent.press(button);
      await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(view.getAllByText(offline).length).toBeGreaterThan(0));
      expect(onSubscribed).not.toHaveBeenCalled();
      expect(mockPurchasePackage).not.toHaveBeenCalled();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  it("buys once the retried store comes up", async () => {
    mockRevenueCatState.reason = "failed";
    const annual = { packageType: "ANNUAL", product: { price: 59, priceString: "$59" } };
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [annual] } });
    mockActivate.mockImplementation(() => {
      mockRevenueCatState.available = true;
      return Promise.resolve();
    });
    mockPurchasePackage.mockResolvedValue(null);
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const { view } = await renderPaywall();
      await fireEvent.press(view.getByLabelText("Unlock Katha"));
      await waitFor(() =>
        expect(mockPurchasePackage).toHaveBeenCalledWith(annual, { basePlanOnly: true })
      );
      await waitFor(() =>
        expect(view.getByLabelText("Unlock Katha").props.accessibilityState.busy).toBeFalsy()
      );
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  it("buys the base plan, never a trial the card does not mention", async () => {
    mockRevenueCatState.available = true;
    const annual = { packageType: "ANNUAL", product: { price: 59, priceString: "$59" } };
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [annual] } });
    mockPurchasePackage.mockResolvedValue(null);
    const { view } = await renderPaywall();
    await waitFor(() => expect(view.getAllByText(/\$59/)[0]).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Unlock Katha"));
    await waitFor(() =>
      expect(mockPurchasePackage).toHaveBeenCalledWith(annual, { basePlanOnly: true })
    );
    await waitFor(() =>
      expect(view.getByLabelText("Unlock Katha").props.accessibilityState.busy).toBeFalsy()
    );
  });

  it("reads the default offering by id before the current one", async () => {
    mockGetOfferings.mockResolvedValue({
      current: {
        availablePackages: [
          { packageType: "ANNUAL", product: { price: 1, priceString: "$1" } },
        ],
      },
      all: {
        default: {
          availablePackages: [
            { packageType: "ANNUAL", product: { price: 59, priceString: "$59.00" } },
          ],
        },
      },
    });
    const { view } = await renderPaywall();
    await waitFor(() => expect(view.getAllByText(/\$59\.00/).length).toBeGreaterThan(0));
  });
});

describe("the policy lines in Portuguese and Spanish", () => {
  afterEach(() => {
    void i18n.changeLanguage("en");
  });

  it.each([
    ["pt", "R$ 299,90 por ano, renovação automática até você cancelar.", "Cancele quando quiser no Google Play."],
    ["es", "R$ 299,90 al año, se renueva automáticamente hasta que canceles.", "Cancela cuando quieras en Google Play."],
  ])("%s", async (lang, renews, cancel) => {
    await i18n.changeLanguage(lang);
    expect(renewalLine("yearly", "R$ 299,90")).toBe(renews);
    expect(cancelLine("android")).toBe(cancel);
  });
});
