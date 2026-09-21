/**
 * What a button looks like while it is working.
 *
 * `button-recipe.test.ts` is the static guard: it reads the source tree and
 * insists that a button whose label turns into a busy word also passes
 * `loading`. This file is the other half, and it exists because that guard has
 * a premise it cannot check itself -- that the busy word is worth writing at
 * all, because somebody can actually see it.
 *
 * The first version of `Button` swapped the ENTIRE content for a spinner when
 * `loading` was set. Every `label={busy ? "Saving" : "Save"}` in the app was
 * therefore a ternary whose busy branch could never render: dead code that
 * reads as live, and four call sites had one. A bare spinner also says only
 * "wait", never what is being waited for -- on a sheet with two controls, that
 * is a worse answer than the word.
 *
 * So the spinner takes the ICON's slot and the label stays. These tests pin
 * that, because it is the kind of detail a later refactor tidies away.
 */
import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { Button } from "@/components/Button";

const Icon = () => <Text testID="button-icon">icon</Text>;

it("keeps the label visible while loading", async () => {
  const view = await render(
    <Button label="Saving" onPress={() => {}} loading testID="cta" />,
  );

  // The word survives. This is the assertion that fails if anyone restores
  // "spinner instead of content".
  expect(view.getByText("Saving")).toBeTruthy();
});

it("puts the spinner where the icon was, not where the label is", async () => {
  const withIcon = await render(
    <Button label="Save" onPress={() => {}} icon={<Icon />} testID="cta" />,
  );
  expect(withIcon.getByTestId("button-icon")).toBeTruthy();

  const loading = await render(
    <Button
      label="Saving"
      onPress={() => {}}
      icon={<Icon />}
      loading
      testID="cta"
    />,
  );

  // The icon steps aside so the row does not carry both a spinner and a
  // glyph, and the label is still the thing being read.
  expect(loading.queryByTestId("button-icon")).toBeNull();
  expect(loading.getByText("Saving")).toBeTruthy();
});

it("says it is busy to somebody who cannot see the spinner", async () => {
  const view = await render(
    <Button label="Saving" onPress={() => {}} loading testID="cta" />,
  );

  // The visual cue and the announced one have to agree: a spinner nobody can
  // see is not a state.
  expect(view.getByTestId("cta").props.accessibilityState).toMatchObject({
    busy: true,
  });
});

it("is not busy when it is merely unavailable", async () => {
  const view = await render(
    <Button label="Save" onPress={() => {}} disabled testID="cta" />,
  );

  // `disabled` means not available; `loading` means you already pressed this.
  // Conflating them is how a button that is waiting on somebody else's work
  // ends up claiming it is doing work of its own.
  expect(view.getByTestId("cta").props.accessibilityState).toMatchObject({
    disabled: true,
    busy: false,
  });
  expect(view.getByText("Save")).toBeTruthy();
});
