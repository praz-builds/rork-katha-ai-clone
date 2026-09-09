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
