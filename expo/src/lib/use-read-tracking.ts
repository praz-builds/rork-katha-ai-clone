import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { recordRead as defaultRecordRead } from "@/lib/api";

/**
 * Measure how long a chapter was actually in front of somebody, and tell the
 * server while they are still reading it.
 *
 * WHAT THIS TURNS ON. `story_reads` was empty in production because nothing
 * ever called `record-read`, and two shipped mechanics read that table: the
 * feedback credit (a claim needs 120 seconds of dwell recorded *before* the
 * comment, plus one server-written `read_at` at least a minute older than it)
 * and the streak ladder, whose only other trigger is publishing a story. Until
 * this existed, "Keep a reading streak" could not be kept by reading.
 *
 * ── WHY IT POSTS AT 120 SECONDS AND NOT ONLY ON THE WAY OUT ───────────────
 *
 * The first version flushed only in the effect's cleanup, and that made the
 * headline case impossible. **The comment box is inside the reader**:
 * `ChapterSocial` renders at the end of the chapter with its own composer, so
 * somebody who reads a chapter and says something at the bottom of it never
 * leaves, and the row is written *after* the comment. The gate sums only reads
 * with `read_at < comment.created_at`, so the sum is zero and the claim is
 * refused — "Read the story first", after ten minutes on the chapter, which is
 * the exact bug this hook was written to remove.
 *
 * It does not heal, either. The comment's timestamp is fixed and the 24-hour
 * dedup means tomorrow's read cannot produce an earlier row, so that comment is
 * unclaimable for good. A one-chapter story could never qualify at all.
 *
 * `POST_AT_SECONDS` is 120 because **that is the only number anything reads**.
 * `story_reads.duration_seconds` has exactly one consumer in the whole repo —
 * the `sum(...) >= 120` in `comment_credit_block_reason`. Posting the moment
 * foreground dwell crosses it records precisely what the gate tests for, and
 * sets `read_at` two minutes into the read, which clears 00090's separate
 * 60-second `read_at` rule long before a 40-character comment can be typed.
 *
 * The cleanup flush stays for chapters that never get that far: it is what
 * feeds `read_count` and the streak for a short read.
 *
 * ── THE 24-HOUR DEDUP SHAPES EVERYTHING ELSE ──────────────────────────────
 *
 * A second call for the same chapter inside a day is answered
 * `recorded: false` and **the first row keeps its original duration**. So the
 * threshold post must be the *first* one, and a partial number must never be
 * sent before it. Two consequences worth knowing:
 *
 *  - Nothing is sent below `MIN_SECONDS`. Paging through a story to find your
 *    place should not write a row per chapter it passes.
 *  - **A short first sitting locks the duration low for the rest of the day.**
 *    Read 30 seconds, leave, come back and read ten minutes: the second post
 *    is deduped and the sum stays 30. Recording the 30 is still right — it
 *    feeds the streak and `read_count`, and 30 fails the gate exactly as 0
 *    does — but raising it would need the server to update the row, which it
 *    deliberately does not do. Out of scope here, and worth knowing.
 *
 * FOREGROUND TIME ONLY. A phone in a pocket with the reader open is not
 * reading. `AppState` banks the elapsed time on the way to background and
 * restarts the clock on the way back, and the threshold timer is descheduled
 * and re-armed with it, so a story left open overnight contributes the minutes
 * it was actually visible.
 *
 * NEVER IN THE WAY. Every call is fire-and-forget and every failure is
 * swallowed — `recordRead` resolves null rather than throwing. Nothing a reader
 * can see depends on it.
 */

/** Below this, a chapter was passed through rather than read. */
export const MIN_SECONDS = 5;

/**
 * The dwell at which the read is reported without waiting for an exit. It is
 * the gate's own threshold, and the gate is the only thing that reads the
 * number.
 */
export const POST_AT_SECONDS = 120;

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
  const send = useRef(recordRead);
  const clock = useRef(now);
  send.current = recordRead;
  clock.current = now;

  useEffect(() => {
    if (!storyId) return;
    const target = { storyId, chapterId: chapterId ?? null };

    let startedAt: number | null = clock.current();
    let bankedMs = 0;
    let posted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const dwellMs = () =>
      bankedMs + (startedAt === null ? 0 : Math.max(0, clock.current() - startedAt));

    const post = (seconds: number) => {
      posted = true;
      // Not awaited: this runs from a timer or a cleanup, and there is nothing
      // waiting on the answer.
      void send.current({
        storyId: target.storyId,
        chapterId: target.chapterId,
        durationSeconds: seconds,
      });
    };

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    /** Arm the threshold post for whatever foreground time is still owed. */
    const armTimer = () => {
      clearTimer();
      if (posted) return;
      const remaining = POST_AT_SECONDS * 1000 - dwellMs();
      timer = setTimeout(() => {
        timer = null;
        if (posted) return;
        // Exactly the threshold, not the measured dwell: the timer may fire a
        // few milliseconds late and the number's only reader is a `>= 120`.
        post(POST_AT_SECONDS);
      }, Math.max(0, remaining));
    };

    /** Move the running clock into the bank. Idempotent. */
    const bank = () => {
      if (startedAt === null) return;
      bankedMs += Math.max(0, clock.current() - startedAt);
      startedAt = null;
    };

    const onAppState = (next: AppStateStatus) => {
      if (next === "active") {
        // Only restart if it is not already running: `active` can arrive twice,
        // and a second start would discard the banked time.
        if (startedAt === null) startedAt = clock.current();
        armTimer();
        return;
      }
      bank();
      clearTimer();
    };

    const subscription = AppState.addEventListener("change", onAppState);
    armTimer();

    return () => {
      subscription.remove();
      clearTimer();
      bank();
      const seconds = bankedMs / 1000;
      // Already reported at the threshold: a second call would be deduped and
      // would tell the server nothing it does not have.
      if (posted) return;
      if (seconds < MIN_SECONDS) return;
      post(seconds);
    };
    // `chapterId` in the deps is what makes turning a page a separate read:
    // the cleanup flushes the chapter being left before the next one starts.
  }, [storyId, chapterId]);
}
