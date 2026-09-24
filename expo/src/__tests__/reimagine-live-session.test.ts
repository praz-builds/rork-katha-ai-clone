/**
 * A reimagined chapter must reveal page by page, like every other chapter.
 *
 * The product rule is that a first chapter, a continuation and a rewrite all
 * behave identically: prose arrives incrementally, and whole settled pages
 * appear behind the reader. A rewrite arrives on its own run object rather
 * than through `continueStoryStreaming`, so without the adapter under test it
 * would have to be waited out behind a cover -- the one presentation the rule
 * exists to prevent.
 */
import {
  __resetGenerationSessions,
  adoptReimagineGeneration,
  getGeneration,
  getGenerationsSnapshot,
  subscribeGenerations,
} from "@/lib/generation-session";
import type { ReimagineRun, ReimagineResult } from "@/lib/reimagine-client";
import { stories } from "@/data/seed";

const story = stories[0];

/** A `ReimagineRun` whose prose and outcome this test drives by hand. */
function fakeRun() {
  const listeners = new Set<() => void>();
  let resolve: (value: ReimagineResult) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<ReimagineResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const state = { text: "", stage: "", status: "writing" as const };
  const run = {
    get text() {
      return state.text;
    },
    get stage() {
      return state.stage;
    },
    get status() {
      return state.status;
    },
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
    /** The run reports CUMULATIVE prose, exactly as the real client does. */
    emit(text: string) {
      state.text = text;
      listeners.forEach((l) => l());
    },
    stage(next: string) {
      state.stage = next;
      listeners.forEach((l) => l());
    },
    resolve,
    reject,
  };
}

/** Enough whole paragraphs to clear the reveal threshold comfortably. */
function longProse(): string {
  const paragraph = "She counted the lamps along the water and lost the number twice. "
    .repeat(40).trim();
  // Enough paragraphs that the reader has several settled pages behind it.
  return Array.from({ length: 18 }, () => paragraph).join("\n\n") + "\n\n";
}

beforeEach(() => {
  __resetGenerationSessions();
});

it("puts a rewrite on the store as a live session for the chapter being rewritten", () => {
  const { run } = fakeRun();
  const session = adoptReimagineGeneration({ run, story, chapterNumber: 2 });

  expect(session.kind).toBe("chapter");
  expect(session.storyId).toBe(story.id);
  // Keyed to the chapter being REPLACED, not to a new one: the reader stays
  // where it is and the pages change underneath it.
  expect(session.chapterNumber).toBe(2);
  expect(session.phase).toBe("writing");
  expect(session.revealedProse).toBe("");
});

it("is on the published snapshot the moment it is adopted, before the run says anything", () => {
  // Screens read sessions through `useGenerations`, i.e. this snapshot. A
  // rewrite that only appeared on the run's first event left the reader on
  // the old chapter, with no loader, for the first seconds of the rewrite.
  const listener = jest.fn();
  const unsubscribe = subscribeGenerations(listener);
  const session = adoptReimagineGeneration({ run: fakeRun().run, story, chapterNumber: 1 });
  unsubscribe();

  expect(listener).toHaveBeenCalled();
  expect(getGenerationsSnapshot().map((item) => item.id)).toContain(session.id);
  expect(session.rewrite).toBe(true);
});

it("reveals settled pages as the rewrite arrives, not the raw tail", () => {
  const fake = fakeRun();
  const session = adoptReimagineGeneration({ run: fake.run, story, chapterNumber: 1 });

  // A half-written first sentence must reveal nothing at all.
  fake.emit("She opened the door and");
  expect(getGeneration(session.id)?.revealedProse).toBe("");

  fake.emit(longProse());
  const revealed = getGeneration(session.id)?.revealedProse ?? "";
  expect(revealed.length).toBeGreaterThan(0);
  // Only whole paragraphs are ever handed over.
  expect(revealed.endsWith("twice.")).toBe(true);
});

it("does not double the prose when only the stage changes", () => {
  // The run's listeners fire on stage and status changes too, so a naive
  // adapter that re-added `run.text` on every notification would append the
  // whole chapter again.
  const fake = fakeRun();
  const session = adoptReimagineGeneration({ run: fake.run, story, chapterNumber: 1 });

  const prose = longProse();
  fake.emit(prose);
  const first = getGeneration(session.id)?.revealedProse ?? "";
  fake.stage("writing");
  fake.stage("writing");
  expect(getGeneration(session.id)?.revealedProse).toBe(first);
});

it("completes with the rewritten chapter", async () => {
  const fake = fakeRun();
  const session = adoptReimagineGeneration({ run: fake.run, story, chapterNumber: 1 });
  const chapter = { ...story.chapters[0], title: "The Door, Again" };

  fake.resolve({ chapter, storyId: story.id, forked: false } as ReimagineResult);
  await fake.run.promise;

  const settled = getGeneration(session.id);
  expect(settled?.phase).toBe("complete");
  expect(settled?.chapter?.title).toBe("The Door, Again");
  expect(settled?.chapterTitle).toBe("The Door, Again");
});

/*
  A READER WHO IS NOT THE AUTHOR ENDS UP ON THEIR OWN COPY.

  `reimagine-chapter` never edits somebody else's story: it forks it and writes
  the rewrite into the fork, answering with the copy's id. The session was
  keyed to the SOURCE story and threw that id away, so app state went looking
  for the rewritten chapter on a story that does not have it, found the old
  chapter already sitting at that number, and dropped the result. The reader
  had paid a credit for a story that existed only on the server.
*/
describe("a rewrite that landed in a private copy", () => {
  it("settles on the copy's id and carries the copy itself", async () => {
    const fake = fakeRun();
    const session = adoptReimagineGeneration({
      run: fake.run,
      story,
      chapterNumber: 1,
    });
    const chapter = { ...story.chapters[0], title: "The Door, Again" };

    fake.resolve(
      { chapter, storyId: "fork-1", forked: true } as ReimagineResult,
    );
    await fake.run.promise;

    const settled = getGeneration(session.id);
    expect(settled?.storyId).toBe("fork-1");
    const copy = settled?.story;
    expect(copy?.id).toBe("fork-1");
    expect(copy?.forkedFromStoryId).toBe(story.id);
    // The rewritten chapter is IN the copy, in place of the one it replaced.
    expect(copy?.chapters).toHaveLength(story.chapters.length);
    expect(copy?.chapters[0].title).toBe("The Door, Again");
    // A copy nobody has read has none of the original's numbers, and is
    // private whatever the story it came from was.
    expect(copy?.visibility).toBe("private");
    expect(copy?.isPublic).toBe(false);
    expect(copy?.likes).toBe(0);
    expect(copy?.views).toBe(0);
  });

  it("carries no copy when the caller owned the story", async () => {
    const fake = fakeRun();
    const session = adoptReimagineGeneration({
      run: fake.run,
      story,
      chapterNumber: 1,
    });

    fake.resolve({
      chapter: story.chapters[0],
      storyId: story.id,
      forked: false,
    } as ReimagineResult);
    await fake.run.promise;

    expect(getGeneration(session.id)?.storyId).toBe(story.id);
    expect(getGeneration(session.id)?.story).toBeNull();
  });
});

it("reports a failed rewrite as an error session rather than hanging", async () => {
  const fake = fakeRun();
  const session = adoptReimagineGeneration({ run: fake.run, story, chapterNumber: 1 });

  fake.reject(new Error("The rewrite failed"));
  await fake.run.promise.catch(() => {});
  await Promise.resolve();

  const failed = getGeneration(session.id);
  expect(failed?.phase).toBe("error");
  expect(failed?.error).toBeTruthy();
});
