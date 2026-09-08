import { Check } from "lucide-react-native";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { TappableWord, type TappableWordState } from "@/components/reader/TappableWord";
import {
  isPhraseSaved,
  listSavedPhrases,
  savePhrase,
  unsavePhrase,
  type SavedPhrase,
} from "@/lib/phrases";
import { cleanWord, sentenceAroundWord, splitWords } from "@/lib/sentence";
import ReaderScreen from "@/screens/ReaderScreen";
import { colors, fonts, motion, radius, spacing } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

export type PhraseCaptureReaderProps = {
  story: Story;
  onBack: () => void;
  initialChapterIndex?: number;
  /**
   * Forwarded to `ReaderScreen`. This wrapper sits between App and the reader,
   * so a seam it does not pass through silently stops working the moment phrase
   * capture is enabled -- here that would mean Listen quietly opening the reader
   * without starting narration.
   */
  autoplay?: boolean;
  /**
   * Forwarded to `ReaderScreen`. Same reason as `autoplay`: a seam this wrapper
   * does not pass through silently stops working the moment phrase capture is
   * enabled, and here that would mean end-of-chapter branching disappearing.
   */
  renderChapterEnd?: (chapter: Chapter) => ReactNode;
};

const TOAST_VISIBLE_MS = 1800;

function pendingKeyFor(storyId: string, phrase: string): string {
  return `${storyId}::${phrase.trim().toLowerCase()}`;
}

/**
 * Wires phrase capture into `ReaderScreen` through its `renderWord` seam.
 *
 * Tap a word to save it, long-press to save the sentence it sits in, tap a
 * saved word again to unsave it. Every save is optimistic: the tapped word
 * reads as saved the instant it is tapped, and rolls back quietly - no
 * `Alert`, just the highlight clearing - only if a reachable server actually
 * refuses it. See `lib/phrases.ts` for why an absent backend is not treated
 * as that kind of failure.
 *
 * WORD -> SENTENCE, WITHOUT TOUCHING PAGINATION. `ReaderScreen` calls
 * `renderWord(word, index)` once per word of whichever page is currently on
 * screen, `index` restarting at 0 for each page. That is all the position
 * information this component is given, and it is enough: `wordsRef`
 * re-collects into the exact word list of the page being rendered right now
 * (reset the moment `index` comes back to 0), so a long-press can always
 * resolve "the sentence around this word" from what is actually on screen,
 * without ReaderScreen exposing page boundaries or pagination internals.
 */
