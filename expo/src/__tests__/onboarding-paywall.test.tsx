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

const mockGetOfferings = jest.fn();
const mockPurchasePackage = jest.fn();

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/lib/revenuecat", () => ({
  revenueCatService: {
    // No offering: the off-store path, which is what review and web walk.
    getOfferings: (...args: unknown[]) => mockGetOfferings(...args),
    purchasePackage: (...args: unknown[]) => mockPurchasePackage(...args),
    isPremium: false,
    subscribe: () => () => undefined,
  },
}));

/* eslint-disable import/first */
import { OnboardingPaywall } from "@/components/onboarding/OnboardingPaywall";
import { TESTIMONIALS } from "@/data/testimonials";
/* eslint-enable import/first */

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
});

describe("OnboardingPaywall", () => {
  it("arrives on the yearly plan, with weekly beside it", async () => {
    const { view } = await renderPaywall();
    // The canonical prices, as the fallback the store has not overridden. The
    // period rides inside the price node, so the match is on the substring.
    expect(view.getByText(/\$59/)).toBeTruthy();
    expect(view.getByText(/\$5\.99/)).toBeTruthy();
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
    expect(view.getByText("Cancel anytime, no commitments")).toBeTruthy();
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
    expect(view.getByText("Unlock Katha and start writing tonight.")).toBeTruthy();
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
    await waitFor(() => expect(view.getByText(/73,00/)).toBeTruthy());
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

  it("never grants premium off-store in a shipped build", async () => {
    // The off-store completion below exists for review and for web. In a
    // production native build the same path would hand premium to anyone
    // whose offerings lookup failed -- no purchase, no receipt -- so there it
    // has to fail loudly instead.
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
});
