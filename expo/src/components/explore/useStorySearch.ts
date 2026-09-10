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
  source: SearchOutcome["source"];
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

  const [state, setState] = useState<StorySearchState>({
    status: "loading",
    stories: [],
    source: "local",
  });

  // The sequence number of the newest run started, and the newest run
  // APPLIED. A result is applied only when its own sequence is the newest
  // started one - see (3) in the doc comment above. Refs, not state:
  // changing them must never itself schedule a render, or the effect below
  // would re-run on its own bookkeeping.
  const latestRun = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const { text, genre } = input;

  const run = useCallback(
    (searchInput: SearchInput) => {
      const sequence = ++latestRun.current;

      inFlight.current?.abort();
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
          setState({
            status: outcome.stories.length > 0 ? "ready" : "empty",
            stories: outcome.stories,
            source: outcome.source,
          });
        },
        () => {
          if (sequence !== latestRun.current) return;
          // `searchStories` already falls back rather than rejecting, so
          // reaching here means something outside it failed. An empty result
          // is the honest render: the screen's no-results state offers
          // genres, which is a way forward either way.
          setState({ status: "empty", stories: [], source: "local" });
        },
      );
    },
    [catalogue, search],
  );

  useEffect(() => {
    if (debounceMs <= 0) {
      run({ text, genre });
      return;
    }
    const timer = setTimeout(() => run({ text, genre }), debounceMs);
    return () => clearTimeout(timer);
  }, [text, genre, debounceMs, run]);

  // Abort whatever is open when the screen goes away. Without this, leaving
  // Explore mid-search leaves a request running and a `setState` aimed at an
  // unmounted tree - and the sequence guard, which is a ref, would happily
  // let it through.
  useEffect(() => () => {
    latestRun.current++;
    inFlight.current?.abort();
  }, []);

  return state;
}
