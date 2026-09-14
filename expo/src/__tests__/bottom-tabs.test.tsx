/**
 * The floating tab bar: four places to go in a pill, and the one thing to do
 * beside it.
 *
 * What is pinned here is the shape the product owner asked for on 2026-09-14
 * (the Create button at the END, not raised in the middle), that the bar
 * clears the bottom safe-area inset on both platforms, and that the tabs are
 * announced as tabs with the selected one marked.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

let mockBottomInset = 34;
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: mockBottomInset, left: 0 }),
}));

/* eslint-disable import/first */
import BottomTabs, { TAB_BAR_CLEARANCE, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { controls } from "@/theme";
/* eslint-enable import/first */

describe("BottomTabs", () => {
  it("draws four tabs and a separate Create button, in that order", async () => {
    const view = await render(<BottomTabs selected="home" onSelect={jest.fn()} />);
    const tabs = view.getAllByRole("tab");
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Home",
      "Explore",
      "Library",
      "You",
    ]);
    // Create is a button, not a fifth tab, and it is not in the tab list.
    const create = view.getByLabelText("Create story");
    expect(create.props.accessibilityRole).toBe("button");
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).not.toContain("Create story");
  });

  it("marks the selected tab and routes every press", async () => {
    const onSelect = jest.fn();
    const view = await render(<BottomTabs selected="library" onSelect={onSelect} />);
    expect(view.getByLabelText("Library").props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText("Home").props.accessibilityState.selected).toBe(false);

    await fireEvent.press(view.getByLabelText("Explore"));
    await fireEvent.press(view.getByLabelText("Create story"));
    expect(onSelect.mock.calls.map(([key]) => key)).toEqual(["explore", "create"]);
  });

  it("floats above the bottom inset, whatever the platform reports", async () => {
    mockBottomInset = 48;
    const view = await render(<BottomTabs selected="home" onSelect={jest.fn()} />);
    const dock = view.getByTestId("tab-bar-dock");
    const style = StyleSheet.flatten(dock.props.style) as { bottom?: number; position?: string };
    expect(style.position).toBe("absolute");
    expect(style.bottom).toBeGreaterThanOrEqual(48);
    // And a screen padding by the exported clearance clears the bar on that inset.
    expect(TAB_BAR_CLEARANCE).toBeGreaterThanOrEqual(style.bottom! + TAB_BAR_HEIGHT);
    mockBottomInset = 34;
  });

  it("keeps every target at or above the 44pt floor", async () => {
    const view = await render(<BottomTabs selected="home" onSelect={jest.fn()} />);
    const tab = StyleSheet.flatten(view.getByLabelText("Home").props.style) as { height?: number };
    expect(tab.height).toBe(TAB_BAR_HEIGHT);
    expect(TAB_BAR_HEIGHT).toBeGreaterThanOrEqual(44);
    const create = StyleSheet.flatten(view.getByLabelText("Create story").props.style) as {
      width?: number;
      height?: number;
    };
    expect(create.width).toBe(controls.tabBarCreate);
    expect(create.height).toBeGreaterThanOrEqual(44);
  });
});
