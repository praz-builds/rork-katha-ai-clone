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

let mockBlockedAuthorIds = new Set<string>();
jest.mock("@/lib/blocks", () => {
  const actual = jest.requireActual("@/lib/blocks");
  return { ...actual, useBlockedAuthorIds: () => mockBlockedAuthorIds };
});

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
  // A real debounce matters for the auto-advance test and only for that one.
  // With 0 the query fires synchronously with the keystroke, so there is never
  // a render where the filter has changed and the previous query's rows are
  // still on screen -- which is exactly the window the chase guard gets wrong.
  // A test at 0 cannot see it, and passes against every broken version.
  debounceMs = 0,
) =>
  render(
    <ExploreScreen
      stories={seedStories}
      onStory={jest.fn()}
      searchOptions={{ search, debounceMs, prefetchTimeoutMs: 0 }}
    />,
  );

type ExploreView = Awaited<ReturnType<typeof renderWith>>;

/** What `FlatList` does when the reader nears the bottom. */
const reachEnd = async (view: ExploreView) => {
  await act(async () => {
    view.getByTestId("explore-list").props.onEndReached();
  });
};

beforeEach(() => {
  mockBlockedAuthorIds = new Set<string>();
});

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

// THE ONE THAT WAS MISSING, and it is the property a reader actually feels.
//
// The tie-break shuffle and the genre interleave are both whole-list
// operations. Run over a list that grows, they re-order the rows already on
// screen: the reader reaches the bottom, asks for more, and the screen they
// were reading is dealt again under their thumb. The first version of this PR
// did exactly that -- 4 of the first 24 positions survived a page arriving --
// and every test it had still passed, because they asserted determinism for
// the same input and the run limit on the combined list. Neither is this.
//
// The fix is to order each page among its own rows, so a page that has been
// rendered is never an input to anything again.
it("never re-orders the rows already on screen when a page arrives", async () => {
  // Several genres, so the interleave has something to do and would visibly
  // re-deal if it ran over the whole list.
  const mixed = (n: number): Story[] =>
    Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
      ...seedStories[0],
      id: `m${n}-${i}`,
      title: `Mixed ${n}-${i}`,
      genre: (["romance", "comedy", "fantasy", "horror"] as const)[i % 4],
      chapters: [],
    }));
  const search = jest.fn(async (input: SearchInput) =>
    outcome(mixed(input.page ?? 0), (input.page ?? 0) < 1)
  );

  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));
  const before = idsOnScreen(view);

  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );

  // Every position in the first page is exactly where it was.
  expect(idsOnScreen(view).slice(0, SEARCH_PAGE_SIZE)).toEqual(before);
});

// Every failure inside `searchStories` RESOLVES rather than rejects, so a
// dropped connection arrives in the success handler as an empty `local`
// outcome. Advancing the cursor on it skips a page for good: the reader's
// Explore goes from story 24 to story 49 with no gap visible anywhere, and
// nothing on screen knows a page was lost.
it("retries the page that failed rather than the one after it", async () => {
  let failNext = true;
  const search = jest.fn(async (input: SearchInput) => {
    const p = input.page ?? 0;
    if (p === 0) return outcome(page(0), true);
    if (failNext) {
      failNext = false;
      // What `searchStories` returns when it cannot reach the server.
      return { stories: [], hasMore: true, source: "local" as const };
    }
    return outcome(page(p), false);
  });

  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  await reachEnd(view);
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  // The failure appended nothing.
  expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE);

  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );

  // Page 1 both times. Asking for page 2 here would lose rows 24-47 for the
  // rest of the session.
  expect(search.mock.calls[1][0].page).toBe(1);
  expect(search.mock.calls[2][0].page).toBe(1);
  expect(new Set(idsOnScreen(view)).size).toBe(SEARCH_PAGE_SIZE * 2);
});

// The other half of the stale-answer fix. Aborting the superseded request is
// right; leaving `status` at "loading" switches paging off for the rest of the
// query, because `loadMore` is guarded on it -- and the footer shows nothing
// at all, because `hasMore` is still true. Explore stops at 24 stories
// forever, which is the fault this whole branch exists to fix.
it("keeps growing after the reader backspaces to a query already loaded", async () => {
  const search = jest.fn((input: SearchInput) => {
    if (input.text === "" && (input.page ?? 0) === 0) {
      return Promise.resolve(outcome(page(0), true));
    }
    if (input.text === "" && (input.page ?? 0) === 1) {
      return Promise.resolve(outcome(page(1), false));
    }
    // The typo's request, left hanging: the reader backspaces before it lands.
    return new Promise<SearchOutcome>(() => {});
  });

  const view = await renderWith(search);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  const field = view.getByPlaceholderText(SEARCH_PLACEHOLDER);
  await act(async () => {
    await fireEvent.changeText(field, "w");
  });
  await act(async () => {
    await fireEvent.changeText(field, "");
  });

  // Back where they started, with the 24 rows still on screen...
  expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE);
  // ...and the bottom of the list still works.
  await reachEnd(view);
  await waitFor(() =>
    expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE * 2)
  );
});

