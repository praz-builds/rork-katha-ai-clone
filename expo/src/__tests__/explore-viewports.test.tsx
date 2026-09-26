/**
 * Explore at the four widths it is actually opened at: a 320pt phone, the
 * 390pt reference frame, a 430pt Pro Max, and a 768pt tablet or desktop
 * window.
 *
 * WHAT THIS IS LOOKING FOR. Not a pixel match — a fixed number that is wider
 * than the window it is in. Before this change the card was a 300pt rail and
 * a 116pt cover whatever the window was, so 320 clipped and 768 left a stamp
 * in the corner of a page. The assertions below are therefore relational: the
 * card's parts always fit inside the content width, and the column stops
 * growing once it is wide enough to read.
 *
 * The window is moved by stubbing `Dimensions.get`, which is where
 * `useWindowDimensions` reads its first value from.
 */
import React from "react";
import { Dimensions, StyleSheet } from "react-native";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import ExploreScreen from "@/screens/ExploreScreen";
import { stories as seedStories } from "@/data/seed";
import { LAYOUT_GUTTER, layoutWidth, MAX_CONTENT_WIDTH } from "@/theme";
/* eslint-enable import/first */

const WIDTHS = [320, 390, 430, 768];

const atWidth = async (width: number) => {
  const real = Dimensions.get;
  const spy = jest.spyOn(Dimensions, "get").mockImplementation((dim) =>
    dim === "window"
      ? { width, height: 844, scale: 2, fontScale: 1 }
      : real.call(Dimensions, dim)
  );
  const view = await render(
    <ExploreScreen
      stories={seedStories}
      onStory={jest.fn()}
      searchOptions={{ debounceMs: 0, prefetchTimeoutMs: 0 }}
    />,
  );
  await waitFor(() => view.getAllByTestId("story-feed-cover-frame"));
  return { view, restore: () => spy.mockRestore() };
};

it.each(WIDTHS)("fits a feed card inside a %ipt window", async (width) => {
  const { view, restore } = await atWidth(width);
  try {
    const { content } = layoutWidth(width);
    const frame = view.getAllByTestId("story-feed-cover-frame")[0];
    const cover = StyleSheet.flatten(frame.props.style) as {
      width: number;
      height: number;
    };

    // A cover wider than the column is the clipping this change is about.
    expect(cover.width).toBeGreaterThan(0);
    expect(cover.width).toBeLessThan(content);
    // And it keeps the 3:4 the source art is in at every one of them.
    expect(cover.height).toBe(Math.round(cover.width * 4 / 3));
  } finally {
    restore();
  }
});

it("caps and centres the column on a wide window only", async () => {
  const narrow = await atWidth(390);
  try {
    const list = narrow.view.getByTestId("explore-list");
    const style = StyleSheet.flatten(list.props.contentContainerStyle) as {
      width?: number;
      alignSelf?: string;
    };
    expect(style.width).toBeUndefined();
    expect(style.alignSelf).toBeUndefined();
  } finally {
    narrow.restore();
  }

  const wide = await atWidth(768);
  try {
    const list = wide.view.getByTestId("explore-list");
    const style = StyleSheet.flatten(list.props.contentContainerStyle) as {
      width?: number;
      alignSelf?: string;
    };
    // The column stops at the readable maximum and sits in the middle of the
    // window rather than against its left edge.
    expect(style.width).toBe(MAX_CONTENT_WIDTH + LAYOUT_GUTTER * 2);
    expect(style.alignSelf).toBe("center");
    expect(style.width as number).toBeLessThan(768);
  } finally {
    wide.restore();
  }
});
