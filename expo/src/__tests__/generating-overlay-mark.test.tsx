/**
 * The K does not move between one load and the next.
 *
 * The bug, exactly: `getGeneratingPhrases` **shuffles** its pool, so this
 * overlay opens on a different phrase every mount, and the phrases are not the
 * same length. The phrase block was `minHeight: 64` — two lines — inside a
 * column with `justifyContent: "center"`, so the column's height was a function
 * of which phrase the shuffle happened to deal: a one-line phrase made it
 * shorter and pushed the mark down, a three-line phrase pulled it up. The mark
 * landed somewhere different on every load, and drifted while the phrase
 * rotated every 3.2 seconds.
 *
 * **What this test can and cannot do.** The React Native test renderer runs no
 * layout — there is no Yoga pass — so there are no measured positions to
 * compare and no test here can assert "the K is at the same y on both loads".
 * Saying that plainly is better than writing an assertion that would pass
 * either way. What it asserts instead is the two halves of the mechanism:
 *
 * 1. That the cause is real — the phrase genuinely differs from load to load,
 *    checked against `getGeneratingPhrases` itself rather than by mounting the
 *    screen repeatedly, since the shuffle is where the variation comes from.
 * 2. That the variation can no longer reach the layout — the block the phrase
 *    sits in is a fixed `height`, not a content-sized `minHeight`, and the text
 *    inside it is capped at the number of lines that height reserves.
 *
 * Together those are the whole of why the mark now holds still: a fixed box
 * under a fixed-size mark in a centred column cannot centre differently.
 *
 * The SVG stub is the same shape as `crafting-loader.test.tsx`'s, and is here
 * for the same reason: this subject centres a `KathaMark`, whose
 * `react-native-svg` nodes must be host views before the tree can be queried.
 * Reanimated is deliberately *not* stubbed — the phrase block is a plain
 * `Animated.View` from React Native, and stubbing the mark's animation would
 * mock away part of the thing whose position is in question.
 */

import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      R.createElement(View, { ...props, testID: props.testID ?? name });
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    default: stub("Svg"),
    Svg: stub("Svg"),
    Circle: stub("Circle"),
    Defs: stub("Defs"),
    Path: stub("Path"),
    Pattern: stub("Pattern"),
    Rect: stub("Rect"),
  };
});

/* eslint-disable import/first */
import GeneratingOverlay from "@/components/GeneratingOverlay";
import { getGeneratingPhrases } from "@/data/generating-phrases";
/* eslint-enable import/first */

describe("the generating overlay's mark holds its position", () => {
  it("really does open on a different phrase every load", () => {
    // If this ever stopped being true the layout fix would still be correct,
    // but the test below would be guarding against a bug that no longer
    // exists — so the cause is checked, not assumed.
    const openings = new Set(
      Array.from(
        { length: 40 },
        () => getGeneratingPhrases("romance", "story").phrases[0],
      ),
    );
    expect(openings.size).toBeGreaterThan(1);

    // And they are not the same length, which is the part that moved the mark.
    const lengths = new Set([...openings].map((phrase) => phrase.length));
    expect(lengths.size).toBeGreaterThan(1);
  });

  it("reserves the phrase block rather than sizing it to the phrase", async () => {
    const view = await render(<GeneratingOverlay genre="romance" />);

    const block = StyleSheet.flatten(
      view.getByTestId("generating-phrase").props.style,
    );
    const text = view.getByTestId("generating-phrase-text");
    const textStyle = StyleSheet.flatten(text.props.style);

    // The specific regression. `minHeight` lets a three-line phrase grow the
    // column and shove the mark upward; a fixed `height` cannot.
    expect(block.minHeight).toBeUndefined();
    expect(typeof block.height).toBe("number");

    // And the reservation is honoured from both sides: the box is exactly the
    // line cap times the line height, so the longest allowed phrase fills it
    // without overflowing and the shortest leaves it exactly as tall.
    expect(typeof text.props.numberOfLines).toBe("number");
    expect(block.height).toBe(text.props.numberOfLines * textStyle.lineHeight);
  });
});