// The auto-advance chase: when a client-side filter empties a page, the list
// has no bottom to reach, so `onEndReached` can never fire and the screen must
// ask for the next page itself. Its stop-guard is a ref, and a ref outlives
// the query it was recorded for -- which two versions of this got wrong by
// changing the number in it instead of clearing it. Both collided with
// certainty: the row count is always 24 on a full page 0, and the page count
// is always 1 at the first advance of any query.
it("chases again on a new query, not just the first one", async () => {
  // BOTH queries end empty, which is what makes this catch anything. A first
  // query that ends with rows leaves `visible.length > 0`, so the chase returns
  // at its first guard on the way out and never arms the ref -- and then the
  // test passes with every version of the guard, including the broken ones.
  const search = jest.fn(async (input: SearchInput) => {
    if (input.text === "") return outcome(page(0), false);
    // Page 0 narrows to nothing but the server had a full page, so there is
    // more to ask for: exactly what `hasMore` counting server rows is for.
    // Every page: a full server page that the defensive genre filter narrows
    // to nothing. `hasMore` counts what the SERVER returned, so it stays true
    // -- the chase stops because the page added no rows, not because the
    // catalogue ended. That distinction is what makes the stale window exist
    // at all: `hasMore` is still true when the reader taps the next filter.
    return outcome([], true);
  });

  const view = await renderWith(search, 20);
  await waitFor(() => expect(idsOnScreen(view)).toHaveLength(SEARCH_PAGE_SIZE));

  // First query: page 0 empty, the chase runs, page 1 is empty too and the
  // chase stops. This is what leaves the stop-guard armed.
  await act(async () => {
    await fireEvent.changeText(view.getByPlaceholderText(SEARCH_PLACEHOLDER), "one");
  });
  await waitFor(() =>
    expect(search.mock.calls.filter((c) => c[0].text === "one" && c[0].page === 1))
      .toHaveLength(1)
  );

  // Second query, same shape. It must chase too. Every broken version of the
  // guard stores the same value for both queries and this one never moves.
  await act(async () => {
    await fireEvent.changeText(view.getByPlaceholderText(SEARCH_PLACEHOLDER), "two");
  });
  await waitFor(() =>
    expect(search.mock.calls.filter((c) => c[0].text === "two" && c[0].page === 1))
      .toHaveLength(1)
  );

  // And it still stops: one chase per query, not a loop.
  expect(
    search.mock.calls.filter((c) => c[0].text === "two" && c[0].page === 1),
  ).toHaveLength(1);
});

// THE CASE THE CHASE EXISTS FOR, and the one its first bound did not bound.
//
// A page can be full of rows the SERVER returned and empty after the client
// narrows it -- the tag filter, or the block list. That still grows
// `pageStarts`, so a guard keyed on "where did the last chase happen" stops
// matching and the walk runs page after page: a reader who leaves a tag on and
// taps a genre marches through it 24 rows at a time without scrolling. The
// earlier fixture returned an EMPTY page, which stops after one pass for a
// different reason, so it never saw this.
it("gives up after a couple of pages when the client filter keeps emptying them", async () => {
  // Every page is FULL from the server and empty after the client narrows it:
  // every row is by an author the reader has blocked. That is the shape a tag
  // filter produces too, and the one a marker-based guard cannot bound,
  // because `pageStarts` grows on every one of these pages.
  mockBlockedAuthorIds = new Set(["blocked-author"]);
  const search = jest.fn(async (input: SearchInput) =>
    outcome(
      Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
        ...seedStories[0],
        id: `p${input.page ?? 0}-${i}`,
        title: `Story ${input.page ?? 0}-${i}`,
        authorId: "blocked-author",
        chapters: [],
      })),
      true,
    )
  );

  await renderWith(search, 20);
  await waitFor(() => expect(search).toHaveBeenCalled());

  // Let every timer and promise settle; an unbounded walk would keep going.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  // Page 0 plus exactly two chases. `toBe`, not `toBeLessThanOrEqual`: the
  // one-sided bound was also satisfied by the chase not happening at all,
  // which is variant 3 of this same effect -- one call for page 0, and green.
  expect(search.mock.calls.length).toBe(3);
});

