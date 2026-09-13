import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { CreditPill } from "@/components/KathaPrimitives";
import DirectionChoices from "@/components/DirectionChoices";
import type { ContinuationOption, DirectionStatus } from "@/components/DirectionChoices";
import { toDirection } from "@/lib/directions";
import * as storyApi from "@/lib/api";
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
} as const;

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
  );
  const beats = shape?.beats ?? [];
  const options: ContinuationOption[] = [];
  beats.forEach((beat, index) => {
    if (options.length >= MAX_OPTIONS) return;
    const prompt = toDirection(beat);
    if (!prompt) return;
    if (options.some((existing) => existing.prompt === prompt)) return;
    options.push({ id: `planned-beat-${index}`, prompt });
  });
  return { options, beats };
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
  /** Test seam. The real resolver is one network call and never rejects loudly. */
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

  /**
   * One start per visit, however many times a card is tapped.
   *
   * Every path out of this screen reserves credits, so a second press landing
   * before the parent has navigated away is a second story and a second
   * charge for one decision. A ref rather than state because the second press
   * of a real double tap arrives before a re-render.
   */
  const startedRef = useRef(false);

  // Resolved once per mount. Re-running on every `brief` identity change would
  // re-shape (and re-offer different openings) while the writer is reading the
  // ones they were given.
  const resolveRef = useRef(resolveDirections);
  resolveRef.current = resolveDirections;
  const briefRef = useRef(brief);
  briefRef.current = brief;
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
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
          setUnavailableReason(UNAVAILABLE_REASON.insufficient);
          setStatus("unavailable");
        }
      },
      () => {
        if (cancelled) return;
        setUnavailableReason(UNAVAILABLE_REASON.failed);
        setStatus("unavailable");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
