/**
 * The quotes the paywall's promises turn into.
 *
 * Every one of these was a string literal at a call site before: "1 credit" on
 * the reimagine sheet whatever the user had bought, and nothing at all on the
 * portrait button. A subscriber was quoted a price they do not pay, and a free
 * account spent its fifth portrait credit unquoted. The point of the module is
 * that the paywall's row and the button's price come out of the same function,
 * so these assertions are the contract between the two screens.
 */
jest.mock("@/lib/revenuecat", () => ({
  // The real module imports react-native-purchases, whose native side does not
  // exist under Jest. Nothing here needs the SDK: these are pure quotes.
  revenueCatService: { isPremium: false, subscribe: () => () => undefined },
}));

import {
  FREE_PORTRAITS_PER_ACCOUNT,
  FREE_REIMAGINES_PER_CHAPTER,
  portraitQuote,
  reimagineQuote,
} from "@/lib/entitlements";

describe("reimagineQuote", () => {
  it("costs a subscriber nothing and says so in plan language", () => {
    expect(reimagineQuote({ subscribed: true, usedOnChapter: 9 })).toEqual({
      free: true,
      label: "Included in your plan",
    });
  });

  it("gives a free account its first reimagine on this chapter", () => {
    expect(reimagineQuote({ subscribed: false, usedOnChapter: 0 })).toEqual({
      free: true,
      label: "1 free",
    });
  });

  it("charges once the chapter's free reimagine is spent", () => {
    expect(
      reimagineQuote({ subscribed: false, usedOnChapter: FREE_REIMAGINES_PER_CHAPTER }),
    ).toEqual({ free: false, label: "1 credit" });
  });

  it("still charges when the count has overrun the allowance", () => {
    expect(reimagineQuote({ subscribed: false, usedOnChapter: 12 }).free).toBe(false);
  });
});

describe("portraitQuote", () => {
  it("costs a subscriber nothing", () => {
    expect(portraitQuote({ subscribed: true, usedOnAccount: 40 })).toEqual({
      free: true,
      label: "Included in your plan",
    });
  });

  it("counts down the free portraits rather than repeating 'free'", () => {
    expect(portraitQuote({ subscribed: false, usedOnAccount: 0 }).label).toBe("4 free");
    expect(portraitQuote({ subscribed: false, usedOnAccount: 3 }).label).toBe("1 free");
  });

  it("charges from the fifth portrait on", () => {
    expect(
      portraitQuote({ subscribed: false, usedOnAccount: FREE_PORTRAITS_PER_ACCOUNT }),
    ).toEqual({ free: false, label: "1 credit" });
  });
});
