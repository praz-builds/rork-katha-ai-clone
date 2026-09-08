/**
 * The review step tells the truth about the cover.
 *
 * The step this replaces did not. It drew a gradient card and called it a
 * preview of a cover that had already been generated, it promised "a unique AI
 * cover will be created when you publish" when `generate-story` schedules the
 * image the moment chapter 1 persists, and its Regenerate button was
 * permanently disabled beside a prompt box whose contents went nowhere.
 *
 * Every one of those is invisible to a type checker and to every other test in
 * this repo, because a screen that lies renders perfectly. So these drive the
 * real screen to review and assert what a writer actually sees in each of the
 * three states the story row can be in - a cover, no cover, a failed cover -
 * and that the Regenerate control states the price the pricing document says
 * and sends the note the writer typed.
 */

/* eslint-disable import/first */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInferStoryBrief = jest.fn();
const mockRegenerateCover = jest.fn();
const mockFetchCoverState = jest.fn();
const mockPublishStory = jest.fn();
const mockLoadDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();
const mockExpoFetch = jest.fn();

jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

// Chapter 1 goes through the real streaming path so the screen arrives at
// review in the state a writer arrives in. Only the two cover calls are
// stubbed, since what they are handed and what the screen does with their
// answers is the subject here.
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    regenerateCover: (...args: unknown[]) => mockRegenerateCover(...args),
    fetchCoverState: (...args: unknown[]) => mockFetchCoverState(...args),
    publishStory: (...args: unknown[]) => mockPublishStory(...args),
    createGenerationRequestId: () => "cover-request",
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: () => mockLoadDraft(),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearDraft: () => mockClearDraft(),
}));

jest.mock("@/components/GeneratingOverlay", () => () => null);

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) =>
      R.createElement(Text, null, `${credits} credits`),
    PrimaryButton: (
      { children, onPress }: { children: React.ReactNode; onPress: () => void },
    ) =>
      R.createElement(
        Pressable,
        { accessibilityRole: "button", onPress },
        R.createElement(Text, null, children),
      ),
  };
});

import {
  COVER_POLL_INTERVAL_MS,
  COVER_POLL_MAX_ATTEMPTS,
} from "@/lib/pricing-limits";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
/* eslint-enable import/first */

/**
 * `cover_status` rides on the story row in the generation response, so the
 * state the screen starts in is chosen here rather than by a later call.
 */
function chapterOneFrame(cover: Record<string, unknown>) {
  const story = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "The Quiet Door",
    author_id: "author-1",
    primary_genre: "adventure",
    story_mode: "standalone",
    themes: ["doors"],
    word_count: 9,
    status: "complete",
    ...cover,
  };
  const chapter = {
    id: "chapter-1",
    chapter_number: 1,
    title: "Chapter 1",
    content: "The door was not there yesterday.\n\nShe pushed it open.",
  };
  return `event: done\ndata: ${JSON.stringify({ story, chapter })}\n\n`;
}

function completedStream(frame: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

/** Drives Create through chapter 1 and leaves the screen in the editor. */
async function renderAtEditor(
  cover: Record<string, unknown>,
  credits = 12,
  onPublished: (story: unknown) => void = jest.fn(),
) {
  mockExpoFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: completedStream(chapterOneFrame(cover)),
    json: async () => ({}),
  });

  const view = await render(
    <CreateStudioScreen
      credits={credits}
      onCreditUsed={jest.fn()}
      onPublished={onPublished}
      onBack={jest.fn()}
    />,
  );

  await fireEvent.changeText(
    view.getByLabelText("Story idea"),
    "A child finds a door in an old library that was not there yesterday.",
  );
  await view.findByRole("button", { name: "Add a character" });

  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /create/i }));
  });
  // The setup screen's Create button now opens the pre-generation review
  // screen; its own Create button is the one that actually fires generation.
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /create/i }));
  });
  await view.findByTestId("continue-chapter-button");
  return view;
}

