/**
 * The background chapter-save queue.
 *
 * This is the half of the optimistic save that keeps it honest. The editor
 * accepts the edit and hands the writer their page back in the same tick; if
 * that were the end of it, a refused write would be a silent loss. So the queue
 * holds the exact text, tells its subscribers what happened, and offers a retry
 * that re-sends what the writer typed rather than what happens to be on screen.
 */

const mockSaveChapter = jest.fn();
jest.mock("@/lib/chapter-save", () => ({
  saveChapter: (...args: unknown[]) => mockSaveChapter(...args),
}));

/* eslint-disable import/first */
import {
  __resetChapterSaveQueue,
  chapterSaveState,
  dismissChapterSave,
  queueChapterSave,
  retryChapterSave,
  subscribeToChapterSaves,
  type ChapterSaveEntry,
} from "@/lib/chapter-save-queue";
/* eslint-enable import/first */

const input = {
  storyId: "story-1",
  chapterId: "chapter-1",
  chapterNumber: 1,
  body: "Worth keeping.",
  title: "The Last Climb",
  isPublished: true,
};

const flush = () => new Promise<void>((resolve) => { setImmediate(() => resolve()); });

beforeEach(() => {
  __resetChapterSaveQueue();
  mockSaveChapter.mockReset();
  mockSaveChapter.mockResolvedValue({ titleSaved: true });
});

it("returns before the request settles, and never blocks the caller", () => {
  mockSaveChapter.mockImplementationOnce(() => new Promise(() => {}));

  // No await. If this returned a promise the caller had to wait on, the whole
  // point of the queue would be gone.
  queueChapterSave(input);

  expect(mockSaveChapter).toHaveBeenCalledWith(input);
  expect(chapterSaveState("chapter-1")?.state).toBe("saving");
});

it("reports success without asking anyone to show it", async () => {
  const seen: ChapterSaveEntry[] = [];
  subscribeToChapterSaves((entry) => seen.push(entry));

  queueChapterSave(input);
  await flush();

  expect(seen.map((entry) => entry.state)).toEqual(["saving", "saved"]);
  expect(chapterSaveState("chapter-1")?.state).toBe("saved");
});

it("keeps the exact text on a failure, and says why", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Could not reach the server."));
  const seen: ChapterSaveEntry[] = [];
  subscribeToChapterSaves((entry) => seen.push(entry));

  queueChapterSave(input);
  await flush();

  const failure = chapterSaveState("chapter-1");
  expect(failure?.state).toBe("failed");
  expect(failure?.error).toBe("Could not reach the server.");
  // The words the writer typed, not a summary of them.
  expect(failure?.input.body).toBe("Worth keeping.");
  expect(seen.map((entry) => entry.state)).toEqual(["saving", "failed"]);
});

it("retries with the text it was holding, and lands", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline."));
  queueChapterSave(input);
  await flush();
  expect(chapterSaveState("chapter-1")?.state).toBe("failed");

  expect(retryChapterSave("chapter-1")).toBe(true);
  expect(mockSaveChapter).toHaveBeenLastCalledWith(input);
  await flush();
  expect(chapterSaveState("chapter-1")?.state).toBe("saved");
});

it("ignores a retry for anything that is not currently failed", async () => {
  expect(retryChapterSave("chapter-1")).toBe(false);

  queueChapterSave(input);
  await flush();
  // Succeeded: there is nothing to retry, and a second tap must not re-send.
  expect(retryChapterSave("chapter-1")).toBe(false);
  expect(mockSaveChapter).toHaveBeenCalledTimes(1);
});

it("lets the writer dismiss a failure they have chosen to live with", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline."));
  queueChapterSave(input);
  await flush();

  dismissChapterSave("chapter-1");
  expect(chapterSaveState("chapter-1")).toBeUndefined();
  expect(retryChapterSave("chapter-1")).toBe(false);
});

it("keeps one entry per chapter, so the newest save is the one that matters", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline."));
  queueChapterSave(input);
  await flush();

  const second = { ...input, body: "Rewritten again." };
  queueChapterSave(second);
  await flush();

  expect(chapterSaveState("chapter-1")?.state).toBe("saved");
  expect(chapterSaveState("chapter-1")?.input.body).toBe("Rewritten again.");
});

it("does not confuse two chapters of the same story", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline."));
  queueChapterSave(input);
  await flush();
  queueChapterSave({ ...input, chapterId: "chapter-2", chapterNumber: 2 });
  await flush();

  expect(chapterSaveState("chapter-1")?.state).toBe("failed");
  expect(chapterSaveState("chapter-2")?.state).toBe("saved");
});

/*
  ONE SAVE OF A CHAPTER AT A TIME.

  The writer saves, reopens the notepad, fixes a word and saves again. Both
  requests used to leave at once, and `edit-story` writes the whole chapter with
  no compare-and-swap to notice the order they arrive in -- so whichever round
  trip the network finished last was what the server kept, which could be the
  OLDER text. The queue now sends the second only after the first has settled.
*/
it("does not let a second save of the same chapter overtake the first", async () => {
  let releaseFirst: (() => void) | null = null;
  mockSaveChapter.mockImplementationOnce(() =>
    new Promise<void>((resolve) => {
      releaseFirst = () => resolve();
    })
  );

  queueChapterSave({ ...input, body: "First." });
  expect(mockSaveChapter).toHaveBeenCalledTimes(1);

  queueChapterSave({ ...input, body: "Second, and newer." });
  await flush();
  // The newer text has NOT been sent: the older request is still open.
  expect(mockSaveChapter).toHaveBeenCalledTimes(1);

  releaseFirst?.();
  await flush();

  expect(mockSaveChapter).toHaveBeenCalledTimes(2);
  expect(mockSaveChapter.mock.calls[1][0]).toMatchObject({
    body: "Second, and newer.",
  });
  // The last thing written is the last thing typed.
  expect(chapterSaveState("chapter-1")?.input.body).toBe("Second, and newer.");
  expect(chapterSaveState("chapter-1")?.state).toBe("saved");
});

it("a failed save does not strand the one queued behind it", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Offline"));
  queueChapterSave({ ...input, body: "First." });
  queueChapterSave({ ...input, body: "Second." });
  await flush();
  await flush();

  expect(mockSaveChapter).toHaveBeenCalledTimes(2);
  expect(chapterSaveState("chapter-1")?.state).toBe("saved");
});

it("saves of DIFFERENT chapters are not made to wait for each other", () => {
  mockSaveChapter.mockImplementationOnce(() => new Promise(() => {}));
  queueChapterSave(input);
  queueChapterSave({ ...input, chapterId: "chapter-2", chapterNumber: 2 });

  expect(mockSaveChapter).toHaveBeenCalledTimes(2);
});
