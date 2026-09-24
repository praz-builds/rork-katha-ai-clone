import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, RotateCcw } from "lucide-react-native";
import { Button } from "@/components/Button";
import { CreditPill } from "@/components/KathaPrimitives";
import DirectionChoices from "@/components/DirectionChoices";
import type { ContinuationOption, DirectionStatus } from "@/components/DirectionChoices";
import { toDirection } from "@/lib/directions";
import * as storyApi from "@/lib/api";
import { captureError, trackEvent } from "@/lib/analytics";
import { MAX_BEAT_LENGTH, STORY_START_CREDITS } from "@/lib/pricing-limits";
import { formatCredits } from "@/lib/pricing";
import { colors, fonts, spacing } from "@/theme";
import type { CreateDraft } from "@/types/domain";

/**
 * The step that replaced the review screen.
 *
 * Review restated the brief the writer had just filled in and asked them to
 * agree with themselves. It cost a screen and a tap and changed nothing about
 * the story. What the writer could not do anywhere was steer the OPENING —
 * direction chips existed only at a chapter end, so the first chapter was the
 * one chapter nobody got a say in.
 *
 * So this asks the same question the reader is asked between chapters, using
 * the same `DirectionChoices` surface, derived from the idea they just typed:
 * pick where it starts, write your own opening instruction, or let Katha
 * decide. Nothing is spent until one of the three is chosen, which is the only
 * job review was actually doing.
 */

/** How many derived cards are offered. The third card is always write-your-own. */
const MAX_OPTIONS = 2;

const UNAVAILABLE_REASON = {
  insufficient: "Katha has no opening to suggest for this idea yet. Tell it where to start, or let it decide.",
  failed: "We couldn't load suggested openings. Tell Katha where to start, or let it decide.",
  rateLimited: "Katha is shaping a lot of stories right now. Try again in a moment, or tell it where to start.",
} as const;

/**
 * How long Retry stays disabled after a rate-limited refusal.
 *
 * The server's window is six shapes a minute per caller, so an instant retry
 * after a refusal is refused again -- and counts against the same window.
 */
const RATE_LIMIT_RETRY_DELAY_MS = 10_000;

/** What the brief needs to carry for shaping to answer with a usable plan. */
export type DirectionBrief = Pick<
  CreateDraft,
  | "seed"
  | "primaryGenre"
  | "characters"
  | "moments"
  | "writingStyle"
  | "avoid"
  | "chapterLength"
  | "plannedChapterCount"
>;

export type ResolvedDirections = {
  options: ContinuationOption[];
  /**
   * The whole chapter plan shaping returned, kept so a chosen direction can
   * replace chapter one's beat without discarding the rest of the outline.
   */
  beats: string[];
  /**
   * How many of `beats` the converter refused. Equal to `beats.length` with
   * no options is the one "nothing to suggest" that is the client's doing
   * rather than the idea's, and it is logged as such.
   */
  dropped: number;
};

/**
 * Where the openings come from.
 *
 * There is NO endpoint that produces continuation chips: at a chapter end they
 * are derived on the client from `story.beats` and `series_state`, which exist
 * only after a story has been generated. The one call that can answer for a
 * story that does not exist yet is `shape-story` — the same free shaping call
 * the brief already uses — because `beats[n]` is the brief for chapter `n + 1`
 * and `beats[0]` is therefore chapter one's opening, stated by the model from
 * this writer's own idea.
 *
 * `toDirection` is the same converter the chapter-end chips use, so a beat
 * phrased as a question becomes an instruction here exactly as a hook does
 * there. A beat it cannot convert grammatically is DROPPED, never replaced:
 * an invented opening would fit every story in the app.
 *
 * A FAILED CALL REJECTS. It used to resolve to an empty list: `inferStoryBrief`
 * without `throwOnError` turns every failure -- a refused session, a network
 * error, a rate limit, an unreadable answer -- into `null`, so the screen
 * showed "Katha has no opening to suggest for this idea" when the truth was
 * that it never got an answer. That is what the founder met on 2026-09-24,
 * with nothing logged anywhere to say which. A rejection now reaches the
 * screen as the failed state with a Retry; an empty list means the model
 * really answered with nothing usable.
 */
