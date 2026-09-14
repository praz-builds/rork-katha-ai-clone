/**
 * The client's view of how many free character images are left.
 *
 * Every case here is one where showing the wrong number costs money or trust:
 * a count that outlives the account it belonged to, an older answer raising one
 * a newer answer lowered, and a failed read erasing what we already knew.
 */
import {
  clearCharacterImagesRemaining,
  getCharacterImagesRemaining,
  observeCharacterImagesRemaining,
  setCharacterImagesRemaining,
} from "@/lib/character-image-allowance";

afterEach(() => {
  clearCharacterImagesRemaining();
});

describe("observeCharacterImagesRemaining", () => {
  it("takes a lower answer, because the six only go down while spending", () => {
    setCharacterImagesRemaining(4);
    observeCharacterImagesRemaining(3);
    expect(getCharacterImagesRemaining()).toBe(3);
  });

  it("ignores an older answer that would raise the count", () => {
    setCharacterImagesRemaining(4);
    // Two requests in flight: the one that left first lands second, still
    // believing four were left. Applied, the next portrait would read free
    // when it is not.
    observeCharacterImagesRemaining(5);
    expect(getCharacterImagesRemaining()).toBe(4);
  });

  it("accepts the first answer it is ever given", () => {
    expect(getCharacterImagesRemaining()).toBeNull();
    observeCharacterImagesRemaining(6);
    expect(getCharacterImagesRemaining()).toBe(6);
  });

  it("lets bootstrap raise it, which is how a sign-in or top-up lands", () => {
    setCharacterImagesRemaining(0);
    // `set`, not `observe` — a genuinely new identity is not a stale response.
    setCharacterImagesRemaining(6);
    expect(getCharacterImagesRemaining()).toBe(6);
  });
});

describe("clearing", () => {
  it("leaves nothing behind for the next identity to read", () => {
    setCharacterImagesRemaining(2);
    clearCharacterImagesRemaining();
    // Null renders no price at all, which is what we want in the window
    // before the new session's bootstrap answers: a guest must not see, or
    // spend against, the count of the account that just signed out.
    expect(getCharacterImagesRemaining()).toBeNull();
  });
});
