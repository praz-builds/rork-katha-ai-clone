/**
 * The feed card is the one shape Home and Explore are both built from, so its
 * anatomy is a contract rather than a styling detail. These assertions pin the
 * three parts a reader actually uses to choose a story - the title, the
 * synopsis, and the two stats - plus the accessibility shape, because the whole
 * card is a single pressable and the decorative read chevron inside it must not
 * announce a second identical action.
 */
import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import { StoryFeedCard } from "@/components/feed/StoryFeedCard";
import { stories } from "@/data/seed";
/* eslint-enable import/first */

const story = stories[0];

// `render` is async in RNTL 14; every call has to be awaited.
it("shows the title, the synopsis and both stats", async () => {
  const { getByText } = await render(<StoryFeedCard story={story} />);
  expect(getByText(story.title)).toBeTruthy();
  expect(getByText(story.synopsis)).toBeTruthy();
  // formatNumber compresses thousands, so assert on the rendered form.
  const compress = (value: number) =>
    value >= 1000
      ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
      : String(value);
  expect(getByText(compress(story.views))).toBeTruthy();
  expect(getByText(compress(story.likes))).toBeTruthy();
});

it("is one pressable that names the read action once", async () => {
  const onPress = jest.fn();
  const { getAllByLabelText } = await render(
    <StoryFeedCard story={story} onPress={onPress} />,
  );
  const targets = getAllByLabelText(`Read ${story.title}`);
  expect(targets).toHaveLength(1);
  targets[0].props.onClick?.();
});
