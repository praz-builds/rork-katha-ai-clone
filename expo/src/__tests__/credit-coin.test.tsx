import React from "react";
import { render } from "@testing-library/react-native";

/**
 * The SVG primitives are stubbed as plain views tagged with their element name,
 * so a test can assert the STRUCTURE of the drawing (how many circles, how many
 * paths, which fills) without a renderer. That is the only part of an icon
 * worth asserting: the geometry is a design decision and belongs in
 * `DESIGN_SYSTEM.md` section 7.2, but "the coin still has a rim, a face and an
 * emblem" is a contract, and it is the thing a careless edit breaks.
 */
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      ReactLocal.createElement(View, { ...props, testID: props.testID ?? name });
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    default: stub("Svg"),
    Svg: stub("Svg"),
    Circle: stub("Circle"),
    Path: stub("Path"),
  };
});

/* eslint-disable import/first */
import { CreditCoin } from "@/components/onboarding/CreditCoin";
import { colors } from "@/theme";
/* eslint-enable import/first */

describe("CreditCoin", () => {
  it("draws one square svg on a 24 grid at the size it is given", async () => {
    const { getByTestId } = await render(<CreditCoin size={52} />);

    const svg = getByTestId("Svg");
    expect(svg.props.width).toBe(52);
    expect(svg.props.height).toBe(52);
    // The viewBox is fixed, so every call site scales the same drawing rather
    // than getting a differently proportioned coin at 20 and at 52.
    expect(svg.props.viewBox).toBe("0 0 24 24");
  });

  it("defaults to the 24pt grid size", async () => {
    const { getByTestId } = await render(<CreditCoin />);

    expect(getByTestId("Svg").props.width).toBe(24);
  });

  it("draws a rim behind a lighter face, and the face sits high in the rim", async () => {
    const { getAllByTestId } = await render(<CreditCoin size={24} />);

    const [rim, face] = getAllByTestId("Circle");

    // Two tones of one gold. If these ever come out equal the coin has gone
    // back to being a flat disc, which is the thing this mark replaced.
    expect(face.props.fill).toBe(colors.chromeStar);
    expect(rim.props.fill).not.toBe(face.props.fill);

    // The face is smaller and higher: the thicker edge under it is the entire
    // reason the mark reads as an object with mass.
    expect(face.props.r).toBeLessThan(rim.props.r);
    expect(face.props.cy).toBeLessThan(rim.props.cy);
  });

  it("draws the highlight and the ink spark as paths", async () => {
    const { getAllByTestId } = await render(<CreditCoin size={24} />);

    const paths = getAllByTestId("Path");
    expect(paths).toHaveLength(2);

    const [highlight, spark] = paths;
    // The highlight is partial-opacity white, never a gradient: a gradient at
    // 20pt is one muddy tone.
    expect(highlight.props.fill).toBe(colors.surface);
    expect(highlight.props.fillOpacity).toBeLessThan(1);
    // The emblem is solid ink, and it is the same spark Home's credits pill
    // carries, which is what makes the flight read as a landing.
    expect(spark.props.fill).toBe(colors.ink);
  });
});