/** Drives Create through chapter 1 and on to the review step. */
async function renderAtReview(
  cover: Record<string, unknown>,
  credits = 12,
  onPublished: (story: unknown) => void = jest.fn(),
) {
  const view = await renderAtEditor(cover, credits, onPublished);

  // The editor's "Review" is one press from review now. There is no cover step
  // in between, and this failing is how a reintroduced one would be caught.
  // (The control used to say "Next"; it was renamed because on a screen that
  // writes chapter after chapter, a forward chevron labelled "Next" reads as
  // "next chapter" — see the note beside it in `CreateStudioScreen`.)
  await act(async () => {
    fireEvent.press(view.getAllByTestId("editor-review-button")[0]);
  });
  await view.findByTestId("regenerate-cover-button");
  return view;
}

beforeEach(() => {
  mockExpoFetch.mockReset();
  mockInferStoryBrief.mockReset().mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
  mockFetchCoverState.mockReset().mockResolvedValue(null);
  mockPublishStory.mockReset().mockResolvedValue({ published: true });
  mockRegenerateCover.mockReset().mockResolvedValue({
    coverImageUrl: "https://cdn.test/covers/story/cover-r1.png",
    coverStatus: "ready",
    coverRegenCount: 1,
    charged: false,
  });
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
});

describe("the review step's cover", () => {
  it("shows the real cover when the story has one", async () => {
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 0,
    });

    const image = view.getByTestId("review-cover-image");
    expect(image.props.source).toEqual({
      uri: "https://cdn.test/covers/story/cover.png",
    });
    expect(view.queryByTestId("review-concept-cover")).toBeNull();
    // No spinner over a cover that has already arrived.
    expect(view.queryByTestId("cover-generating")).toBeNull();
  });

  it("falls back to the concept card, and says that is what it is", async () => {
    const view = await renderAtReview({
      cover_status: "failed",
      cover_regen_count: 0,
    });

    expect(view.getByTestId("review-concept-cover")).toBeTruthy();
    // §10.4 makes keeping the concept card a legitimate published look, which
    // is only a choice the writer can make if it is labelled.
    expect(view.getByText("CONCEPT")).toBeTruthy();
    expect(view.queryByTestId("review-cover-image")).toBeNull();
  });

  it("says a failed cover failed instead of spinning over it", async () => {
    const view = await renderAtReview({
      cover_status: "failed",
      cover_regen_count: 0,
    });

    expect(view.getByTestId("cover-failed")).toBeTruthy();
    // The specific dishonesty: a spinner for work that will never happen.
    expect(view.queryByTestId("cover-generating")).toBeNull();
  });

  it("shows progress only while the server says work is happening", async () => {
    const view = await renderAtReview({
      cover_status: "generating",
      cover_regen_count: 0,
    });

    expect(view.getByTestId("cover-generating")).toBeTruthy();
    expect(view.queryByTestId("cover-failed")).toBeNull();
    expect(view.getByTestId("review-concept-cover")).toBeTruthy();
  });
});

