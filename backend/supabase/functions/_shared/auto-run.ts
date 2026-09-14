/**
 * The credits an auto story buys before it writes anything.
 *
 * ## What an auto run is
 *
 * `story_flow = 'auto'` is the writer saying they do not want to be asked
 * between chapters. Until now the client's write-ahead bought those chapters
 * one at a time, checking the balance before each, which meant an auto story
 * could stop halfway because something else spent a credit in between --
 * audio, a portrait, a second device -- on a mode whose whole promise is that
 * it will not interrupt.
 *
 * So the run is bought UPFRONT: when chapter one lands,
 * `reserve_auto_chapter_run` works out how many of the remaining planned
 * chapters the balance can afford, reserves all of them in one transaction,
 * and records the last paid-for chapter on `stories.auto_run_through_chapter`.
 * The client reads that number off the row and writes exactly that far.
 *
 * ## Why the calls live here and not inline
 *
 * Both `generate-story` and `generate-story-stream` start stories, and both
 * have to reserve the run at the same moment for the same reasons; a run
 * reserved by one transport and not the other is an auto story that stalls
 * depending on which client version wrote it. `continue-story` is the only
 * caller of the refund, but it belongs beside the reservation because the two
 * numbers have to agree about what a run is.
 *
 * ## Both are best-effort, and deliberately so
 *
 * NEITHER OF THESE MAY FAIL A GENERATION. The reservation happens after
 * chapter one is written, persisted and paid for: throwing here would refund
 * the start and report a failure for a chapter the reader is already reading.
 * The refund runs on a path that is already failing, and a failure inside a
 * failure handler would replace a specific error with an opaque one. Both
 * report through `logError` under the `credits` bucket instead, which is what
 * AGENTS.md requires of anything that touches money: a failure reported only
 * in chat did not happen.
 *
 * The cost of the reservation failing is an auto story that asks before each
 * chapter, which is the interactive behaviour and charges correctly. The cost
 * of the refund failing is credits left reserved against chapters nobody will
 * write -- which is why it is logged `high` rather than `low`.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError, safeErrorMessage } from "./errors.ts";

/** What `reserve_auto_chapter_run` returns, as the callers read it. */
export interface AutoRunReservation {
  /** How many chapters were bought by this call. Zero is an ordinary answer. */
  chapters: number;
  /**
   * The last chapter this story has paid for.
   *
   * `from_chapter - 1` when nothing was bought, which is how the client tells
   * "a run was considered and the balance bought nothing" from "this story
   * predates runs", the second of which is a null column and keeps the old
   * per-chapter behaviour.
   */
  through_chapter: number;
  credits: number;
  /** The balance after the run, which is what the client must be told. */
  balance: number;
}

/**
 * Buy the rest of an auto series' plan, if it is one and the balance allows.
 *
 * Returns null when nothing was reserved AND nothing should be reported --
 * a non-auto story, or a failure. The caller keeps the balance it already had.
 */
export async function reserveAutoChapterRun(
  client: SupabaseClient,
  input: {
    userId: string;
    storyId: string;
    /** One run id per attempt, so a retried invocation replays. */
    runId: string;
    /** Chapter one is bought by `begin_story_generation`; a run starts at two. */
    fromChapter: number;
  },
): Promise<AutoRunReservation | null> {
  const { data, error } = await client.rpc("reserve_auto_chapter_run", {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_run_id: input.runId,
    p_from_chapter: input.fromChapter,
  });

  if (error) {
    console.error(
      "auto run reservation failed:",
      safeErrorMessage(error),
    );
    await logError({
      bucket: "credits",
      severity: "medium",
      source: "runtime",
      errorCode: "auto_run_reservation_failed",
      error,
      context: { story_id: input.storyId, from_chapter: input.fromChapter },
      userId: input.userId,
    });
    /*
      NULL MEANS "NO RUN WAS BOUGHT", AND THE STORY DEGRADES TO PER-CHAPTER.

      Deliberate, and worth stating because the degradation is invisible from
      the reader's side: `stories.auto_run_through_chapter` stays null, so the
      write-ahead takes its pre-run path and buys a chapter at a time against
      the live balance. The story still continues by itself -- that is the
      promise auto mode actually makes -- but it is no longer bought in one
      step, so the balance ticks down instead of dropping once.

      Failing the whole generation instead would be worse by a distance: the
      writer has already paid for chapter one and would lose it to a transient
      RPC error on an optimisation. Falling back to the behaviour that worked
      before pre-buying existed costs them nothing.

      It is not silent to us: `auto_run_reservation_failed` is logged at medium
      with the story and the chapter, so a run of these is visible even though
      no single one interrupts a reader.
    */
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  return {
    chapters: Number(payload.chapters ?? 0),
    through_chapter: Number(payload.through_chapter ?? input.fromChapter - 1),
    credits: Number(payload.credits ?? 0),
    balance: Number(payload.balance ?? 0),
  };
}

/**
 * Give back every chapter of a run that was bought and will not be written.
 *
 * Called with the chapter the run STOPPED ON, not the one after it: a provider
 * failure at chapter 4 of a 6-chapter run refunds 3 -- the one that failed and
 * the two never attempted. The failed chapter's own refund may already have
 * happened on the ordinary path; `refund_auto_chapter_run` goes through
 * `refund_generation_operation`, which is idempotent per operation, so the two
 * cannot pay it out twice.
 */
export async function refundAutoChapterRun(
  client: SupabaseClient,
  input: {
    userId: string;
    storyId: string;
    fromChapter: number;
    error: string;
  },
): Promise<void> {
  if (input.fromChapter < 2) return;
  const { error } = await client.rpc("refund_auto_chapter_run", {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_from_chapter: input.fromChapter,
    p_error: input.error,
  });
  if (!error) return;

  console.error("auto run refund failed:", safeErrorMessage(error));
  await logError({
    bucket: "credits",
    severity: "high",
    source: "runtime",
    errorCode: "auto_run_refund_failed",
    error,
    context: { story_id: input.storyId, from_chapter: input.fromChapter },
    userId: input.userId,
  });
}
