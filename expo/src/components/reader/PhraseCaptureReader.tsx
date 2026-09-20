import AsyncStorage from "@react-native-async-storage/async-storage";
import { BookmarkPlus, Check, X } from "lucide-react-native";
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
import { CHROME } from "@/components/reader/ReaderChrome";
import { SelectionToolbar, type SelectionAction } from "@/components/reader/SelectionToolbar";
import { TappableWord, type TappableWordState } from "@/components/reader/TappableWord";
import { copyText } from "@/lib/clipboard";
import {
  isWordInRange,
  rangeFromAnchor,
  rangeLength,
  selectionTextFrom,
  textForRange,
  wordCountOf,
  wordStepsForDrag,
  type SelectionRange,
} from "@/lib/text-selection";
import {
  isPhraseSaved,
  listSavedPhrases,
  MAX_PHRASE_LENGTH,
  savePhrase,
  unsavePhrase,
  type SavedPhrase,
} from "@/lib/phrases";
import { cleanWord, sentenceAroundWord, splitWords } from "@/lib/sentence";
import ReaderScreen from "@/screens/ReaderScreen";
import { colors, fonts, motion, radius, shadows, spacing } from "@/theme";
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
  renderChapterEnd?: (
    chapter: Chapter,
    actions: { reimagine: (() => void) | null; reimagineLabel: string },
  ) => ReactNode;
  /**
   * Forwarded to `ReaderScreen`. Same reason as `autoplay`: a seam this wrapper
   * does not pass through silently stops working, and here that would mean a
   * reimagined chapter waiting behind a cover instead of appearing page by
   * page like every other chapter.
   */
  onReimagineStarted?: (run: ReimagineRun) => void;
  /**
   * Forwarded to `ReaderScreen`. Same reason again: without it a reader's
   * Reimagine has nowhere to go, so the control is not offered to them at all
   * -- the feature would silently disappear for everybody but the author the
   * moment phrase capture is enabled.
   */
  onReimagineStory?: (story: Story) => void;
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

/**
 * THE GESTURE DOES NOT EXIST ON WEB, AND THAT IS NOT A BUG IN THIS FILE.
 *
 * `TappableWord` is a nested `<Text onPress onLongPress>`, which is the only
 * thing that keeps inline layout inside the reader's flowing paragraph.
 * react-native-web's `Text` handles `onPress` (it becomes `onClick`) and
 * SILENTLY DROPS `onLongPress`: the prop is neither destructured nor in the
 * forwarded-props allowlist (`react-native-web/dist/exports/Text/index.js`,
 * `modules/forwardedProps`), so it never reaches the DOM and never fires.
 *
 * Everything downstream then cannot happen. `beginSelection` is the only
 * caller that sets `selectingShared`, and the pan handler's first line returns
 * unless that is true -- so on web there is no anchor, no drag, no toolbar and
 * no way to save anything longer than a single word. The owner reporting that
 * "long-press a sentence" does not exist was reporting this, from a browser.
 *
 * The web path below therefore does not re-implement the gesture. The page
 * body is already `selectable`, so the browser's own selection is the
 * gesture -- drag across a line with a mouse, or select with the keyboard --
 * and its text is fed into the SAME toolbar and the SAME save. One save path,
 * two ways of pointing at the words.
 */
const WEB = Platform.OS === "web";

/**
 * The coach mark's "shown" flag, persisted the way every other reader
 * preference is (`katha.reader.preferences.v1`, `katha.voice.gender.v1`): one
 * AsyncStorage key, read on mount, written once.
 */
const COACH_KEY = "katha.reader.phraseCoach.v1";

/**
 * The one-time coach mark, and the second sentence changes by platform
 * because the gesture does.
 *
 * Telling a browser reader to "hold a line" would be the same lie the drag
 * hint was: `Text.onLongPress` does not exist there. What does exist is the
 * browser's own selection, so that is what web is told to do.
 */
const COACH_COPY = WEB
  ? "Tap a word to save it. Select a line to keep the whole sentence."
  : "Tap a word to save it. Hold a line to keep the whole sentence.";

/** The bar that stands in for the drag hint once a mode has replaced the drag. */
const PICK_HINT = "tap the last word to extend";
const WEB_SELECTION_HINT = "selected on the page";

function pendingKeyFor(storyId: string, phrase: string): string {
  return `${storyId}::${phrase.trim().toLowerCase()}`;
}

