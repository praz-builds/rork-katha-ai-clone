/**
 * The search loop behind Explore: debounce, cancel, and never go backwards.
 *
 * Three separate failures live here, and they are easy to mistake for one:
 *
 * 1. **Too many requests.** A five-letter word typed at speed is five
 *    queries if every keystroke fires one. `SEARCH_DEBOUNCE_MS` collapses
 *    them into the one the reader actually meant.
 *
 * 2. **Requests nobody is waiting for.** Debouncing still leaves an in-flight
 *    request behind whenever the reader keeps typing through a pause, so each
 *    run gets an `AbortController` and the previous one is aborted. This is
 *    what stops a slow network from queueing work whose answer is already
 *    irrelevant.
 *
 * 3. **An older answer landing last.** This is the one that survives both
 *    fixes above and is the reason the other two are not enough. Abort is a
 *    request to stop, not a guarantee: a response already on the wire still
 *    resolves, and two overlapping searches can complete in either order. If
 *    the reader types "wolf", then "wolves", and "wolf" answers second, the
 *    list ends up showing results for a term that is no longer in the box —
 *    with no error, nothing to retry, and no way for the reader to tell.
 *    Every run therefore carries a monotonically increasing sequence number,
 *    and a result is applied ONLY if its sequence is still the newest. An
 *    older sequence is dropped on arrival, whatever it contains.
 *
 * THERE WAS A FOURTH THING HERE AND IT IS GONE. Until 2026-09-27 this hook
 * warmed the first six covers with `Image.prefetch` and raced that against a
 * 180ms timeout before handing the rows over. It never worked and could not
 * have: it delayed the first paint by up to 180ms to get a head start on a
 * ~2MB PNG, so the race was designed to lose, and `Image.prefetch` only warms
 * the in-memory/HTTP cache for the session anyway. What was needed was fewer
 * bytes and a real disk cache, which is `lib/cover-url.ts` and `expo-image`.
 *
 * The state machine the caller renders from is deliberately explicit —
 * `idle`, `loading`, `ready`, `empty` — rather than a nullable list plus a
 * boolean, because "no results" and "results not here yet" are different
 * pages and a nullable list cannot tell them apart on the first render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SEARCH_DEBOUNCE_MS,
  searchStories,
  type SearchInput,
  type SearchOutcome,
} from "@/lib/search";
import type { Story } from "@/types/domain";

export type SearchStatus = "loading" | "ready" | "empty";

export type StorySearchState = {
  status: SearchStatus;
  stories: Story[];
  /**
   * The index in `stories` at which each page begins, newest page last. Always
   * starts with 0.
   *
   * WHY THE CALLER NEEDS THIS. Explore re-orders what it renders -- a seeded
   * tie-break, then the reader's sort, then a genre interleave -- and every
   * one of those is a whole-list operation. Run over a list that GROWS, they
   * re-order the rows already on screen: the reader reaches the bottom, asks
   * for more, and the screen they were reading is dealt again under their
   * thumb. Measured on the first version of this: 4 of the first 24 positions
   * survived a page arriving.
   *
   * Page boundaries let the caller order each page among its own rows and
   * concatenate, which is append-stable by construction -- a page already
   * rendered is never an input to anything again. The cost is that the seam
   * between two pages can repeat a genre; that is one run of two at every
   * 24th card, against the whole list re-shuffling.
   */
  pageStarts: number[];
  source: SearchOutcome["source"];
  /** A further page might exist. See `hasMore` on `SearchOutcome`. */
  hasMore: boolean;
  /** A next page is in flight. The first page reports `status: "loading"`. */
  loadingMore: boolean;
  /**
   * Ask for the next page. A no-op while one is in flight, at the end of the
   * list, or before the first page has landed -- so the caller can wire it
   * straight to `onEndReached`, which fires more than once and fires early.
   *
   * **Returns whether it actually started a request.** `onEndReached` does not
   * care, but Explore's auto-advance does: it records that it has chased a
   * page so it cannot chase the same one twice, and recording that against a
   * call the guards refused is how the chase ends up disarmed for a query it
   * never ran for.
   */
  loadMore: () => boolean;
};

