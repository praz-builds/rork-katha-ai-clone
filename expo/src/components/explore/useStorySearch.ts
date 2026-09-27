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
 * A fourth thing happens here that is not a failure at all: the first
 * screenful of covers is warmed before the rows are handed over, because this
 * is the only point in the flow that knows what the reader is about to see.
 * It is bounded by `PREFETCH_TIMEOUT_MS` and can never hold results back
 * beyond it, and no cover is ever requested twice — see the comment on those
 * constants and on `warmedCovers`.
 *
 * The state machine the caller renders from is deliberately explicit —
 * `idle`, `loading`, `ready`, `empty` — rather than a nullable list plus a
 * boolean, because "no results" and "results not here yet" are different
 * pages and a nullable list cannot tell them apart on the first render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "react-native";
import {
  SEARCH_DEBOUNCE_MS,
  searchStories,
  type SearchInput,
  type SearchOutcome,
} from "@/lib/search";
import type { Story } from "@/types/domain";

export type SearchStatus = "loading" | "ready" | "empty";

/**
 * How many covers are warmed before the results are handed to the list, and
 * how long that is allowed to take.
 *
 * WHY WARM THEM AT ALL. The card paints its genre gradient until its cover
 * loads (see `StoryFeedCard`), which is correct and is never gated on the
 * image — but it means the top of a cold Explore reliably shows a screen of
 * gradients for as long as the first requests take. Six is roughly the first
 * screenful at the reference frame; warming them costs nothing the list was
 * not about to spend anyway, and moves it a beat earlier.
 *
 * WHY THE TIMEOUT IS THE IMPORTANT HALF. This sits between a finished search
 * and the reader seeing it, so it is the one place a slow CDN could hold up a
 * result the app already has. It cannot: the wait is a race against the
 * timeout, nothing is retried, and a prefetch that fails or never answers is
 * simply forgotten. 180ms is under the threshold where a list feels like it
 * responded to the search rather than paused after it.
 */
const PREFETCH_COVERS = 6;
const PREFETCH_TIMEOUT_MS = 180;

/**
 * Every cover URI this session has already asked for, warmed or still in
 * flight, and the ceiling on how many it remembers.
 *
 * WHY THIS EXISTS. The warm-up above is a race against a 180ms timeout, and
 * when the timeout wins the requests do NOT stop — `Image.prefetch` returns a
 * promise with no abort, so the only thing the timeout ends is the waiting.
 * A search runs per settled keystroke, and the same stories come back for
 * "wol", "wolf", "wolve", so a reader typing a word could have the same six
 * covers requested four times over, each attempt still on the wire when the
 * next was made. The cost is the REQUEST, not the callback — so the fix has
 * to be to stop asking again, and a cancellation that merely ignored the
 * answer would fix nothing while looking like it had.
 *
 * WHY IT IS BOUNDED. This is module state with the lifetime of the JS
 * context, and a reader who browses Explore all evening would otherwise grow
 * it without limit. It evicts OLDEST FIRST rather than clearing wholesale,
 * because a `Set` iterates in insertion order and the covers a reader just
 * scrolled past are the ones most likely to come back in the next query;
 * dropping everything at the ceiling would re-request the current screenful
 * along with the rest. An evicted URI costs one extra request, which is what
 * this was before, so the ceiling degrades rather than breaks.
 */
export const WARMED_COVER_LIMIT = 60;
const warmedCovers = new Set<string>();

/**
 * Test seam. The set outlives a test file's modules, so two tests reusing a
 * cover URL would silently share it — the second would skip the prefetch and
 * pass without ever exercising what it names. Call this in `beforeEach`.
 */
export function resetWarmedCovers(): void {
  warmedCovers.clear();
}

/** Marked when the request is MADE, so an in-flight cover is not asked twice. */
function rememberCover(uri: string): void {
  warmedCovers.add(uri);
  while (warmedCovers.size > WARMED_COVER_LIMIT) {
    const oldest = warmedCovers.values().next().value;
    if (oldest === undefined) break;
    warmedCovers.delete(oldest);
  }
}

/** `Image.prefetch` is remote-only; a bundled seed asset is already local. */
function coverUris(stories: readonly Story[]): string[] {
  const uris: string[] = [];
  for (const story of stories) {
    if (uris.length >= PREFETCH_COVERS) break;
    if (story.coverImageUrl) uris.push(story.coverImageUrl);
  }
  return uris;
}