export default function PhraseCaptureReader({
  story,
  onBack,
  initialChapterIndex = 0,
  autoplay = false,
  renderChapterEnd,
}: PhraseCaptureReaderProps) {
  const [savedPhrases, setSavedPhrases] = useState<SavedPhrase[]>([]);
  const savedPhrasesRef = useRef<SavedPhrase[]>([]);
  useEffect(() => {
    savedPhrasesRef.current = savedPhrases;
  }, [savedPhrases]);

  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const pendingKeysRef = useRef<Set<string>>(new Set());

  const [activeChapter, setActiveChapter] = useState<Chapter>(
    story.chapters[initialChapterIndex] ?? story.chapters[0],
  );
  // The chapter's tokens, seeded up front rather than accumulated as pages
  // render. `renderWord` still fills in what it draws, but seeding means a
  // sentence that runs off the bottom of the page is already known, so a
  // long-press near a page break returns the whole sentence rather than the
  // half that happened to be on screen.
  useEffect(() => {
    wordsRef.current = splitWords(activeChapter.paragraphs.join("\n\n"));
  }, [activeChapter]);

  const activeChapterRef = useRef(activeChapter);
  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useSharedValue(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  const wordsRef = useRef<string[]>([]);

  // The initial load must not clobber a save the reader already made.
  //
  // This read is asynchronous, and a reader can tap a word before it resolves.
  // Assigning its result unconditionally then replaced the optimistic entry,
  // clearing the highlight and letting the same word be saved twice. A phrase
  // saved in this session outranks a snapshot taken before it existed.
  const hasLocalSaveRef = useRef(false);
  useEffect(() => {
    let alive = true;
    hasLocalSaveRef.current = false;
    listSavedPhrases().then((phrases) => {
      if (!alive || hasLocalSaveRef.current) return;
      setSavedPhrases(phrases);
    });
    return () => {
      alive = false;
    };
  }, [story.id]);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReaderEnabled);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showSavedToast = useCallback((phrase: string) => {
    setToast(`Saved "${phrase}"`);
    toastOpacity.value = reducedMotion ? 1 : withTiming(1, { duration: motion.fast });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastOpacity.value = reducedMotion ? 0 : withTiming(0, { duration: motion.base });
      setTimeout(() => setToast(null), reducedMotion ? 0 : motion.base);
    }, TOAST_VISIBLE_MS);
  }, [reducedMotion, toastOpacity]);

  const toastStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  const setPending = useCallback((key: string, on: boolean) => {
    const next = new Set(pendingKeysRef.current);
    if (on) next.add(key); else next.delete(key);
    pendingKeysRef.current = next;
    setPendingKeys(next);
  }, []);

  const toggleSave = useCallback(async (
    input: { phrase: string; sentence: string; chapterId: string },
    key: string,
  ) => {
    setPending(key, true);
    const optimisticId = `optimistic-${key}`;
    const optimistic: SavedPhrase = {
      id: optimisticId,
      phrase: input.phrase,
      sentence: input.sentence,
      storyId: story.id,
      storyTitle: story.title,
      chapterId: input.chapterId,
      createdAt: new Date().toISOString(),
      dueAt: new Date().toISOString(),
      reviewCount: 0,
    };
    hasLocalSaveRef.current = true;
    setSavedPhrases((prev) => [optimistic, ...prev]);

    const saved = await savePhrase({
      phrase: input.phrase,
      sentence: input.sentence,
      storyId: story.id,
      storyTitle: story.title,
      chapterId: input.chapterId,
    });

    setPending(key, false);
    if (saved) {
      setSavedPhrases((prev) => prev.map((entry) => entry.id === optimisticId ? saved : entry));
      showSavedToast(input.phrase);
    } else {
      // Rolled back quietly. No alert - the highlight simply clears.
      setSavedPhrases((prev) => prev.filter((entry) => entry.id !== optimisticId));
    }
  }, [setPending, showSavedToast, story.id, story.title]);

  const toggleUnsave = useCallback(async (existing: SavedPhrase, key: string) => {
    setPending(key, true);
    setSavedPhrases((prev) => prev.filter((entry) => entry.id !== existing.id));

    const ok = await unsavePhrase(existing.id);

    setPending(key, false);
    if (!ok) {
      // A reachable server refused the unsave. Restore it, quietly.
      setSavedPhrases((prev) => [existing, ...prev]);
    }
  }, [setPending]);

  const handleWordPress = useCallback((index: number, cleaned: string) => {
    const key = pendingKeyFor(story.id, cleaned);
    if (pendingKeysRef.current.has(key)) return;

    const existing = isPhraseSaved(savedPhrasesRef.current, story.id, cleaned);
    if (existing) {
      void toggleUnsave(existing, key);
      return;
    }
    const sentence = sentenceAroundWord(wordsRef.current, index).text || cleaned;
    void toggleSave({ phrase: cleaned, sentence, chapterId: activeChapterRef.current.id }, key);
  }, [story.id, toggleSave, toggleUnsave]);

  const handleWordLongPress = useCallback((index: number) => {
    const range = sentenceAroundWord(wordsRef.current, index);
    const sentenceText = (range.text || wordsRef.current[index] || "").trim();
    // Punctuation-only surroundings (a lone dash, an empty page) have nothing
    // worth saving.
    if (!cleanWord(sentenceText)) return;

    const key = pendingKeyFor(story.id, sentenceText);
    if (pendingKeysRef.current.has(key)) return;

    const existing = isPhraseSaved(savedPhrasesRef.current, story.id, sentenceText);
    if (existing) {
      void toggleUnsave(existing, key);
      return;
    }
    void toggleSave(
      { phrase: sentenceText, sentence: sentenceText, chapterId: activeChapterRef.current.id },
      key,
    );
  }, [story.id, toggleSave, toggleUnsave]);

  const renderWord = useCallback((word: string, index: number): ReactNode => {
    // `index` is chapter-absolute, and `wordsRef` holds the whole chapter's
    // tokens rather than the current page's. Accumulating page tokens here
    // meant a sentence running across a page break was truncated at the
    // boundary, so a long-press near the foot of a page saved a fragment.
    wordsRef.current[index] = word;

    // A screen-reader user gets the unmodified reading experience: the
    // paragraph is read fluently rather than word by word. See the
    // accessibility note on `TappableWord`.
    if (screenReaderEnabled) return word;

    const cleaned = cleanWord(word);
    if (!cleaned) return word;

    const key = pendingKeyFor(story.id, cleaned);
    const existing = isPhraseSaved(savedPhrases, story.id, cleaned);
    const state: TappableWordState = pendingKeys.has(key)
      ? "pending"
      : existing
      ? "saved"
      : "idle";

    return (
      <TappableWord
        word={word}
        state={state}
        testID={`reader-word-${index}`}
        onPress={() => handleWordPress(index, cleaned)}
        onLongPress={() => handleWordLongPress(index)}
      />
    );
  }, [handleWordLongPress, handleWordPress, pendingKeys, savedPhrases, screenReaderEnabled, story.id]);

  const onChapterChange = useCallback((chapter: Chapter) => {
    setActiveChapter(chapter);
  }, []);

  return (
    <View style={styles.flex}>
      <ReaderScreen
        story={story}
        onBack={onBack}
        initialChapterIndex={initialChapterIndex}
        renderWord={renderWord}
        onChapterChange={onChapterChange}
        autoplay={autoplay}
        renderChapterEnd={renderChapterEnd}
      />
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, toastStyle]}
          accessibilityLiveRegion="polite"
        >
          <Check size={14} color={colors.surface} />
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toast: {
    position: "absolute",
    bottom: spacing.huge,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  toastText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
});
