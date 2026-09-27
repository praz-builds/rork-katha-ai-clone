/**
 * Explore's infinite scroll.
 *
 * Until 2026-09-27 there was none: the query ended in a bare
 * `.limit(SEARCH_PAGE_SIZE)`, so the screen could never show a 25th story and
 * a reader who scrolled to the bottom of the catalogue simply ran out, with
 * nothing to say so.
 *
 * The four ways paging goes wrong, and each has a test:
 *
 * 1. **`onEndReached` fires repeatedly**, including several times before the
 *    first response lands. A page per fire is a request storm.
 * 2. **A stale page appends to a new query.** The filter changes while page 2
 *    is on the wire; it must be dropped, not stapled onto page 1 of whatever
 *    the reader is now looking at. The existing sequence guard does NOT cover
 *    this on its own, because `loadMore` continues a query rather than
 *    starting one.
 * 3. **Rows arrive twice**, which in a `FlatList` is a duplicate key: a second
 *    card and a console warning, never a crash.
 * 4. **The footer lies.** A spinner that never resolves, or an end-of-list
 *    line above more stories.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

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
import { SEARCH_PAGE_SIZE, type SearchInput, type SearchOutcome } from "@/lib/search";
import { stories as seedStories } from "@/data/seed";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

/**
 * A page of `SEARCH_PAGE_SIZE` stories, all one genre.
 *
 * One genre on purpose: `spreadByKey` cannot interleave a single key, so the
 * order is the input's and an assertion about which ids are on screen stays
 * about paging rather than about the interleave.
 */
const page = (n: number): Story[] =>
  Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
    ...seedStories[0],
    id: `p${n}-${i}`,
    title: `Page ${n} story ${i}`,
    genre: "romance" as Story["genre"],
    chapters: [],
  }));

const outcome = (stories: Story[], hasMore: boolean): SearchOutcome => ({
  stories,
  hasMore,
  source: "supabase",
});

const renderWith = (
  search: (input: SearchInput, options?: unknown) => Promise<SearchOutcome>,
) =>
  render(
    <ExploreScreen
      stories={seedStories}
      onStory={jest.fn()}
      searchOptions={{ search, debounceMs: 0, prefetchTimeoutMs: 0 }}
    />,
  );

type ExploreView = Awaited<ReturnType<typeof renderWith>>;

/** What `FlatList` does when the reader nears the bottom. */
const reachEnd = async (view: ExploreView) => {
  await act(async () => {
    view.getByTestId("explore-list").props.onEndReached();
  });
};

const idsOnScreen = (view: ExploreView): string[] =>
  view.getByTestId("explore-list").props.data.map((story: Story) => story.id);

it("appends the next page when the reader reaches the bottom", async () => {
  const search = jest.fn(async (input: SearchInput) =>
    outcome(page(input.page ?? 0), (input.page ?? 0) < 1)
  );
  const view = await renderWith(search);

  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));
  expect(search).toHaveBeenCalledTimes(1);

  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );

  // Page 1, asked for once, ADDED to page 0 rather than replacing it.
  //
  // Membership rather than position: the screen shuffles by reader and day to
  // break ties before it sorts, so where a given card lands is deliberately
  // not fixed. What paging promises is that nothing already on screen leaves.
  expect(search.mock.calls[1][0].page).toBe(1);
  const ids = new Set(idsOnScreen(view));
  for (const story of [...page(0), ...page(1)]) {
    expect(ids.has(story.id)).toBe(true);
  }
});

it("asks once however many times the list says it reached the end", async () => {
  // `onEndReached` fires on every scroll event near the bottom, and the
  // repeats arrive in the same tick as the first -- which is why the guard is
  // a ref rather than state.
  let release: ((value: SearchOutcome) => void) | null = null;
  const search = jest.fn((input: SearchInput) => {
    if ((input.page ?? 0) === 0) return Promise.resolve(outcome(page(0), true));
    return new Promise<SearchOutcome>((resolve) => {
      release = resolve;
    });
  });
  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  await reachEnd(view);
  await reachEnd(view);
  await reachEnd(view);

  expect(search).toHaveBeenCalledTimes(2);
  await act(async () => {
    release?.(outcome(page(1), false));
  });
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );
});

