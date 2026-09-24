/**
 * Library's three tabs, and where each one gets its list.
 *
 * WHAT THESE GUARD AGAINST is the shape the screen used to have. "Saved" was
 * `stories.filter(s => s.bookmarks > 100)` and "History" was `slice(0, 5)` of
 * the same feed array, so both tabs listed popular stories the reader had
 * never touched. The tests below therefore hand the screen a feed-shaped
 * array of session stories AND a separate starred list, and check that the
 * two never leak into each other: Created shows only what the reader wrote,
 * Starred shows only what `bookmarks` returned.
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
jest.mock("@/lib/api", () => ({
  fetchCreatedShelf: jest.fn(),
  fetchStarredShelf: jest.fn(),
}));
jest.mock("@/components/library/CharactersTab", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    __esModule: true,
    default: () => ReactModule.createElement(Text, { testID: "characters-tab" }, "Characters"),
  };
});

/* eslint-disable import/first */
import LibraryScreen from "@/screens/LibraryScreen";
import { fetchCreatedShelf, fetchStarredShelf } from "@/lib/api";
import { stories as seedStories } from "@/data/seed";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

const created = jest.mocked(fetchCreatedShelf);
const starred = jest.mocked(fetchStarredShelf);

const asStory = (source: Story, overrides: Partial<Story>): Story => ({
  ...source,
  ...overrides,
});

const MINE = asStory(seedStories[0], { id: "mine-1", title: "A Kitchen At Dawn" });
const STARRED = asStory(seedStories[1], { id: "star-1", title: "The Salt Road" });

beforeEach(() => {
  created.mockReset();
  starred.mockReset();
  created.mockResolvedValue({ ok: true, stories: [] });
  starred.mockResolvedValue({ ok: true, stories: [] });
});

const renderLibrary = async (props: Partial<React.ComponentProps<typeof LibraryScreen>> = {}) =>
  await render(
    <LibraryScreen
      generatedStories={[]}
      onStory={jest.fn()}
      onCreate={jest.fn()}
      onExplore={jest.fn()}
      {...props}
    />,
  );

it("opens on Created and lists the reader's own stories", async () => {
  created.mockResolvedValue({ ok: true, stories: [MINE] });
  const view = await renderLibrary();

  await waitFor(() => expect(view.getByText("A Kitchen At Dawn")).toBeTruthy());
  expect(view.queryByText("The Salt Road")).toBeNull();
});

it("keeps a story written in this session even before the fetch answers", async () => {
  const session = asStory(seedStories[2], { id: "fresh-1", title: "Fresh Ink" });
  created.mockResolvedValue({ ok: true, stories: [MINE] });

  const view = await renderLibrary({ generatedStories: [session] });

  expect(view.getByText("Fresh Ink")).toBeTruthy();
  await waitFor(() => expect(view.getByText("A Kitchen At Dawn")).toBeTruthy());
});

it("does not list the same story twice when the fetch catches up with the session", async () => {
  created.mockResolvedValue({ ok: true, stories: [MINE] });
  const view = await renderLibrary({ generatedStories: [MINE] });

  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(view.getAllByText("A Kitchen At Dawn")).toHaveLength(1);
});

it("invites the reader to write from an empty Created shelf", async () => {
  const onCreate = jest.fn();
  const view = await renderLibrary({ onCreate });

  await waitFor(() => expect(view.getByTestId("library-created-empty")).toBeTruthy());
  await fireEvent.press(view.getByTestId("library-created-empty-action"));
  expect(onCreate).toHaveBeenCalled();
});

it("shows an error with a retry rather than an empty shelf when Created cannot load", async () => {
  created.mockResolvedValue({ ok: false });
  const view = await renderLibrary();

  await waitFor(() => expect(view.getByTestId("library-created-error")).toBeTruthy());
  expect(view.queryByTestId("library-created-empty")).toBeNull();

  created.mockResolvedValue({ ok: true, stories: [MINE] });
  await fireEvent.press(view.getByLabelText("Try again"));
  await waitFor(() => expect(view.getByText("A Kitchen At Dawn")).toBeTruthy());
});

