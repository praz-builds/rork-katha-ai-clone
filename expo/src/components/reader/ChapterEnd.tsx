import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Sparkles } from "lucide-react-native";
import DirectionChoices from "@/components/DirectionChoices";
import {
  canExtend,
  autoChapterToWriteAhead,
  hasGenerationForChapter,
  plannedChapterCountOf,
  retryGeneration,
  useChapterGeneration,
} from "@/lib/generation-session";
import { isOwnStory } from "@/lib/ownership";
import type { ContinuationOption, DirectionStatus } from "@/components/DirectionChoices";
import { toDirection } from "@/lib/directions";
import { CHAPTER_TEXT_CREDITS } from "@/lib/pricing-limits";
import { colors, radius, spacing, type } from "@/theme";
import type { Chapter, DirectionChooser, Story } from "@/types/domain";

/**
 * The cards, the composer and the surprise-me path are `DirectionChoices` --
 * shared with the create flow, which asks the same question before chapter one
 * exists. This file owns only what is specific to a chapter end: where the
 * directions come from, whether there is a next chapter to offer at all, and
 * what one costs.
 *
 * Re-exported because callers and tests already import the option type from
 * here, and a second spelling of it would be one more thing to keep in step.
 */
export type { ContinuationOption } from "@/components/DirectionChoices";

type SuggestionStatus = DirectionStatus;

const UNAVAILABLE_REASON = {
  insufficient:
    "This story doesn't have enough detail yet to suggest a direction.",
  failed: "We couldn't load suggested directions for this chapter.",
} as const;

/** The resolver is given this long before its result is treated as failed. */
const RESOLVE_TIMEOUT_MS = 4000;

/**
 * One honest sentence about who sent the story this way.
 *
 * THE RULE THIS EXISTS TO KEEP: a reader is never told they chose a path the
 * model chose. `direction_chosen_by` is the only thing that knows, so this
 * reads it and says nothing when it says nothing.
 *
 * - `reader` -- a person tapped a chip or typed a direction. Which person
 *   matters: on somebody else's story "You chose this" is simply false, so the
 *   author is named instead. The story's own author sees "You".
 * - `model` -- auto mode, and the direction model actually picked among the
 *   chips. Katha chose, and the sentence says so.
 * - `ranking` -- auto mode with no choosing step: the call failed or was not
 *   made, and the top-ranked chip was taken. Deliberately NOT the same
 *   sentence as `model` (00078 says why): calling a fallback a choice is a
 *   small lie, and it is the exact lie this column was added to prevent.
 * - absent -- nothing was recorded, or the chapter predates the column. No
 *   sentence at all; the cards stand on their own.
 */
