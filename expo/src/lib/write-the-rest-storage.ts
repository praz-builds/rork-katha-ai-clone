import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persistence for a "Write the rest" run.
 *
 * §10.2 asks for "a resume prompt if the app is killed mid-run", and a run is
 * the one thing in the studio that can be killed with money already spent and
 * more still planned. Everything else the studio does is a single request: it
 * either completed or it did not, and there is nothing to resume. A run is a
 * program that was half executed, so the intent has to outlive the process or
 * the writer comes back to a story that stopped at chapter 5 of 7 with no
 * record that anything was ever driving it there.
 *
 * It deliberately mirrors `draft-storage.ts` rather than inventing a second
 * persistence style: one `katha:create:*` key, one JSON blob, best-effort
 * writes that never throw into the caller, and the same 7-day expiry. A run
 * record older than the draft policy is not a run anybody still means to
 * finish, and leaving it would offer to spend credits on a story the writer has
 * forgotten.
 *
 * What is NOT stored here, on purpose:
 *
 * - **The story itself.** The chapters a run wrote are persisted by the server
 *   as each one lands — that is the whole point of "you pay as each chapter is
 *   written" — so duplicating them in AsyncStorage would create a second,
 *   staler copy of the thing the backend already owns.
 * - **Credits.** The balance moves for reasons this record cannot see, so a
 *   remembered balance would be wrong by the time it is read. A resumed run
 *   re-prices itself against the live balance and confirms again.
 */

const RUN_KEY = "katha:create:write-the-rest";
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matching draft-storage.ts

export type WriteTheRestRun = {
  /**
   * Which story the run belongs to.
   *
   * Checked before anything is offered. A record for a different story must
   * never resume into the story that happens to be open — that would append
   * paid chapters to the wrong book.
   */
  storyId: string;
  /** The chapter count the run is driving toward: `maxChapters` when confirmed. */
  targetChapterCount: number;
  /**
   * Whether chapter art was on when the run was confirmed.
   *
   * Recorded because it is priced (`CREDITS_AND_PRICING.md`: 1 credit per
   * chapter's art), so the resume confirm has to itemise the same run the
   * writer originally agreed to rather than re-deriving it from a toggle they
   * may have flipped since.
   */
  illustrated: boolean;
  /** Chapters the story had when the run started. The run's own progress floor. */
  startedAtChapterCount: number;
  savedAt: number;
};

export async function saveWriteTheRestRun(
  run: Omit<WriteTheRestRun, "savedAt">,
): Promise<void> {
  try {
    const payload: WriteTheRestRun = { ...run, savedAt: Date.now() };
    await AsyncStorage.setItem(RUN_KEY, JSON.stringify(payload));
  } catch {
    // Silent fail. A run that cannot record itself still runs; it just cannot
    // be resumed, which is strictly better than refusing to start.
  }
}

export async function loadWriteTheRestRun(): Promise<WriteTheRestRun | null> {
  try {
    const raw = await AsyncStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed: WriteTheRestRun = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.storyId !== "string" ||
      !parsed.storyId ||
      typeof parsed.targetChapterCount !== "number" ||
      typeof parsed.startedAtChapterCount !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > STALE_MS) {
      await AsyncStorage.removeItem(RUN_KEY);
      return null;
    }
    return { ...parsed, illustrated: parsed.illustrated === true };
  } catch {
    return null;
  }
}

export async function clearWriteTheRestRun(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RUN_KEY);
  } catch {
    // Silent fail
  }
}