export async function resolveOpeningDirections(
  brief: DirectionBrief,
): Promise<ResolvedDirections> {
  const shape = await storyApi.inferStoryBrief(
    brief.seed,
    "create",
    brief.primaryGenre,
    {
      characters: brief.characters,
      moments: brief.moments,
      writingStyle: brief.writingStyle,
      avoid: brief.avoid,
      chapterLength: brief.chapterLength,
      plannedChapterCount: brief.plannedChapterCount,
    },
    { throwOnError: true },
  );
  const beats = shape?.beats ?? [];
  const options: ContinuationOption[] = [];
  let dropped = 0;
  beats.forEach((beat, index) => {
    // Converted even past MAX_OPTIONS, so `dropped` counts the whole plan.
    const prompt = toDirection(beat);
    if (!prompt) {
      dropped += 1;
      return;
    }
    if (options.length >= MAX_OPTIONS) return;
    if (options.some((existing) => existing.prompt === prompt)) return;
    options.push({ id: `planned-beat-${index}`, prompt });
  });
  return { options, beats, dropped };
}

/** Why the failed state is showing, as an enum safe for telemetry. */
function failureReason(error: unknown): string {
  return error instanceof storyApi.StoryShapeRequestError
    ? error.reason
    : "unknown";
}

export type DirectionStepProps = {
  brief: DirectionBrief;
  credits: number;
  /**
   * Start the story. `direction` is the opening instruction the writer chose,
   * or `undefined` for "let Katha decide"; `beats` is shaping's plan, which
   * travels whether or not a direction was picked.
   */
  onStart: (choice: { direction?: string; beats?: string[] }) => void;
  onBack: () => void;
  /** Test seam. The real resolver is one network call; it rejects when that call fails. */
  resolveDirections?: (brief: DirectionBrief) => Promise<ResolvedDirections>;
};