function attributionFor(
  chosenBy: DirectionChooser | undefined,
  story: Story,
): string | undefined {
  if (chosenBy === "reader") {
    return isOwnStory(story) ? "You chose this." : "The author chose this.";
  }
  if (chosenBy === "model") return "Katha chose this one.";
  if (chosenBy === "ranking") return "Katha continued with the first of these.";
  return undefined;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * How many DERIVED direction cards the reader is offered.
 *
 * Two, not three. The third card in the row is always "Write your own", so the
 * reader is looking at three cards either way -- two the story proposes and one
 * they fill in themselves.
 */
const MAX_OPTIONS = 2;

/**
 * Reads the concrete continuation directions straight off data the backend
 * already generated - the approved chapter plan and the series state - rather
 * than making a fresh network call. `story.beats[n]` briefs chapter `n + 1`,
 * so the beat at the next chapter's index is exactly what the writer already
 * approved happens next; `series_state.open_hooks` and `promised_payoffs` are
 * unresolved threads the model itself is tracking; `next_chapter_pressure` is
 * the model's own statement of what the chapter that just ended is pushing
 * toward; `chapter.hookText` is the line this chapter actually closed on. All
 * five travel on the `Story`/`Chapter` the reader already has, because §10
 * makes chapter 1's generation (and every continuation after it) the place
 * series state is written.
 *
 * NOTHING GENERIC IS EVER SYNTHESISED HERE. A previous version kept a list of
 * hardcoded filler ("Introduce a complication no one saw coming") to pad the
 * surface out when the story carried little state. That is worse than showing
 * nothing: a suggestion that could sit under any story in the app advertises
 * that the app did not read this one. If the story carries no usable state the
 * caller degrades to the write-your-own path and says why.
 *
 * The previous version also stopped at exactly two and threw everything away
 * unless it found two, which is why readers of a thinly-stated story saw only
 * the free-text box. One real direction is worth showing.
 *
 * Exported so it can be tested in isolation from the async/loading shell
 * around it.
 */
export function deriveContinuationOptions(
  story: Story,
  chapter: Chapter,
): ContinuationOption[] {
  const candidates: ContinuationOption[] = [];
  const push = (id: string, value: string | undefined | null) => {
    const raw = nonEmpty(value);
    if (!raw) return;
    /*
      EVERY CHIP IS AN INSTRUCTION, NEVER A QUESTION.

      `open_hooks` and `hook_text` arrive phrased as questions, because that is
      what a hook is. Rendered straight they read as a comprehension quiz --
      "Who is writing the predictive linen notes" -- which asks the reader to
      answer the story rather than steer it. `toDirection` puts a fixed English
      frame in front of the story's own words to point it the other way, and
      returns `null` for anything it cannot convert grammatically.

      A `null` is DROPPED. It is not replaced, because the replacement would
      have to be invented, and an invented chip fits every story in the app.
    */
    const prompt = toDirection(raw);
    if (!prompt) return;
    // Two sources often carry the same sentence - the plan's next beat and the
    // pressure the model recorded, most commonly. Deduping on the CONVERTED
    // prose (not the source) also catches a hook and a payoff that differ only
    // in punctuation, since both land on the same direction.
    if (candidates.some((existing) => existing.prompt === prompt)) return;
    candidates.push({ id, prompt });
  };

  push("planned-beat", story.beats?.[chapter.chapterNumber]);
  story.seriesState?.open_hooks?.forEach((hook, index) => {
    push(`open-hook-${index}`, hook);
  });
  story.seriesState?.promised_payoffs?.forEach((payoff, index) => {
    push(`promised-payoff-${index}`, payoff);
  });
  push("next-chapter-pressure", story.seriesState?.next_chapter_pressure);
  push("chapter-hook", chapter.hookText);

  return candidates.slice(0, MAX_OPTIONS);
}

async function defaultResolveOptions(
  story: Story,
  chapter: Chapter,
): Promise<ContinuationOption[]> {
  return deriveContinuationOptions(story, chapter);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Suggestion lookup timed out")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export type ChapterEndProps = {
  story: Story;
  chapter: Chapter;
  /**
   * Resolves the two suggested directions. Defaults to
   * {@link deriveContinuationOptions} wrapped in a promise. Overridable so a
   * test can force the "offline or error" path without faking a network
   * layer that does not exist here - the real resolver never rejects, but
   * the degrade path it feeds must still be provably correct.
   */
  resolveOptions?: (story: Story, chapter: Chapter) => Promise<ContinuationOption[]>;
  /**
   * Write the next chapter in this direction. `undefined` means Katha decides.
   *
   * This component no longer makes the request itself. It used to, and then
   * showed its own "Writing what happens next..." panel at the bottom of the
   * last page - a second waiting surface, several inches down a scroll, with a
   * different look from the one the same app shows for the first chapter. The
   * caller now starts the generation and puts the ordinary wait on screen; when
   * it lands, the reader opens on page 1 of the new chapter.
   */
  onContinue: (
    direction?: string,
    offered?: readonly ContinuationOption[],
    /**
     * True when this chapter is past the story's plan, so the caller must ask
     * the server to raise it. Sent only from a story that has reached its
     * planned ending and can still grow -- never from auto-continue.
     */
    extend?: boolean,
  ) => void;
  /**
   * Opens Reimagine for a standalone story, which has no next chapter to offer
   * and so ends on this instead. Omitted and the pill is not rendered.
   */
  onReimagine?: () => void;
  /**
   * The viewer's balance, for the auto fallback's own gate.
   *
   * Required rather than optional: a default would silently re-create the
   * missing gate this prop exists to close.
   */
  credits: number;
};

export default function ChapterEnd({
  story,
  chapter,
  resolveOptions = defaultResolveOptions,
  onContinue,
  onReimagine,
  credits,
}: ChapterEndProps) {
  const reduceMotion = useReducedMotion();
  const isSeries = story.storyMode === "series";
  const latestChapterNumber = story.chapters.reduce(
    (max, item) => Math.max(max, item.chapterNumber),
    0,
  );

  // `renderChapterEnd` fires at the last page of every chapter, not only the
  // story's newest one. Re-reading an earlier chapter must not offer to
  // branch the series from the middle of it - the reader already has a
  // "Chapters" list for moving forward through what exists.
  const isLatestChapter = chapter.chapterNumber >= latestChapterNumber;
  // Mirror the server's own default rather than treating "unknown" as
  // "unlimited". `continue-story` resolves a missing or unrecognised
  // `planned_chapter_count` to 3 and refuses anything past it, so a story
  // without one was being offered a continuation the server would reject --
  // the client promising something the backend had already decided against.
  // Shared with the write-ahead path, which must stop at the same chapter this
  // surface stops offering.
  const effectivePlannedCount = plannedChapterCountOf(story);
  const planReached = isSeries
    && chapter.chapterNumber >= effectivePlannedCount;

  /**
   * The story has run out of plan, and the person reading it can buy more.
   *
   * This is what turns "The story is complete" into a question. A story that
   * has reached its plan is finished only until its author says otherwise: the
   * ordinary direction chips are offered again, and picking one raises the
   * plan by a chapter and charges for it.
   *
   * `canExtend` carries the three conditions -- a series, below the fifteen
   * chapter ceiling, viewed by its own author. Someone else's finished story
   * still says it is complete, because the alternative is offering a stranger
   * a button that spends their credits writing into a story they do not own.
   */
  const extendable = planReached && canExtend(story);

  /**
   * Nothing more to offer here at all.
   *
   * A standalone (no chapter two ever existed), a story at the ceiling, or
   * anybody else's finished series. An extendable story is deliberately NOT
   * complete: it takes the ordinary chapter-end path below, chips and all.
   */
  const seriesComplete = !isSeries || (planReached && !extendable);

  /**
   * Auto-continue: the writer said in the brief that they do not want to be
   * asked between chapters.
   *
   * The flow is deliberately identical to interactive -- the same directions
   * are resolved from the same story state -- and only the decision changes
   * hands. The first derived option is taken because the resolver already
   * ranks them: `beats[n]` is the plan the writer approved for this exact
   * chapter, and it sorts ahead of an open hook. With nothing derived the
   * direction is `undefined`, which is the same "Katha decides" the surprise-me
   * path sends, so an auto story never stalls on a chapter the resolver could
   * not read.
   *
   * `storyFlow` is read from the story ROW, not from the draft that created it:
   * the brief is a different session from this one, and the server clamps a
   * mode it does not recognise to `interactive`.
   */
  const nextChapterNumber = chapter.chapterNumber + 1;

  /**
   * Auto-continue fires only for the story's AUTHOR, and only once per chapter.
   *
   * The ownership gate is not theoretical. `story_flow` travels on the row, and
   * the moment any read that feeds a public shelf starts selecting it, every
   * reader who reached the end of somebody else's auto story would fire
   * `continue-story` against a story they do not own -- with no tap, and with a
   * "chapter is being written" message in front of them that the 404 makes a
   * lie. Nothing but which columns one edge function happens to select is
   * standing between that and production, so the gate belongs here.
   *
   * The once-per-chapter guard is `hasGenerationForChapter`, not a ref: this
   * component unmounts the moment the reader leaves the last page, so a ref
   * guards a single visit and nothing more. See the note on that function.
   */
  const isAuto = story.storyFlow === "auto" && isOwnStory(story);

  /**
   * Whether chapter N+1 is under way, as far as this mount can tell.
   *
   * Seeded from the session store rather than from `false`, because the store
   * is the only thing that survives this component being unmounted -- which
   * happens every time the reader leaves the last page. Seeded state and not a
   * ref, because the copy on screen depends on the answer and a ref does not
   * re-render.
   */
  const [autoStarted, setAutoStarted] = useState(false);

  /**
   * The session writing chapter N+1, whoever started it.
   *
   * Usually nobody here started it. In auto mode the next chapter is begun the
   * moment THIS one is persisted, minutes before the reader pages down to this
   * surface, so by the time it mounts the work is normally done and this
   * component is the fallback rather than the trigger. Subscribed rather than
   * read once, because a write-ahead can fail while the reader is still inside
   * the previous chapter and the copy below has to follow that.
   */
  const nextSession = useChapterGeneration(story.id, nextChapterNumber);

  const [status, setStatus] = useState<SuggestionStatus>("loading");
  const [options, setOptions] = useState<ContinuationOption[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string>(
    UNAVAILABLE_REASON.failed,
  );

  /**
   * One continuation per chapter end, however many times it is tapped.
   *
   * This component used to make the request itself and guard it with the
   * request's own pending state; it now hands the direction upward and the
   * caller starts the generation, so the guard has to be here or nowhere. It
   * is not cosmetic: two taps in the same tick are two `startChapterGeneration`
   * calls, which is two chapters written and two credits spent for one
   * decision. A `ref` rather than state because the second press of a real
   * double tap can arrive before a re-render.
   */
  const firedRef = useRef(false);
  // Read inside `continueOnce`, which is memoised on `onContinue` alone so a
  // resolved option list does not mint a new callback and re-run the auto
  // effect that depends on it.
  const optionsRef = useRef<ContinuationOption[]>([]);
  // Read inside `continueOnce` for the same reason `optionsRef` is: the
  // callback is memoised on `onContinue` alone, so reading `extendable`
  // directly would either capture a stale value or re-mint the callback and
  // re-run the auto effect that depends on it.
  const extendRef = useRef(false);
  extendRef.current = extendable;
  useEffect(() => {
    firedRef.current = false;
  }, [chapter.id]);
  const continueOnce = useCallback((direction?: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    // The whole offer travels with the pick, not just the pick. Which chips
    // were on screen when a reader chose is recorded against the chapter so
    // the path a story took can be shown later; they are derived from a story
    // state that has already moved on by the time anyone could ask again.
    // `extend` is decided here rather than by the caller, because this is the
    // only place that knows the story has run out of plan. It rides with the
    // pick so the server raises the plan in the same transaction that charges
    // for the chapter -- a raise sent separately could commit against a
    // reservation that never happened, or fail after one that did.
    onContinue(direction, optionsRef.current, extendRef.current);
  }, [onContinue]);

  useEffect(() => {
    // Resolved for an extendable story too: `seriesComplete` is false there,
    // and the chips it renders are exactly these.
    if (seriesComplete || !isLatestChapter) return;
    let cancelled = false;
    setStatus("loading");
    withTimeout(resolveOptions(story, chapter), RESOLVE_TIMEOUT_MS)
      .then((resolved) => {
        if (cancelled) return;
        // One real direction beats none. Requiring two used to discard a
        // perfectly good single suggestion and leave the reader facing only
        // the free-text box - the defect this surface was rebuilt to fix.
        if (resolved.length >= 1) {
          optionsRef.current = resolved.slice(0, MAX_OPTIONS);
          setOptions(resolved.slice(0, MAX_OPTIONS));
          setStatus("ready");
        } else {
          // `DirectionChoices` opens its own composer on "unavailable": with
          // nothing derived, the reader's own words are the only way on.
          setUnavailableReason(UNAVAILABLE_REASON.insufficient);
          setStatus("unavailable");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUnavailableReason(UNAVAILABLE_REASON.failed);
        setStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [story, chapter, isLatestChapter, seriesComplete, resolveOptions]);

  // THIS IS THE FALLBACK, NOT THE TRIGGER. In auto mode the next chapter is
  // normally begun by `startAutoChapterAhead` the moment this one is persisted,
  // so that the reader arrives here to prose that already exists instead of to
  // an eight-second wait. This effect covers the cases where that did not
  // happen: the reader was not in the reader when the chapter landed, the
  // balance was short at the time, an older story reopened past its last
  // written chapter. `hasGenerationForChapter` is what keeps the two from both
  // buying the same chapter -- it counts every phase, so a write-ahead that is
  // still streaming, already finished, or failed all stop this dead.
  //
  // Fires once the directions have resolved either way -- `ready` or
  // `unavailable` -- and never while they are still loading, so an auto story
  // gets the direction its own state suggests rather than the fallback that
  // merely happened to be on screen first. `continueOnce` carries the same
  // single-fire guard the tap path uses, and it is reset per chapter id, so a
  // re-render or a status change cannot buy a second chapter.
  useEffect(() => {
    /*
      `planReached`, NOT `seriesComplete`. An extendable story is not complete
      -- that is the whole point of it -- so gating this on `seriesComplete`
      would let auto mode buy the extension itself, with no tap behind it, on
      a story whose author asked for exactly three chapters. Auto-continue
      stops at the plan; extending is a deliberate tap every time.
    */
    if (!isAuto || planReached || !isLatestChapter) return;
    if (status === "loading") return;
    if (hasGenerationForChapter(story.id, nextChapterNumber)) return;
    /*
      THE FALLBACK ASKS THE SAME QUESTION THE WRITE-AHEAD ASKS, and it did not.

      This effect had no balance gate at all. That was survivable when auto
      bought one chapter at a time and simply stopped when the money ran out;
      pre-buying makes "the balance is short of one chapter at the end of the
      run" the DESIGNED ending of every balance-capped run, not an edge. So the
      reader finished the last chapter they paid for, this fired the next one,
      and the server answered 402 -- a failure card at the end of a story that
      ended exactly as intended, with nobody having tapped anything.

      `autoChapterToWriteAhead` already holds every rule: ownership, the plan,
      the run ceiling, the balance, one-in-flight, and the durable failed-chapter
      bar. Calling it here rather than restating a subset is what keeps the two
      paths from drifting apart again -- they disagreed precisely because they
      were written twice.
    */
    if (autoChapterToWriteAhead(story, credits) === null) return;
    /*
      NO DIRECTION IS SENT, and that is the whole point of the fallback being
      auto mode's fallback rather than a tap without a finger.

      This used to send `options[0].prompt` -- the client's top-ranked chip --
      as `next_instruction`. Two things were wrong with that. The server treats
      an explicit instruction as "the reader has been asked and answered", so it
      skipped `chooseDirection` entirely: every chapter that came through this
      path was chosen by exactly the client sort the feature was built to
      replace. And it was then recorded as `direction_chosen_by: 'reader'`,
      which is a human tap that never happened -- a lie in the column the future
      chip surface will read.

      Passing `undefined` with the offer intact hands the choice to the server,
      which can see how the chapter actually ended, and records `model` or
      `ranking` truthfully.
    */
    continueOnce(undefined);
    setAutoStarted(true);
  }, [
    isAuto,
    planReached,
    isLatestChapter,
    status,
    options,
    continueOnce,
    story,
    credits,
    story.id,
    nextChapterNumber,
  ]);

  /*
    AN EARLIER CHAPTER ENDS ON THE PATHS IT TOOK.

    This returned null, which was right about the one thing it was guarding --
    re-reading chapter two must not offer to branch the series from the middle
    of it -- and left the boundary blank. The record of that boundary exists:
    since migration 00078 every continuation stores the chips that were on the
    table and the one it was written from.

    It is stored on the chapter that CAME OUT of the decision, not on the one
    that ended, so the block is assembled from the NEXT chapter and rendered at
    the end of this one. That is where the decision was made and where a reader
    moving forward meets it, a beat before reading what it produced.
  */
  if (!isLatestChapter) {
    const continuation = story.chapters.find(
      (item) => item.chapterNumber === chapter.chapterNumber + 1,
    );
    const offered = continuation?.directionsOffered ?? [];
    const chosen = nonEmpty(continuation?.directionChosen);
    /*
      A reader who typed their own direction chose something that was never on
      a card, and `direction_chosen` holds it. Showing the offered chips and
      silently dropping the one the story actually used would make this block
      a list of paths none of which were taken -- so the typed direction joins
      the list, last, as the one that was.
    */
    const paths = chosen && !offered.some((option) => option.prompt === chosen)
      ? [...offered, { id: `${continuation?.id ?? "chapter"}-chosen`, prompt: chosen }]
      : offered;
    if (paths.length === 0) return null;
    return (
      <View style={styles.wrap}>
        <DirectionChoices
          readOnly
          heading="The paths from here"
          options={paths}
          chosen={chosen}
          attribution={attributionFor(continuation?.directionChosenBy, story)}
          testIDPrefix="chapter-end"
        />
      </View>
    );
  }

  /*
    Two ways a story ends here, and they are different endings.

    A SERIES that has reached its planned last chapter AND cannot be grown says
    so: at the fifteen-chapter ceiling, or read by somebody who does not own it.
    One its author can still extend is not complete and never reaches here --
    it takes the chip surface below, and a tap there buys the next chapter.

    A STANDALONE never had a next chapter to offer. It ends on the one thing it
    can still be: written again, differently. So it gets the Reimagine pill
    rather than a direction module, and the engagement row the reader already
    renders underneath sits below it.
  */
  if (seriesComplete) {
    return (
      <View
        style={styles.wrap}
        accessibilityLabel={
          isSeries ? "This story is complete" : "The end of this story"
        }
      >
        {isSeries ? (
          <>
            <Text style={styles.heading}>The story is complete</Text>
            <Text style={styles.body}>
              This story has reached its planned ending. There is no further
              chapter to write.
            </Text>
          </>
        ) : null}
        {onReimagine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reimagine this story"
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && !reduceMotion && styles.textCtaPressed,
            ]}
            onPress={onReimagine}
            testID="chapter-end-reimagine"
          >
            <Sparkles size={16} color={colors.accent} />
            <Text style={styles.secondaryButtonText}>Reimagine this story</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // No chips in auto mode. Rendering them and then firing behind the reader's
  // back would offer a choice that was already made, and a tap on one would be
  // a second chapter and a second credit.
  //
  // Except at the plan. An auto story that has reached its planned ending has
  // stopped writing itself -- the effect above refuses to extend, and so does
  // `autoChapterToWriteAhead` -- so there is nothing in flight to report. It
  // falls through to the chips like any other extendable story, and the reader
  // grows it by tapping one.
  if (isAuto && !planReached) {
    /*
      The copy states what is TRUE, which is why it asks the session store
      rather than assuming.

      A FAILURE OUTRANKS EVERYTHING ELSE HERE, including this mount's own
      belief that it started something. The next chapter is normally begun
      minutes earlier, while the reader was still inside this one, so by the
      time they reach this page a refusal has often already happened -- most
      obviously a 402 on a balance that ran out. Reading only "does a session
      exist" put "Chapter N+1 is being written" over a request the server had
      declined, with no tap behind it for the reader to regret. They get the
      failure and the way out of it instead, and the retry is a TAP because
      re-firing automatically is how one refusal becomes a loop.

      `status === "loading"` counts as pending: the directions are still being
      resolved, the effect below has not had its turn, and telling the reader
      nothing started would be wrong for the second it takes.
    */
    const failed = nextSession?.phase === "error";
    /*
      A COMPLETED SESSION IS NOT A PENDING ONE. This read `nextSession !== null`,
      which is true of a chapter that has already finished writing -- so between
      the session settling and the app appending the new chapter to the story,
      the reader was told their finished chapter was still being written. The
      window is small and it is not zero, and the sentence is simply false
      inside it.

      `autoStarted` is still ORed in because it covers the opposite gap: this
      mount has fired but the session has not registered yet.
    */
    const inFlight = nextSession?.phase === "writing";
    const pending = !failed
      && (inFlight || autoStarted || status === "loading");
    return (
      <View style={styles.wrap} testID="chapter-end-auto">
        <Text style={styles.heading}>
          {pending ? "Katha is writing on" : "Chapter " + nextChapterNumber + " didn't start"}
        </Text>
        <Text style={styles.body}>
          {pending
            ? `You chose to let Katha pick what happens next. Chapter ${nextChapterNumber} is being written.`
            : "Something stopped the next chapter from starting. Nothing was charged for it."}
        </Text>
        {pending ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Write chapter ${nextChapterNumber}`}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && !reduceMotion && styles.textCtaPressed,
            ]}
            // A failed session is retried IN PLACE, not started again. A second
            // `startChapterGeneration` mints a new request id against a chapter
            // the server may still hold a reservation for, which comes back 409
            // and buries the real failure under a duplicate one -- and this
            // mount's own single-fire ref may already be spent, which would
            // make the button do nothing at all.
            onPress={() =>
              failed && nextSession
                ? retryGeneration(nextSession.id)
                // Same as the auto effect above: no direction, so the server
                // chooses and records who chose truthfully.
                : continueOnce(undefined)}
            testID="chapter-end-auto-retry"
          >
            <Text style={styles.secondaryButtonText}>
              Write chapter {nextChapterNumber}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <DirectionChoices
        heading={extendable ? "Keep it going?" : "What's next?"}
        priceNote={extendable
          // Said out loud, because this chapter is past what the writer
          // planned and paid attention to. A reader who thought the story was
          // three chapters long should not discover the fourth by watching
          // their balance drop.
          ? `This story is planned for ${effectivePlannedCount} ${
            effectivePlannedCount === 1 ? "chapter" : "chapters"
          }. Any of these writes chapter ${chapter.chapterNumber + 1} anyway · ${CHAPTER_TEXT_CREDITS} credit`
          : `Any of these writes chapter ${chapter.chapterNumber + 1} · ${CHAPTER_TEXT_CREDITS} credit`}
        status={status}
        options={options}
        unavailableReason={unavailableReason}
        loadingLabel="Loading suggested directions"
        loadingMessage="Finding directions for this story..."
        chooseHint={`Writes chapter ${chapter.chapterNumber + 1}`}
        submitLabel={`Continue · ${CHAPTER_TEXT_CREDITS} credit`}
        writeOwnLabel="Write your own — or get a surprise"
        composerPlaceholder="Tell Katha what happens next."
        testIDPrefix="chapter-end"
        onChoose={continueOnce}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  heading: {
    ...type.headline,
    color: colors.ink,
  },
  body: {
    ...type.body,
    color: colors.ink,
  },
  // The pressed state of the Reimagine pill. Every other card and composer
  // style moved to `DirectionChoices` with the surface that used them.
  textCtaPressed: {
    opacity: 0.6,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.accent,
    fontWeight: "700",
  },
});