export type UseStorySearchOptions = {
  /** The local catalogue the offline/unconfigured fallback filters. */
  catalogue?: readonly Story[];
  /** Test seam. Defaults to the real query in `@/lib/search`. */
  search?: typeof searchStories;
  /** Test seam. 0 runs the query on the same tick. */
  debounceMs?: number;
};

export function useStorySearch(
  input: SearchInput,
  options: UseStorySearchOptions = {},
): StorySearchState {
  const {
    catalogue,
    search = searchStories,
    debounceMs = SEARCH_DEBOUNCE_MS,
  } = options;

  const [state, setState] = useState<Omit<StorySearchState, "loadMore">>({
    status: "loading",
    stories: [],
    pageStarts: [0],
    source: "local",
    hasMore: false,
    loadingMore: false,
  });

  // The sequence number of the newest run started, and the newest run
  // APPLIED. A result is applied only when its own sequence is the newest
  // started one - see (3) in the doc comment above. Refs, not state:
  // changing them must never itself schedule a render, or the effect below
  // would re-run on its own bookkeeping.
  const latestRun = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // The highest page successfully applied, and the query it belongs to. The
  // query is compared by value on every `loadMore`: a page-2 request that
  // outlived a filter change must not append to page 1 of the new one, and
  // the sequence guard alone does not catch that, because `loadMore` does not
  // start a new query -- it continues the current one.
  const loadedPage = useRef(0);
  const loadedFor = useRef("");
  const loadingMoreRef = useRef(false);
  const pageInFlight = useRef<AbortController | null>(null);

  const { text, genre, bedtime = false } = input;
  const queryKey = `${text}\u0000${genre ?? ""}\u0000${bedtime}`;

  const run = useCallback(
    (searchInput: SearchInput) => {
      const sequence = ++latestRun.current;
      loadingMoreRef.current = false;

      inFlight.current?.abort();
      pageInFlight.current?.abort();
      pageInFlight.current = null;
      const controller = typeof AbortController !== "undefined"
        ? new AbortController()
        : null;
      inFlight.current = controller;

      setState((current) => ({ ...current, status: "loading" }));

      void search(searchInput, {
        signal: controller?.signal,
        catalogue,
      }).then(
        (outcome) => {
          // The whole point. An answer to a question the reader has already
          // moved on from is discarded here rather than painted over the
          // answer to the one they are actually asking.
          if (sequence !== latestRun.current) return;

          // Reset ON SUCCESS, not on start. A run that is aborted or skipped
          // must leave this alone: the list it would have replaced is still on
          // screen, pages and all, and a `loadedPage` of 0 under three pages of
          // rows means the next `onEndReached` re-requests page 1, has every
          // row dropped as a duplicate, and makes the reader reach the bottom
          // once per page already loaded before a new one arrives.
          loadedPage.current = 0;
          loadedFor.current = `${searchInput.text}\u0000${searchInput.genre ?? ""}\u0000${searchInput.bedtime === true}`;
          setState({
            status: outcome.stories.length > 0 ? "ready" : "empty",
            stories: outcome.stories,
            pageStarts: [0],
            source: outcome.source,
            hasMore: outcome.hasMore,
            loadingMore: false,
          });
        },
        () => {
          if (sequence !== latestRun.current) return;
          // `searchStories` already falls back rather than rejecting, so
          // reaching here means something outside it failed. An empty result
          // is the honest render: the screen's no-results state offers
          // genres, which is a way forward either way.
          setState({
            status: "empty",
            stories: [],
            pageStarts: [0],
            source: "local",
            hasMore: false,
            loadingMore: false,
          });
        },
      );
    },
    [catalogue, search],
  );

  /**
   * The next page, appended.
   *
   * It deliberately does NOT go through `run`. `run` aborts what is in flight
   * and replaces the list, which is right for a new query and exactly wrong
   * for a continuation: it would throw away the pages already on screen. So
   * this has its own guards rather than borrowing that one's.
   *
   * Three things can go wrong and each has a guard:
   *
   * - **`onEndReached` fires repeatedly**, including more than once before a
   *   response lands. `loadingMoreRef` is a ref, not state, because the
   *   second call arrives in the same tick as the first and a state update
   *   has not been applied yet.
   * - **The filter changes while page 2 is in flight.** `run` bumps the
   *   sequence, so the stale page is dropped on the sequence check -- and
   *   `loadedFor` is compared as well, because a reader could return to the
   *   same query and a sequence number alone would then let an answer from
   *   the previous visit through.
   * - **A page arrives out of order.** Only one is ever in flight, and
   *   `loadedPage` only advances on a page that was applied.
   *
   * A failed page is not an error state: the list already on screen is still
   * good. It simply stops offering more, because a footer spinner that never
   * resolves is worse than an end-of-list line.
   */
  const loadMore = useCallback((): boolean => {
    if (loadingMoreRef.current) return false;
    if (!state.hasMore || state.status === "loading") return false;
    if (loadedFor.current !== queryKey) return false;

    const sequence = latestRun.current;
    const nextPage = loadedPage.current + 1;
    loadingMoreRef.current = true;
    // Tracked in `pageInFlight` so `run` and the unmount effect can abort it.
    // Without this a page fetched just before the reader leaves Explore, or
    // changes the filter, runs to completion and is thrown away on arrival --
    // harmless, and a request nobody wanted.
    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
    pageInFlight.current = controller;
    setState((current) => ({ ...current, loadingMore: true }));

    const settle = () => {
      // Cleared INSIDE the guard, not before it. Clearing first meant a page
      // whose sequence had moved on released the lock while a newer page was
      // still in flight, so the next `onEndReached` sent a third request for
      // the page already being fetched. Benign -- `appendUnseen` drops the
      // rows and the page number is the same -- and still a wasted trip.
      loadingMoreRef.current = false;
      if (pageInFlight.current === controller) pageInFlight.current = null;
    };

    void search(
      { text, genre, bedtime, page: nextPage },
      { catalogue, signal: controller?.signal },
    ).then(
      (outcome) => {
        if (sequence !== latestRun.current || loadedFor.current !== queryKey) return;
        settle();
        // A FAILED PAGE MUST NOT BURN ITS PAGE NUMBER. Every failure inside
        // `searchStories` resolves rather than rejects -- a query error, a
        // failed block-list lookup, anything the outer catch sees -- so they
        // all arrive HERE, in the success handler, as an empty `local`
        // outcome. Advancing unconditionally meant a dropped connection on
        // page 1 moved the cursor to 1, appended nothing, and left the next
        // scroll asking for page 2: rows 24-47 never requested again, no gap
        // visible anywhere, and nothing on screen aware a page was lost.
        //
        // `source` is the discriminator, and it is already on the outcome. A
        // legitimately short server page still advances, because it is
        // "supabase"; only "local" -- which is this client saying it could not
        // tell -- holds the cursor so the next scroll retries the same page.
        if (outcome.source !== "local") loadedPage.current = nextPage;
        setState((current) => {
          // De-duplicated by id. The ordering is deterministic, so this should
          // never fire -- which is the reason to keep it: a repeated key in a
          // FlatList is a silent render bug, not a crash.
          const stories = appendUnseen(current.stories, outcome.stories);
          return {
            ...current,
            stories,
            // Where this page begins. Recorded only when it actually added
            // rows, so a page that de-duplicated to nothing does not leave an
            // empty slice behind for the caller to order.
            pageStarts: stories.length > current.stories.length
              ? [...current.pageStarts, current.stories.length]
              : current.pageStarts,
            hasMore: outcome.hasMore,
            loadingMore: false,
          };
        });
      },
      () => {
        if (sequence !== latestRun.current) return;
        settle();
        setState((current) => ({ ...current, loadingMore: false, hasMore: false }));
      },
    );
    return true;
  }, [
    bedtime,
    catalogue,
    genre,
    queryKey,
    search,
    state.hasMore,
    state.status,
    text,
  ]);

  useEffect(() => {
    // Re-running the query the reader is already looking at throws away every
    // page after the first. Type a character and delete it -- A, AB, A -- and
    // the third run is query A again: three pages of scrolled list collapse
    // back to 24 rows under the thumb. `loadedFor` is what already landed, so
    // an exact match with nothing in flight has nothing to do.
    const fire = () => {
      if (loadedFor.current === queryKey && !loadingMoreRef.current) {
        // SKIPPING THE QUERY MUST NOT SKIP THE CANCELLATION. `run` bumped the
        // sequence and aborted the previous request on every fire, and those
        // two are what make guard (3) in the header comment work. Returning
        // without them leaves a SUPERSEDED request holding the newest
        // sequence, and its answer is applied to a query the reader has left.
        //
        // The path is a typo and a backspace inside one round trip: "wolf" is
        // loaded, the reader types "wolfs" and `run` starts it, the reader
        // backspaces to "wolf" -- `loadedFor` is still "wolf", because it is
        // only assigned when a run SUCCEEDS -- so this branch is taken while
        // "wolfs" is still on the wire. It then lands, matches the sequence
        // nobody moved, and paints results for a term that is not in the box,
        // with nothing to retry and no way to tell. It never self-corrects:
        // no dep changes again until the reader types.
        // AND PUT THE STATE MACHINE BACK, which is the other half and is
        // easier to miss than the abort. `run` set `status: "loading"` when it
        // started the request just invalidated, and both of that request's
        // handlers early-return on the sequence check -- so nothing ever
        // writes state again. `loadMore` is guarded on `status !== "loading"`,
        // so paging switches off for the rest of the query: the reader reaches
        // the bottom of their 24 cards and nothing loads, with no spinner and
        // no end-of-list line, because `hasMore` is still true. That is the
        // very fault this branch exists to fix, reached through its own fix.
        //
        // `loadedPage` needs no restoring here, because `run` no longer resets
        // it on the way out -- see the comment where it now does, in the
        // success handler. Resetting on start meant an abandoned run left it
        // at 0 while `stories` still held every page the reader had scrolled.
        latestRun.current++;
        inFlight.current?.abort();
        inFlight.current = null;
        setState((current) => ({
          ...current,
          status: current.stories.length > 0 ? "ready" : "empty",
        }));
        return;
      }
      run({ text, genre, bedtime });
    };
    if (debounceMs <= 0) {
      fire();
      return;
    }
    const timer = setTimeout(fire, debounceMs);
    return () => clearTimeout(timer);
  }, [text, genre, bedtime, debounceMs, queryKey, run]);

  // Abort whatever is open when the screen goes away. Without this, leaving
  // Explore mid-search leaves a request running and a `setState` aimed at an
  // unmounted tree - and the sequence guard, which is a ref, would happily
  // let it through.
  useEffect(() => () => {
    latestRun.current++;
    inFlight.current?.abort();
    pageInFlight.current?.abort();
  }, []);

  return { ...state, loadMore };
}

/**
 * `next` appended to `current`, skipping any id already present.
 *
 * The page order is deterministic (`like_count`, `created_at`, `id`), so an
 * overlap should be impossible. It is guarded anyway because the failure is
 * silent: a duplicate key in a `FlatList` renders a second card and warns to
 * a console nobody is reading, rather than throwing.
 */
function appendUnseen(current: Story[], next: Story[]): Story[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((story) => story.id));
  const fresh = next.filter((story) => !seen.has(story.id));
  return fresh.length === 0 ? current : [...current, ...fresh];
}
