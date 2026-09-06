/**
 * Explore is the browse surface, so its filters are the feature - a filter that
 * renders but does not narrow the list is worse than no filter at all, because
 * it silently lies about what the catalogue contains. These tests drive the
 * real controls rather than asserting on markup.
 *
 * The search field is the fragile part. It lives inside `ListHeaderComponent`,
 * and if that header's component TYPE is rebuilt on each render, React unmounts
 * and remounts the `TextInput` on every keystroke: the field drops focus and
 * the user can only ever type one character. The multi-keystroke test below is
 * what catches that regression.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

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
import { stories } from "@/data/seed";
/* eslint-enable import/first */

const renderExplore = () =>
  render(
    <ExploreScreen
      stories={stories}
      onStory={jest.fn()}
      onProfile={jest.fn()}
    />,
  );

it("narrows the list as the reader types, without losing the field", async () => {
  const view = await renderExplore();
  const field = view.getByPlaceholderText("Search stories, moods, authors");

  // One character at a time. A header component rebuilt per render remounts
  // the input here and the later keystrokes land on a fresh, empty field.
  const target = stories[0];
  const term = target.title.slice(0, 6);
  for (let i = 1; i <= term.length; i++) {
    await fireEvent.changeText(field, term.slice(0, i));
  }

  expect(view.getByDisplayValue(term)).toBeTruthy();
  expect(view.getByText(target.title)).toBeTruthy();
});

it("shows the empty state when nothing matches, and recovers from it", async () => {
  const view = await renderExplore();
  const field = view.getByPlaceholderText("Search stories, moods, authors");

  await fireEvent.changeText(field, "zzzzzzzznotastory");
  expect(view.getByText("No stories match")).toBeTruthy();

  await fireEvent.press(view.getByText("Clear filters"));
  expect(view.queryByText("No stories match")).toBeNull();
});

it("reorders the list when the sort changes", async () => {
  const view = await renderExplore();
  await fireEvent.press(view.getByLabelText("Filters"));

  // Asserting the most-liked story is merely PRESENT proves nothing - every
  // story is present. The assertion has to be about ORDER, so read the
  // rendered cards in tree order off their accessibility labels.
  const titlesInOrder = () =>
    view.getAllByLabelText(/^Read /).map((node) =>
      String(node.props.accessibilityLabel).replace(/^Read /, "")
    );

  await fireEvent.press(view.getByText("Most loved"));
  const mostLoved = [...stories].sort((a, b) => b.likes - a.likes)[0];
  expect(titlesInOrder()[0]).toBe(mostLoved.title);

  await fireEvent.press(view.getByText("Newest"));
  const newest = [...stories].sort((a, b) =>
    a.publishedOffset - b.publishedOffset
  )[0];
  expect(titlesInOrder()[0]).toBe(newest.title);
});

it("counts active filters and clears them", async () => {
  const view = await renderExplore();
  await fireEvent.press(view.getByLabelText("Filters"));
  await fireEvent.press(view.getByText("Newest"));

  // Sort away from the default is one active filter.
  expect(view.getByText("1")).toBeTruthy();

  await fireEvent.press(view.getByText("Clear"));
  expect(view.queryByText("Clear")).toBeNull();
});
