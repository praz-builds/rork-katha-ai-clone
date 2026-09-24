/**
 * The two ways out of a failed narration, and the width they are drawn at.
 *
 * These were a ~180pt label-sized primary and a quieter ghost beside it,
 * centred under a centred paragraph. Migrating them to `Button` stretched both
 * across the container, because `Button` is full width by default -- so the
 * secondary stopped reading as secondary and the pair stopped reading as a
 * choice. The assertion below is on the resolved `alignSelf`, which is the one
 * property that decides it: `stretch` is the full-width branch, `center` is
 * the hug-content branch this screen asks for.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { View } from "react-native";

import { NarrationLoader } from "@/components/listen/NarrationLoader";

const alignSelfOf = (element: { props: Record<string, unknown> }) => {
  const style = element.props.style as
    | Record<string, unknown>
    | Record<string, unknown>[];
  const flattened = Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : style;
  return (flattened as { alignSelf?: string }).alignSelf;
};

it("keeps both ways out at their own width, centred", async () => {
  const { getByLabelText } = await render(
    <NarrationLoader
      status="That did not work"
      detail="The narrator never answered."
      art={<View testID="stub-art" />}
      action={{ label: "Try again", onPress: () => {} }}
      secondaryAction={{ label: "Read instead", onPress: () => {} }}
    />,
  );

  // Neither may be `stretch`: that is `Button`'s full-width branch, and a
  // full-width ghost under a full-width primary is two primaries.
  expect(alignSelfOf(getByLabelText("Try again"))).toBe("center");
  expect(alignSelfOf(getByLabelText("Read instead"))).toBe("center");
});
