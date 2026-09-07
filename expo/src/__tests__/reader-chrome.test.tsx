import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
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