export default function DirectionStep({
  brief,
  credits,
  onStart,
  onBack,
  resolveDirections = resolveOpeningDirections,
}: DirectionStepProps) {
  const [status, setStatus] = useState<DirectionStatus>("loading");
  const [options, setOptions] = useState<ContinuationOption[]>([]);
  const [beats, setBeats] = useState<string[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string>(
    UNAVAILABLE_REASON.failed,
  );
  // Only a FAILED lookup offers Retry. "No opening to suggest" is an answer,
  // and asking the same question again would get the same one.
  const [failed, setFailed] = useState(false);
  // Bumped by Retry; the resolve effect re-runs on it and on nothing else.
  const [attempt, setAttempt] = useState(0);
  // True while a rate-limited refusal is still cooling down.
  const [coolingDown, setCoolingDown] = useState(false);
  /*
    One retry per failure, however many times it is tapped. Two taps before
    the re-render would bump `attempt` twice and send two shaping requests --
    each one spending the per-minute window. A ref, because the second tap of
    a real double tap arrives before state could say anything. Re-armed only
    when a lookup fails again.
  */
  const retryArmedRef = useRef(false);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), RATE_LIMIT_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  /**
   * One start per visit, however many times a card is tapped.
   *
   * Every path out of this screen reserves credits, so a second press landing
   * before the parent has navigated away is a second story and a second
   * charge for one decision. A ref rather than state because the second press
   * of a real double tap arrives before a re-render.
   */
  const startedRef = useRef(false);

  // Resolved once per mount, and again only when the writer taps Retry.
  // Re-running on every `brief` identity change would re-shape (and re-offer
  // different openings) while the writer is reading the ones they were given.
  const resolveRef = useRef(resolveDirections);
  resolveRef.current = resolveDirections;
  const briefRef = useRef(brief);
  briefRef.current = brief;
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setFailed(false);
    resolveRef.current(briefRef.current).then(
      (resolved) => {
        if (cancelled) return;
        setBeats(resolved.beats);
        // One real opening beats none. Requiring two would throw away a
        // perfectly good single suggestion and leave the writer facing only
        // the free-text box.
        if (resolved.options.length >= 1) {
          setOptions(resolved.options.slice(0, MAX_OPTIONS));
          setStatus("ready");
        } else {
          // The model planned an opening and the converter refused every
          // line of it. That is a client defect wearing the face of a thin
          // idea, so it is counted. Counts only -- never the beats.
          if (resolved.beats.length > 0 && resolved.dropped === resolved.beats.length) {
            captureError({
              bucket: "client.app",
              severity: "low",
              errorCode: "opening_directions_all_dropped",
              error: new Error("opening_directions_all_dropped"),
              context: { beats: resolved.beats.length, dropped: resolved.dropped },
            });
            trackEvent("opening_directions_all_dropped", {
              beats: resolved.beats.length,
            });
          }
          setUnavailableReason(UNAVAILABLE_REASON.insufficient);
          setStatus("unavailable");
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        const reason = failureReason(error);
        captureError({
          bucket: "client.app",
          severity: "low",
          errorCode: "opening_directions_failed",
          error,
          context: { reason, attempt },
        });
        trackEvent("opening_directions_failed", { reason, attempt });
        const rateLimited = reason === "rate_limited";
        setUnavailableReason(
          rateLimited ? UNAVAILABLE_REASON.rateLimited : UNAVAILABLE_REASON.failed,
        );
        setCoolingDown(rateLimited);
        retryArmedRef.current = true;
        setFailed(true);
        setStatus("unavailable");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const startOnce = (direction?: string) => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStart({ direction, beats });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to edit"
          onPress={onBack}
          hitSlop={2}
          style={styles.iconButton}
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>
        <CreditPill credits={credits} />
      </View>
      <Text style={styles.eyebrow}>Your story starts here</Text>
      <DirectionChoices
        heading="Where does it begin?"
        priceNote={`Any of these writes chapter 1 · ${formatCredits(STORY_START_CREDITS)}`}
        status={status}
        options={options}
        unavailableReason={unavailableReason}
        loadingLabel="Loading suggested openings"
        loadingMessage="Reading your idea for openings..."
        chooseHint="Writes chapter 1 in this direction"
        submitLabel={`Create story · ${formatCredits(STORY_START_CREDITS)}`}
        writeOwnLabel="Write your own — or get a surprise"
        composerPlaceholder="Tell Katha how it opens."
        testIDPrefix="create-direction"
        // The opening direction becomes `beats[0]`, which the server bounds to
        // MAX_BEAT_LENGTH. The composer's default is the chapter-end limit of
        // 300, and typing past 200 here had the tail cut server-side with the
        // field and the counter both saying it fit.
        charLimit={MAX_BEAT_LENGTH}
        onChoose={startOnce}
      />
      {/*
        Retry sits under the choices, not inside them: DirectionChoices is the
        shared chapter-end surface and has no failed-with-retry state of its
        own. It is only here when the lookup FAILED -- the writer can still
        type an opening or let Katha decide without it.
      */}
      {status === "unavailable" && failed ? (
        <Button
          label={coolingDown ? "Try again in a moment" : "Try again"}
          variant="secondary"
          size="sm"
          disabled={coolingDown}
          accessibilityLabel="Try loading suggested openings again"
          onPress={() => {
            if (!retryArmedRef.current) return;
            retryArmedRef.current = false;
            setAttempt((value) => value + 1);
          }}
          icon={<RotateCcw size={16} color={colors.ink} />}
          testID="create-direction-retry"
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  eyebrow: {
    color: colors.accent,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
