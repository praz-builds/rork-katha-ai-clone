/**
 * Why a chapter save outlives the screen that started it.
 *
 * Tapping Save used to `await` the round trip with the editor still on screen
 * and every control disabled, and only then start a 1.2-second "Saved" dwell
 * before returning to the reader. Against the deployed backend that is three to
 * four seconds of a frozen notepad to persist text the writer is looking at.
 *
 * The write is not what the writer is waiting for. They already know what they
 * typed; what they want back is their page. So the edit is accepted locally and
 * the reader returns immediately, and the request runs here, outside the
 * component tree, where unmounting the editor cannot cancel it.
 *
 * THE PRICE OF OPTIMISM IS AN HONEST FAILURE. A queued save that is refused is
 * not swallowed and it is not retried forever behind the writer's back: the
 * entry stays in this queue holding the exact text, subscribers are told, and
 * the reader shows a failure with a Retry that re-sends that same text. Nothing
 * ever reports success for a write that failed.
 *
 * This is a separate module from `chapter-save.ts` on purpose. The queue calls
 * the network primitive through a module boundary, so a test can replace the
 * primitive and still exercise the real queue -- an internal call inside one
 * module cannot be intercepted, and faking the queue away would leave the
 * optimistic path untested.
 */
import { saveChapter, type SaveChapterInput } from "@/lib/chapter-save";

export type ChapterSaveState = "saving" | "saved" | "failed";

export type ChapterSaveEntry = {
  /** Keyed per chapter: a newer save for the same chapter replaces the older one. */
  chapterId: string;
  state: ChapterSaveState;
  /** The exact text this entry is trying to persist. Never dropped on failure. */
  input: SaveChapterInput;
  /** Set only in the `failed` state. */
  error?: string;
};

type Listener = (entry: ChapterSaveEntry) => void;

const entries = new Map<string, ChapterSaveEntry>();
const listeners = new Set<Listener>();

function emit(entry: ChapterSaveEntry): void {
  entries.set(entry.chapterId, entry);
  listeners.forEach((listener) => listener(entry));
}

/** Subscribe to every queued chapter save. Returns the unsubscribe. */
export function subscribeToChapterSaves(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest state for one chapter, or `undefined` if nothing was ever queued. */
export function chapterSaveState(chapterId: string): ChapterSaveEntry | undefined {
  return entries.get(chapterId);
}

/**
 * The save currently in flight for a chapter, if any.
 *
 * ONE AT A TIME, PER CHAPTER. Two saves of the same chapter used to be two
 * unordered requests: the writer saves, reopens the notepad, fixes a word and
 * saves again, and whichever round trip the network happens to finish last is
 * what the server keeps -- which can be the OLDER text. `edit-story` writes
 * the whole chapter with no compare-and-swap to notice, so the ordering has to
 * be true before the requests leave. Chaining is enough: the second save waits
 * for the first to settle, and a failed first save does not cancel the second
 * (its `catch` is swallowed here, having already been reported to subscribers).
 */
const inFlight = new Map<string, Promise<void>>();

function run(input: SaveChapterInput): void {
  const { chapterId } = input;
  emit({ chapterId, state: "saving", input });
  const send = () =>
    saveChapter(input).then(
      () => {
        emit({ chapterId, state: "saved", input });
      },
      (caught: unknown) => {
        emit({
          chapterId,
          state: "failed",
          input,
          error: caught instanceof Error && caught.message
            ? caught.message
            : "Your edit is on this device but Katha could not save it.",
        });
      },
    );
  // Sent NOW when nothing is in flight for this chapter -- a save must not
  // wait a microtask on the common path, and the whole point of this module is
  // that the request is already away by the time the editor closes. Only a
  // save that would overtake one still running has to queue behind it.
  const previous = inFlight.get(chapterId);
  const settled = previous ? previous.then(send) : send();
  inFlight.set(chapterId, settled);
  void settled.then(() => {
    // Only the latest chain clears itself, so a save queued behind this one
    // still finds its predecessor to wait for.
    if (inFlight.get(chapterId) === settled) inFlight.delete(chapterId);
  });
}

/**
 * Persist a chapter in the background. Returns immediately; the caller must
 * NOT await this to decide what to put on screen.
 */
export function queueChapterSave(input: SaveChapterInput): void {
  run(input);
}

/**
 * Re-send a failed save with the text it was holding. A no-op unless that
 * chapter's latest entry actually failed, so a double-tapped Retry sends once.
 */
export function retryChapterSave(chapterId: string): boolean {
  const entry = entries.get(chapterId);
  if (!entry || entry.state !== "failed") return false;
  run(entry.input);
  return true;
}

/**
 * Forget a failed save. The writer has been shown the failure and chosen to
 * live with a local-only edit; keeping the banner up after that is nagging.
 */
export function dismissChapterSave(chapterId: string): void {
  entries.delete(chapterId);
}

/** Test seam. Empties the queue and its subscribers. */
export function __resetChapterSaveQueue(): void {
  entries.clear();
  listeners.clear();
  inFlight.clear();
}
