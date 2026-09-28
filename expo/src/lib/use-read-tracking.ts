import { useCallback, useEffect, useRef } from "react";
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
 * foreground dwell crosses it records precisely what the gate tests for.
 *
 * The cleanup flush stays for chapters that never get that far: it is what
 * feeds `read_count` and the streak for a short read.
 *
 * ── AND A FLUSH WHEN THE COMPOSER IS TOUCHED ──────────────────────────────
 *
 * `flushNow` is called when the comment box takes focus, which is the one
 * moment on the path to a claim that a clock cannot see. It is for the shape
 * the threshold misses: **two chapters that each stay under 120 seconds.**
 * Chapter 1 flushes at 70s on the page turn; chapter 2 is still mounted and has
 * no row at all, so the sum is 70 and the claim is refused over 140 seconds of
 * real reading. Writing chapter 2's row when the reader reaches for the
 * keyboard makes the sum 140.
 *
 * ── WHAT THIS STILL CANNOT DO, AND IT IS THE GATES' OWN ARITHMETIC ────────
 *
 * The two server rules are **120 seconds of summed dwell** and **one row whose
 * `read_at` is at least 60 seconds older than the comment** — and `read_at` is
 * `now()` at insert, not when the read began. Jointly they mean **no comment
 * before three minutes can qualify**, whatever this hook does: the earliest
 * honest row carrying 120 seconds is written at the 120-second mark, and the
 * 60-second rule then puts the first claimable comment at 180.
 *
 * A reader who comments between 2:00 and 3:00 is refused, permanently — the
 * comment's timestamp never moves and the dedup stops a later read producing an
 * earlier row. Writing the row sooner would mean claiming 120 seconds of
 * reading that had not happened. That is 00090's design rather than something
 * to route around here, and it is written down so the next person does not try.
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
): { flushNow: () => void } {
  const { recordRead = defaultRecordRead, now = Date.now } = options;

  // Refs throughout: none of this may cause a render. A reading screen that
  // re-renders on a timer is the one thing this must not become.
  const send = useRef(recordRead);
  const clock = useRef(now);
  send.current = recordRead;
  clock.current = now;
  // Set by the effect below to its own post; stable identity for callers.
  const flushRef = useRef<() => void>(() => {});
  const flushNow = useCallback(() => flushRef.current(), []);
  /**
   * Seconds the SERVER has accepted for this story, across the chapters read
   * in this visit. At hook scope on purpose: the effect is torn down and
   * rebuilt on every page turn, and the gate sums a STORY's rows, so the
   * composer flush has to know what the earlier chapters already contributed.
   *
   * It must never read high. Everything the flush does keys off it, and a
   * number above the server's turns the guard from a protection into the
   * short-row-plus-cancelled-timer bug it was added to prevent. So it counts
   * only what came back `recorded: true`, and it is reset inside the effect
   * rather than during render -- React runs the new render before the old
   * effect's cleanup, so zeroing it here would hand story B the seconds story
   * A's last chapter is about to post.
   */
  const recordedForStory = useRef({ storyId: "", seconds: 0 });

  useEffect(() => {
    if (!storyId) return;
    const target = { storyId, chapterId: chapterId ?? null };
    if (recordedForStory.current.storyId !== storyId) {
      recordedForStory.current = { storyId, seconds: 0 };
    }

    let startedAt: number | null = clock.current();
    let bankedMs = 0;
    let posted = false;
    // True from the moment a request goes out until it answers. `posted` alone
    // cannot cover that window: it is set from the reply.
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const dwellMs = () =>
      bankedMs + (startedAt === null ? 0 : Math.max(0, clock.current() - startedAt));

    /**
     * Report `seconds`, and update what this hook believes only from what the
     * server actually said.
     *
     * Three things were wrong with the obvious version, and all three end in
     * the same place: a short row written by the flush, a cancelled timer, and
     * the 120 the gate tests for never arriving.
     *
     * `posted` used to be set on the ATTEMPT. `recordRead` swallows every
     * failure and resolves null, so a dropped request looked exactly like a
     * written row -- and because all three paths bail out on `posted`, one
     * failed call silenced the other two.
     *
     * The story mirror used to be incremented on any non-null answer. A
     * **deduped** read is non-null: the server finds a row for this chapter
     * inside 24 hours, answers `recorded: false`, and leaves the original
     * `duration_seconds` alone. Paging back one chapter was enough to lift the
     * mirror above the server's sum, and the flush's guard is only as good as
     * that number.
     *
     * And `posted` is set after the await, so for the length of the request
     * every caller still reads false -- a page turn during a slow threshold
     * post ran the cleanup into the same chapter. `inFlight` closes that
     * without going back to trusting the attempt.
     *
     * `clearTimer` moved in here too, after a delivered post. Cancelling it
     * before the call meant a failed flush left `posted` false with nothing
     * left to fire, and the timer is the only path that runs while the reader
     * is still on the chapter -- which is the only path that helps the case
     * this hook exists for.
     */
    const post = async (seconds: number) => {
      if (posted || inFlight) return;
      inFlight = true;
      try {
        const result = await send.current({
          storyId: target.storyId,
          chapterId: target.chapterId,
          durationSeconds: seconds,
        });
        if (result === null) return;
        // Delivered. This chapter has nothing left to say either way, because
        // a second call inside the window is deduped.
        posted = true;
        clearTimer();
        // But only a WRITTEN row moved the server's sum.
        if (result.recorded) recordedForStory.current.seconds += seconds;
      } catch {
        // `recordRead` catches its own, but a seam a caller injects may not,
        // and an unhandled rejection is not something a reading screen may do.
      } finally {
        inFlight = false;
      }
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
        void post(POST_AT_SECONDS);
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

    /**
     * What `flushNow` does: write this chapter's row now, but ONLY if doing so
     * actually gets the story over the gate.
     *
     * The first version posted whatever the dwell was, over `MIN_SECONDS`. That
     * is a floor for "was this a page turn", not for "can this row satisfy a
     * 120-second sum", and using it here cost claims that had been paying: a
     * focus at 100 seconds wrote 100, cancelled the timer, and the dedup meant
     * the 120 the gate tests for was never coming. The reader then typed for
     * two minutes, posted, and was told to read the story first.
     *
     * So it posts when the story's recorded seconds plus this chapter's dwell
     * clear the threshold -- which is exactly the case this was added for, two
     * chapters of 70 -- and otherwise leaves the timer to do its job, because
     * a threshold post twenty seconds away is strictly better than a short row
     * that locks the chapter for the day.
     *
     * It does not touch the timer. `post` cancels it once a post has actually
     * landed; cancelling here would mean a flush whose request fails takes the
     * net down with it, on the one path where the reader never leaves.
     */
    flushRef.current = () => {
      if (posted) return;
      const seconds = dwellMs() / 1000;
      if (seconds < MIN_SECONDS) return;
      if (recordedForStory.current.seconds + seconds < POST_AT_SECONDS) return;
      void post(seconds);
    };

    const subscription = AppState.addEventListener("change", onAppState);
    armTimer();

    return () => {
      flushRef.current = () => {};
      subscription.remove();
      clearTimer();
      bank();
      const seconds = bankedMs / 1000;
      // Already reported at the threshold: a second call would be deduped and
      // would tell the server nothing it does not have.
      if (posted) return;
      if (seconds < MIN_SECONDS) return;
      void post(seconds);
    };
    // `chapterId` in the deps is what makes turning a page a separate read:
    // the cleanup flushes the chapter being left before the next one starts.
  }, [storyId, chapterId]);

  return { flushNow };
}
