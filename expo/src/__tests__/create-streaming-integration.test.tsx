/**
 * The proof that a person is handed finished pages, not a typewriter.
 *
 * This file used to assert the opposite, and it was right to at the time: it
 * caught a client that streamed on the wire and painted once at the end. The
 * fix over-corrected. The first token replaced the loader, and the reader then
 * watched their chapter be typed out mid-sentence for the whole generation,
 * which product ruled against — you land on a page that is already written, and
 * the rest arrives behind you.
 *
 * Both of those failure modes are invisible to every other test here. A screen
 * that buffers and a screen that types look identical to a unit test of the SSE
 * reader, and identical to a type checker. So this file renders the real
 * `CreateStudioScreen`, drives a real stream one frame at a time, and asserts
 * the two things that separate the intended behaviour from both of them:
 *
 * 1. A partial paragraph is **never** on screen. Releasing half a sentence, and
 *    then a whole one, and then more, must not put any of it in front of the
 *    reader while the chapter is still under the reveal threshold.
 * 2. Once the threshold is cleared the reader gets whole, finished pages —
 *    including a complete page 1 — while the response is **still open**. That
 *    is what stops this from being a licence to go back to buffering.
 *
 * The page arithmetic itself is pinned in `chapter-reveal.test.ts`; this file
 * is about what the screen does with it.
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
    /** Release a final frame and close, in one step. */
    async finishWith(frame: string) {
      await this.release(frame);
      await this.finish();
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


/** One `delta` frame carrying exactly this text. */
function delta(text: string): string {
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
}

/**
 * Prose sized against the reveal threshold rather than against readability.
 *
 * `REVEAL_MIN_PAGES` is three pages of a nominal 390x640 phone at the reader's
 * 18/31 type, which `paginateChapter` puts at roughly 650 characters a page.
 * `PARAGRAPH` is a little over 300 characters, so nine of them clear three
 * pages with room to spare, without encoding the exact arithmetic here - that
 * belongs in `chapter-reveal.test.ts`, and duplicating it here would make this
 * file fail for a reason it is not about.
 */
const OPENING = "The door was not there yesterday.\n\n";
const PARAGRAPH =
  "She pushed it open and the hinges gave without a sound, which was the " +
  "first thing that felt wrong about it. Beyond the frame the library went " +
  "on exactly as it did on the other side, the same shelves, the same brass " +
  "lamps, the same dust turning slowly in the same slant of afternoon light, " +
  "and that was the second.\n\n";
/** No trailing blank line: the paragraph the model is still typing. */
const TAIL = "She counted the lamps twice before she";

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

describe("Create Studio hands over finished pages, never a typewriter", () => {
  it("shows nothing while the chapter is still being written", async () => {
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

    expect(view.queryByTestId("streaming-prose")).toBeNull();

    await stream.release(
      'event: meta\ndata: {"story_id":"story-1","balance":9}\n\n',
    );

    // A sentence, then another, then a whole paragraph. This is exactly the
    // shape of the behaviour that was removed: under the old rule the first of
    // these chunks put "The door was not" on screen and the reader watched the
    // rest of the word arrive.
    await stream.release(delta("The door was not"));
    expect(view.queryByTestId("streaming-prose")).toBeNull();
    expect(view.queryByText(/The door was not/)).toBeNull();

    await stream.release(delta(" there yesterday.\n\n"));
    // Even a *complete* paragraph is not enough. One settled paragraph is not
    // a finished page, and a page that will keep growing under the reader is
    // the thing the threshold exists to prevent.
    expect(view.queryByTestId("streaming-prose")).toBeNull();

    await stream.release(delta(PARAGRAPH));
    expect(view.queryByTestId("streaming-prose")).toBeNull();

    await stream.finishWith(DONE_EVENT);
  });

  it("reveals whole finished pages while the response is still open", async () => {
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

    // Enough settled prose to clear REVEAL_MIN_PAGES with room to spare.
    await stream.release(delta(OPENING + PARAGRAPH.repeat(9)));

    // THE ASSERTION THIS FILE EXISTS FOR, in its current form. `done` has not
    // been sent - the response is still open, so this is not buffering - and
    // the reader already has pages.
    expect(view.getByTestId("streaming-prose")).toBeTruthy();

    // Page 1 opens on a complete paragraph, not a fragment.
    const first = view.getByTestId("streaming-paragraph-0");
    expect(first.props.children).toBe(OPENING.trim());

    // And the tail the model is still typing is not among them. `TAIL` has no
    // blank line after it, so it is the paragraph in progress.
    await stream.release(delta(TAIL));
    expect(view.queryByText(new RegExp(TAIL))).toBeNull();

    // Only now does the story land, and the screen moves on to the editor.
    await stream.finishWith(DONE_EVENT);
    expect(view.queryByTestId("streaming-prose")).toBeNull();
  });

  it("keeps the revealed pages and offers a way out when generation fails", async () => {
    // The reader has been handed finished pages of their story. Erasing them
    // and returning them to an empty form is the outcome this path prevents.
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

    await stream.release(delta(OPENING + PARAGRAPH.repeat(9)));
    expect(view.getByTestId("streaming-prose")).toBeTruthy();

    await stream.release(
      'event: error\ndata: {"error":"Generation failed. Credit refunded.","partial_prose_shown":true,"refunded":true}\n\n',
    );
    await stream.finish();

    expect(view.getByTestId("streaming-paragraph-0").props.children).toBe(
      OPENING.trim(),
    );
    expect(view.getByText("Generation failed. Credit refunded.")).toBeTruthy();

    // And the screen is not a dead end.
    await act(async () => {
      fireEvent.press(view.getByTestId("streaming-dismiss-error"));
    });
    expect(view.queryByTestId("streaming-prose")).toBeNull();
  });

  it("never strands the reader on the loader when the chapter is too short to reveal", async () => {
    // The other half of "N pages, or the whole chapter, whichever comes first".
    // A chapter under the threshold is never revealed mid-stream at all - it
    // goes from the crafting screen straight to the finished text in the
    // editor, which is the same experience one beat earlier.
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

    await stream.release(delta(OPENING));
    expect(view.queryByTestId("streaming-prose")).toBeNull();

    await stream.finishWith(DONE_EVENT);
    // The editor, holding the server's chapter. No loader left behind.
    expect(view.queryByTestId("streaming-prose")).toBeNull();
    expect(await view.findByTestId("continue-chapter-button")).toBeTruthy();
  });
});
