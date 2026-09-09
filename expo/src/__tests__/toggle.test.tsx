import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { Toggle } from "@/components/Toggle";
import { colors, controls } from "@/theme";

/**
 * The one switch in the app.
 *
 * The bug these exist for: the create brief drew an orange track under an iOS
 * GREEN thumb, because React Native's `Switch` fills in its own platform
 * colours for whatever the caller does not pass. So the assertions below are
 * about the two things a shared control has to guarantee -- that it says what
 * state it is in, and that every colour it draws came out of `@/theme`.
 */

function flatten(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
}

describe("Toggle", () => {
  it("announces itself as a switch, named, and in the state it is drawing", async () => {
    const off = await render(
      <Toggle value={false} onValueChange={jest.fn()} accessibilityLabel="Kids Mode" />,
    );
    const control = off.getByRole("switch", { name: "Kids Mode" });
    expect(control.props.accessibilityState).toMatchObject({
      checked: false,
      disabled: false,
    });

    const on = await render(
      <Toggle value onValueChange={jest.fn()} accessibilityLabel="Kids Mode" />,
    );
    expect(
      on.getByRole("switch", { name: "Kids Mode" }).props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it("hands the caller the opposite of the current value, once per press", async () => {
    const onValueChange = jest.fn();
    const view = await render(
      <Toggle value={false} onValueChange={onValueChange} accessibilityLabel="Chapter art" />,
    );

    await fireEvent.press(view.getByRole("switch", { name: "Chapter art" }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);

    // A control that is already on asks to be turned off, not on again.
    await view.rerender(
      <Toggle value onValueChange={onValueChange} accessibilityLabel="Chapter art" />,
    );
    await fireEvent.press(view.getByRole("switch", { name: "Chapter art" }));
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange).toHaveBeenLastCalledWith(false);
  });

  it("is inert when disabled, and still reports disabled rather than off", async () => {
    const onValueChange = jest.fn();
    // "Make it public" is disabled for a signed-out writer while ON in the
    // draft: the state has to survive the disabling, or the row tells them
    // their story is private by their own choice.
    const view = await render(
      <Toggle
        value
        disabled
        onValueChange={onValueChange}
        accessibilityLabel="Make it public"
      />,
    );
    const control = view.getByRole("switch", { name: "Make it public" });

    expect(control.props.accessibilityState).toMatchObject({
      checked: true,
      disabled: true,
    });
    await fireEvent.press(control);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("draws a disabled toggle differently from an off one", async () => {
    const trackOf = (node: Awaited<ReturnType<typeof render>>) =>
      flatten(node.getByRole("switch", { name: "Public" }).children[0] as never);

    const off = await render(
      <Toggle value={false} onValueChange={jest.fn()} accessibilityLabel="Public" />,
    );
    const disabled = await render(
      <Toggle value={false} disabled onValueChange={jest.fn()} accessibilityLabel="Public" />,
    );

    expect(trackOf(off).backgroundColor).toBe(colors.borderStrong);
    expect(trackOf(disabled).backgroundColor).toBe(colors.border);
    expect(trackOf(off).backgroundColor).not.toBe(trackOf(disabled).backgroundColor);
  });

  it("meets the 44pt target and draws no colour outside the token file", async () => {
    const view = await render(
      <Toggle value onValueChange={jest.fn()} accessibilityLabel="Kids Mode" />,
    );
    const control = view.getByRole("switch", { name: "Kids Mode" });
    const target = flatten(control);
    expect(target.minWidth).toBe(controls.toggleHitTarget);
    expect(target.minHeight).toBe(controls.toggleHitTarget);
    expect(controls.toggleHitTarget).toBeGreaterThanOrEqual(44);

    const tokens = new Set<string>(Object.values(colors));
    const paint = JSON.stringify(view.toJSON()).match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    for (const hex of paint) {
      expect(tokens).toContain(hex);
    }
    // And in particular: never the platform green that started all this.
    expect(paint.map((hex) => hex.toLowerCase())).not.toContain("#34c759");
  });
});
