import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const UNAVAILABLE_REASON = {
  insufficient:
    "This story doesn't have enough detail yet to suggest a direction.",
  failed: "We couldn't load suggested directions for this chapter.",
} as const;

const FALLBACK_SURPRISE_PROMPTS = [
  "Introduce a complication no one saw coming.",
  "Have a secondary character reveal something they have been hiding.",
  "Send the protagonist somewhere they have been avoiding.",
  "Let a promise made earlier finally come due.",
];

/** The resolver is given this long before its result is treated as failed. */
const RESOLVE_TIMEOUT_MS = 4000;

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Reads the two concrete continuation directions straight off data the
 * backend already generated - the approved chapter plan and the series
 * state - rather than making a fresh network call. `story.beats[n]` briefs
 * chapter `n + 1`, so the beat at the next chapter's index is exactly what
 * the writer already approved happens next; `series_state.open_hooks` is an
 * unresolved thread the model itself is tracking. Both travel on the `Story`
 * object the reader already has, because §10 makes chapter 1's generation
 * (and every continuation after it) the place series state is written.
 *
 * Exported so it can be tested in isolation from the async/loading shell
 * around it.
 */
export function deriveContinuationOptions(
  story: Story,
  chapter: Chapter,
): ContinuationOption[] {
  const plannedBeat = nonEmpty(story.beats?.[chapter.chapterNumber]);
  const pressure = nonEmpty(story.seriesState?.next_chapter_pressure);
  const first = plannedBeat ?? pressure;

  const openHook = story.seriesState?.open_hooks
    ?.map((hook) => nonEmpty(hook))
    .find((hook): hook is string => !!hook && hook !== first);
  const payoff = story.seriesState?.promised_payoffs
    ?.map((entry) => nonEmpty(entry))
    .find((entry): entry is string => !!entry && entry !== first);
  const hookText = nonEmpty(chapter.hookText);
  const second = openHook ?? payoff ?? (hookText !== first ? hookText : undefined);

  const options: ContinuationOption[] = [];
  if (first) options.push({ id: "planned-beat", prompt: first });
  if (second) options.push({ id: "open-thread", prompt: second });
  return options;
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
  const seriesComplete = !isSeries
    || (typeof plannedChapterCount === "number"
      && chapter.chapterNumber >= plannedChapterCount);

  const [status, setStatus] = useState<SuggestionStatus>("loading");
  const [options, setOptions] = useState<ContinuationOption[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string>(
    UNAVAILABLE_REASON.failed,
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [completedChapter, setCompletedChapter] = useState<Chapter | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (seriesComplete || !isLatestChapter) return;
    let cancelled = false;
    setStatus("loading");
    withTimeout(resolveOptions(story, chapter), RESOLVE_TIMEOUT_MS)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved.length >= 2) {
          setOptions(resolved.slice(0, 2));
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

  const surprisePool = useMemo(
    () => (options.length ? options.map((option) => option.prompt) : FALLBACK_SURPRISE_PROMPTS),
    [options],
  );

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

  const handleSurprise = useCallback(() => {
    const pick = surprisePool[Math.floor(Math.random() * surprisePool.length)];
    if (pick) setComposerText(pick);
  }, [surprisePool]);

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

  if (composerOpen) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Write your own</Text>
        <TextInput
          multiline
          value={composerText}
          onChangeText={setComposerText}
          maxLength={MAX_NEXT_INSTRUCTION_CHARS}
          placeholder="Type what happens next, or get a surprise below."
          placeholderTextColor={colors.tertiary}
          style={styles.composerInput}
          accessibilityLabel="Write your own direction"
          accessibilityHint="Optional. Leave blank and Katha decides what happens next."
          testID="chapter-end-composer-input"
        />
        <View style={styles.composerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fill in a surprise direction"
            style={styles.surpriseButton}
            onPress={handleSurprise}
            testID="chapter-end-surprise"
          >
            <Shuffle size={18} color={colors.ink} />
            <Text style={styles.surpriseButtonText}>Surprise me</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to suggested directions"
            style={styles.backButton}
            onPress={() => setComposerOpen(false)}
            testID="chapter-end-composer-back"
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        </View>
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
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>What&apos;s next?</Text>
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
      {status === "ready"
        ? options.map((option, index) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={`Continue: ${option.prompt}`}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Write your own or get a surprise"
        style={({ pressed }) => [
          styles.optionCard,
          styles.writeOwnCard,
          pressed && !reduceMotion && styles.optionCardPressed,
        ]}
        onPress={() => setComposerOpen(true)}
        testID="chapter-end-write-own"
      >
        <PenLine size={16} color={colors.ink} />
        <Text style={styles.optionText}>Write your own or get a surprise</Text>
      </Pressable>
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
  writeOwnCard: {
    backgroundColor: colors.surface2,
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
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  surpriseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  surpriseButtonText: {
    ...type.subhead,
    color: colors.ink,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  backButtonText: {
    ...type.subhead,
    color: colors.muted,
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