describe("regenerating the cover", () => {
  it("is off while the first cover is still being painted, and comes back", async () => {
    // Pressing it in this state is a guaranteed 409 `in_flight`: the server
    // holds one cover claim per story. Being off here is not the permanently
    // disabled control §10.4 removed — the watch below resolves the status and
    // the button returns.
    jest.useFakeTimers();
    try {
      mockFetchCoverState.mockResolvedValue({
        coverImageUrl: "https://cdn.test/covers/story/cover.png",
        coverStatus: "ready",
        coverRegenCount: 0,
      });

      const view = await renderAtReview({
        cover_status: "generating",
        cover_regen_count: 0,
      });

      const button = view.getByTestId("regenerate-cover-button");
      expect(button.props.accessibilityState?.disabled).toBe(true);
      await act(async () => {
        fireEvent.press(button);
      });
      expect(mockRegenerateCover).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 100);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        view.getByTestId("regenerate-cover-button").props.accessibilityState
          ?.disabled,
      ).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("is never a permanently disabled control", async () => {
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 0,
    });

    const button = view.getByTestId("regenerate-cover-button");
    expect(button.props.accessibilityState?.disabled).toBeFalsy();
  });

  it("says free while the free retry is unspent", async () => {
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 0,
    });
    expect(view.getByText(/Regenerate cover · free/)).toBeTruthy();
  });

  it("says 1 credit once the free retry has been spent", async () => {
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 1,
    });
    expect(view.getByText(/Regenerate cover · 1 credit/)).toBeTruthy();
  });

  it("sends the note the writer typed, and swaps in the new cover", async () => {
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 0,
    });

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("cover-note-input"),
        "  A door ajar at dusk  ",
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("regenerate-cover-button"));
    });

    await waitFor(() => expect(mockRegenerateCover).toHaveBeenCalled());
    const [storyId, requestId, note] = mockRegenerateCover.mock.calls[0];
    expect(storyId).toBe("11111111-1111-4111-8111-111111111111");
    expect(requestId).toBe("cover-request");
    // Trimmed. The old screen collected this field and discarded it entirely.
    expect(note).toBe("A door ajar at dusk");

    await waitFor(() =>
      expect(view.getByTestId("review-cover-image").props.source).toEqual({
        uri: "https://cdn.test/covers/story/cover-r1.png",
      })
    );
    // The price moved with the count the server returned.
    expect(view.getByText(/Regenerate cover · 1 credit/)).toBeTruthy();
  });

  it("keeps the note when the regeneration fails, and says why", async () => {
    mockRegenerateCover.mockRejectedValueOnce(new Error("provider is down"));
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 0,
    });

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("cover-note-input"),
        "A door ajar at dusk",
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("regenerate-cover-button"));
    });

    expect(await view.findByTestId("cover-error")).toBeTruthy();
    // Retyping it would charge the writer for our failure in the only currency
    // this field has.
    expect(view.getByTestId("cover-note-input").props.value).toBe(
      "A door ajar at dusk",
    );
  });

  it("does not call the paid endpoint with no credits to pay with", async () => {
    // Generated with a balance, then spent down to nothing — which is the real
    // sequence, since a writer with no credits could not have made the story.
    const view = await renderAtReview({
      cover_status: "ready",
      cover_image_url: "https://cdn.test/covers/story/cover.png",
      cover_regen_count: 2,
    });
    await act(async () => {
      view.rerender(
        <CreateStudioScreen
          credits={0}
          onCreditUsed={jest.fn()}
          onPublished={jest.fn()}
          onBack={jest.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.press(view.getByTestId("regenerate-cover-button"));
    });
    // The 402 exists on the server too. Reaching it would still be correct, it
    // would just be a slower and more expensive way to say the same thing.
    expect(mockRegenerateCover).not.toHaveBeenCalled();
  });
});

