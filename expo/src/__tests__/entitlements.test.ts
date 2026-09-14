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
  it("charges a subscriber the same as everyone else past the six", () => {
    // The plan used to buy unlimited portraits and the server enforced no such
    // thing. Since migration 00088 it enforces six for every account, so a
    // quote of "Included in your plan" would be this module promising what the
    // server is about to refuse.
    expect(portraitQuote({ usedOnAccount: 40 })).toEqual({
      free: false,
      label: "1 credit",
    });
  });

  it("counts down the free images rather than repeating 'free'", () => {
    expect(portraitQuote({ usedOnAccount: 0 }).label).toBe("6 free");
    expect(portraitQuote({ usedOnAccount: 5 }).label).toBe("1 free");
  });

  it("charges from the seventh image on", () => {
    expect(
      portraitQuote({ usedOnAccount: FREE_PORTRAITS_PER_ACCOUNT }),
    ).toEqual({ free: false, label: "1 credit" });
  });
});

// A guest holds the three bootstrap credits, so an affordability check alone
// says "yes" — and the server then refuses, because an anonymous identity may
// use its six and buy none. Quoting a price there hands somebody an enabled
// button that cannot work, which is the exact failure this quote exists for.
describe("portraitQuote for an anonymous identity", () => {
  it("offers no price once the six are gone, and says it cannot be bought", () => {
    const quote = portraitQuote({
      usedOnAccount: FREE_PORTRAITS_PER_ACCOUNT,
      isAnonymous: true,
    });
    expect(quote.free).toBe(false);
    expect(quote.requiresAccount).toBe(true);
    expect(quote.label).toMatch(/sign in/i);
  });

  it("still counts their free six the same way", () => {
    const quote = portraitQuote({ usedOnAccount: 4, isAnonymous: true });
    expect(quote.free).toBe(true);
    // Two left of six — a guest is not on a smaller allowance, only a
    // different wall at the end of it.
    expect(quote.label).toContain("2");
  });

  it("quotes a named user the price, not the wall", () => {
    const quote = portraitQuote({
      usedOnAccount: FREE_PORTRAITS_PER_ACCOUNT,
      isAnonymous: false,
    });
    expect(quote.free).toBe(false);
    expect(quote.requiresAccount).toBeUndefined();
  });
});
