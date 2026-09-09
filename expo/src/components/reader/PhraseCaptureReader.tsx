import { Check } from "lucide-react-native";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import { SelectionToolbar, type SelectionAction } from "@/components/reader/SelectionToolbar";
import { TappableWord, type TappableWordState } from "@/components/reader/TappableWord";
import { copyText } from "@/lib/clipboard";
import {
  isWordInRange,
  rangeFromAnchor,
  rangeLength,
  textForRange,
  wordStepsForDrag,
  type SelectionRange,
} from "@/lib/text-selection";
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
import type { ReimagineRun } from "@/lib/reimagine-client";
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
  /**
   * Forwarded to `ReaderScreen`. Same reason as `autoplay`: a seam this wrapper
   * does not pass through silently stops working, and here that would mean a
   * reimagined chapter waiting behind a cover instead of appearing page by
   * page like every other chapter.
   */
  onReimagineStarted?: (run: ReimagineRun) => void;
  /**
   * Forwarded to `ReaderScreen`. Same reason again: without it the live reader
   * would silently stop being live the moment phrase capture is enabled, and
   * the writer would sit on a finished-looking page while their chapter went on
   * being written behind it.
   */
  liveSessionId?: string | null;
  /**
   * Forwarded to `ReaderScreen`. Same reason again: without it the chrome's
   * Listen control would quietly fall back to the reader's inline sheet the
   * moment phrase capture is enabled, instead of opening the narration player.
   */
  onListen?: (chapterIndex: number) => void;
  /**
   * Forwarded to `ReaderScreen`. Same reason as `autoplay`: a seam this wrapper
   * does not pass through silently stops working the moment phrase capture is
   * enabled, and here that would mean a guest quietly liking and following into
   * a void because the sign-in gate never reached the reader.
   */
  onRequireSignIn?: () => void;
};

const TOAST_VISIBLE_MS = 1800;

/**
 * How long the finger must be still before the drag gesture takes over.
 *
 * React Native's own `Text.onLongPress` fires at 500ms and it is what anchors
 * the selection, so the pan must not steal the touch before then -- if it did,
 * there would be a drag with nothing to drag from. 650ms leaves the anchor
 * comfortably first and still feels like one continuous press-and-drag.
 *
 * Below this threshold nothing changes: a tap is a tap (word saved), and a
 * horizontal flick is a page turn, because a pan waiting on a long press fails
 * the moment the finger travels.
 */
const DRAG_ACTIVATION_MS = 650;

function pendingKeyFor(storyId: string, phrase: string): string {
  return `${storyId}::${phrase.trim().toLowerCase()}`;
}