// WHERE THAT WALK ENDS, which is the state a reader is now guaranteed to see.
//
// The budget stops the requests; it does not decide what the screen says. The
// genre branch of the empty state blamed the catalogue -- "This genre is new
// here. More will appear as writers publish in it." -- over a genre whose rows
// had been fetched and then removed by the reader's own filter, with `hasMore`
// still true and no way out, because `onEndReached` cannot fire against an
// empty list.
it("does not call a genre new when the reader's own filter emptied it", async () => {
  mockBlockedAuthorIds = new Set(["blocked-author"]);
  const search = jest.fn(async (input: SearchInput) =>
    outcome(
      Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
        ...seedStories[0],
        id: `p${input.page ?? 0}-${i}`,
        title: `Story ${input.page ?? 0}-${i}`,
        genre: "fantasy" as Story["genre"],
        authorId: "blocked-author",
        chapters: [],
      })),
      true,
    )
  );

  const view = await renderWith(search, 20);
  await act(async () => {
    fireEvent.press(view.getByLabelText("Fantasy"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  expect(view.queryByText(/This genre is new here/)).toBeNull();
  expect(view.getByText(/Everything found here is by a writer you blocked/))
    .toBeTruthy();
  // And a way to carry on, since the scroll that would normally fetch the next
  // page has no list to happen on.
  const keepLooking = view.getByText("Keep looking");
  const before = search.mock.calls.length;
  await act(async () => {
    fireEvent.press(keepLooking);
  });
  expect(search.mock.calls.length).toBe(before + 1);
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


// THE TAG PATH, which is the one the docblock names and the one with the copy
// a reader is most likely to see: a tag left checked from the previous results
// while they tap a genre, or type a term.
//
// Both of these fetch rows that match perfectly and then remove them here, so
// what the screen says has to name the filter rather than the catalogue.
const taggedPage = (n: number, tag: string): Story[] =>
  Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
    ...seedStories[0],
    id: `p${n}-${i}`,
    title: `Story ${n}-${i}`,
    genre: "fantasy" as Story["genre"],
    tags: [tag],
    chapters: [],
  }));

/** Check a tag in the filter panel. The chip label is capitalised. */
const checkFirstTag = async (view: ExploreView, tag: string) => {
  await act(async () => {
    fireEvent.press(view.getByLabelText("Filters"));
  });
  await act(async () => {
    fireEvent.press(await view.findByText(tag));
  });
};

it("blames the tag, not the genre, when the tag is what emptied it", async () => {
  const search = jest.fn(async (input: SearchInput) =>
    outcome(taggedPage(input.page ?? 0, "dragons"), true)
  );
  const view = await renderWith(search, 20);
  await waitFor(() => expect(search).toHaveBeenCalled());

  await checkFirstTag(view, "Dragons");
  // Now a tag that nothing coming back carries.
  search.mockImplementation(async (input: SearchInput) =>
    outcome(taggedPage(input.page ?? 0, "pirates"), true)
  );
  await act(async () => {
    fireEvent.press(view.getByLabelText("Fantasy"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  expect(view.queryByText(/This genre is new here/)).toBeNull();
  expect(view.getByText(/Your filters are narrower than the catalogue/)).toBeTruthy();
  // The body says to clear them, so the button that clears them is here --
  // alongside Keep looking, not instead of it.
  expect(view.getByText("Clear filters")).toBeTruthy();
  expect(view.getByText("Keep looking")).toBeTruthy();
});

it("does not blame the search term when a tag is what emptied it", async () => {
  // Typing does not clear the tags, and the chip that caused this is off
  // screen by then -- `availableTags` comes from the results, and there are
  // none. "Try a different spelling" is advice about the wrong thing.
  const search = jest.fn(async (input: SearchInput) =>
    outcome(taggedPage(input.page ?? 0, "dragons"), true)
  );
  const view = await renderWith(search, 20);
  await waitFor(() => expect(search).toHaveBeenCalled());

  await checkFirstTag(view, "Dragons");
  search.mockImplementation(async (input: SearchInput) =>
    outcome(taggedPage(input.page ?? 0, "pirates"), true)
  );
  await act(async () => {
    fireEvent.changeText(view.getByPlaceholderText(SEARCH_PLACEHOLDER), "dragon");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  expect(view.queryByText(/Try a different spelling/)).toBeNull();
  expect(view.getByText(/Your filters are narrower than the catalogue/)).toBeTruthy();
});
