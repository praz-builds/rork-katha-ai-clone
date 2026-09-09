import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { PenLine, Shuffle, Sparkles } from "lucide-react-native";
import { CHAPTER_TEXT_CREDITS, MAX_NEXT_INSTRUCTION_CHARS } from "@/lib/pricing-limits";
import { colors, fonts, radius, spacing, type } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

/**
 * One concrete direction the reader can send the next chapter toward.
 *
 * `prompt` is specific prose ("Ask Aaji to open the stuck page and share the
 * old fort song"), never a generic label ("Continue the plot"). It becomes
 * `next_instruction` on the `continue-story` request unchanged.
 */
export type ContinuationOption = {
  id: string;
  prompt: string;
};

type SuggestionStatus = "loading" | "ready" | "unavailable";

/**
 * What `continue-story` falls back to when a story has no usable
 * `planned_chapter_count`. Kept in step with the backend deliberately: if the
 * client assumes more, it offers a continuation the server will refuse.
 */
const DEFAULT_PLANNED_CHAPTER_COUNT = 3;

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

/** How many direction cards the reader is offered at once. */
const MAX_OPTIONS = 3;

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
    const prompt = nonEmpty(value);
    if (!prompt) return;
    // Two sources often carry the same sentence - the plan's next beat and the
    // pressure the model recorded, most commonly. Deduping on the prose (not
    // the source) keeps the reader from being offered the same step twice
    // wearing two different labels.
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
  onContinue: (direction?: string) => void;
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
  const plannedChapterCount = story.plannedChapterCount;
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
  const effectivePlannedCount =
    plannedChapterCount === 3 || plannedChapterCount === 7 ||
      plannedChapterCount === 15
      ? plannedChapterCount
      : DEFAULT_PLANNED_CHAPTER_COUNT;
  const seriesComplete = !isSeries
    || chapter.chapterNumber >= effectivePlannedCount;

  const [status, setStatus] = useState<SuggestionStatus>("loading");
  const [options, setOptions] = useState<ContinuationOption[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string>(
    UNAVAILABLE_REASON.failed,
  );
  // The composer starts closed on purpose. Suggested directions are the
  // primary surface; typing your own is the escape hatch, and an escape hatch
  // that is open by default reads as the main path.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");

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
          setOptions(resolved.slice(0, MAX_OPTIONS));
          setStatus("ready");
        } else {
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

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>What&apos;s next?</Text>
      {/* The price rides with the surface, not with one button, because every
        * path out of here - a suggested direction, a typed one, or letting
        * Katha decide - writes one chapter and costs the same. §10.2 requires
        * the continuation to carry its own price; putting it only on the
        * composer's submit button hid it from the cards, which are now the
        * path most readers will take. */}
      <Text style={styles.priceNote}>
        Any of these writes chapter {chapter.chapterNumber + 1} ·{" "}
        {CHAPTER_TEXT_CREDITS} credit
      </Text>
      {status === "loading" ? (
        <View
          style={styles.loadingRow}
          accessibilityLabel="Loading suggested directions"
        >
          <ActivityIndicator color={colors.muted} />
          <Text style={styles.mutedBody}>Finding directions for this story...</Text>
        </View>
      ) : null}
      {status === "unavailable" ? (
        <Text style={styles.mutedBody}>{unavailableReason}</Text>
      ) : null}
      {/* The suggested directions ARE the surface. They were previously one
        * card among equals next to a full-width free-text box, and a reader
        * whose story yielded fewer than two suggestions saw the box alone -
        * which reads as "tell us what to write", the opposite of what this
        * feature is for. Each card is the whole tap target and fires the
        * continuation immediately; the prose on it is the exact
        * `next_instruction` the request sends, so what the reader reads is
        * what the model is told. */}
      {status === "ready"
        ? options.map((option, index) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={`Continue: ${option.prompt}`}
            accessibilityHint={
              `Writes chapter ${chapter.chapterNumber + 1} in this direction`
            }
            style={({ pressed }) => [
              styles.optionCard,
              pressed && !reduceMotion && styles.optionCardPressed,
            ]}
            onPress={() => onContinue(option.prompt)}
            testID={`chapter-end-option-${index}`}
          >
            <Sparkles size={16} color={colors.accent} />
            <Text style={styles.optionText}>{option.prompt}</Text>
          </Pressable>
        ))
        : null}
      {/* Two small text CTAs, deliberately lighter than the cards above: an
        * icon, a label, no card, no fill. The free-text input is not rendered
        * until "Write your own" is tapped. */}
      <View style={styles.ctaRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            composerOpen ? "Hide your own direction" : "Write your own direction"
          }
          accessibilityState={{ expanded: composerOpen }}
          style={({ pressed }) => [
            styles.textCta,
            pressed && !reduceMotion && styles.textCtaPressed,
          ]}
          onPress={() => setComposerOpen((open) => !open)}
          testID="chapter-end-write-own"
        >
          <PenLine size={16} color={colors.muted} />
          <Text style={styles.textCtaLabel}>Write your own</Text>
        </Pressable>
        {/* §10.2: leaving the direction blank means Katha decides. This is that
          * sentence as a control. It replaces a "Surprise me" button that
          * pasted one of four hardcoded generic lines into the box - filler
          * that fit any story in the app and so proved the app had read none
          * of them. Sending no instruction at all lets the model use the plan
          * and series state it already has, which is the honest version of the
          * same offer. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Let Katha decide what happens next"
          style={({ pressed }) => [
            styles.textCta,
            pressed && !reduceMotion && styles.textCtaPressed,
          ]}
          onPress={() => onContinue(undefined)}
          testID="chapter-end-let-katha-decide"
        >
          <Shuffle size={16} color={colors.muted} />
          <Text style={styles.textCtaLabel}>Let Katha decide</Text>
        </Pressable>
      </View>
      {composerOpen ? (
        <View style={styles.composer}>
          <TextInput
            multiline
            value={composerText}
            onChangeText={setComposerText}
            maxLength={MAX_NEXT_INSTRUCTION_CHARS}
            placeholder="Type what happens next."
            placeholderTextColor={colors.tertiary}
            style={styles.composerInput}
            accessibilityLabel="Write your own direction"
            accessibilityHint="Optional. Leave blank and Katha decides what happens next."
            testID="chapter-end-composer-input"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              composerText.trim()
                ? "Continue with your direction"
                : "Continue and let Katha decide"
            }
            style={styles.primaryButton}
            onPress={() => onContinue(nonEmpty(composerText))}
            testID="chapter-end-composer-submit"
          >
            <Text style={styles.primaryButtonText}>
              Continue · {CHAPTER_TEXT_CREDITS} credit
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  mutedBody: {
    ...type.subhead,
    color: colors.muted,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionCardPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  priceNote: {
    ...type.caption,
    color: colors.muted,
    marginTop: -spacing.related,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  // Deliberately not a card: no border, no fill, muted icon and label. The
  // weight difference between this and `optionCard` is the whole point of the
  // rebuild, so it must stay visible at a glance.
  textCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingRight: spacing.xs,
  },
  textCtaPressed: {
    opacity: 0.6,
  },
  textCtaLabel: {
    ...type.subhead,
    color: colors.muted,
    fontWeight: "600",
  },
  composer: {
    gap: spacing.md,
  },
  optionText: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },
  composerInput: {
    minHeight: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 15,
    textAlignVertical: "top",
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 15,
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
