/**
 * The cover has to reach the app on its own.
 *
 * A story's art is painted after its chapter is answered, on a background task
 * nothing pushes down to the client. `CreateStudioScreen` used to poll for it;
 * when generation moved into `generation-session.ts` the poll was not moved
 * with it, and the result was a cover that existed in the bucket, served over
 * HTTP 200, and stayed invisible in the app until a full reload - the genre
 * gradient forever, in the feed and on the story page at once.
 *
 * These tests pin the four things that failure taught us to check: that the
 * poll runs at all, that the URL it finds reaches subscribers, that it stops
 * politely rather than forever, and that it never leaves a timer behind.
 */

import {
  __resetGenerationSessions,
  COVER_POLL_MAX_ATTEMPTS,
  dismissGeneration,
  getGeneration,
  startStoryGeneration,
} from "@/lib/generation-session";
import { stories } from "@/data/seed";
import type { CreateDraft, Story } from "@/types/domain";

// `mock`-prefixed so Jest's module-factory hoisting will let the factory close
// over them; everything below uses the shorter aliases.
const mockFetchCoverState = jest.fn();
const mockGenerateStoryStreaming = jest.fn();

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  fetchCoverState: (...args: unknown[]) => mockFetchCoverState(...args),
  generateStoryStreaming: (...args: unknown[]) =>
    mockGenerateStoryStreaming(...args),
  publishStory: jest.fn(() => Promise.resolve({})),
}));

// The poll asks nobody when there is nobody to ask, so the configured branch
// is the one worth testing.
jest.mock("@/lib/supabase", () => ({
  ...jest.requireActual("@/lib/supabase"),
  isSupabaseConfigured: true,
}));

jest.mock("@/lib/draft-storage", () => ({
  ...jest.requireActual("@/lib/draft-storage"),
  clearDraft: jest.fn(() => Promise.resolve()),
}));

const draft: CreateDraft = {
  seed: "A lighthouse keeper who has never seen the sea in daylight.",
  primaryGenre: "mystery",
  language: "English",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  characters: [],
  isSeries: false,
  visibility: "private",
};

/** The story the server answers with: chapter persisted, cover still being painted. */
const written: Story = {
  ...stories[0],
  id: "story-live-1",
  coverImage: undefined,
  coverImageUrl: undefined,
  coverStatus: "generating",
};

/** Let every already-resolved promise in the chain run. */
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

/** Run the next scheduled poll and let its answer land. */
const tick = async () => {
  jest.advanceTimersByTime(60_000);
  await flush();
};

beforeEach(() => {
  jest.useFakeTimers();
  mockFetchCoverState.mockReset();
  mockGenerateStoryStreaming.mockReset();
  mockGenerateStoryStreaming.mockResolvedValue(written);
  __resetGenerationSessions();
});

afterEach(() => {
  __resetGenerationSessions();
  jest.useRealTimers();
});

/** Start a story and let it finish, returning the settled session id. */
async function generate(): Promise<string> {
  const { id } = startStoryGeneration({ draft });
  await flush();
  return id;
}

it("does not ask for the cover before the chapter is persisted", async () => {
  mockGenerateStoryStreaming.mockReturnValue(new Promise(() => {}));
  startStoryGeneration({ draft });
  await tick();
  expect(mockFetchCoverState).not.toHaveBeenCalled();
});

it("publishes the cover through the store once the server says it is ready", async () => {
  mockFetchCoverState
    .mockResolvedValueOnce({ coverStatus: "generating", coverRegenCount: 0 })
    .mockResolvedValueOnce({
      coverStatus: "ready",
      coverImageUrl: "https://covers.test/story-live-1/cover.png",
      coverRegenCount: 0,
    });

  const id = await generate();
  // The story is on the store with no art yet - the gradient placeholder.
  expect(getGeneration(id)?.story?.coverImageUrl).toBeUndefined();

  await tick();
  expect(getGeneration(id)?.story?.coverStatus).toBe("generating");
  expect(getGeneration(id)?.story?.coverImageUrl).toBeUndefined();

  await tick();
  expect(getGeneration(id)?.story).toMatchObject({
    coverStatus: "ready",
    coverImageUrl: "https://covers.test/story-live-1/cover.png",
  });

  // Settled: nothing further is asked, however long the app stays open.
  const asked = mockFetchCoverState.mock.calls.length;
  await tick();
  await tick();
  expect(mockFetchCoverState).toHaveBeenCalledTimes(asked);
});

it("stops asking when the server says the cover failed", async () => {
  mockFetchCoverState.mockResolvedValue({
    coverStatus: "failed",
    coverRegenCount: 0,
  });

  const id = await generate();
  await tick();

  expect(getGeneration(id)?.story?.coverStatus).toBe("failed");
  await tick();
  await tick();
  expect(mockFetchCoverState).toHaveBeenCalledTimes(1);
});

it("gives up after a capped number of attempts rather than polling forever", async () => {
  mockFetchCoverState.mockResolvedValue({
    coverStatus: "generating",
    coverRegenCount: 0,
  });

  await generate();
  // Far more ticks than the cap allows.
  for (let i = 0; i < COVER_POLL_MAX_ATTEMPTS + 5; i += 1) await tick();

  expect(mockFetchCoverState).toHaveBeenCalledTimes(COVER_POLL_MAX_ATTEMPTS);
  expect(jest.getTimerCount()).toBe(0);
});

// A transport failure is not an answer, and the writer never asked about their
// cover in the first place - so it retries quietly and is still capped.
it("keeps asking through a failed request, and stays capped", async () => {
  mockFetchCoverState.mockRejectedValue(new Error("offline"));

  await generate();
  for (let i = 0; i < COVER_POLL_MAX_ATTEMPTS + 3; i += 1) await tick();

  expect(mockFetchCoverState).toHaveBeenCalledTimes(COVER_POLL_MAX_ATTEMPTS);
  expect(jest.getTimerCount()).toBe(0);
});

it("leaves no timer behind when the session is dismissed", async () => {
  mockFetchCoverState.mockResolvedValue({
    coverStatus: "generating",
    coverRegenCount: 0,
  });

  const id = await generate();
  expect(jest.getTimerCount()).toBeGreaterThan(0);

  dismissGeneration(id);
  expect(jest.getTimerCount()).toBe(0);

  await tick();
  expect(mockFetchCoverState).not.toHaveBeenCalled();
});

it("leaves no timer behind when every session is forgotten", async () => {
  mockFetchCoverState.mockResolvedValue({
    coverStatus: "generating",
    coverRegenCount: 0,
  });

  await generate();
  __resetGenerationSessions();
  expect(jest.getTimerCount()).toBe(0);
});
