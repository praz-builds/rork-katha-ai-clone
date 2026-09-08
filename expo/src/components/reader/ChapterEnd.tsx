import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { AlertCircle, PenLine, Shuffle, Sparkles } from "lucide-react-native";
import {
  continueStory,
  createGenerationRequestId,
  GenerationRequestError,
  isLocalStubChapter,
} from "@/lib/api";
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
type SubmitPhase = "idle" | "submitting" | "success" | "error";

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
   * Sends the continuation request. Defaults to `continueStory` from
   * `@/lib/api`, the buffered (non-streaming) path already used elsewhere for
   * this exact call shape - `(storyId, requestId, isFinale, expectedChapterNum,
   * nextInstruction)`. Overridable for tests.
   */
  continueChapter?: typeof continueStory;
  /**
   * Fires once a new chapter has been generated. Optional: this component
   * never mutates the reader's pagination or the story it was handed, so a
   * caller that wants to jump to the new chapter or refetch the story wires
   * this in.
   */
  onChapterReady?: (chapter: Chapter) => void;
};

export default function ChapterEnd({
  story,
  chapter,
  resolveOptions = defaultResolveOptions,
  continueChapter = continueStory,
  onChapterReady,
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
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [completedChapter, setCompletedChapter] = useState<Chapter | null>(null);
  const [directionApplied, setDirectionApplied] = useState(true);
  const submittingRef = useRef(false);

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

  const submit = useCallback(async (instruction?: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase("submitting");
    setErrorMessage("");
    try {
      const nextChapterNumber = chapter.chapterNumber + 1;
      const isFinale = typeof plannedChapterCount === "number"
        && nextChapterNumber >= plannedChapterCount;
      const requestId = createGenerationRequestId();
      const result = await continueChapter(
        story.id,
        requestId,
        isFinale,
        nextChapterNumber,
        instruction,
      );
      setCompletedChapter(result.chapter);
      // With no backend configured the continuation is canned prose, so the
      // direction the reader chose or typed did not shape it. Saying so is the
      // honest option: silently returning text that ignores their choice
      // teaches them the feature does not work.
      setDirectionApplied(!isLocalStubChapter(result));
      setPhase("success");
      onChapterReady?.(result.chapter);
    } catch (err) {
      setErrorMessage(
        err instanceof GenerationRequestError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setPhase("error");
    } finally {
      submittingRef.current = false;
    }
  }, [chapter.chapterNumber, continueChapter, onChapterReady, plannedChapterCount, story.id]);

  if (!isLatestChapter) return null;

  if (seriesComplete) {
    return (
      <View style={styles.wrap} accessibilityLabel="This story is complete">
        <Text style={styles.heading}>The story is complete</Text>
        <Text style={styles.body}>
          This story has reached its planned ending. There is no further
          chapter to write.
        </Text>
      </View>
    );
  }

  if (phase === "submitting") {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Writing what happens next...</Text>
        <View style={styles.progressRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>This usually takes under a minute.</Text>
        </View>
      </View>
    );
  }

  if (phase === "success" && completedChapter) {
    return (
      <View style={styles.wrap} accessibilityLabel="New chapter ready">
        <Text style={styles.heading}>New chapter ready</Text>
        <Text style={styles.body}>
          &quot;{completedChapter.title}&quot; has been added to this story.
        </Text>
        {!directionApplied
          ? (
            <Text style={styles.stubNote}>
              This one was written from a sample, so the direction you chose was
              not used. Connect a backend to steer the next chapter.
            </Text>
          )
          : null}
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.wrap}>
        <View style={styles.errorRow}>
          <AlertCircle size={18} color={colors.premium} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={styles.retryButton}
          onPress={() => setPhase("idle")}
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
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
        Any of these writes the next chapter · {CHAPTER_TEXT_CREDITS} credit
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
            onPress={() => submit(option.prompt)}
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
          onPress={() => submit(undefined)}
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
            onPress={() => submit(nonEmpty(composerText))}
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
  progressRow: {
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
  stubNote: {
    ...type.subhead,
    fontFamily: fonts.ui,
    letterSpacing: 0,
    color: colors.muted,
    marginTop: spacing.related,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    minHeight: 44,
  },
  errorText: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryButtonText: {
    ...type.body,
    color: colors.ink,
    fontWeight: "700",
  },
});
