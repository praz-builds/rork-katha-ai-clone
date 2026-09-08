/**
 * The proof that a person sees the story being written.
 *
 * Every other test in this repo can pass while the feature does nothing for a
 * user: the endpoint can stream, the transport can parse frames, the API
 * function can hand over chunks, and the screen can still collect them all and
 * paint once at the end. That client is indistinguishable from the old one from
 * the outside, and it is exactly what shipped for a while.
 *
 * So this test renders the real `CreateStudioScreen`, drives it the way a
 * person does, and asserts the prose is on screen **while the response is still
 * open**. It fails if the screen ever goes back to buffering.
 */

/* eslint-disable import/first */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockInferStoryBrief = jest.fn();
const mockLoadDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();

/**
 * A stream whose chunks are released one at a time, on demand.
 *
 * `release()` hands over exactly one frame and resolves once the app has
 * consumed it, which is what makes "is it on screen yet?" a meaningful question
 * between chunks. A stream that enqueued everything up front could not tell a
 * streaming client from a buffering one.
 */
function controllableStream() {
  const encoder = new TextEncoder();
  const queue: string[] = [];
  let notify: (() => void) | null = null;
  let done = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!queue.length && !done) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (queue.length) {
        controller.enqueue(encoder.encode(queue.shift()!));
        return;
      }
      controller.close();
    },
  });

  return {
    body,
    async release(frame: string) {
      queue.push(frame);
      notify?.();
      notify = null;
      // Two microtask flushes: one for the reader to take the chunk, one for
      // React to commit the state it produced.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async finish() {
      done = true;
      notify?.();
      notify = null;
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

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

// Only the brief inference is stubbed. Generation deliberately goes through the
// real `generateStoryStreaming` and the real SSE reader, because those are part
// of what is being verified.
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    createGenerationRequestId: () => "streaming-integration-request",
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

import CreateStudioScreen from "@/screens/CreateStudioScreen";
/* eslint-enable import/first */

const DONE_EVENT =
  'event: done\ndata: {"story":{"id":"story-1","title":"The Quiet Door","author_id":"author-1","primary_genre":"adventure","story_mode":"standalone","themes":["doors"],"word_count":9,"status":"complete"},"chapter":{"id":"chapter-1","chapter_number":1,"title":"Chapter 1","content":"The door was not there yesterday.\\n\\nShe pushed it open."}}\n\n';

async function renderCreate() {
  return await render(
    <CreateStudioScreen
      credits={12}
      onCreditUsed={jest.fn()}
      onPublished={jest.fn()}
      onBack={jest.fn()}
    />,
  );
}

/**
 * Main Create is one screen (idea, controls, Create) plus a pre-generation
 * review screen. This helper walks to the point where the review screen's own
 * Create button is the one still to press — the caller presses that one
 * itself, since what happens on that press is what each test here exists to
 * assert.
 */
async function driveToCreate(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.changeText(
    view.getByLabelText("Story idea"),
    "A child finds a door in an old library that was not there yesterday.",
  );
  await view.findByRole("button", { name: "Add a character" });
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /create/i }));
  });
  await view.findByText("Here is what Katha will write");
}

beforeEach(() => {
  mockExpoFetch.mockReset();
  mockInferStoryBrief.mockReset().mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
});

describe("Create Studio shows the story as it is written", () => {
  it("paints each chunk before the response has finished", async () => {
    const stream = controllableStream();
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream.body,
      json: async () => ({}),
    });

    const view = await renderCreate();
    await driveToCreate(view);

    await act(async () => {
      fireEvent.press(view.getByRole("button", { name: /create/i }));
    });

    // Nothing has been sent yet, so the loader is still up and no prose exists.
    expect(view.queryByTestId("streaming-prose")).toBeNull();

    await stream.release(
      'event: meta\ndata: {"story_id":"story-1","balance":9}\n\n',
    );
    await stream.release(
      'event: delta\ndata: {"text":"The door was not there yesterday."}\n\n',
    );

    // THE ASSERTION THIS FILE EXISTS FOR. The response is still open - `done`
    // has not been sent - and the first sentence is already on screen.
    expect(view.getByTestId("streaming-prose")).toBeTruthy();
    expect(view.getByText("The door was not there yesterday.")).toBeTruthy();

    // A second chunk appends to the first rather than replacing it.
    await stream.release(
      'event: delta\ndata: {"text":"\\n\\nShe pushed it open."}\n\n',
    );
    expect(view.getByText("The door was not there yesterday.")).toBeTruthy();
    expect(view.getByText("She pushed it open.")).toBeTruthy();

    // Only now does the story land, and the screen moves on to the editor.
    await stream.release(DONE_EVENT);
    await stream.finish();
    expect(view.queryByTestId("streaming-prose")).toBeNull();
  });

  it("keeps the prose and offers a way out when generation fails mid-stream", async () => {
    // The reader has read part of their story. Erasing it and returning them to
    // an empty form is the outcome this path exists to prevent.
    const stream = controllableStream();
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream.body,
      json: async () => ({}),
    });

    const view = await renderCreate();
    await driveToCreate(view);
    await act(async () => {
      fireEvent.press(view.getByRole("button", { name: /create/i }));
    });

    await stream.release(
      'event: delta\ndata: {"text":"The door was not there yesterday."}\n\n',
    );
    await stream.release(
      'event: error\ndata: {"error":"Generation failed. Credit refunded.","partial_prose_shown":true,"refunded":true}\n\n',
    );
    await stream.finish();

    expect(view.getByText("The door was not there yesterday.")).toBeTruthy();
    expect(view.getByText("Generation failed. Credit refunded.")).toBeTruthy();

    // And the screen is not a dead end.
    const dismiss = view.getByTestId("streaming-dismiss-error");
    await act(async () => {
      fireEvent.press(dismiss);
    });
    expect(view.queryByTestId("streaming-prose")).toBeNull();
  });
});
