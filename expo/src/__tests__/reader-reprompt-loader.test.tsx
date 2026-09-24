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
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

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
  let resolve: (value: ReimagineResult) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<ReimagineResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
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
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as ReimagineRun;
  return {
    run,
    async resolve(value: ReimagineResult) {
      await act(async () => {
        resolve(value);
        await promise;
        await Promise.resolve();
      });
    },
    async reject(error: Error) {
      await act(async () => {
        reject(error);
        await promise.catch(() => {});
        await Promise.resolve();
      });
    },
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

it("opens the new version on page 1 even when the old one was re-prompted from a later page", async () => {
  // The reading anchor is an offset into the OLD text. Left in place, the new
  // prose was mapped onto it and the reader landed mid-chapter.
  const prose = longProse();
  const paged = {
    ...story,
    chapters: [{ ...story.chapters[0], paragraphs: prose.trim().split("\n\n") }, ...story.chapters.slice(1)],
  };
  const view = await render(<ReaderScreen story={paged} onBack={jest.fn()} />);
  const pageCount = view.getAllByTestId(/^reader-page-label-\d+$/).length;
  expect(pageCount).toBeGreaterThan(3);
  await act(async () => {
    fireEvent(view.getByTestId("reader-pager"), "momentumScrollEnd", {
      nativeEvent: {
        contentOffset: { x: 3 * 400, y: 0 },
        layoutMeasurement: { width: 400, height: 800 },
        contentSize: { width: 400 * pageCount, height: 800 },
      },
    });
  });

  const fake = fakeRun(1);
  const session = adoptReimagineGeneration({ run: fake.run, story: paged, chapterNumber: 1 });
  await view.rerender(<ReaderScreen story={paged} liveSessionId={session.id} onBack={jest.fn()} />);
  expect(view.getByLabelText(LOADER)).toBeTruthy();

  await fake.emit(prose);
  await fake.resolve({
    chapter: { ...paged.chapters[0], id: "rewritten-1", title: "Again" },
    model: "test",
    storyId: story.id,
    forked: false,
  });
  await waitFor(() => expect(view.queryByLabelText(LOADER)).toBeNull());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Toggle reader controls"));
  });
  await waitFor(() => {
    expect(view.getByLabelText("Pages").props.accessibilityValue).toMatchObject({ now: 1 });
  });
});

it("gives the crafting screen a Back control that leaves the reader", async () => {
  // The overlay covers the reader and the reading area's tap is inert while a
  // chapter is written, so on iOS and web this is the only way out.
  const fake = fakeRun(1);
  const session = adoptReimagineGeneration({ run: fake.run, story });
  const onBack = jest.fn();
  const view = await render(
    <ReaderScreen story={story} liveSessionId={session.id} onBack={onBack} />,
  );

  expect(view.getByLabelText(LOADER)).toBeTruthy();
  await act(async () => {
    await fireEvent.press(view.getByTestId("rewrite-overlay-back"));
  });
  expect(onBack).toHaveBeenCalledTimes(1);
});

it("a failed rewrite says why, and Try again starts a fresh rewrite of the same request", async () => {
  const first = fakeRun(1);
  const second = fakeRun(1);
  const restart = jest.fn(() => second.run);
  const session = adoptReimagineGeneration({ run: first.run, story, restart });
  const view = await render(
    <ReaderScreen story={story} liveSessionId={session.id} onBack={jest.fn()} />,
  );

  await first.reject(new Error("The model gave up."));
  await waitFor(() => expect(view.queryByLabelText(LOADER)).toBeNull());
  expect(view.getByText(/The model gave up\./)).toBeTruthy();

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Try again"));
  });
  // A NEW run for the same request -- not a replay of the failed one.
  expect(restart).toHaveBeenCalledWith(first.run.request);
  // Back behind the crafting screen until the new version's first page.
  expect(view.getByLabelText(LOADER)).toBeTruthy();

  await second.emit(longProse());
  await waitFor(() => expect(view.queryByLabelText(LOADER)).toBeNull());
  expect(view.getByTestId("reader-page-body-0")).toHaveTextContent(/She counted the lamps/);
});

it("rewrites the chapter the run was asked for, not the chapter the reader was opened at", async () => {
  // App used to key the session to the chapter the reader was OPENED at, so
  // turning to chapter 2 and re-prompting it blanked chapter 1. The session
  // now takes its chapter from the run's own request.
  const fake = fakeRun(2);
  const session = adoptReimagineGeneration({ run: fake.run, story });
  expect(session.chapterNumber).toBe(2);

  const onChapterChange = jest.fn();
  const view = await render(
    <ReaderScreen
      story={story}
      initialChapterIndex={1}
      liveSessionId={session.id}
      onBack={jest.fn()}
      onChapterChange={onChapterChange}
    />,
  );
  expect(view.getByLabelText(LOADER)).toBeTruthy();

  await fake.emit(longProse());
  await waitFor(() => expect(view.queryByLabelText(LOADER)).toBeNull());
  // Still on chapter 2, now showing the rewrite. A session keyed to chapter
  // 1 would have pulled the reader back there and blanked it.
  expect(view.getByTestId("reader-page-body-0")).toHaveTextContent(/She counted the lamps/);
  expect(onChapterChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ chapterNumber: 2 }),
    1,
  );
  expect(onChapterChange).not.toHaveBeenCalledWith(expect.anything(), 0);
});
