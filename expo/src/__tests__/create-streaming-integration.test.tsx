/**
 * The proof that a person is handed finished pages, not a typewriter.
 *
 * Two different things get called "streaming" and this file is the boundary
 * between them:
 *
 * - **Incremental delivery** is the transport, and it stays. Prose arrives from
 *   the server in chunks as it is written, which is the only reason page 1 can
 *   be on screen ~20 seconds in rather than after the whole 55-76 second
 *   generation.
 * - **A typewriter reveal** is a presentation, and it never ships. No text is
 *   painted letter by letter or mid-sentence.
 *
 * The settle rule is what separates them - whole paragraphs, whole finished
 * pages, prefix-stable - and both failure modes it guards against are invisible
 * to every other test here. A client that buffers the whole response and a
 * client that types it out look identical to a unit test of the SSE reader, and
 * identical to a type checker. So this file drives a REAL stream, one frame at
 * a time, through the real `generateStoryStreaming`, the real SSE reader and
 * the real session store, into the real reader, and asserts:
 *
 * 1. A partial paragraph is **never** on screen. Half a sentence, then a whole
 *    one, then a whole paragraph, must all leave the reader on the crafting
 *    screen while the chapter is under the reveal threshold.
 * 2. Once the threshold is cleared the reader is looking at whole finished
 *    pages while the response is **still open**. That is what stops rule 1 from
 *    being a licence to go back to buffering.
 * 3. What was revealed survives a failure, with the credit accounted for.
 * 4. A chapter too short ever to reveal still lands, rather than stranding the
 *    writer on the crafting screen.
 *
 * The page arithmetic itself is pinned in `chapter-reveal.test.ts`; this file is
 * about what the screen does with it.
 *
 * WHERE THIS USED TO LIVE. It drove `CreateStudioScreen`, because the studio
 * both ran the generation and painted the prose into a `StreamingProse` panel.
 * Neither is true now: the session runs outside React so it survives the writer
 * leaving the screen, and the prose is shown by the ordinary reader. The
 * harness below is the two-line branch `App` makes between them.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";

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

jest.mock(
  "@react-native-async-storage/async-storage",
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(() => Promise.resolve({
        sound: {
          pauseAsync: jest.fn(),
          playAsync: jest.fn(),
          unloadAsync: jest.fn(),
        },
      })),
    },
  },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
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

// Only the request id is stubbed, and only so the assertions can name the
// session. Generation deliberately goes through the real
// `generateStoryStreaming` and the real SSE reader, because those are part of
// what is being verified. `publishStory` is stubbed because a public story
// calls it unattended on completion and it is not what this file is about.
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  let n = 0;
  return {
    ...actual,
    createGenerationRequestId: () => `streaming-integration-${++n}`,
    publishStory: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: () => mockLoadDraft(),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearDraft: () => mockClearDraft(),
}));

jest.mock("@/components/GeneratingOverlay", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return () => R.createElement(View, { testID: "generating-overlay" });
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

import GeneratingOverlay from "@/components/GeneratingOverlay";
import {
  __resetGenerationSessions,
  getGeneration,
  provisionalStory,
  startStoryGeneration,
  useGeneration,
} from "@/lib/generation-session";
import ReaderScreen from "@/screens/ReaderScreen";
import type { CreateDraft } from "@/types/domain";
/* eslint-enable import/first */

/**
 * The branch `App` makes between the two surfaces a generation lands on.
 *
 * While the chapter has no finished pages there is nothing to read, so the
 * crafting screen holds the window. The moment whole settled pages exist the
 * reader takes over on page 1 and the rest arrives behind it. Kept to those
 * three lines deliberately: anything more here would be this test asserting
 * against its own fixture rather than against the app.
 */
function LiveSurface({ sessionId }: { sessionId: string }) {
  const session = useGeneration(sessionId);
  if (!session) return null;
  if (session.phase === "writing" && session.revealedProse.length === 0) {
    return <GeneratingOverlay genre={session.genre} mode="story" />;
  }
  return (
    <ReaderScreen
      story={provisionalStory(session)!}
      liveSessionId={session.id}
      onBack={jest.fn()}
      onReimagine={jest.fn()}
    />
  );
}

/** Every string the tree actually renders, in order. */
function visibleText(view: Awaited<ReturnType<typeof render>>): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || node === false) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (typeof node === "number") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(view.toJSON());
  return out.join("");
}

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

const DRAFT: CreateDraft = {
  primaryGenre: "adventure",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "A child finds a door in an old library that was not there yesterday.",
  language: "English",
  visibility: "private",
  characters: [],
  isSeries: false,
};

function openStream() {
  const stream = controllableStream();
  mockExpoFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: stream.body,
    json: async () => ({}),
  });
  return stream;
}

/** Starts the generation and renders the surface it lands on. */
async function startAndRender() {
  const session = startStoryGeneration({ draft: DRAFT });
  const view = await render(<LiveSurface sessionId={session.id} />);
  return { session, view };
}

beforeEach(() => {
  __resetGenerationSessions();
  mockExpoFetch.mockReset();
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
});

afterEach(() => {
  cleanup();
  __resetGenerationSessions();
});

