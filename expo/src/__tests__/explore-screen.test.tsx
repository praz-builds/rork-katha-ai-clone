/**
 * Explore is the browse surface, so its controls ARE the feature — a filter
 * that renders but does not narrow the list is worse than no filter at all,
 * because it silently lies about what the catalogue contains. These tests
 * drive the real controls rather than asserting on markup.
 *
 * The search field is the fragile part. It lives inside
 * `ListHeaderComponent`, and if that header's component TYPE is rebuilt on
 * each render, React unmounts and remounts the `TextInput` on every
 * keystroke: the field drops focus and the user can only ever type one
 * character. The multi-keystroke test below is what catches that regression.
 *
 * Every render passes `debounceMs: 0`, which runs the query on the same tick
 * instead of after `SEARCH_DEBOUNCE_MS`. The debounce itself has its own
 * tests in `explore-search.test.tsx`; here it would only add a timer to every
 * assertion. The results still arrive asynchronously (the query is a promise
 * either way), which is why everything below waits.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

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
import { SEARCH_PLACEHOLDER } from "@/components/explore/SearchField";
import { stories } from "@/data/seed";
import { UI_GENRES } from "@/types/domain";
import { genreLabels } from "@/theme";
/* eslint-enable import/first */

const renderExplore = async (onStory = jest.fn()) =>
  await render(
    <ExploreScreen
      stories={stories}
      onStory={onStory}
      onProfile={jest.fn()}
      searchOptions={{ debounceMs: 0 }}
    />,
  );

/** The rendered cards, in tree order, read off their accessibility labels. */
type ExploreView = Awaited<ReturnType<typeof renderExplore>>;

const titlesInOrder = (view: ExploreView) =>
  view.getAllByLabelText(/^Read /).map((node) =>
    String(node.props.accessibilityLabel).replace(/^Read /, "")
  );

it("opens on a browsable default rather than a blank page", async () => {
  const view = await renderExplore();
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
  // Nothing typed, no genre: the reader is looking at the catalogue's most
  // loved, and the eyebrow says so rather than leaving them to guess.
  expect(view.getByText(/Most loved/)).toBeTruthy();
});

it("offers every genre the app knows, as selectable chips", async () => {
  const view = await renderExplore();
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
  for (const genre of UI_GENRES) {
    expect(view.getByLabelText(genreLabels[genre])).toBeTruthy();
  }
});

it("narrows the list as the reader types, without losing the field", async () => {
  const view = await renderExplore();
  const field = view.getByPlaceholderText(SEARCH_PLACEHOLDER);

  // One character at a time. A header component rebuilt per render remounts
  // the input here and the later keystrokes land on a fresh, empty field.
  const target = stories[0];
  const term = target.title.slice(0, 6);
  for (let i = 1; i <= term.length; i++) {
    await fireEvent.changeText(field, term.slice(0, i));
  }

  expect(view.getByDisplayValue(term)).toBeTruthy();
  await waitFor(() => expect(view.getByText(target.title)).toBeTruthy());
});

it("clears the search from the field's own clear button", async () => {
  const view = await renderExplore();
  const field = view.getByPlaceholderText(SEARCH_PLACEHOLDER);

  await fireEvent.changeText(field, "zzzzzzzznotastory");
  await waitFor(() => expect(view.getByText(/No stories match/)).toBeTruthy());

  await fireEvent.press(view.getByLabelText("Clear search"));
  expect(view.queryByDisplayValue("zzzzzzzznotastory")).toBeNull();
  await waitFor(() => expect(view.queryByText(/No stories match/)).toBeNull());
});

