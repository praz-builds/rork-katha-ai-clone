/**
 * The chrome's page row, after three things were fixed off a screenshot of the
 * running app.
 *
 * 1. A "Pages" caption spent a whole row's width naming the control beside it,
 *    next to a readout that already said "Page 7 of 15". The caption is gone
 *    and its height went to the six controls above and below it, which are what
 *    a thumb actually has to find.
 * 2. The sheet's top corners were `radius.xl` (24), which on a 390-wide sheet
 *    curves for most of the height of the first control row and reads as a pill
 *    rather than a panel.
 * 3. The forward page control was not on screen at all. It was a `ChevronLeft`
 *    rotated 180 degrees through a style prop -- a transform lucide hands to the
 *    SVG root, which does not survive every renderer. Both ends are one
 *    component now, so they cannot drift apart again.
 */

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

it("keeps the page readout and drops the Pages caption", async () => {
  const view = await render(<ReaderChrome {...props({ pageIndex: 6, pageCount: 15 })} />);

  const readout = view.getByTestId("page-readout");
  expect(
    (readout.props.children as unknown[]).flat().join(""),
  ).toBe("Page 7 of 15");
  // Gone as a visible LABEL. The scrubber keeps "Pages" as its accessibility
  // name, which is the one place the word still earns its keep.
  expect(view.queryByText("Pages")).toBeNull();
});

it("renders both page controls, symmetric and the same size", async () => {
  const view = await render(<ReaderChrome {...props({ pageIndex: 1, pageCount: 5 })} />);

  const back = view.getByTestId("page-step-previous");
  const forward = view.getByTestId("page-step-next");

  expect(back.props.accessibilityLabel).toBe("Previous page");
  expect(forward.props.accessibilityLabel).toBe("Next page");
  // One component drives both ends, so the hit area cannot diverge.
  expect(forward.props.hitSlop).toEqual(back.props.hitSlop);
});

it("turns the page in both directions", async () => {
  const onPageChange = jest.fn();
  const view = await render(
    <ReaderChrome {...props({ pageIndex: 2, pageCount: 5, onPageChange })} />,
  );

  await fireEvent.press(view.getByTestId("page-step-next"));
  expect(onPageChange).toHaveBeenLastCalledWith(3);

  await fireEvent.press(view.getByTestId("page-step-previous"));
  expect(onPageChange).toHaveBeenLastCalledWith(1);
  expect(onPageChange).toHaveBeenCalledTimes(2);
});

it("disables back on the first page, and does not turn on a press", async () => {
  const onPageChange = jest.fn();
  const view = await render(
    <ReaderChrome {...props({ pageIndex: 0, pageCount: 5, onPageChange })} />,
  );

  expect(view.getByTestId("page-step-previous").props.accessibilityState.disabled).toBe(true);
  expect(view.getByTestId("page-step-next").props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(view.getByTestId("page-step-previous"));
  expect(onPageChange).not.toHaveBeenCalled();
});

it("disables forward on the last page, and does not turn on a press", async () => {
  const onPageChange = jest.fn();
  const view = await render(
    <ReaderChrome {...props({ pageIndex: 4, pageCount: 5, onPageChange })} />,
  );

  expect(view.getByTestId("page-step-next").props.accessibilityState.disabled).toBe(true);
  expect(view.getByTestId("page-step-previous").props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(view.getByTestId("page-step-next"));
  expect(onPageChange).not.toHaveBeenCalled();
});

it("disables both controls in a single-page chapter", async () => {
  const view = await render(<ReaderChrome {...props({ pageIndex: 0, pageCount: 1 })} />);

  expect(view.getByTestId("page-step-previous").props.accessibilityState.disabled).toBe(true);
  expect(view.getByTestId("page-step-next").props.accessibilityState.disabled).toBe(true);
});

it("keeps the control set to exactly the six, and no History", async () => {
  const view = await render(
    <ReaderChrome {...props({ onEdit: jest.fn(), onReimagine: jest.fn(), onMusic: jest.fn() })} />,
  );

  ["Music", "Edit", "Reimagine", "Listen", "Chapters", "Preferences"].forEach((label) => {
    expect(view.getByLabelText(label)).toBeTruthy();
  });
  expect(view.queryByLabelText("History")).toBeNull();
});

it("gives the sheet an architectural top radius, not a pill's", async () => {
  const view = await render(<ReaderChrome {...props()} />);

  const raw = view.getByTestId("reader-chrome-sheet").props.style as unknown;
  const layers = (Array.isArray(raw) ? raw.flat(Infinity) : [raw]) as Record<string, unknown>[];
  const flat = layers.reduce<Record<string, unknown>>(
    (all, layer) => ({ ...all, ...(layer ?? {}) }),
    {},
  );

  // `radius.md` (14), down from `radius.xl` (24).
  expect(flat.borderTopLeftRadius).toBe(14);
  expect(flat.borderTopRightRadius).toBe(14);
});
