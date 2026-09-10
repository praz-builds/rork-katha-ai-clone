/**
 * The invitation to write another story.
 *
 * Two visual variants exist while the product owner picks one, and the point
 * of building them behind a single constant is that the choice is only ever
 * about the surface: the copy, the one tap target, the accessible name and the
 * action must be identical in both, or the screenshots are not comparable.
 * That is what these tests hold.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import WriteAnotherCTA, {
  WRITE_CTA_VARIANT,
  type WriteAnotherVariant,
} from "@/components/feed/WriteAnotherCTA";

const VARIANTS: WriteAnotherVariant[] = ["gradient", "editorial"];

it.each(VARIANTS)("says the same thing in the %s variant", async (variant) => {
  const view = await render(
    <WriteAnotherCTA onPress={() => {}} tone={variant === "gradient" ? "loud" : "quiet"} />,
  );

  expect(view.getByText("Write another story")).toBeTruthy();
  expect(view.getByText("A genre, a name, one idea. Katha writes the rest."))
    .toBeTruthy();
  expect(view.getByLabelText("Write another story")).toBeTruthy();
});

it.each(VARIANTS)("is one tap target in the %s variant", async (variant) => {
  const onPress = jest.fn();
  const view = await render(
    <WriteAnotherCTA onPress={onPress} tone={variant === "gradient" ? "loud" : "quiet"} />,
  );

  // One target, not a card plus a button plus a chevron: a screen reader must
  // not hear the same action announced twice.
  const targets = view.getAllByLabelText("Write another story");
  expect(targets).toHaveLength(1);

  fireEvent.press(targets[0]);
  expect(onPress).toHaveBeenCalledTimes(1);
});

// Flipping `WRITE_CTA_VARIANT` is the whole review mechanism: one constant, no
// call-site edit. This is what proves Home follows it.
it("renders the face the constant selects when no variant is passed", async () => {
  const view = await render(<WriteAnotherCTA onPress={() => {}} />);

  expect(view.getByTestId(`write-another-face-${WRITE_CTA_VARIANT}`))
    .toBeTruthy();
  const other = WRITE_CTA_VARIANT === "gradient" ? "editorial" : "gradient";
  expect(view.queryByTestId(`write-another-face-${other}`)).toBeNull();
});