async function warmCovers(
  stories: readonly Story[],
  prefetch: (uri: string) => Promise<unknown>,
  timeoutMs: number,
  /** Whether this run is still the newest. See the note below the filter. */
  isCurrent: () => boolean,
): Promise<void> {
  // Anything already asked for is dropped here rather than re-requested. The
  // screenful is taken FIRST and filtered second, so a query whose top rows
  // are all warm warms nothing instead of reaching further down the list for
  // covers the reader cannot see yet.
  const uris = coverUris(stories).filter((uri) => !warmedCovers.has(uri));
  // No remote covers is the common case in tests and offline: return on the
  // same tick rather than arming a timer nothing is waiting for.
  if (uris.length === 0) return;
  // THE REQUEST IS THE COST, SO A SUPERSEDED RUN MUST NOT MAKE ONE -- and
  // there is less room here than it looks, which is worth writing down.
  //
  // A review asked for this on the grounds that a newer search starting
  // "during warm-up" leaves the obsolete one's covers competing for bandwidth
  // with the covers now on screen. The guard is cheap and correct, so it is
  // here. But it cannot currently fire: every uri below is launched in ONE
  // synchronous tick, so nothing can land between the caller's check and the
  // last launch. By the time the reader could type, the requests are already
  // on the wire, and `Image.prefetch` cannot be cancelled.
  //
  // So this is insurance against the launches ever becoming staggered (a
  // concurrency cap, a per-cover delay), not a fix for a reachable bug today.
  // It has no test, deliberately: a test could only assert something that
  // cannot happen, which is worse than no test. The thing that actually
  // bounds the spend is the `warmedCovers` filter above.
  if (!isCurrent()) return;
  for (const uri of uris) rememberCover(uri);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(uris.map((uri) =>
        isCurrent() ? prefetch(uri).catch(() => undefined) : Promise.resolve()
      )),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // Best effort, by definition. A prefetch layer that can throw must not be
    // able to stop the results it was only meant to make prettier.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const defaultPrefetch = (uri: string): Promise<unknown> =>
  typeof Image.prefetch === "function"
    ? Promise.resolve(Image.prefetch(uri))
    : Promise.resolve(false);

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
   */
  loadMore: () => void;
};

export type UseStorySearchOptions = {
  /** The local catalogue the offline/unconfigured fallback filters. */
  catalogue?: readonly Story[];
  /** Test seam. Defaults to the real query in `@/lib/search`. */
  search?: typeof searchStories;
  /** Test seam. 0 runs the query on the same tick. */
  debounceMs?: number;
  /** Test seam. Defaults to React Native's `Image.prefetch`. */
  prefetch?: (uri: string) => Promise<unknown>;
  /** Test seam. 0 hands the results over without warming anything. */
  prefetchTimeoutMs?: number;
};

export function useStorySearch(
  input: SearchInput,
  options: UseStorySearchOptions = {},
): StorySearchState {
  const {
    catalogue,
    search = searchStories,
    debounceMs = SEARCH_DEBOUNCE_MS,
    prefetch = defaultPrefetch,
    prefetchTimeoutMs = PREFETCH_TIMEOUT_MS,
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
        async (outcome) => {
          // The whole point. An answer to a question the reader has already
          // moved on from is discarded here rather than painted over the
          // answer to the one they are actually asking.
          if (sequence !== latestRun.current) return;

          // Warm the first screenful's covers, then hand the rows over. The
          // wait is bounded by `prefetchTimeoutMs` and by nothing else.
          if (prefetchTimeoutMs > 0) {
            await warmCovers(
              outcome.stories,
              prefetch,
              prefetchTimeoutMs,
              () => sequence === latestRun.current,
            );
            // The reader may have typed through the warm-up, so the sequence
            // is checked AGAIN on the other side of it. Checking only before
            // the await would reintroduce exactly the stale-answer bug the
            // guard exists to prevent.
            if (sequence !== latestRun.current) return;
          }

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
    [catalogue, search, prefetch, prefetchTimeoutMs],
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
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (!state.hasMore || state.status === "loading") return;
    if (loadedFor.current !== queryKey) return;

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
