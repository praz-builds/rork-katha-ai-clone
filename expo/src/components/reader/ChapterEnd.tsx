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
import type { Chapter, Story } from "@/types/domain";

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
  ) => void;
  /**
   * Opens Reimagine for a standalone story, which has no next chapter to offer
   * and so ends on this instead. Omitted and the pill is not rendered.
   */
  onReimagine?: () => void;
};

export default function ChapterEnd({
  story,
  chapter,
  resolveOptions = defaultResolveOptions,
  onContinue,
  onReimagine,
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
  const seriesComplete = !isSeries
    || chapter.chapterNumber >= effectivePlannedCount;

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
    onContinue(direction, optionsRef.current);
  }, [onContinue]);

  useEffect(() => {
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
    if (!isAuto || seriesComplete || !isLatestChapter) return;
    if (status === "loading") return;
    if (hasGenerationForChapter(story.id, nextChapterNumber)) return;
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
    seriesComplete,
    isLatestChapter,
    status,
    options,
    continueOnce,
    story.id,
    nextChapterNumber,
  ]);

  if (!isLatestChapter) return null;

  /*
    Two ways a story ends here, and they are different endings.

    A SERIES that has reached its planned last chapter says so: there is no
    further chapter to write, and offering one would be selling a credit against
    a story the plan has already finished.

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
  if (isAuto) {
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
    const pending = !failed
      && (autoStarted || status === "loading" || nextSession !== null);
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
        heading="What's next?"
        priceNote={`Any of these writes chapter ${chapter.chapterNumber + 1} · ${CHAPTER_TEXT_CREDITS} credit`}
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
