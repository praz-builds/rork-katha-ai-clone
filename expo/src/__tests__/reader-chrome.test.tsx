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
  const onHistory = jest.fn();
  const onEdit = jest.fn();
  const onReimagine = jest.fn();
  const onMusic = jest.fn();
  const view = await render(
    <ReaderChrome {...props({ onHistory, onEdit, onReimagine, onMusic })} />,
  );

  await fireEvent.press(view.getByLabelText("History"));
  await fireEvent.press(view.getByLabelText("Edit"));
  await fireEvent.press(view.getByLabelText("Reimagine"));
  await fireEvent.press(view.getByLabelText("Music"));

  expect(onHistory).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onReimagine).toHaveBeenCalledTimes(1);
  expect(onMusic).toHaveBeenCalledTimes(1);
});

it("does not render Edit or Reimagine when their handlers are omitted", async () => {
  const view = await render(<ReaderChrome {...props()} />);

  expect(view.queryByLabelText("Edit")).toBeNull();
  expect(view.queryByLabelText("Reimagine")).toBeNull();
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