describe("the cover reaches the editor, not only review", () => {
  it("reveals the cover in the story header once it lands", async () => {
    // §10.4 puts the cover with chapter 1. Making the writer reach review to
    // discover it is making them wait for news that arrived minutes earlier.
    // Faked from before the render, because the watch's interval is created
    // while the editor is being reached; switching the clock afterwards leaves
    // a real interval that no amount of advancing can fire.
    jest.useFakeTimers();
    try {
      mockFetchCoverState.mockResolvedValue({
        coverImageUrl: "https://cdn.test/covers/story/cover.png",
        coverStatus: "ready",
        coverRegenCount: 0,
      });

      const view = await renderAtEditor({
        cover_status: "generating",
        cover_regen_count: 0,
      });

      // Nothing yet: the row says the art is still being made, and the studio
      // does not draw a cover it has not been told exists.
      expect(view.queryByTestId("editor-cover-thumb")).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 100);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockFetchCoverState).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      );
      expect(view.getByTestId("editor-cover-thumb")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("the cover watch", () => {
  it("never has two fetches out at once", async () => {
    // The interval callback is async. Without a guard, a fetch slower than the
    // 6s interval is re-entered while the first is still out, stacking requests
    // and spending the attempt budget on answers nobody waited for.
    jest.useFakeTimers();
    try {
      mockFetchCoverState.mockReset().mockImplementation(
        () => new Promise(() => {}),
      );

      await renderAtEditor({
        cover_status: "generating",
        cover_regen_count: 0,
      });

      for (let tick = 0; tick < 4; tick += 1) {
        await act(async () => {
          jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 100);
        });
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(mockFetchCoverState).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps watching while the writer is off writing the next chapter", async () => {
    // The regression this replaces: the watch was gated on
    // `step === "editor" || step === "review"`, so the one activity that takes
    // minutes — continuing the story, or a whole "Write the rest" run, both of
    // which sit on `generating` — was also the one activity during which
    // nobody asked whether the cover had landed. A writer continued, came
    // back, and found the studio still saying "painting chapter one's art"
    // about an image that had been finished in Storage for minutes.
    //
    // §10.4's promise is that the cover happens *behind* what the writer is
    // doing. A watch that stops whenever they do something is not a background
    // watch, so this drives the screen into `generating` with a continuation
    // that never resolves and asserts the asking carries on.
    jest.useFakeTimers();
    try {
      mockFetchCoverState.mockReset().mockResolvedValue(null);

      const view = await renderAtEditor({
        cover_status: "generating",
        cover_regen_count: 0,
      });

      // A continuation whose response never arrives. The screen stays on
      // `generating` for as long as this test wants it to.
      mockExpoFetch.mockReset().mockReturnValue(new Promise(() => {}));
      await act(async () => {
        fireEvent.press(view.getByTestId("continue-chapter-button"));
      });

      const before = mockFetchCoverState.mock.calls.length;
      for (let tick = 0; tick < 3; tick += 1) {
        await act(async () => {
          jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 100);
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }

      expect(mockFetchCoverState.mock.calls.length).toBe(before + 3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps its attempt budget across a move between the editor and review", async () => {
    // The watch is rebuilt whenever its effect re-runs. An attempt counter
    // local to the effect would reset with it, and a writer flicking between
    // the editor and review would poll a dead job forever.
    jest.useFakeTimers();
    try {
      mockFetchCoverState.mockReset().mockResolvedValue(null);

      const view = await renderAtEditor({
        cover_status: "generating",
        cover_regen_count: 0,
      });

      const half = Math.floor(COVER_POLL_MAX_ATTEMPTS / 2);
      const advance = async (ticks: number) => {
        for (let tick = 0; tick < ticks; tick += 1) {
          await act(async () => {
            jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 100);
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
        }
      };

      await advance(half);
      expect(mockFetchCoverState).toHaveBeenCalledTimes(half);

      await act(async () => {
        fireEvent.press(view.getAllByTestId("editor-review-button")[0]);
      });
      await view.findByTestId("regenerate-cover-button");

      // The rest of the budget, then well past it. The watch must stop at the
      // bound rather than start counting again from zero.
      await advance(COVER_POLL_MAX_ATTEMPTS);
      expect(mockFetchCoverState).toHaveBeenCalledTimes(COVER_POLL_MAX_ATTEMPTS);
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * The cover the writer watched arrive is the cover the published story gets.
 *
 * The image is made asynchronously and reaches the screen through a poll, into
 * `cover` state -- which is correct, because `setStory` last ran long before
 * the image existed. But the story handed to `onPublished` was built from
 * `story` alone, so it carried whatever `generate-story` answered with, which
 * for a cover that was not finished yet is nothing at all. The writer watched
 * their cover appear in the studio, published, and landed on a story showing
 * the placeholder gradient, with the real image sitting in Storage the whole
 * time. Reopening the story later fetched it and it came back, which made a
 * certainty look like a fluke.
 */
describe("publishing a story whose cover arrived while the writer was editing", () => {
  it("hands on the cover the poll delivered, not the empty one the story arrived with", async () => {
    jest.useFakeTimers();
    try {
      const onPublished = jest.fn();
      // Arrives with no image and work in progress -- the ordinary case, since
      // the cover is scheduled the moment chapter 1 persists.
      const view = await renderAtReview(
        { cover_status: "generating", cover_regen_count: 0 },
        12,
        onPublished,
      );
      expect(view.getByTestId("cover-generating")).toBeTruthy();

      mockFetchCoverState.mockResolvedValue({
        coverImageUrl: "https://cdn.test/covers/story/arrived.png",
        coverStatus: "ready",
        coverRegenCount: 0,
      });
      await act(async () => {
        jest.advanceTimersByTime(COVER_POLL_INTERVAL_MS + 10);
      });
      await waitFor(() =>
        expect(view.getByTestId("review-cover-image").props.source).toEqual({
          uri: "https://cdn.test/covers/story/arrived.png",
        })
      );

      await act(async () => {
        fireEvent.press(view.getByText("Save to library"));
      });

      await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
      expect(onPublished.mock.calls[0][0]).toMatchObject({
        coverImageUrl: "https://cdn.test/covers/story/arrived.png",
        // The status travels with the url. A story whose status still said
        // "generating" over an image that had arrived would draw the reader's
        // placeholder on top of a real cover.
        coverStatus: "ready",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
