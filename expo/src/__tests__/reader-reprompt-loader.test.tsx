/**
 * A Re-prompt covers the chapter with the crafting screen until the new
 * version's first page has settled.
 *
 * The rewrite replaces the chapter on screen the moment it starts: the live
 * session's prose is empty, so the reader used to sit on a blank opener with
 * a "still writing" tail for the half-minute before page one existed. The
 * create flow never shows that -- it holds the crafting screen until whole
 * pages exist -- and a rewrite now does the same. A continuation is left
 * alone: it deliberately opens straight onto its own opener.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";

const mockContinueStoryStreaming = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  let n = 0;
  return {
    ...actual,
    continueStoryStreaming: (...args: unknown[]) => mockContinueStoryStreaming(...args),
    createGenerationRequestId: () => `reader-reprompt-loader-${++n}`,
  };
});
jest.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(() => Promise.resolve({
        sound: { pauseAsync: jest.fn(), playAsync: jest.fn(), unloadAsync: jest.fn() },
      })),
    },
  },
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

import { stories } from "@/data/seed";
import {
  __resetGenerationSessions,
  adoptReimagineGeneration,
  startChapterGeneration,
} from "@/lib/generation-session";
import type { ReimagineResult, ReimagineRun } from "@/lib/reimagine-client";
import ReaderScreen from "@/screens/ReaderScreen";
/* eslint-enable import/first */

const story = stories.find((item) => item.chapters.length > 1)!;
const LOADER = "Writing this chapter again";

/** A `ReimagineRun` whose prose this test drives by hand. */
function fakeRun(chapterNumber: number) {
  const listeners = new Set<() => void>();
  const state = { text: "" };
  const promise = new Promise<ReimagineResult>(() => {});
  const run = {
    request: { storyId: story.id, chapterNumber, prompt: "Again, but at night." },
    get text() {
      return state.text;
    },
    stage: "writing",
    status: "writing",
    error: null,
    result: null,
    promise,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as ReimagineRun;
  return {
    run,
    /** Cumulative prose, as the real client reports it. */
    async emit(text: string) {
      await act(async () => {
        state.text = text;
        listeners.forEach((listener) => listener());
        await Promise.resolve();
      });
    },
  };
}

/** Whole paragraphs, enough to settle several pages. */
function longProse(): string {
  const paragraph = "She counted the lamps along the water and lost the number twice. "
    .repeat(40).trim();
  return Array.from({ length: 18 }, () => paragraph).join("\n\n") + "\n\n";
}

beforeEach(() => {
  cleanup();
  __resetGenerationSessions();
  mockContinueStoryStreaming.mockReset();
});

afterEach(() => {
  cleanup();
  __resetGenerationSessions();
});

it("holds the crafting screen over a re-prompt until its first page settles, then hands over", async () => {
  const fake = fakeRun(1);
  const session = adoptReimagineGeneration({ run: fake.run, story, chapterNumber: 1 });
  const view = await render(
    <ReaderScreen story={story} liveSessionId={session.id} onBack={jest.fn()} />,
  );

  // Nothing of the new chapter exists yet: the crafting screen, not a blank page.
  expect(view.getByLabelText(LOADER)).toBeTruthy();

  // A half sentence settles nothing, so the loader stays.
  await fake.emit("She opened the door and");
  expect(view.getByLabelText(LOADER)).toBeTruthy();

  // Whole pages exist: the reader takes over on page 1 of the new version.
  await fake.emit(longProse());
  await waitFor(() => expect(view.queryByLabelText(LOADER)).toBeNull());
  expect(view.getByTestId("reader-page-body-0")).toHaveTextContent(/She counted the lamps/);
});

it("does not put the crafting screen over a continuation, which opens on its own opener", async () => {
  mockContinueStoryStreaming.mockImplementation(() => new Promise(() => {}));
  const session = startChapterGeneration({
    story,
    nextChapterNumber: story.chapters.length + 1,
  });
  const view = await render(
    <ReaderScreen
      story={story}
      initialChapterIndex={story.chapters.length - 1}
      liveSessionId={session.id}
      onBack={jest.fn()}
    />,
  );

  await waitFor(() => expect(view.getByLabelText("Still writing")).toBeTruthy());
  expect(view.queryByLabelText(LOADER)).toBeNull();
});