it("never asks past the end of the catalogue", async () => {
  const search = jest.fn(async () => outcome(page(0), false));
  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  await reachEnd(view);
  await reachEnd(view);

  expect(search).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("explore-list-end")).toBeTruthy();
});

it("shows the spinner only while a page is actually on the way", async () => {
  let release: ((value: SearchOutcome) => void) | null = null;
  const search = jest.fn((input: SearchInput) => {
    if ((input.page ?? 0) === 0) return Promise.resolve(outcome(page(0), true));
    return new Promise<SearchOutcome>((resolve) => {
      release = resolve;
    });
  });
  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  // More exists but nothing has been asked for: no spinner, and no end-of-list
  // line either, because a footer under a list that is still growing reads as
  // the end of it.
  expect(view.queryByTestId("explore-loading-more")).toBeNull();
  expect(view.queryByTestId("explore-list-end")).toBeNull();

  await reachEnd(view);
  expect(view.getByTestId("explore-loading-more")).toBeTruthy();

  await act(async () => {
    release?.(outcome(page(1), false));
  });
  await waitFor(() => expect(view.getByTestId("explore-list-end")).toBeTruthy());
  expect(view.queryByTestId("explore-loading-more")).toBeNull();
});

it("drops a page that belongs to a query the reader has left", async () => {
  // The failure: type a new term while page 2 of the old one is in flight,
  // and the old page 2 appends to the new page 1. The reader gets results for
  // two different searches in one list, with nothing to indicate it.
  let releaseStale: ((value: SearchOutcome) => void) | null = null;
  const search = jest.fn((input: SearchInput) => {
    if (input.text === "" && (input.page ?? 0) === 0) {
      return Promise.resolve(outcome(page(0), true));
    }
    if (input.text === "" && (input.page ?? 0) === 1) {
      return new Promise<SearchOutcome>((resolve) => {
        releaseStale = resolve;
      });
    }
    // The new query's first page.
    return Promise.resolve(
      outcome([{ ...seedStories[0], id: "fresh", title: "Fresh", chapters: [] }], false),
    );
  });

  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  await reachEnd(view);
  await act(async () => {
    await fireEvent.changeText(view.getByPlaceholderText(SEARCH_PLACEHOLDER), "wolf");
  });
  await waitFor(() => expect(idsOnScreen(view)).toEqual(["fresh"]));

  // The stale page lands now. It must go nowhere.
  await act(async () => {
    releaseStale?.(outcome(page(1), false));
  });
  expect(idsOnScreen(view)).toEqual(["fresh"]);
});

it("does not render a story twice if a page overlaps", async () => {
  // The ordering is deterministic, so this should be impossible. It is
  // guarded anyway because the failure is silent: a duplicate key renders a
  // second card and warns to a console nobody is reading.
  const first = page(0);
  const search = jest.fn(async (input: SearchInput) =>
    (input.page ?? 0) === 0
      ? outcome(first, true)
      // Page 1 repeats the last two rows of page 0.
      : outcome([first[SEARCH_PAGE_SIZE - 2], first[SEARCH_PAGE_SIZE - 1], ...page(1)], false)
  );
  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );

  const ids = idsOnScreen(view);
  expect(new Set(ids).size).toBe(ids.length);
});

it("starts the next query at page 0, not where the last one stopped", async () => {
  const search = jest.fn(async (input: SearchInput) =>
    outcome(page(input.page ?? 0), (input.page ?? 0) < 1)
  );
  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));
  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );

  search.mockClear();
  await act(async () => {
    await fireEvent.changeText(view.getByPlaceholderText(SEARCH_PLACEHOLDER), "wolf");
  });

  await waitFor(() => expect(search).toHaveBeenCalled());
  expect(search.mock.calls[0][0].page ?? 0).toBe(0);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));
});
