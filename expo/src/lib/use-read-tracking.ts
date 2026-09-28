import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { recordRead as defaultRecordRead } from "@/lib/api";

/**
 * Measure how long a chapter was actually in front of somebody, and tell the
 * server once, on the way out.
 *
 * WHAT THIS TURNS ON. `story_reads` was empty in production because nothing
 * ever called `record-read`, and two shipped mechanics read that table: the
 * feedback credit (a claim needs 120 seconds of dwell recorded *before* the
 * comment, plus one server-written `read_at` a minute older than it) and the
 * streak ladder, whose only other trigger is publishing a story. Until this
 * existed, "Keep a reading streak" could not be kept by reading.
 *
 * ONE POST PER CHAPTER, AT THE END. The server deduplicates per user and
 * chapter over 24 hours: a second call inside that window is answered
 * `recorded: false` and the first row keeps its original duration. So posting
 * at a threshold mid-read would permanently record that partial number and
 * throw the rest away. The dwell is accumulated here and sent when the reader
 * leaves the chapter, leaves the screen, or backgrounds the app.
 *
 * FOREGROUND TIME ONLY. A phone in a pocket with the reader open is not
 * reading, and the credit this feeds is meant to mean somebody read something.
 * The `AppState` subscription banks the elapsed time on the way to background
 * and restarts the clock on the way back, so a story left open overnight
 * contributes the minutes it was actually visible.
 *
 * NEVER IN THE WAY. Every call is fire-and-forget and every failure is
 * swallowed -- `recordRead` resolves null rather than throwing. Nothing a
 * reader can see depends on it, and an error about telemetry over a story
 * somebody is reading would be worse than the missing row.
 *
 * WHY A MINIMUM. Under `MIN_SECONDS` nothing is sent at all. Paging through a
 * story to find your place should not write a row for every chapter it passes
 * -- and because of the 24-hour dedup, a 1-second row is not a small mistake:
 * it is the number that chapter is stuck with for the rest of the day, and it
 * would make the 120-second gate *harder* to pass than recording nothing.
 */

/** Below this, a chapter was passed through rather than read. */
export const MIN_SECONDS = 5;

export type ReadTrackingOptions = {
  /** Test seam. Defaults to the real endpoint call. */
  recordRead?: typeof defaultRecordRead;
  /** Test seam. Defaults to `Date.now`. */
  now?: () => number;
};

export function useReadTracking(
  storyId: string,
  chapterId: string | null | undefined,
  options: ReadTrackingOptions = {},
): void {
  const { recordRead = defaultRecordRead, now = Date.now } = options;

  // Refs throughout: none of this may cause a render. A reading screen that
  // re-renders on a timer is the one thing this must not become.
  const startedAt = useRef<number | null>(null);
  const bankedMs = useRef(0);
  // Held in a ref as well as in the closure so the flush on unmount reports
  // the chapter it measured rather than whatever is current by then.
  const tracked = useRef<{ storyId: string; chapterId: string | null } | null>(null);
  const send = useRef(recordRead);
  const clock = useRef(now);
  send.current = recordRead;
  clock.current = now;

  useEffect(() => {
    if (!storyId) return;
    const target = { storyId, chapterId: chapterId ?? null };
    tracked.current = target;
    bankedMs.current = 0;
    startedAt.current = clock.current();

    /** Move the running clock into the bank. Idempotent. */
    const bank = () => {
      if (startedAt.current === null) return;
      bankedMs.current += Math.max(0, clock.current() - startedAt.current);
      startedAt.current = null;
    };

    const onAppState = (next: AppStateStatus) => {
      if (next === "active") {
        // Only restart if it is not already running: `active` can arrive
        // twice, and a second start would discard the banked time.
        if (startedAt.current === null) startedAt.current = clock.current();
        return;
      }
      bank();
    };

    const subscription = AppState.addEventListener("change", onAppState);

    return () => {
      subscription.remove();
      bank();
      const seconds = bankedMs.current / 1000;
      bankedMs.current = 0;
      tracked.current = null;
      if (seconds < MIN_SECONDS) return;
      // Deliberately not awaited: this runs in a cleanup, on the way out of a
      // screen, and there is nothing left to tell.
      void send.current({
        storyId: target.storyId,
        chapterId: target.chapterId,
        durationSeconds: seconds,
      });
    };
    // `chapterId` in the deps is what makes turning a page a separate read:
    // the cleanup flushes the chapter being left before the next one starts.
  }, [storyId, chapterId]);
}
