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
  source: SearchOutcome["source"];
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

  const { text, genre, bedtime = false } = input;

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
    [catalogue, search, prefetch, prefetchTimeoutMs],
  );

  useEffect(() => {
    if (debounceMs <= 0) {
      run({ text, genre, bedtime });
      return;
    }
    const timer = setTimeout(() => run({ text, genre, bedtime }), debounceMs);
    return () => clearTimeout(timer);
  }, [text, genre, bedtime, debounceMs, run]);

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