/**
 * Wires phrase capture into `ReaderScreen` through its `renderWord` seam.
 *
 * Tap a word to save it, tap a saved word again to unsave it. Long-press starts
 * a selection anchored on the sentence around that word, which a drag then
 * grows or shrinks word by word before Save phrase / Copy / Share quote is
 * chosen from the menu it raises. Every save is optimistic: the tapped word
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
  liveSessionId = null,
  onRequireSignIn,
  onReimagineStarted,
  onListen,
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

  const showToast = useCallback((message: string) => {
    setToast(message);
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
      showToast(`Saved "${input.phrase}"`);
    } else {
      // Rolled back quietly. No alert - the highlight simply clears.
      setSavedPhrases((prev) => prev.filter((entry) => entry.id !== optimisticId));
    }
  }, [setPending, showToast, story.id, story.title]);

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

  /*
    LONG-PRESS AND DRAG SELECTION.

    Long-pressing a word used to save the sentence around it outright -- one
    gesture, one guess about how much of the sentence the reader meant, no way
    to see it before it happened and no way to take a word off the end. It is
    now the start of a selection instead: the word lights, a light impact says
    the selection has begun, and dragging grows or shrinks the range with a
    selection tick per word crossed. Nothing is written until the reader taps
    Save phrase.

    The sentence around the word is still the STARTING range, because that is
    almost always what somebody long-pressing a line of prose wants, and a
    selection that opens on one word makes the reader do work the app could
    have done. The drag then adjusts it.

    Word TAP is untouched: tap saves the word, tap again unsaves it.
  */
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const selectionAnchor = useRef(0);
  const selectionRef = useRef<SelectionRange | null>(null);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const [selectionSaving, setSelectionSaving] = useState(false);
  const [selectionSaved, setSelectionSaved] = useState(false);

  // Read by the pan worklet, so the clamp happens on the UI runtime rather than
  // being scheduled back to React just to find out the drag ran off the end.
  const anchorShared = useSharedValue(0);
  /** Where the focus already sits when the drag begins: the sentence's length. */
  const baseStepsShared = useSharedValue(0);
  const wordCountShared = useSharedValue(0);
  const lastStepsShared = useSharedValue(0);
  const selectingShared = useSharedValue(false);

  const clearSelection = useCallback(() => {
    selectingShared.value = false;
    setSelection(null);
    setSelectionSaved(false);
  }, [selectingShared]);

  const beginSelection = useCallback((index: number) => {
    const words = wordsRef.current;
    if (words.length === 0) return;
    const sentence = sentenceAroundWord(words, index);
    // Punctuation-only surroundings (a lone dash, an empty page) have nothing
    // worth selecting.
    if (!cleanWord(sentence.text || words[index] || "")) return;

    /*
      The anchor is the sentence's FIRST word and the drag starts from its
      LAST, not from the word under the finger.

      The opening range is the whole sentence, so a drag that reset the focus to
      the pressed word would collapse the highlight to two words on its first
      tick -- the reader would watch their selection shrink as they pulled it
      wider. Starting the focus where the highlight already ends means the first
      tick moves it by one word, in the direction the finger went.
    */
    selectionAnchor.current = sentence.start;
    anchorShared.value = sentence.start;
    baseStepsShared.value = sentence.end - sentence.start;
    wordCountShared.value = words.length;
    lastStepsShared.value = sentence.end - sentence.start;
    selectingShared.value = true;
    setSelectionSaved(false);
    setSelection({ start: sentence.start, end: sentence.end });
    // Same frame as the highlight, and paired with it: the wash is the
    // feedback, the impact is the confirmation. Haptics are off system-wide
    // for many readers and silent on most Android hardware.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [anchorShared, baseStepsShared, lastStepsShared, selectingShared, wordCountShared]);

  /**
   * Called from the pan worklet ONLY when the word count under the drag has
   * actually changed -- a threshold crossing, never a frame. One tick, one
   * re-render, one word.
   */
  const extendSelection = useCallback((steps: number) => {
    setSelection(rangeFromAnchor(selectionAnchor.current, steps, wordsRef.current.length));
    setSelectionSaved(false);
    void Haptics.selectionAsync();
  }, []);

  const dragToSelect = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(DRAG_ACTIVATION_MS)
        .onUpdate((event) => {
          "worklet";
          if (!selectingShared.value || wordCountShared.value <= 0) return;
          const raw = baseStepsShared.value
            + wordStepsForDrag(event.translationX, event.translationY);
          // Clamped on the UI runtime so a drag that has run past the end of
          // the chapter stops ticking instead of scheduling a no-op React
          // update (and a haptic) on every further frame.
          const last = wordCountShared.value - 1;
          const focus = Math.min(Math.max(anchorShared.value + raw, 0), last);
          const steps = focus - anchorShared.value;
          if (steps === lastStepsShared.value) return;
          lastStepsShared.value = steps;
          scheduleOnRN(extendSelection, steps);
        }),
    [anchorShared, baseStepsShared, extendSelection, lastStepsShared, selectingShared, wordCountShared],
  );

  // `wordsRef` is a ref by design (it is seeded per chapter and filled during
  // render by `renderWord`), so the range is the only thing that changes here.
  const selectedText = useMemo(
    () => textForRange(wordsRef.current, selection),
    [selection],
  );

  const handleSelectionAction = useCallback(async (action: SelectionAction) => {
    const phrase = selectedText;
    if (!phrase) return;

    if (action === "save") {
      const key = pendingKeyFor(story.id, phrase);
      if (pendingKeysRef.current.has(key)) return;
      const existing = isPhraseSaved(savedPhrasesRef.current, story.id, phrase);
      if (existing) {
        setSelectionSaved(true);
        return;
      }
      setSelectionSaving(true);
      setSelectionSaved(true);
      await toggleSave(
        { phrase, sentence: phrase, chapterId: activeChapterRef.current.id },
        key,
      );
      setSelectionSaving(false);
      // `toggleSave` rolls its own optimistic entry back on a real refusal, so
      // the honest read of "did this stick" is the saved list, not the call.
      if (!isPhraseSaved(savedPhrasesRef.current, story.id, phrase)) {
        setSelectionSaved(false);
        return;
      }
      clearSelection();
      return;
    }

    if (action === "copy") {
      const copied = await copyText(phrase);
      // Never a success state for a write that failed: a browser or a build
      // without the clipboard module says nothing rather than "Copied".
      if (copied) showToast("Copied");
      clearSelection();
      return;
    }

    // Share quote. The attribution is the point -- a screenshot of the same
    // line carries no way back to the story.
    const message = `"${phrase}"\n\n${story.title} on Katha AI`;
    if (Platform.OS === "web") {
      const copied = await copyText(message);
      if (copied) showToast("Quote copied");
    } else {
      try {
        await Share.share({ message });
      } catch {
        // The reader dismissed the share sheet.
      }
    }
    clearSelection();
  }, [clearSelection, selectedText, showToast, story.id, story.title, toggleSave]);

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
    // A live selection outranks the saved highlight while it is on screen: the
    // range under the finger is the thing the reader is steering, and letting a
    // previously-saved word inside it keep its own colour would break the range
    // into stripes.
    const state: TappableWordState = isWordInRange(index, selection)
      ? "selecting"
      : pendingKeys.has(key)
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
        onLongPress={() => beginSelection(index)}
      />
    );
  }, [beginSelection, handleWordPress, pendingKeys, savedPhrases, screenReaderEnabled, selection, story.id]);

  const onChapterChange = useCallback((chapter: Chapter) => {
    setActiveChapter(chapter);
    // A range is a set of indices into ONE chapter's word list. Carrying it
    // across a chapter change would light an unrelated run of words in the new
    // one.
    clearSelection();
  }, [clearSelection]);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <GestureDetector gesture={dragToSelect}>
        <View style={styles.flex}>
          <ReaderScreen
            story={story}
            onBack={onBack}
            initialChapterIndex={initialChapterIndex}
            renderWord={renderWord}
            onChapterChange={onChapterChange}
            autoplay={autoplay}
            renderChapterEnd={renderChapterEnd}
            liveSessionId={liveSessionId}
            onRequireSignIn={onRequireSignIn}
            onListen={onListen}
            onReimagineStarted={onReimagineStarted}
          />
        </View>
      </GestureDetector>
      {/*
        Tapping anywhere off the selection dismisses it, and that tap does
        NOTHING else -- it does not also toggle the reader's chrome, which is
        what the same tap does with no selection open. A scrim is how that is
        made true without `ReaderScreen` having to know a selection exists:
        while one is live this layer is in front of the page and eats the tap.
        It is transparent, so the reader sees only their highlight.
      */}
      {selection ? (
        <Pressable
          testID="selection-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Dismiss selection"
          onPress={clearSelection}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {selection ? (
        <SelectionToolbar
          wordCount={rangeLength(selection)}
          saving={selectionSaving}
          saved={selectionSaved}
          onAction={(action) => { void handleSelectionAction(action); }}
        />
      ) : null}
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
    </GestureHandlerRootView>
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
