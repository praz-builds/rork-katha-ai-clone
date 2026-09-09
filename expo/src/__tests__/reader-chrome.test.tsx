import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { ReaderChrome } from "@/components/reader/ReaderChrome";
import type { ReaderChromeProps } from "@/components/reader/ReaderChrome";

const props = (overrides: Partial<ReaderChromeProps> = {}): ReaderChromeProps => ({
  visible: true,
  storyTitle: "The Last Lighthouse Keeper",
  pageIndex: 0,
  pageCount: 3,
  searchOpen: false,
  searchQuery: "",
  searchMatchCount: 0,
  activeSearchMatch: 0,
  onBack: jest.fn(),
  onSearchOpen: jest.fn(),
  onSearchClose: jest.fn(),
  onSearchQueryChange: jest.fn(),
  onSearchNext: jest.fn(),
  onSearchPrevious: jest.fn(),
  onPageChange: jest.fn(),
  onPreferences: jest.fn(),
  onChapters: jest.fn(),
  onListen: jest.fn(),
  ...overrides,
});

it("invokes extension controls exactly once per press", async () => {
  const onEdit = jest.fn();
  const onReimagine = jest.fn();
  const onMusic = jest.fn();
  const view = await render(
    <ReaderChrome {...props({ onEdit, onReimagine, onMusic })} />,
  );

  await fireEvent.press(view.getByLabelText("Edit"));
  await fireEvent.press(view.getByLabelText("Reimagine"));
  await fireEvent.press(view.getByLabelText("Music"));

  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onReimagine).toHaveBeenCalledTimes(1);
  expect(onMusic).toHaveBeenCalledTimes(1);
});

/**
 * History is gone, prop and all.
 *
 * There was never any persisted version history behind it: the old AI editor
 * held exactly one prior paragraph, in memory, for as long as that editor
 * happened to be open. A control in the reader's chrome promising "history"
 * over that was a feature the app did not have, so it is not a hidden control
 * or a disabled one - it does not exist, and this asserts the prop is gone
 * rather than merely unrendered.
 */
it("has no History control and no handler for one", async () => {
  const view = await render(<ReaderChrome {...props()} />);

  expect(view.queryByLabelText("History")).toBeNull();
  expect(Object.keys(props())).not.toContain("onHistory");
});

it("does not render Edit or Reimagine when their handlers are omitted", async () => {
  const view = await render(<ReaderChrome {...props()} />);

  // Absent, never disabled. Mid-generation a greyed control is a question the
  // writer cannot answer; Edit and Reimagine simply appear when the chapter is
  // finished, and Edit only for its author.
  expect(view.queryByLabelText("Edit")).toBeNull();
  expect(view.queryByLabelText("Reimagine")).toBeNull();
});

it("names the chapter under the story", async () => {
  const view = await render(
    <ReaderChrome {...props({ chapterTitle: "The Letter" })} />,
  );
  expect(view.getByText("The Letter")).toBeTruthy();
});

it("drops the chapter line for a standalone story, which has one title", async () => {
  const view = await render(<ReaderChrome {...props()} />);
  expect(view.queryByText("The Letter")).toBeNull();
});

it("offers Music, Listen, Chapters, Preferences and the page slider", async () => {
  const view = await render(<ReaderChrome {...props()} />);

  expect(view.getByLabelText("Music")).toBeTruthy();
  expect(view.getByLabelText("Listen")).toBeTruthy();
  expect(view.getByLabelText("Chapters")).toBeTruthy();
  expect(view.getByLabelText("Preferences")).toBeTruthy();
  expect(view.getByTestId("page-scrubber")).toBeTruthy();
});

/**
 * While a chapter is still being written the chrome is reduced to the way out
 * and the title. Everything in the bottom sheet operates on prose, and the
 * prose is not finished.
 */
it("shows only the top bar while the chapter is still being written", async () => {
  const view = await render(
    <ReaderChrome {...props({ mode: "top-only", onEdit: jest.fn() })} />,
  );

  expect(view.getByLabelText("Back")).toBeTruthy();
  expect(view.queryByTestId("reader-chrome-sheet")).toBeNull();
  expect(view.queryByLabelText("Edit")).toBeNull();
});

it("hides the search bar along with the rest of the chrome, without discarding the in-progress query", async () => {
  const hidden = await render(
    <ReaderChrome
      {...props({
        visible: false,
        searchOpen: true,
        searchQuery: "lighthouse",
        searchMatchCount: 2,
        activeSearchMatch: 0,
      })}
    />,
  );

  // Hiding the chrome must take its search affordance with it: no orphaned,
  // still-interactive find bar left on the page.
  expect(hidden.queryByLabelText("Find in chapter")).toBeNull();
  expect(hidden.queryByLabelText("Next search match")).toBeNull();
  expect(hidden.queryByLabelText("Previous search match")).toBeNull();
  cleanup();

  // The query itself must not be silently discarded by the chrome: the
  // reader screen owns `searchQuery`/`searchOpen`, and ReaderChrome renders
  // whatever it is handed -- so the same in-progress search comes straight
  // back once the chrome is shown again, rather than being reset to empty.
  const shown = await render(
    <ReaderChrome
      {...props({
        visible: true,
        searchOpen: true,
        searchQuery: "lighthouse",
        searchMatchCount: 2,
        activeSearchMatch: 0,
      })}
    />,
  );

  expect(shown.getByLabelText("Find in chapter").props.value).toBe("lighthouse");
  expect(shown.getByText("1 of 2")).toBeTruthy();
});
