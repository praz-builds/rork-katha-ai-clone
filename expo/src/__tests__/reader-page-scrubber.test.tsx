import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ReaderChrome } from "@/components/reader/ReaderChrome";
import type { ReaderChromeProps } from "@/components/reader/ReaderChrome";

// Deliberately its own file rather than a block inside `reader-chrome.test.tsx`.
// That suite calls `cleanup()` in the middle of a test and renders again after
// it; anything appended below that point renders into a torn-down root and gets
// an empty tree back. Isolation here is cheaper than untangling that.
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

/**
 * The Pages control is a scrubber, and used to be a stepper wearing a track.
 *
 * It advanced exactly ONE page per tap wherever you touched it, and wrapped
 * back to page 1 once it reached the end. So on a forty-page chapter, tapping
 * three-quarters along moved you a single page, and tapping near the end threw
 * you back to the beginning. A control that draws a filled track and a thumb is
 * making a promise about position; that one did not keep it.
 */
describe("the Pages scrubber", () => {
  /** Give the track a measured width, which `seekTo` refuses to act without. */
  async function layOutTrack(view: Awaited<ReturnType<typeof render>>) {
    // The sheet animates in, so on first render RNTL considers the subtree
    // hidden. The control is mounted and interactive; only the query needs
    // telling.
    const track = view.getByTestId("page-scrubber", { includeHiddenElements: true });
    await fireEvent(track, "layout", {
      nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } },
    });
    return track;
  }

  it("jumps to the page the touch actually points at", async () => {
    const onPageChange = jest.fn();
    const view = await render(
      <ReaderChrome {...props({ pageCount: 41, pageIndex: 0, onPageChange })} />,
    );
    const track = await layOutTrack(view);

    // Three quarters along a 41-page chapter is page 31 (index 30), not page 2.
    await fireEvent(track, "responderGrant", {
      nativeEvent: { locationX: 150 },
    });
    expect(onPageChange).toHaveBeenCalledWith(30);
  });

  it("scrubs on drag, not only on the initial touch", async () => {
    const onPageChange = jest.fn();
    const view = await render(
      <ReaderChrome {...props({ pageCount: 11, pageIndex: 0, onPageChange })} />,
    );
    const track = await layOutTrack(view);

    await fireEvent(track, "responderMove", { nativeEvent: { locationX: 100 } });
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("never wraps: touching the end stays at the end", async () => {
    // The specific old bug. Landing on the last page and touching the far
    // right sent the reader back to page 1.
    const onPageChange = jest.fn();
    const view = await render(
      <ReaderChrome {...props({ pageCount: 5, pageIndex: 4, onPageChange })} />,
    );
    const track = await layOutTrack(view);

    await fireEvent(track, "responderGrant", {
      nativeEvent: { locationX: 200 },
    });
    // Already there, so nothing is emitted — and crucially not page 0.
    expect(onPageChange).not.toHaveBeenCalledWith(0);
  });

  it("does nothing before the track has been measured", async () => {
    // `trackWidth` starts at 0. Acting on that would divide by zero, or guess
    // a width and send the very first touch to the wrong page.
    const onPageChange = jest.fn();
    const view = await render(
      <ReaderChrome {...props({ pageCount: 10, pageIndex: 3, onPageChange })} />,
    );

    await fireEvent(view.getByTestId("page-scrubber", { includeHiddenElements: true }), "responderGrant", {
      nativeEvent: { locationX: 120 },
    });
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps one-page steps for a screen reader", async () => {
    // "increment" has no position to map, so the assistive path stays a
    // stepper — one page per swipe is what an adjustable is expected to do.
    const onPageChange = jest.fn();
    const view = await render(
      <ReaderChrome {...props({ pageCount: 10, pageIndex: 3, onPageChange })} />,
    );

    await fireEvent(view.getByTestId("page-scrubber", { includeHiddenElements: true }), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});
