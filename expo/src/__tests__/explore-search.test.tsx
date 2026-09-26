/**
 * The three failures Explore's search has to survive, each tested against the
 * thing that actually fixes it.
 *
 * They look like one problem ("searching feels wrong") and are three:
 *
 *   1. a request per keystroke                → the debounce
 *   2. requests nobody is waiting on any more → the abort
 *   3. an older answer arriving last          → the sequence guard
 *
 * The third is the one worth writing a test for above all, because the first
 * two do not fix it and it fails SILENTLY: the reader sees results for a term
 * that is no longer in the box, with nothing to retry and no way to tell.
 *
 * Plus the safeguard on the way out: what the field sends to PostgREST.
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
import {
  hasUsableTerm,
  MIN_QUERY_LENGTH,
  sanitizeSearchTerm,
  searchLocalCatalogue,
} from "@/lib/search";
import type { SearchInput, SearchOutcome } from "@/lib/search";
import { stories as seedStories } from "@/data/seed";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

/** A story that exists only in a test, named so an assertion can find it. */
const fixture = (id: string, title: string): Story => ({
  ...seedStories[0],
  id,
  title,
  chapters: [],
});

const renderWith = (
  search: (
    input: SearchInput,
    options?: { signal?: AbortSignal; catalogue?: readonly Story[] },
  ) => Promise<SearchOutcome>,
  debounceMs = 0,
) =>
  render(
    <ExploreScreen
      stories={seedStories}
      onStory={jest.fn()}
      searchOptions={{ search, debounceMs }}
    />,
  );

type ExploreView = Awaited<ReturnType<typeof renderWith>>;

const type = async (view: ExploreView, value: string) =>
  await fireEvent.changeText(
    view.getByPlaceholderText(SEARCH_PLACEHOLDER),
    value,
  );

describe("the debounce", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends one query for a word typed at speed, not one per keystroke", async () => {
    const search = jest.fn(async (_input: SearchInput) =>
      ({ stories: [], source: "local" }) as SearchOutcome
    );
    const view = await renderWith(search, 220);

    // The initial browse query fires on mount. Everything after this is the
    // typing, and that is what the count below is about.
    await act(async () => {
      jest.advanceTimersByTime(220);
    });
    search.mockClear();

    for (const term of ["w", "wo", "wol", "wolf"]) {
      await type(view, term);
      await act(async () => {
        // Faster than the debounce window, the way a real typist arrives.
        jest.advanceTimersByTime(60);
      });
    }
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(220);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toMatchObject({ text: "wolf" });
  });
});

describe("overlapping requests", () => {
  it("never lets an older response overwrite a newer one", async () => {
    // Two searches, and the SLOW one is the one typed FIRST. Without the
    // sequence guard, "wolf"'s results land after "wolves" has already been
    // painted and quietly replace them.
    const resolvers: Record<string, (outcome: SearchOutcome) => void> = {};
    const search = jest.fn((input: SearchInput) =>
      new Promise<SearchOutcome>((resolve) => {
        resolvers[input.text] = resolve;
      })
    );

    const view = await renderWith(search);

    await type(view, "wolf");
    await waitFor(() => expect(resolvers["wolf"]).toBeDefined());
    await type(view, "wolves");
    await waitFor(() => expect(resolvers["wolves"]).toBeDefined());

    // The newer query answers first.
    await act(async () => {
      resolvers["wolves"]({
        stories: [fixture("newer", "The Wolves of Anvil Bay")],
        source: "supabase",
      });
    });
    await waitFor(() =>
      expect(view.getByText("The Wolves of Anvil Bay")).toBeTruthy()
    );

    // Then the older one, out of order. It must be discarded on arrival.
    await act(async () => {
      resolvers["wolf"]({
        stories: [fixture("older", "A Lone Wolf")],
        source: "supabase",
      });
    });

    expect(view.queryByText("A Lone Wolf")).toBeNull();
    expect(view.getByText("The Wolves of Anvil Bay")).toBeTruthy();
  });

  it("aborts the request it is replacing", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const search = jest.fn((
      _input: SearchInput,
      options?: { signal?: AbortSignal },
    ) => {
      signals.push(options?.signal);
      return new Promise<SearchOutcome>(() => {});
    });

    const view = await renderWith(search);
    await waitFor(() => expect(signals.length).toBe(1));

    await type(view, "wolf");
    await waitFor(() => expect(signals.length).toBe(2));

    // The first request's signal is aborted the moment the second starts, so
    // a slow network is not left carrying work whose answer is already stale.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe("what reaches the query", () => {
  it("strips every character that would re-shape a PostgREST filter", () => {
    // `or=(title.ilike.*x*,topic.ilike.*x*)` is parsed by splitting on commas
    // and matching parentheses, and ilike treats % and _ as wildcards. A term
    // carrying any of those does not merely fail to match - it changes the
    // filter the server parses, which is how a search box turns into a way to
    // read rows the clause was written to exclude.
    for (const char of [",", "(", ")", "%", "_", "*", "\\", "'", '"', "."]) {
      expect(sanitizeSearchTerm(`wolf${char}bay`)).toBe("wolf bay");
    }
    expect(
      sanitizeSearchTerm("wolf,is_public.eq.false)"),
    ).toBe("wolf is public eq false");
  });

  it("caps the term so a pasted essay is not sent as a search", () => {
    expect(sanitizeSearchTerm("a".repeat(500)).length).toBe(80);
  });

  it("treats one character as the reader still deciding, not a search", () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(hasUsableTerm("w")).toBe(false);
    expect(hasUsableTerm("wo")).toBe(true);
    // Punctuation is stripped before the length is judged, so `.` is not a
    // one-character search either.
    expect(hasUsableTerm("..")).toBe(false);
  });
});

describe("the offline fallback", () => {
  it("matches the same fields the live query does", () => {
    const target = seedStories[0];
    const byTitle = searchLocalCatalogue(
      { text: target.title.slice(0, 6), genre: null },
      seedStories,
    );
    expect(byTitle.map((story) => story.id)).toContain(target.id);

    const byGenre = searchLocalCatalogue(
      { text: "", genre: "fantasy" },
      seedStories,
    );
    expect(byGenre.length).toBeGreaterThan(0);
    for (const story of byGenre) expect(story.genre).toBe("fantasy");

    const bedtime = searchLocalCatalogue(
      { text: "", genre: null, bedtime: true },
      [
        { ...target, id: "all-ages", audienceMode: "kids" },
        { ...target, id: "adult", audienceMode: "adult" },
      ],
    );
    // Bedtime is not a friendlier name for all-ages. The bundled fallback
    // has no editorial bedtime tags, so the screen explains that it needs a
    // connection rather than re-labelling either row.
    expect(bedtime).toEqual([]);
  });
});

describe("the loading state", () => {
  it("says it is looking rather than claiming nothing matched", async () => {
    const search = jest.fn(() => new Promise<SearchOutcome>(() => {}));
    const view = await renderWith(search);

    // Nothing has answered yet. Telling a reader "no stories match" while the
    // answer is still in flight is simply wrong, and they will have moved on
    // before it corrects itself.
    await waitFor(() =>
      expect(view.getByText("Looking through the catalogue…")).toBeTruthy()
    );
    expect(view.queryByText(/No stories match/)).toBeNull();
  });
});
