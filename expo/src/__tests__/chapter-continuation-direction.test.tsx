/**
 * The reader's steer reaches the request, and does not outlive it.
 *
 * `continue-story` has accepted `next_instruction` — and `story-prompts.ts` has
 * rendered it with a precedence rule that beats the plan — for as long as the
 * endpoint has existed. The client never sent it, so the whole feature was one
 * unpassed argument away from working and nothing failed to say so.
 *
 * These tests hold the halves of that argument a type signature cannot check:
 * blank must collapse to `undefined` rather than `""`, because an empty string
 * still renders the reader-direction block in the prompt and tells the model a
 * steer exists when none does; a used direction must not leak into the next
 * chapter, because a direction that survives keeps steering chapters the reader
 * never aimed it at, invisibly; and a direction must survive a RETRY, because
 * losing it there charges the reader for our failure in the only currency they
 * have at that moment.
 *
 * WHERE THIS USED TO LIVE. The direction was typed into a "What happens next?"
 * box in the draft editor, and this file drove `CreateStudioScreen` all the way
 * there. The editor is gone (2026-09-09): continuation is reached exactly once,
 * at the foot of the chapter, from `ChapterEnd`, and the request is made by the
 * generation session rather than by a screen. So the direction's journey is now
 * two hops, each tested where it happens - `chapter-end.test.tsx` proves the
 * surface hands up the exact prose the reader chose (and nothing at all when
 * they let Katha decide), and this file proves the session puts it on the wire.
 */

/* eslint-disable import/first */
const mockContinueStoryStreaming = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: { auth: { getSession: jest.fn() } },
}));

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  let n = 0;
  return {
    ...actual,
    continueStoryStreaming: (...args: unknown[]) =>
      mockContinueStoryStreaming(...args),
    createGenerationRequestId: () => `continuation-direction-${++n}`,
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: jest.fn(),
  saveDraft: jest.fn(),
  clearDraft: jest.fn(),
}));

import {
  __resetGenerationSessions,
  getGeneration,
  retryGeneration,
  startChapterGeneration,
  waitForGeneration,
} from "@/lib/generation-session";
import type { Chapter, Story } from "@/types/domain";
/* eslint-enable import/first */

/** Position of `nextInstruction` in the `continueStoryStreaming` signature. */
const DIRECTION_ARG = 5;
/** Position of `extend` in the same signature. */
const EXTEND_ARG = 7;

function chapterTwo(): Chapter {
  return {
    id: "chapter-2",
    storyId: "story-1",
    title: "Chapter 2",
    paragraphs: ["The stairs went down further than the building was tall."],
    chapterNumber: 2,
    chapterRole: "mid_series",
    isPublished: false,
  };
}

const story: Story = {
  id: "story-1",
  title: "The Quiet Door",
  authorId: "me",
  genre: "adventure",
  storyMode: "series",
  plannedChapterCount: 3,
  synopsis: "A child finds a door.",
  chapters: [{
    id: "chapter-1",
    storyId: "story-1",
    title: "Chapter 1",
    paragraphs: ["The door was not there yesterday."],
    chapterNumber: 1,
    chapterRole: "series_opening",
    isPublished: true,
  }],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

/** Starts the next chapter and waits for the session to settle. */
async function continueWith(direction?: string) {
  const session = startChapterGeneration({
    story,
    nextChapterNumber: 2,
    direction,
  });
  await waitForGeneration(session.id).catch(() => {});
  return session;
}

beforeEach(() => {
  __resetGenerationSessions();
  mockContinueStoryStreaming.mockReset().mockResolvedValue({
    model: "test-model",
    chapter: chapterTwo(),
  });
});

afterEach(() => {
  __resetGenerationSessions();
});

describe("the direction the reader chose reaches the request", () => {
  it("sends no direction at all when the reader gave none", async () => {
    await continueWith(undefined);

    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(1);
    // `undefined`, not `""` — an empty string is a direction as far as the
    // prompt builder is concerned, and claims a steer that does not exist.
    expect(mockContinueStoryStreaming.mock.calls[0][DIRECTION_ARG])
      .toBeUndefined();
  });

  it("forwards the reader's own sentence unaltered", async () => {
    await continueWith("She finds her brother on the other side.");

    expect(mockContinueStoryStreaming.mock.calls[0][DIRECTION_ARG]).toBe(
      "She finds her brother on the other side.",
    );
  });

  it("says which chapter it is writing, and whether that chapter is the last", async () => {
    // The direction is not the only thing the server needs to be told. A
    // continuation that misreports its own number is written against the wrong
    // beat of the plan, and one that does not know it is the finale ends the
    // story on a hook nothing will ever pay off.
    const session = startChapterGeneration({
      story,
      nextChapterNumber: 3,
      isFinale: true,
      direction: "They climb back into the light.",
    });
    await waitForGeneration(session.id).catch(() => {});

    const args = mockContinueStoryStreaming.mock.calls[0];
    expect(args[0]).toBe("story-1");
    expect(args[3]).toBe(true);
    expect(args[4]).toBe(3);
  });

  /**
   * Extending is opt-in on the wire, not inferred from the chapter number.
   *
   * The server refuses a chapter past the plan unless this flag is set, and
   * that refusal is what stops every other caller -- auto-continue above all
   * -- from spending a credit on a story its author said was finished.
   */
  it("asks to grow the story only when the reader tapped to grow it", async () => {
    await continueWith(undefined);
    expect(mockContinueStoryStreaming.mock.calls[0][EXTEND_ARG]).toBe(false);

    const session = startChapterGeneration({
      story,
      nextChapterNumber: 4,
      direction: "One more night at the door.",
      extend: true,
    });
    await waitForGeneration(session.id).catch(() => {});
    expect(mockContinueStoryStreaming.mock.calls[1][EXTEND_ARG]).toBe(true);
  });

  it("does not let one chapter's direction steer the next one", async () => {
    await continueWith("She finds her brother on the other side.");
    await continueWith(undefined);

    // Each session carries its own direction and nothing else does. A direction
    // held anywhere shared would still be steering here, invisibly.
    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(2);
    expect(mockContinueStoryStreaming.mock.calls[1][DIRECTION_ARG])
      .toBeUndefined();
  });

  it("keeps the direction across a retry after a failure", async () => {
    // The reader typed it; we lost the chapter. Making them find and retype it
    // would charge them for our failure. The retry is offered under the prose
    // they already have, so there is no box to retype it into either - the
    // session is what remembers.
    mockContinueStoryStreaming.mockRejectedValueOnce(new Error("offline"));
    const session = await continueWith("She finds her brother on the other side.");

    expect(getGeneration(session.id)?.phase).toBe("error");

    retryGeneration(session.id);
    await waitForGeneration(session.id);

    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(2);
    expect(mockContinueStoryStreaming.mock.calls[1][DIRECTION_ARG]).toBe(
      "She finds her brother on the other side.",
    );
    expect(getGeneration(session.id)?.phase).toBe("complete");
  });
});
