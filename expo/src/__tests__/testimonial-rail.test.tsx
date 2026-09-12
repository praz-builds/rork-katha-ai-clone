/**
 * The rail, tested on the two things that make it a rail rather than a row.
 *
 * 1. The row is rendered TWICE. That duplication is the whole loop: when the
 *    first copy has translated fully off, the second one is exactly where the
 *    first started, so there is no seam and no visible reset. Somebody
 *    "cleaning up" the second copy is the single most likely way this breaks,
 *    and it breaks invisibly in a simulator with reduced motion on.
 * 2. Reduced motion is a real `ScrollView`, not a slower animation. The rule in
 *    `.agents/skills/expo-animation` is that reduced motion ships with the
 *    animation; asserting it here is what stops it from being a follow-up.
 */
import React from "react";
import { render } from "@testing-library/react-native";

const mockReducedMotion = jest.fn(() => false);

jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated/mock");
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    useReducedMotion: () => mockReducedMotion(),
  };
});

/* eslint-disable import/first */
import { TestimonialRail } from "@/components/onboarding/TestimonialRail";
import { TESTIMONIALS } from "@/data/testimonials";
/* eslint-enable import/first */

beforeEach(() => {
  mockReducedMotion.mockReturnValue(false);
});

describe("TestimonialRail", () => {
  it("renders every testimonial with its name and quote", async () => {
    const view = await render(<TestimonialRail items={TESTIMONIALS.slice(0, 2)} />);
    for (const item of TESTIMONIALS.slice(0, 2)) {
      expect(view.getAllByText(item.name).length).toBeGreaterThan(0);
      expect(view.getAllByText(item.quote).length).toBeGreaterThan(0);
    }
  });

  /**
   * The use-case eyebrow was removed on 2026-09-12: it restated the quote
   * underneath it and cost the card the height that made the quote readable.
   * Asserted on the old strings themselves, because the way an eyebrow comes
   * back is somebody re-adding a field to the data file, and a test that only
   * counted nodes would pass through that.
   */
  it("carries no use-case tag over the quote", async () => {
    const view = await render(<TestimonialRail items={TESTIMONIALS.slice(0, 3)} />);
    const hidden = { includeHiddenElements: true } as const;
    for (const gone of [
      "Plays himself in RPG stories",
      "Bedtime stories for two",
      "Listens on the commute",
    ]) {
      expect(view.queryByText(gone, hidden)).toBeNull();
    }
    // And the card reads to a screen reader as the two things it now holds.
    const [first] = view.getAllByRole("listitem");
    expect(first.props.accessibilityLabel).toBe(
      `${TESTIMONIALS[0].name}. ${TESTIMONIALS[0].quote}`,
    );
  });

  it("draws the row twice so the loop has no seam", async () => {
    const view = await render(<TestimonialRail items={TESTIMONIALS.slice(0, 3)} />);
    expect(view.getByTestId("testimonial-rail-row")).toBeTruthy();
    // The loop copy is hidden from assistive technology, so it only exists for
    // a query that asks for hidden elements. That IS the assertion: a screen
    // reader must not read six testimonials for three, and the second copy
    // must still be on screen for the eye.
    const hidden = { includeHiddenElements: true } as const;
    expect(view.getByTestId("testimonial-rail-loop-copy", hidden)).toBeTruthy();
    expect(view.getAllByText(TESTIMONIALS[0].quote, hidden)).toHaveLength(2);
    expect(view.getAllByText(TESTIMONIALS[0].quote)).toHaveLength(1);
  });

  it("is one list of listitems", async () => {
    const view = await render(<TestimonialRail items={TESTIMONIALS.slice(0, 2)} />);
    const rail = view.getByTestId("testimonial-rail");
    expect(rail.props.accessibilityRole).toBe("list");
    expect(view.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("becomes a plain scroll view under reduced motion", async () => {
    mockReducedMotion.mockReturnValue(true);
    const view = await render(<TestimonialRail items={TESTIMONIALS.slice(0, 3)} />);
    expect(view.getByTestId("testimonial-rail-static")).toBeTruthy();
    expect(view.queryByTestId("testimonial-rail")).toBeNull();
    // One copy only: nothing is looping, so the duplicate would just be three
    // more cards to scroll past.
    expect(view.getAllByText(TESTIMONIALS[0].quote)).toHaveLength(1);
  });
});