it("lists starred stories from the bookmarks read, not from a popularity filter", async () => {
  // The old screen took `stories.filter(s => s.bookmarks > 100)`. This popular
  // story is deliberately NOT in the starred result, so a regression to that
  // filter shows up as this story appearing.
  const popular = asStory(seedStories[3], {
    id: "popular-1",
    title: "Everyone Read This",
    bookmarks: 9000,
  });
  created.mockResolvedValue({ ok: true, stories: [popular] });
  starred.mockResolvedValue({ ok: true, stories: [STARRED] });

  const view = await renderLibrary({ generatedStories: [popular] });
  await fireEvent.press(view.getByTestId("library-tab-starred"));

  await waitFor(() => expect(view.getByText("The Salt Road")).toBeTruthy());
  expect(view.queryByText("Everyone Read This")).toBeNull();
});

it("explains what starring does from an empty Starred shelf", async () => {
  const onExplore = jest.fn();
  const view = await renderLibrary({ onExplore });
  await fireEvent.press(view.getByTestId("library-tab-starred"));

  await waitFor(() => expect(view.getByTestId("library-starred-empty")).toBeTruthy());
  expect(view.getByText("Nothing starred yet")).toBeTruthy();
  await fireEvent.press(view.getByTestId("library-starred-empty-action"));
  expect(onExplore).toHaveBeenCalled();
});

it("shows an error with a retry when Starred cannot load", async () => {
  starred.mockResolvedValue({ ok: false });
  const view = await renderLibrary();
  await fireEvent.press(view.getByTestId("library-tab-starred"));

  await waitFor(() => expect(view.getByTestId("library-starred-error")).toBeTruthy());
});

it("has exactly three tabs, and none of the fabricated ones", async () => {
  const view = await renderLibrary();
  await waitFor(() => expect(view.getByTestId("library-tab-created")).toBeTruthy());

  expect(view.getByTestId("library-tab-starred")).toBeTruthy();
  expect(view.getByTestId("library-tab-characters")).toBeTruthy();
  expect(view.queryByText("Notes")).toBeNull();
  expect(view.queryByText("History")).toBeNull();
  expect(view.queryByText("Comments")).toBeNull();
  expect(view.queryByText("Saved")).toBeNull();
  expect(view.queryByText("My Stories")).toBeNull();
});

it("keeps every segment label on one line at the chip label size", async () => {
  const view = await renderLibrary();
  for (const label of ["Created", "Starred", "Characters"]) {
    const text = view.getByText(label);
    expect(text.props.numberOfLines).toBe(1);
    const style = Object.assign({}, ...[text.props.style].flat(Infinity).filter(Boolean));
    expect(style.fontSize).toBe(15);
  }
});

it("reaches Characters from the third tab", async () => {
  const view = await renderLibrary();
  await fireEvent.press(view.getByTestId("library-tab-characters"));
  await waitFor(() => expect(view.getByTestId("characters-tab")).toBeTruthy());
});

it("says so when a refresh fails over a shelf that already has stories", async () => {
  // The full-screen error only fires on an EMPTY shelf, which is right: a
  // shelf full of work should not be replaced by an error box. But the
  // earlier version then said nothing at all, so a failed refresh left a
  // stale list looking current — a story published a minute ago was simply
  // missing, with no hint anything had gone wrong and nothing to retry.
  // The reachable version of "a populated shelf whose fetch failed": the
  // reader wrote a story this session, so `generatedStories` has something in
  // it, and the shelf query then fails. Before, that rendered as a normal
  // shelf holding one story — with the rest of their library missing and
  // nothing saying why.
  created.mockResolvedValue({ ok: false });
  const view = await renderLibrary({ generatedStories: [MINE] });

  await waitFor(() =>
    expect(view.getByTestId("library-created-stale-error")).toBeTruthy()
  );
  // The stories stay. The failure is stated above them, with the retry.
  expect(view.getByText("A Kitchen At Dawn")).toBeTruthy();
  expect(view.queryByTestId("library-created-error")).toBeNull();

  // And it clears when the retry finally lands.
  created.mockResolvedValue({
    ok: true,
    stories: [asStory(seedStories[2], { id: "mine-2", title: "The Salt Road II" })],
  });
  await fireEvent.press(view.getByLabelText("Try again"));
  await waitFor(() =>
    expect(view.queryByTestId("library-created-stale-error")).toBeNull()
  );
  expect(view.getByText("The Salt Road II")).toBeTruthy();
});