describe("a generation hands over finished pages, never a typewriter", () => {
  it("shows nothing of the chapter while it is still under the threshold", async () => {
    const stream = openStream();
    const { view } = await startAndRender();

    expect(view.getByTestId("generating-overlay")).toBeTruthy();

    await stream.release(
      'event: meta\ndata: {"story_id":"story-1","balance":9}\n\n',
    );

    // A fragment, then the rest of the sentence, then a whole paragraph. This
    // is exactly the shape of a typewriter: under a naive rule the first of
    // these chunks puts "The door was not" on screen and the reader watches the
    // rest of the word arrive.
    await stream.release(delta("The door was not"));
    expect(view.getByTestId("generating-overlay")).toBeTruthy();
    expect(visibleText(view)).not.toContain("The door was not");

    await stream.release(delta(" there yesterday.\n\n"));
    // Even a COMPLETE paragraph is not enough. One settled paragraph is not a
    // finished page, and a page that keeps growing under the reader is the
    // thing the threshold exists to prevent.
    expect(view.getByTestId("generating-overlay")).toBeTruthy();

    await stream.release(delta(PARAGRAPH));
    expect(view.getByTestId("generating-overlay")).toBeTruthy();

    await stream.finishWith(DONE_EVENT);
  });

  it("opens the reader on whole finished pages while the response is still open", async () => {
    const stream = openStream();
    const { session, view } = await startAndRender();

    // Enough settled prose to clear REVEAL_MIN_PAGES with room to spare.
    await stream.release(delta(OPENING + PARAGRAPH.repeat(9)));

    // THE ASSERTION THIS FILE EXISTS FOR. `done` has not been sent - the
    // response is still open, so this is not buffering - and the reader is
    // already reading.
    expect(view.queryByTestId("generating-overlay")).toBeNull();
    expect(view.getByTestId("reader-pager")).toBeTruthy();

    // Page 1 opens on a complete paragraph, and the revealed prose ends on a
    // paragraph boundary rather than mid-sentence. Read back through the store:
    // a session is an immutable snapshot, and the one `startStoryGeneration`
    // returned is the empty first frame of it.
    expect(getGeneration(session.id)!.revealedProse.startsWith(OPENING.trim()))
      .toBe(true);
    expect(visibleText(view)).toContain("The door was not there yesterday.");

    // The page count is honest about counting what EXISTS, and the last
    // available page says so.
    const writing = visibleText(view);
    expect(writing).toMatch(/Page 1 of \d+ · writing/);
    expect(writing).toContain("Still writing...");

    // And the paragraph the model is mid-way through is not among them. `TAIL`
    // has no blank line after it, so it is the one still being typed.
    await stream.release(delta(TAIL));
    expect(visibleText(view)).not.toContain(TAIL);

    // Only now does the story land. The writing indicator goes, and the count
    // stops calling itself provisional.
    await stream.finishWith(DONE_EVENT);
    const complete = visibleText(view);
    expect(complete).not.toContain("Still writing...");
    expect(complete).not.toContain("· writing");
  });

  it("cannot be opened underneath the reader: page 1 is fixed the moment it is revealed", async () => {
    const stream = openStream();
    const { session } = await startAndRender();

    await stream.release(delta(OPENING + PARAGRAPH.repeat(9)));
    const firstReveal = getGeneration(session.id)!.revealedProse;
    expect(firstReveal.length).toBeGreaterThan(0);

    // Prefix stability is the whole promise. More prose may extend what is
    // revealed; it may never rewrite a character of what already was.
    await stream.release(delta(PARAGRAPH.repeat(4)));
    const secondReveal = getGeneration(session.id)!.revealedProse;
    expect(secondReveal.startsWith(firstReveal)).toBe(true);
    expect(secondReveal.length).toBeGreaterThan(firstReveal.length);

    await stream.finishWith(DONE_EVENT);
  });

  it("keeps the revealed pages, and accounts for the credit, when generation fails", async () => {
    // The writer has been handed finished pages of their story. Erasing them
    // and returning them to an empty form is the outcome this path prevents.
    const stream = openStream();
    const { view } = await startAndRender();

    await stream.release(delta(OPENING + PARAGRAPH.repeat(9)));
    expect(view.getByTestId("reader-pager")).toBeTruthy();

    await stream.release(
      'event: error\ndata: {"error":"Generation failed. Credit refunded.","partial_prose_shown":true,"refunded":true}\n\n',
    );
    await stream.finish();

    const text = visibleText(view);
    // The prose is still there.
    expect(text).toContain("The door was not there yesterday.");
    // And the one sentence a writer actually needs at that moment: the server's
    // technical message is the right thing to log and the wrong thing to put
    // under half a chapter somebody is reading.
    expect(text).toContain("Katha stopped early. Your credit is back.");
    expect(view.getByLabelText("Retry")).toBeTruthy();
    // Not a dead end and not a spinner.
    expect(text).not.toContain("Still writing...");
  });

  it("never strands the writer on the crafting screen when the chapter is too short to reveal", async () => {
    // The other half of "three pages, or the whole chapter, whichever comes
    // first". A chapter under the threshold is never revealed mid-stream at
    // all - it goes from the crafting screen straight to the finished text.
    const stream = openStream();
    const { view } = await startAndRender();

    await stream.release(delta(OPENING));
    expect(view.getByTestId("generating-overlay")).toBeTruthy();

    await stream.finishWith(DONE_EVENT);

    expect(view.queryByTestId("generating-overlay")).toBeNull();
    const text = visibleText(view);
    expect(text).toContain("She pushed it open.");
    expect(text).not.toContain("Still writing...");
  });
});