it("suggests genres out of a search that matched nothing", async () => {
  const view = await renderExplore();
  await fireEvent.changeText(
    view.getByPlaceholderText(SEARCH_PLACEHOLDER),
    "zzzzzzzznotastory",
  );

  await waitFor(() => expect(view.getByText(/No stories match/)).toBeTruthy());

  // A dead end that only says "clear your filters" hands the problem back to
  // the reader. The no-results state offers a way forward, and it works.
  // The strip carries a Fantasy chip too, so this reaches for the LAST one -
  // the suggestion inside the empty state, which is the affordance under test.
  const fantasyChips = view.getAllByText(/Fantasy$/);
  await fireEvent.press(fantasyChips[fantasyChips.length - 1]);
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
  expect(view.queryByText(/No stories match/)).toBeNull();
});

describe("selecting a genre", () => {
  it("filters the list to that genre and clears on a second tap", async () => {
    const view = await renderExplore();
    await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
    const everything = titlesInOrder(view).length;

    await fireEvent.press(view.getByLabelText("Fantasy"));
    await waitFor(() => {
      const shown = titlesInOrder(view);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(everything);
      for (const title of shown) {
        const story = stories.find((item) => item.title === title);
        expect(story?.genre).toBe("fantasy");
      }
    });

    // Tapping the selected chip is how a single-select row is cleared; there
    // is deliberately no "All" chip competing with the absence of one.
    await fireEvent.press(view.getByLabelText("Fantasy"));
    await waitFor(() => expect(titlesInOrder(view).length).toBe(everything));
  });

  /**
   * `UI_GENRES` includes genres the seeded catalogue has no stories in yet.
   * Selecting one must never land the reader on a blank screen or on the
   * "your search matched nothing" copy, which is the wrong diagnosis: the
   * truth is that nobody has published there yet. Asserted against the live
   * seed catalogue rather than a hardcoded list of empty genres, so this
   * keeps meaning the right thing as stories are seeded.
   */
  it("explains an empty genre as a catalogue gap, not a failed search", async () => {
    const view = await renderExplore();
    expect(stories.some((story) => story.genre === "educational")).toBe(false);

    await fireEvent.press(view.getByLabelText("Educational"));
    await waitFor(() =>
      expect(view.getByText("No Educational stories yet")).toBeTruthy()
    );
    expect(view.queryByText(/No stories match/)).toBeNull();

    await fireEvent.press(view.getByText("See every story"));
    await waitFor(() =>
      expect(view.queryByText("No Educational stories yet")).toBeNull()
    );
  });
});

it("reorders the list when the sort changes", async () => {
  const view = await renderExplore();
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
  await fireEvent.press(view.getByLabelText("Filters"));

  // By testID, not by text. "Most loved" is also what the eyebrow says when
  // nothing is typed and no genre is picked, so `getByText` is one wording
  // change away from matching two nodes and throwing instead of sorting.
  await fireEvent.press(view.getByTestId("explore-sort-loved"));
  const mostLoved = [...stories].sort((a, b) => b.likes - a.likes)[0];
  await waitFor(() => expect(titlesInOrder(view)[0]).toBe(mostLoved.title));

  await fireEvent.press(view.getByTestId("explore-sort-newest"));
  const newest = [...stories].sort((a, b) =>
    a.publishedOffset - b.publishedOffset
  )[0];
  await waitFor(() => expect(titlesInOrder(view)[0]).toBe(newest.title));
});

it("counts active filters and clears them", async () => {
  const view = await renderExplore();
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));
  await fireEvent.press(view.getByLabelText("Filters"));
  await fireEvent.press(view.getByTestId("explore-sort-newest"));

  // Sort away from the default is one active filter.
  expect(view.getByText("1")).toBeTruthy();

  await fireEvent.press(view.getByText("Clear"));
  await waitFor(() => expect(view.queryByText("Clear")).toBeNull());
});

it("opens a card from the bundled catalogue through the ordinary navigator", async () => {
  const onStory = jest.fn();
  const view = await renderExplore(onStory);
  await waitFor(() => expect(titlesInOrder(view).length).toBeGreaterThan(0));

  await fireEvent.press(view.getByLabelText(`Read ${stories[0].title}`));
  expect(onStory).toHaveBeenCalledWith(stories[0].id);
});
