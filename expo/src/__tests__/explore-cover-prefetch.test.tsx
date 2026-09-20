/**
 * Warming the first screenful of Explore covers, and the rule that matters
 * more than the warming: it may never hold the results up.
 *
 * A feed card paints its genre gradient until its cover loads and is never
 * gated on the image (see `StoryFeedCard`), so the only way to stop a cold
 * Explore opening on a screen of gradients is to ask for those covers a beat
 * before the list asks. That is a nicety. The results are not — which is why
 * the second test here is the important one: a prefetch that never answers
 * must cost the reader the timeout and nothing more.
 */
import { renderHook, waitFor } from "@testing-library/react-native";
import { useStorySearch } from "@/components/explore/useStorySearch";
import type { SearchOutcome } from "@/lib/search";
import { stories as seedStories } from "@/data/seed";
import type { Story } from "@/types/domain";

/** Seed stories carry bundled art; only a URL can be prefetched. */
const remote = (index: number): Story => ({
  ...seedStories[index % seedStories.length],
  id: `remote-${index}`,
  coverImage: undefined,
  coverImageUrl: `https://example.test/cover-${index}.png`,
});

const outcome = (stories: Story[]): SearchOutcome => ({
  stories,
  source: "supabase",
});

/**
 * The options object is built ONCE, outside the render callback. Handing the
 * hook a fresh `search`/`prefetch` pair on every render would re-arm its
 * effect on its own output and spin forever — which is a property of any hook
 * whose deps include callbacks, not of this change.
 */
const renderSearch = (
  stories: Story[],
  prefetch: (uri: string) => Promise<unknown>,
  prefetchTimeoutMs = 180,
) => {
  const options = {
    debounceMs: 0,
    prefetchTimeoutMs,
    prefetch,
    search: () => Promise.resolve(outcome(stories)),
  };
  return renderHook(() =>
    useStorySearch({ text: "", genre: null }, options)
  );
};

it("warms the first screenful of covers and no more", async () => {
  const asked: string[] = [];
  const prefetch = (uri: string) => {
    asked.push(uri);
    return Promise.resolve(true);
  };

  const ten = Array.from({ length: 10 }, (_, index) => remote(index));
  const { result } = await renderSearch(ten, prefetch);

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(asked).toEqual(ten.slice(0, 6).map((story) => story.coverImageUrl));
});

it("hands the results over even when a prefetch never answers", async () => {
  // The failure this guards against is a blank Explore on a bad network: a
  // cover request that hangs must not take the catalogue down with it.
  const prefetch = () => new Promise<unknown>(() => {});

  const stories = [remote(0), remote(1)];
  const { result } = await renderSearch(stories, prefetch, 20);

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.stories).toHaveLength(2);
});

it("does not prefetch bundled covers", async () => {
  // A seed story's art is already in the bundle; asking the network for it
  // would be a request for a file that is not on the network.
  const asked: string[] = [];
  const prefetch = (uri: string) => {
    asked.push(uri);
    return Promise.resolve(true);
  };

  const { result } = await renderSearch([...seedStories.slice(0, 3)], prefetch);

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(asked).toEqual([]);
});