/** The DOM's current selection as one line of prose, or "" when there is none. */
function readWebSelection(): string {
  if (!WEB || typeof window === "undefined") return "";
  try {
    return selectionTextFrom(window.getSelection?.());
  } catch {
    // Some embeddings throw rather than answer. No selection is the safe
    // reading.
    return "";
  }
}

function clearWebSelection(): void {
  if (!WEB || typeof window === "undefined") return;
  try {
    window.getSelection?.()?.removeAllRanges();
  } catch {
    // Nothing to clear, or nothing that can be cleared. Either way the
    // component's own state is the thing the toolbar reads.
  }
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
 * THERE ARE THREE WAYS TO SELECT A PHRASE AND ONE WAY TO SAVE ONE. Long-press
 * and drag (native only -- see the note on `WEB`), the browser's own selection
 * (web), and the explicit tap-first-then-last mode a labelled control opens
 * (both, and the only route available with a screen reader running). All three
 * raise the same `SelectionToolbar` and end in the same `toggleSave`; a second
 * save path would be a second set of bugs.
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
  onReimagineStory,
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

  /*
    THE COACH MARK. ONCE, EVER, AND NEVER OVER A LIVE GENERATION.

    Phrase capture has no visible affordance: prose looks like prose whether or
    not it is tappable. So the first time a reader opens a finished chapter,
    the reader says what the page can do -- one line, at the bottom, dismissed
    by "Got it" or by the first save, and then gone for good.

    THREE CONDITIONS, ALL LOAD-BEARING:

    - Not while `liveSessionId` is writing. A writer watching their own story
      appear is not being taught a reading gesture, and the flag is NOT burned
      in that case, so the same reader still gets their one showing later.
    - Not when a screen reader is running. The copy describes a tap and a hold
      on a word, and the per-word path is deliberately off for them (see
      `renderWord`); their route is the "Save a phrase" control instead.
    - Not if the key is already set. The read is awaited before anything is
      shown, so a slow storage read delays the mark rather than flashing one at
      somebody who dismissed it last week.
  */
  const [coachVisible, setCoachVisible] = useState(false);
  const coachDismissedRef = useRef(false);
  useEffect(() => {
    if (liveSessionId || screenReaderEnabled) return;
    let alive = true;
    void (async () => {
      let seen: string | null = null;
      try {
        seen = await AsyncStorage.getItem(COACH_KEY);
      } catch {
        // Storage that cannot be read is treated as "already seen". Showing
        // the mark on every launch because a read failed is worse than never
        // showing it.
        seen = "seen";
      }
      if (!alive || seen || coachDismissedRef.current) return;
      setCoachVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, [liveSessionId, screenReaderEnabled]);

  const dismissCoach = useCallback(() => {
    // Ref first: the flag has to be set before the storage read above can
    // resolve, or a save made while that read was in flight would be followed
    // by the coach mark appearing anyway.
    coachDismissedRef.current = true;
    setCoachVisible(false);
    void (async () => {
      try {
        await AsyncStorage.setItem(COACH_KEY, "seen");
      } catch {
        // It will be offered once more on the next launch. That is a smaller
        // failure than interrupting a reader to report it.
      }
    })();
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
      /*
        THE TOAST NAMES THE DESTINATION.

        It used to read `Saved "lighthouse"`, which answers a question nobody
        asked -- the word is highlighted under their finger, so they can see
        what was saved. What they cannot see is WHERE it went, and until they
        happen to open Library and find a Notes segment they did not know
        existed, a saved phrase is a highlight that goes nowhere. "Saved to
        Notes" is the shortest true sentence that hands them the next step.
      */
      showToast("Saved to Notes");
      // The reader has now done the thing the coach mark exists to teach.
      dismissCoach();
    } else {
      // Rolled back quietly. No alert - the highlight simply clears.
      setSavedPhrases((prev) => prev.filter((entry) => entry.id !== optimisticId));
    }
  }, [dismissCoach, setPending, showToast, story.id, story.title]);

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
  /**
   * The browser's own selection, on web only.
   *
   * A SECOND WAY OF POINTING, NOT A SECOND FEATURE. It is plain text rather
   * than a word range because that is all the DOM hands back, and it is
   * deliberately kept beside `selection` instead of being converted into one:
   * the range exists to LIGHT words on a native page, and on web the browser
   * has already lit them itself. Both funnel into `selectedText`, which is the
   * only thing `handleSelectionAction` ever reads.
   */
  const [webSelection, setWebSelection] = useState<string | null>(null);
  /**
   * The explicit, gesture-free mode the "Save a phrase" control opens.
   *
   * In it, a tap picks the first word of a phrase and a second tap picks the
   * last, instead of saving single words. It is the route for a reader who
   * will never discover a long-press, and the ONLY route for a screen-reader
   * user: `renderWord` serves them fluent prose the rest of the time, so there
   * are no per-word stops to double-tap until they ask for them here.
   */
  const [selectionMode, setSelectionMode] = useState(false);
  /** The first word picked in `selectionMode`, or null before one has been. */
  const pickAnchor = useRef<number | null>(null);
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
    setWebSelection(null);
    pickAnchor.current = null;
    // The DOM selection is the web reader's highlight. Leaving it lit after
    // the menu has closed would say the phrase is still selected when nothing
    // in the app thinks so any more.
    clearWebSelection();
  }, [selectingShared]);

  /*
    THE WEB GESTURE: the browser's selection, listened for rather than built.

    `selectionchange` fires on every tick of a drag, so it is used only to
    CLEAR (a collapsed selection means the reader clicked away). The raise
    happens on `mouseup` / `keyup` / `touchend`, once, when the reader has
    finished choosing -- which keeps this to one re-render per selection
    instead of one per pixel.

    Nothing here runs on native: `WEB` is a build-time constant, so the effect
    body is dead code on a device.
  */
  useEffect(() => {
    if (!WEB || typeof document === "undefined") return;
    const settle = () => {
      const text = readWebSelection();
      setWebSelection(text.length > 0 ? text : null);
      if (text.length > 0) setSelectionSaved(false);
    };
    const maybeClear = () => {
      if (readWebSelection().length === 0) setWebSelection(null);
    };
    document.addEventListener("mouseup", settle);
    document.addEventListener("keyup", settle);
    document.addEventListener("touchend", settle);
    document.addEventListener("selectionchange", maybeClear);
    return () => {
      document.removeEventListener("mouseup", settle);
      document.removeEventListener("keyup", settle);
      document.removeEventListener("touchend", settle);
      document.removeEventListener("selectionchange", maybeClear);
    };
  }, []);

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

  /**
   * A tap in `selectionMode`: the first picks the phrase's first word, the
   * next picks its last, and every tap after that moves the last word again.
   *
   * No gesture, no timing, no drag -- which is what makes it the accessible
   * route as well as the discoverable one. `rangeFromAnchor` is the same
   * clamp the drag uses, so a second tap BEFORE the anchor selects backwards
   * exactly as dragging left does.
   */
  const pickWord = useCallback((index: number) => {
    const words = wordsRef.current;
    if (words.length === 0) return;
    setSelectionSaved(false);
    const anchor = pickAnchor.current;
    if (anchor === null) {
      pickAnchor.current = index;
      setSelection({ start: index, end: index });
      return;
    }
    setSelection(rangeFromAnchor(anchor, index - anchor, words.length));
  }, []);

  const enterSelectionMode = useCallback(() => {
    pickAnchor.current = null;
    setSelection(null);
    setWebSelection(null);
    setSelectionSaved(false);
    setSelectionMode(true);
    // Opening the mode is the reader demonstrating they know the feature
    // exists, so the mark has nothing left to teach them.
    dismissCoach();
  }, [dismissCoach]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  // `wordsRef` is a ref by design (it is seeded per chapter and filled during
  // render by `renderWord`), so the range is the only thing that changes here.
  //
  // A word range wins over a DOM selection when both somehow exist: the range
  // is the one the app drew and the reader steered.
  const selectedText = useMemo(
    () => (selection ? textForRange(wordsRef.current, selection) : (webSelection ?? "")),
    [selection, webSelection],
  );

  const handleSelectionAction = useCallback(async (action: SelectionAction) => {
    const phrase = selectedText;
    if (!phrase) return;

    if (action === "save") {
      /*
        A browser selection has no upper bound -- Cmd-A selects the chapter --
        and `saved_phrases_phrase_present` (migration 00047) caps a phrase at
        `MAX_PHRASE_LENGTH`. Saving anyway would write a row a reachable server
        must refuse, and the refusal would roll back silently, which is exactly
        the "it did nothing" the feature is being fixed for. Say so instead.
      */
      if (phrase.length > MAX_PHRASE_LENGTH) {
        showToast("Too long to save — pick a shorter line");
        return;
      }
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
      // The mode closes with the save it was opened for. Leaving it open would
      // put the reader back on a page where a tap picks words instead of
      // turning the story on, with no sign that it had changed.
      setSelectionMode(false);
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
    //
    // UNLESS THEY HAVE ASKED FOR THE OPPOSITE. In `selectionMode` they have
    // pressed a control whose whole purpose is to choose two words, so per-word
    // stops are what they came for -- and without this they had no route to the
    // feature at all, because every other route is a gesture.
    if (screenReaderEnabled && !selectionMode) return word;

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
        accessible={selectionMode}
        accessibilityHint={
          pickAnchor.current === null
            ? "Double tap to start a phrase at this word"
            : "Double tap to end the phrase at this word"
        }
        onPress={selectionMode
          ? () => pickWord(index)
          : () => handleWordPress(index, cleaned)}
        onLongPress={() => beginSelection(index)}
      />
    );
  }, [beginSelection, handleWordPress, pendingKeys, pickWord, savedPhrases, screenReaderEnabled, selection, selectionMode, story.id]);

  /*
    NOT FORWARDED UPWARD, DELIBERATELY.

    A `onChapterChange` pass-through was added here for the auto write-ahead's
    reading-position bound, and that bound was then removed as a product
    decision -- the chain runs to the credit balance, not to the reader. The
    prop went with it rather than being left in place "in case": an inline
    callback from a parent is a new identity on every parent render, which
    re-runs this memo, which makes `ReaderScreen` fire the change again and
    dismiss a phrase selection the reader was in the middle of. An unused seam
    with a live footgun is worse than no seam.
  */
  const handleChapterChange = useCallback((chapter: Chapter) => {
    setActiveChapter(chapter);
    // A range is a set of indices into ONE chapter's word list. Carrying it
    // across a chapter change would light an unrelated run of words in the
    // new one.
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
            onChapterChange={handleChapterChange}
            autoplay={autoplay}
            renderChapterEnd={renderChapterEnd}
            liveSessionId={liveSessionId}
            onRequireSignIn={onRequireSignIn}
            onListen={onListen}
            onReimagineStarted={onReimagineStarted}
            onReimagineStory={onReimagineStory}
            // The chrome's labelled way into phrase capture, for every reader
            // rather than only the ones who can make the gesture. Suppressed
            // while the mode is already open, so the control cannot re-enter
            // a mode the reader is standing in.
            onSavePhrase={selectionMode ? undefined : enterSelectionMode}
          />
          {/*
            Tapping anywhere off the selection dismisses it, and that tap does
            NOTHING else -- it does not also toggle the reader's chrome, which
            is what the same tap does with no selection open. A scrim is how
            that is made true without `ReaderScreen` having to know a selection
            exists: while one is live this layer is in front of the page and
            eats the tap. It is transparent, so the reader sees only their
            highlight.

            INSIDE the gesture detector, not beside it. As a sibling it also
            covered the view `dragToSelect` is attached to, so the moment a
            selection appeared the reader could no longer drag to adjust its
            range -- the one gesture the selection exists to be shaped by. A
            descendant of the detector's view still hands the long-press drag
            to the pan handler, and still swallows the plain tap.
          */}
          {/*
            NOT IN `selectionMode`. The scrim covers the page, which is correct
            for a drag-made selection -- the next tap should dismiss it and do
            nothing else -- and fatal in the explicit mode, where the next tap
            is the reader choosing the phrase's LAST word. There, Done is the
            way out and the words stay reachable.
          */}
          {selection && !selectionMode ? (
            <Pressable
              testID="selection-dismiss"
              accessibilityRole="button"
              accessibilityLabel="Dismiss selection"
              onPress={clearSelection}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </View>
      </GestureDetector>
      {/*
        THE MODE BAR: a persistent instruction while the explicit mode is open.

        It sits at the top rather than the bottom because the toolbar owns the
        bottom, and because the reader needs it before there is anything to
        operate on -- the toolbar only appears once words are chosen, and an
        empty page with no bar would be a mode with no sign it was on.
      */}
      {selectionMode ? (
        <View style={styles.modeBar} testID="phrase-mode-bar" accessibilityLiveRegion="polite">
          <Text style={styles.modeText}>
            {WEB
              ? "Select the words you want, then Save phrase."
              : "Tap the first word, then the last."}
          </Text>
          <Pressable
            onPress={exitSelectionMode}
            accessibilityRole="button"
            accessibilityLabel="Done saving phrases"
            hitSlop={8}
            testID="phrase-mode-done"
            style={styles.modeDone}
          >
            <X size={16} color={colors.surface} />
            <Text style={styles.modeDoneText}>Done</Text>
          </Pressable>
        </View>
      ) : null}
      {selection || webSelection ? (
        <SelectionToolbar
          wordCount={selection
            ? rangeLength(selection)
            : wordCountOf(webSelection ?? "")}
          saving={selectionSaving}
          saved={selectionSaved}
          hint={selection
            ? (selectionMode ? PICK_HINT : undefined)
            : WEB_SELECTION_HINT}
          onAction={(action) => { void handleSelectionAction(action); }}
        />
      ) : null}
      {/*
        THE ACCESSIBLE DOOR, MOUNTED HERE AS WELL AS IN THE CHROME.

        `ReaderChrome` takes an `onSavePhrase` and draws a labelled control for
        it, threaded down through `ReaderScreen`, and that is the route for
        everyone. This one is not a duplicate of it, and the reason is worth
        stating so nobody deletes it as one: **the chrome is a transient
        overlay.** It animates to `opacity: 0` with `pointerEvents: "none"`
        when the reader is actually reading, and it comes back on a tap on the
        page. That is a fine way to reach a control if you can see that it
        went away and tap a blank area to get it back.

        Every other route into phrase capture is a gesture a screen-reader user
        cannot make -- a long-press or a drag over words that are deliberately
        not in their accessibility tree, because the page serves them fluent
        prose instead of a thousand per-word stops. So for them the chrome
        being momentarily absent is not an inconvenience, it is the feature
        disappearing. This control is persistent and is rendered only while a
        screen reader is running: a floating button on a page of prose is
        exactly the furniture this reader is designed without.
      */}
      {screenReaderEnabled && !selectionMode ? (
        <Pressable
          onPress={enterSelectionMode}
          accessibilityRole="button"
          accessibilityLabel="Save a phrase"
          accessibilityHint="Choose the first and last word of a phrase to save"
          testID="phrase-capture-entry"
          style={styles.entry}
        >
          <BookmarkPlus size={16} color={colors.surface} />
          <Text style={styles.entryText}>Save a phrase</Text>
        </Pressable>
      ) : null}
      {/*
        ONE LINE, ONCE. See the coach-mark effect above for the three
        conditions it is gated on. `box-none` on the wrapper so the page
        underneath is still readable and tappable around the card -- a scrim
        would make the first thing a new reader meets a modal.
      */}
      {coachVisible && !selection && !webSelection && !selectionMode ? (
        <View pointerEvents="box-none" style={styles.coachWrap}>
          <View style={styles.coach} testID="phrase-coach" accessibilityLiveRegion="polite">
            <Text style={styles.coachText}>{COACH_COPY}</Text>
            <Pressable
              onPress={dismissCoach}
              accessibilityRole="button"
              accessibilityLabel="Got it"
              hitSlop={8}
              testID="phrase-coach-dismiss"
              style={styles.coachDismiss}
            >
              <Text style={styles.coachDismissText}>Got it</Text>
            </Pressable>
          </View>
        </View>
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
  /*
    Everything below is drawn in `CHROME`, not in the reading theme.

    Same rule the control sheet and the selection toolbar already follow: this
    is the app operating on the page. A coach mark or a mode bar tinted to
    match Sepia would read as part of the story.
  */
  modeBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    minHeight: 56,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: CHROME.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHROME.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  modeText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: CHROME.text,
    letterSpacing: 0,
  },
  modeDone: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: CHROME.track,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  modeDoneText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.surface,
    letterSpacing: 0,
  },
  entry: {
    position: "absolute",
    bottom: spacing.huge,
    alignSelf: "center",
    zIndex: 30,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    boxShadow: shadows.overlay,
  },
  entryText: {
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface,
    letterSpacing: 0,
  },
  coachWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.huge,
    zIndex: 30,
  },
  coach: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: CHROME.surface,
    borderWidth: 1,
    borderColor: CHROME.border,
    boxShadow: shadows.overlay,
  },
  coachText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    color: CHROME.text,
    letterSpacing: 0,
  },
  coachDismiss: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  coachDismissText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0,
  },
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
