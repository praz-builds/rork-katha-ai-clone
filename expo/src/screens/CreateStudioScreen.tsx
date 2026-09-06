import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Edit3,
  MessageCircle,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native";
import {
  CreditPill,
  PrimaryButton,
} from "@/components/KathaPrimitives";
import CreateBriefFlow from "@/components/create/CreateBriefFlow";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import StreamingProse from "@/components/create/StreamingProse";
import {
  continueStoryStreaming,
  type CoverState,
  createGenerationRequestId,
  editParagraphStreaming,
  fetchCoverState,
  generateStoryStreaming,
  GenerationRequestError,
  publishStory,
  regenerateCover,
} from "@/lib/api";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage";
import {
  COVER_POLL_INTERVAL_MS,
  COVER_POLL_MAX_ATTEMPTS,
  MAX_CAST_SIZE,
  MAX_COVER_NOTE_CHARS,
  MAX_NEXT_INSTRUCTION_CHARS,
} from "@/lib/pricing-limits";
import {
  colors,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  spacing,
} from "@/theme";
import {
  GENRE_EMOJI,
  GENRE_ROW_1,
  GENRE_ROW_2,
  GENRE_STARTERS,
} from "@/lib/genre-content";
import type { AudienceMode, CreateDraft, Genre, IdentityLens, SpiceLevel, Story } from "@/types/domain";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * The steps the studio actually has.
 *
 * There used to be a `cover` step between the editor and review, and every
 * thing on it was untrue: it drew a gradient concept card and called it a
 * preview of a cover that had in fact already been generated, it said the cover
 * "will be created when you publish" when `generate-story` schedules it the
 * moment chapter 1 persists, and its Regenerate button was permanently
 * disabled next to a prompt box whose contents were never sent anywhere.
 *
 * §10.4 settles where the cover belongs: chapter 1's art *is* the cover, so it
 * is revealed in the editor as soon as it lands and confirmed at review, which
 * is the step that was always going to show it. A step of its own was a step
 * about a thing that had already happened.
 */
type StudioStep = "setup" | "generating" | "editor" | "review" | "publishing";

type DraftCharacter = {
  name: string;
  description: string;
  isHero: boolean;
  /** Voice, motivation, relationships. Drives the prose, never the portrait. */
  background?: string;
  /** Face, build, clothing. Drives the portrait, and detail in the prose. */
  appearance?: string;
  portraitUrl?: string;
  portraitStatus?: "idle" | "generating" | "ready" | "failed";
};

type StudioDraft = {
  primaryGenre: Genre;
  genres?: Genre[];
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  seed: string;
  language: CreateDraft["language"];
  /** Private by default. This is publish intent, never a generation input. */
  visibility: NonNullable<CreateDraft["visibility"]>;
  characters: DraftCharacter[];
  isSeries: boolean;
  /**
   * The brief fields the backend now consumes.
   *
   * There is no UI producing them yet — the Idea/Shape/Review split and the
   * moments builder are unbuilt — but the contract is wired end to end, so the
   * screens that collect them will not also have to plumb them.
   */
  whereAndWhen?: string;
  moments?: string[];
  storyValues?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: "short" | "standard" | "long";
  plannedChapterCount?: 3 | 7 | 15;
  illustrateChapters?: boolean;
};

type ParagraphState = {
  text: string;
  isEditing: boolean;
  isProcessing: boolean;
  previousText?: string;
};

type CreateStudioProps = {
  credits: number;
  isAnonymous?: boolean;
  onCreditUsed: (amount: number) => void;
  onPublished: (story: Story) => void;
  onBack: () => void;
  /**
   * The blueprint a user built during onboarding.
   *
   * It arrives as a draft rather than as a story, and the user still presses
   * Create themselves. Generating on arrival would spend their whole welcome
   * grant on a story they have not asked for a second time and may never open.
   */
  initialDraft?: Partial<StudioDraft>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARACTERS = MAX_CAST_SIZE;

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "pt", label: "Portuguese", flag: "🇵🇹" },
] as const;



/**
 * Encouragement, never a gate.
 *
 * The old version counted toward 40 characters ("Almost there (12/40)"), which
 * taught users to pad a sentence rather than to add structure, and framed a
 * short idea as a failure. Nothing here blocks Create; the slot-based
 * brief-strength meter replaces the counter proper.
 */
/**
 * Brief strength — section 8, replacing the character counter.
 *
 * Keyed to slots filled, not to characters typed. The counter measured the one
 * thing the user should not optimise: length. A 150-character idea is not a
 * better brief than a 30-character idea plus a setting and a cast, and telling
 * someone "great detail" for padding teaches them to pad.
 *
 * Two properties the counter lacked. It names what to add next, and **Sparse is
 * framed as a legitimate choice** — a user who wants to type one sentence and
 * hit Create must never be scolded for it.
 */
function getBriefStrength(draft: StudioDraft): {
  label: string;
  detail: string;
  filled: number;
} {
  if (!draft.seed.trim()) {
    return {
      label: "",
      detail: "A sentence is enough. Katha takes it from there.",
      filled: 0,
    };
  }

  // Genre is deliberately not counted. It always has a value — the draft opens
  // on "fantasy" — so including it made every brief with an idea score at least
  // two, and **Sparse was unreachable**. A slot that is always full cannot
  // discriminate between briefs, and the meter's whole job is to discriminate.
  let filled = 1;
  if (draft.whereAndWhen?.trim()) filled += 1;
  if (draft.characters.some((c) => c.name.trim())) filled += 1;
  if (draft.moments?.length) filled += 1;

  if (filled >= 4) {
    return { label: "Rich", detail: "Katha has plenty to work with.", filled };
  }
  if (filled === 3) {
    return { label: "Strong", detail: "This will sound like yours.", filled };
  }
  if (filled === 2) {
    return { label: "Good", detail: "Enough to write from.", filled };
  }
  return {
    label: "Sparse",
    detail: "Katha will invent most of this. That can be good.",
    filled,
  };
}

const INITIAL_DRAFT: StudioDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "",
  language: "English",
  // No phantom character.
  //
  // This seeded one blank `{ name: "", description: "" }` row, which the client
  // sent verbatim. `validation.ts` rejects any supplied character without a
  // name, so every user who did not fill in a cast — the common case, since
  // characters are optional — got a 400 on the primary path. The cast starts
  // empty; `addCharacter` creates the first row.
  characters: [],
  isSeries: true,
  chapterLength: "standard",
  plannedChapterCount: 3,
  illustrateChapters: false,
  visibility: "private",
};

// ---------------------------------------------------------------------------
// Local paragraph edit fallback (used when backend is unreachable)
// ---------------------------------------------------------------------------

async function localEditParagraph(
  paragraphText: string,
  instruction: string,
  _customNote?: string,
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (instruction === "expand") {
    return (
      paragraphText +
      " The details sharpened as the moment stretched on, each one more vivid than the last."
    );
  }
  if (instruction === "shorten") {
    const sentences = paragraphText.split(". ");
    return (
      sentences
        .slice(0, Math.ceil(sentences.length / 2))
        .join(". ") + "."
    );
  }
  if (instruction === "rewrite") {
    return paragraphText
      .split(". ")
      .reverse()
      .join(". ");
  }
  return paragraphText + " (refined)";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateStudioScreen({
  credits,
  isAnonymous = true,
  onCreditUsed,
  onPublished,
  onBack,
  initialDraft,
}: CreateStudioProps) {
  const [step, setStep] = useState<StudioStep>("setup");
  // The prose arriving from the server, and what it is doing.
  //
  // Held as one string rather than a paragraph array because chunks arrive
  // mid-word and mid-paragraph; splitting is a render concern, not a state one.
  const [streamedProse, setStreamedProse] = useState("");
  // The same text as `streamedProse`, readable synchronously.
  //
  // The error handler runs in a closure created before any chunk arrived, so it
  // sees the initial state value and cannot tell "failed before the reader saw
  // anything" from "failed halfway through their story" - which are two
  // different screens. The ref is what it reads instead.
  const streamedProseRef = useRef("");
  const [streamStage, setStreamStage] = useState<string>("context");
  // Set only when generation failed after prose had already been shown. The
  // text stays on screen; erasing what somebody has read is the worse outcome.
  const [streamError, setStreamError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioDraft>(() =>
    initialDraft ? { ...INITIAL_DRAFT, ...initialDraft } : INITIAL_DRAFT
  );
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  // Editor state
  const [story, setStory] = useState<Story | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphState[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [storyTitle, setStoryTitle] = useState("");
  // (tone picker removed)
  const [customPromptIndex, setCustomPromptIndex] = useState<number | null>(null);
  const [customPromptText, setCustomPromptText] = useState("");

  // Undo toast
  const [undoTarget, setUndoTarget] = useState<{
    index: number;
    previous: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The cover, which is chapter 1's art (§10.4).
  //
  // Held apart from `story` rather than folded into it because it moves on a
  // different clock: the story object is rewritten on every keystroke in the
  // editor, and the cover is settled by a background task on the server that
  // this screen only observes. Seeded from the generation response, advanced by
  // `fetchCoverState`, replaced outright by a regeneration.
  const [cover, setCover] = useState<CoverState>({
    coverStatus: "pending",
    coverRegenCount: 0,
  });
  /** The writer's optional steer for the next cover. Sent, not discarded. */
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  // Chapter state
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [addingChapter, setAddingChapter] = useState(false);
  const maxChapters = story?.plannedChapterCount ?? draft.plannedChapterCount ?? 3;

  // The reader's optional steer for the chapter that has not been written yet.
  //
  // Blank is the normal case and means Katha decides — the field exists so a
  // reader who *does* have something in mind is not forced to accept whatever
  // the plan had queued up. It costs nothing: the credit is charged for the
  // chapter, never for saying what should be in it.
  const [nextInstruction, setNextInstruction] = useState("");

  // Pulse animation for processing paragraphs
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const hasProcessing = paragraphs.some((p) => p.isProcessing);
    if (hasProcessing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [paragraphs, pulseAnim]);

  // Clear request id when draft changes
  useEffect(() => {
    requestIdRef.current = null;
  }, [draft]);

  // Clear undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Restore persisted draft on mount
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    // An onboarding blueprint outranks anything in AsyncStorage: the user built
    // it seconds ago, and restoring over it would silently discard the whole
    // reason they finished the flow.
    if (initialDraft) {
      draftRestoredRef.current = true;
      return;
    }
    loadDraft()
      .then((saved) => {
        if (!saved) return;
        const restored = saved as StudioDraft;

        // `saved` comes from AsyncStorage and is typed by assertion only, so
        // nothing guarantees `characters` is an array. A draft written by an
        // older build, or a partially written one, can omit it - and reading
        // .length off undefined here would reject the promise before
        // draftRestoredRef is set, leaving auto-save disabled for the whole
        // mount and silently discarding everything the user then types.
        const characters = Array.isArray(restored.characters)
          ? restored.characters
          : [];

        // The cap also moved: it was 5 before MAX_CHARACTERS came down to 3, so
        // an older draft can hold more than the server will accept. Clamp on
        // the way in rather than letting Create take a 400.
        setDraft({
          ...restored,
          characters: characters.slice(0, MAX_CHARACTERS),
        });
      })
      .finally(() => {
        // Always, even if the stored draft was unreadable. Otherwise a single
        // bad payload disables auto-save until the app restarts.
        draftRestoredRef.current = true;
      });
    // Runs once. `initialDraft` is fixed for the life of the mount, and a
    // re-run would restore over whatever the user has typed since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft on changes (debounced 500ms, blocked until restore completes)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (step !== "setup" || !draftRestoredRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(draft);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, step]);

  // One non-whitespace character, matching validation.ts. The 40-character gate
  // is gone: it taught padding rather than structure, and a one-line idea is a
  // legitimate choice per source-of-truth/STORY_GENERATION_FLOW.md section 2.
  const canGenerate =
    draft.seed.trim().length >= 1 && credits >= 3 && !busy;
  const briefStrength = getBriefStrength(draft);

  const wordCount = paragraphs.reduce((acc, p) => {
    return acc + p.text.split(/\s+/).filter(Boolean).length;
  }, 0);

  const readTimeMin = Math.max(1, Math.round(wordCount / 200));

  // What the Continue button calls itself.
  //
  // Three readings of the same action, and the label is the only place the
  // difference shows: the chapter that closes the planned run is the finale,
  // a typed direction is being followed rather than invented, and blank is
  // Katha's own choice. There is still one handler and one request behind all
  // three — the wording follows the state, it does not create one.
  const continueIsFinale = story
    ? story.chapters.length + 1 >= maxChapters
    : false;
  const continueLabel = continueIsFinale
    ? "Write the finale"
    : nextInstruction.trim()
      ? "Continue this way"
      : "Continue";

  // -----------------------------------------------------------------------
  // Step 1: Generate draft
  // -----------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    if (busy) return;
    if (!canGenerate) {
      Alert.alert(
        credits >= 3 ? "Add a story seed" : "Credits needed",
        credits >= 3
          ? "Give Katha one clear idea to shape."
          : "You need 3 credits to start a story.",
      );
      return;
    }
    setBusy(true);
    setStep("generating");
    const requestId =
      requestIdRef.current ?? createGenerationRequestId();
    requestIdRef.current = requestId;

    const createDraft: CreateDraft = {
      primaryGenre: draft.primaryGenre,
      genres: draft.genres,
      audienceMode: draft.audienceMode,
      spiceLevel: draft.spiceLevel,
      identityLenses: draft.identityLenses,
      seed: draft.seed,
      language: draft.language,
      visibility: draft.visibility,
      // Belt and braces with the clamp in loadDraft: validation.ts enforces the
      // same cap, and a request over it is a 400 rather than a truncation.
      characters: draft.characters.slice(0, MAX_CHARACTERS),
      isSeries: draft.isSeries,
      whereAndWhen: draft.whereAndWhen,
      moments: draft.moments,
      storyValues: draft.storyValues,
      writingStyle: draft.writingStyle,
      avoid: draft.avoid,
      chapterLength: draft.chapterLength,
      plannedChapterCount: draft.plannedChapterCount,
      illustrateChapters: draft.illustrateChapters,
    };

    streamedProseRef.current = "";
    setStreamedProse("");
    setStreamStage("context");
    setStreamError(null);

    try {
      const generated = await generateStoryStreaming(createDraft, requestId, {
        onStage: setStreamStage,
        onDelta: (chunk) => {
          streamedProseRef.current += chunk;
          setStreamedProse(streamedProseRef.current);
        },
      });
      const firstChapter = generated.chapters[0];
      if (!firstChapter) {
        throw new Error("Story generation returned no chapter");
      }
      onCreditUsed(3);
      clearDraft();
      setStory(generated);
      // Chapter 1's art is already in flight by the time this response arrives
      // — `generate-story` schedules it the moment the chapter persists — so
      // the studio starts watching from here rather than pretending the cover
      // is a publish-time concern.
      setCover({
        coverImageUrl: generated.coverImageUrl,
        coverStatus: generated.coverStatus ?? "generating",
        coverRegenCount: generated.coverRegenCount ?? 0,
      });
      setCoverPrompt("");
      setCoverError(null);
      setStoryTitle(generated.title);
      setActiveChapterIndex(0);
      setParagraphs(
        firstChapter.paragraphs.map((text) => ({
          text,
          isEditing: false,
          isProcessing: false,
        })),
      );
      streamedProseRef.current = "";
      setStreamedProse("");
      setStep("editor");
    } catch (error) {
      if (
        error instanceof GenerationRequestError &&
        error.resetRequestId
      ) {
        requestIdRef.current = null;
      }
      const message = error instanceof Error
        ? error.message
        : "Please try again.";
      // A failure before any prose arrived is an ordinary error: back to setup
      // with an alert. A failure after it is not, because the reader is looking
      // at part of their story. Keep them on the text, say what happened
      // underneath it, and let them decide - the credit is already refunded.
      if (streamedProseRef.current.trim()) {
        setStreamError(message);
      } else {
        setStep("setup");
        Alert.alert("Could not create story", message);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, canGenerate, credits, draft, onCreditUsed]);

  // -----------------------------------------------------------------------
  // Step 2: Paragraph AI actions
  // -----------------------------------------------------------------------

  const showUndoToast = useCallback(
    (index: number, previous: string) => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoTarget({ index, previous });
      undoTimerRef.current = setTimeout(() => {
        setUndoTarget(null);
      }, 5000);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (!undoTarget) return;
    setParagraphs((prev) =>
      prev.map((p, i) =>
        i === undoTarget.index
          ? { ...p, text: undoTarget.previous, previousText: undefined }
          : p,
      ),
    );
    setUndoTarget(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoTarget]);

  const runAiAction = useCallback(
    async (index: number, instruction: string, customNote?: string) => {
      const paragraph = paragraphs[index];
      if (!paragraph || paragraph.isProcessing) return;

      const previousText = paragraph.text;
      // Capture the chapter index at call time to guard against chapter switches
      const editChapterIndex = activeChapterIndex;
      setParagraphs((prev) =>
        prev.map((p, i) =>
          i === index ? { ...p, isProcessing: true } : p,
        ),
      );

      try {
        const chapter = story?.chapters[editChapterIndex];
        let result: string;
        if (story && chapter) {
          // The rewrite replaces the paragraph as it is written, in place.
          //
          // This is the edit path's whole point: the writer is looking directly
          // at the sentence being changed, so a spinner over it is the most
          // conspicuous wait in the product. `partial` accumulates outside
          // React for the same reason the chapter stream does - chunks arrive
          // faster than a render.
          let partial = "";
          result = await editParagraphStreaming(
            story.id,
            chapter.id,
            index,
            instruction as "rewrite" | "expand" | "shorten" | "custom",
            {
              onDelta: (chunk) => {
                partial += chunk;
                // A chapter switch mid-edit must not paint one chapter's text
                // onto another's paragraph.
                if (editChapterIndex !== activeChapterIndex) return;
                setParagraphs((prev) =>
                  prev.map((p, i) =>
                    i === index ? { ...p, text: partial } : p,
                  ),
                );
              },
            },
            { customNote: instruction === "custom" ? customNote : undefined },
          );
          if (!result) {
            result = await localEditParagraph(previousText, instruction, customNote);
          }
        } else {
          result = await localEditParagraph(previousText, instruction, customNote);
        }
        // Only apply if user hasn't switched chapters during the edit
        if (editChapterIndex !== activeChapterIndex) return;
        setParagraphs((prev) =>
          prev.map((p, i) =>
            i === index
              ? {
                  text: result,
                  isEditing: false,
                  isProcessing: false,
                  previousText,
                }
              : p,
          ),
        );
        showUndoToast(index, previousText);
      } catch {
        if (editChapterIndex !== activeChapterIndex) return;
        // Put the original paragraph back.
        //
        // The streamed rewrite has been painting over this paragraph as it
        // arrived, so a failure would otherwise leave the writer holding half a
        // sentence where their finished one used to be. Nothing was saved -
        // the server only persists a completed rewrite - so restoring the text
        // it started from is both correct and what the writer expects. Editing
        // is free, so the retry costs them nothing.
        setParagraphs((prev) =>
          prev.map((p, i) =>
            i === index
              ? { ...p, text: previousText, isProcessing: false }
              : p,
          ),
        );
        Alert.alert("Edit failed", "Could not apply the edit. Please try again.");
      }

      setSelectedIndex(null);
      setCustomPromptIndex(null);
      setCustomPromptText("");
    },
    [paragraphs, showUndoToast, activeChapterIndex, story],
  );

  const deleteParagraph = useCallback(
    (index: number) => {
      Alert.alert(
        "Delete paragraph?",
        "This paragraph will be removed from your draft.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              setParagraphs((prev) => prev.filter((_, i) => i !== index));
              setSelectedIndex(null);
            },
          },
        ],
      );
    },
    [],
  );

  const addParagraph = useCallback(() => {
    setParagraphs((prev) => [
      ...prev,
      { text: "", isEditing: true, isProcessing: false },
    ]);
  }, []);

  const updateParagraphText = useCallback(
    (index: number, text: string) => {
      setParagraphs((prev) =>
        prev.map((p, i) => (i === index ? { ...p, text } : p)),
      );
    },
    [],
  );

  const toggleEditing = useCallback(
    (index: number) => {
      setParagraphs((prev) =>
        prev.map((p, i) =>
          i === index ? { ...p, isEditing: !p.isEditing } : p,
        ),
      );
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Save current editor state to story object
  // -----------------------------------------------------------------------

  const saveEditorToStory = useCallback(() => {
    if (!story) return story;
    const updatedChapters = story.chapters.map((ch, i) =>
      i === activeChapterIndex
        ? { ...ch, paragraphs: paragraphs.map((p) => p.text).filter(Boolean) }
        : ch,
    );
    const updated = { ...story, title: storyTitle || story.title, chapters: updatedChapters };
    setStory(updated);
    return updated;
  }, [story, activeChapterIndex, paragraphs, storyTitle]);

  // -----------------------------------------------------------------------
  // Step transitions: Editor → Review → Publish
  // -----------------------------------------------------------------------

  const handleDoneWriting = useCallback(() => {
    saveEditorToStory();
    setStep("review");
  }, [saveEditorToStory]);

  const handleBackToEditor = useCallback(() => {
    setStep("editor");
  }, []);

  // -----------------------------------------------------------------------
  // The cover
  // -----------------------------------------------------------------------

  /**
   * Watch for chapter 1's art while the writer is in the studio.
   *
   * `generate-story` returns `cover_status: "generating"` and then finishes the
   * job on a background task, so this screen is handed a promise and no way to
   * hear it kept. Without this the cover could only ever appear on a later
   * launch, and the studio would be back to describing a cover it had never
   * seen — which is the thing §10.4 is a correction to.
   *
   * It runs only while there is something to wait for: the effect re-runs when
   * the status changes and returns immediately once it is no longer
   * `generating`, which is what tears the interval down. It is bounded so a
   * server-side claim that died leaves the writer with the concept card rather
   * than a spinner that never resolves.
   */
  useEffect(() => {
    const storyId = story?.id;
    if (!storyId) return;
    if (cover.coverStatus !== "generating") return;
    if (step !== "editor" && step !== "review") return;

    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const next = await fetchCoverState(storyId);
      if (cancelled) return;
      if (next) setCover(next);
      if (attempts >= COVER_POLL_MAX_ATTEMPTS) clearInterval(timer);
    }, COVER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [story?.id, cover.coverStatus, step]);

  /** 1 free retry, then 1 credit — `CREDITS_AND_PRICING.md`, §10.4. */
  const coverRegenCostsCredit = cover.coverRegenCount >= 1;

  const handleRegenerateCover = useCallback(async () => {
    if (!story || coverBusy) return;
    if (coverRegenCostsCredit && credits < 1) {
      Alert.alert(
        "Credits needed",
        "You need 1 credit to regenerate this cover. The first one was free.",
      );
      return;
    }

    setCoverBusy(true);
    setCoverError(null);
    const note = coverPrompt.trim();
    // A fresh id every press. A regeneration is not a retry of the last one —
    // the writer wants a different picture — and the server refuses a request
    // id that has already bought a cover rather than handing out a second one.
    const requestId = createGenerationRequestId();

    try {
      const next = await regenerateCover(story.id, requestId, note || undefined);
      setCover({
        coverImageUrl: next.coverImageUrl,
        coverStatus: next.coverStatus,
        coverRegenCount: next.coverRegenCount,
      });
      // The server says what it charged. Deriving it here from the count would
      // be a second copy of the pricing rule, and the two would drift.
      if (next.charged) onCreditUsed(1);
      // Cleared only on success, for the same reason the continuation box is:
      // a failed regeneration that also ate what the writer typed charges them
      // twice for one of our failures.
      setCoverPrompt("");
    } catch (error) {
      setCoverError(
        error instanceof Error
          ? error.message
          : "The cover could not be regenerated. Please try again.",
      );
    } finally {
      setCoverBusy(false);
    }
  }, [story, coverBusy, coverRegenCostsCredit, credits, coverPrompt, onCreditUsed]);

  // -----------------------------------------------------------------------
  // Step: Publish
  // -----------------------------------------------------------------------

  const handlePublish = useCallback(async () => {
    if (!story) return;
    setStep("publishing");

    // The editor writes to React state, not to the server. Publishing has to
    // carry those edits or it publishes the model's original text and silently
    // discards everything the user wrote — at the exact moment they committed
    // to the story. Editing is free and unlimited, so the more care a user
    // took, the more they used to lose.
    const edited = saveEditorToStory() ?? story;

    // An emptied chapter blocks the publish rather than being filtered out of
    // it. Filtering would send no `chapters` at all, the server would read that
    // as "unchanged", and it would publish the original text under a story the
    // user had just cleared — the same silent stale publish by another door.
    const emptyChapter = edited.chapters.find(
      (ch) => !ch.paragraphs.some((p) => p.trim()),
    );
    if (emptyChapter) {
      setStep("review");
      Alert.alert(
        "Empty chapter",
        `"${emptyChapter.title || `Chapter ${emptyChapter.chapterNumber}`}" has no text. Add something to it, or delete it, before publishing.`,
      );
      return;
    }

    const shouldPublish = draft.visibility === "public";
    const updatedChapters = edited.chapters.map((ch) => ({
      ...ch,
      isPublished: shouldPublish,
    }));

    // A failed publish is reported, not swallowed.
    //
    // This used to discard every failure — timeout, network, server rejection —
    // and then call `onPublished` with `isPublished: true` on every chapter, so
    // the user saw a published story while the server held the original text.
    // Carrying the hand edits made that strictly worse: a swallowed failure now
    // discards the edits this change exists to preserve, and the local state
    // hides it. Publishing is not something to be optimistic about.
    try {
      await Promise.race([
        publishStory(edited.id, {
          title: storyTitle || edited.title,
          visibility: draft.visibility,
          chapters: edited.chapters.map((ch) => ({
            id: ch.id,
            content: ch.paragraphs.filter((p) => p.trim()).join("\n\n"),
          })),
        }),
        // Bounded so the UI never hangs on a stalled request.
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
    } catch {
      setStep("review");
      Alert.alert(
        shouldPublish ? "Couldn't publish" : "Couldn't save",
        "Your story and every edit are still here. Check your connection and try again.",
      );
      return;
    }

    const publishedStory: Story = {
      ...edited,
      title: storyTitle || edited.title,
      chapters: updatedChapters,
    };

    onPublished(publishedStory);
  }, [draft.visibility, story, storyTitle, onPublished, saveEditorToStory]);

  const handleContinueStory = useCallback(async (isFinale = false) => {
    if (!story || addingChapter) return;
    if (story.chapters.length >= maxChapters) {
      Alert.alert(
        "Series complete",
        `This story has reached its planned ${maxChapters} chapters.`,
      );
      return;
    }
    if (credits < 1) {
      Alert.alert("Credits needed", "You need 1 credit to add a chapter.");
      return;
    }

    // Save current editor state before generating next chapter
    const savedStory = saveEditorToStory() ?? story;

    // Read the direction once, here, rather than inside the stream callbacks.
    // The box stays editable while the chapter streams, and a request that
    // re-read the state later could send text the reader typed *after* they
    // pressed Continue. Empty collapses to `undefined` so the request omits the
    // field entirely — an empty string would still render the reader-direction
    // block in the prompt, telling the model a steer exists when none does.
    const direction = nextInstruction.trim() || undefined;

    setAddingChapter(true);
    setStep("generating");

    const requestId = createGenerationRequestId();
    const nextChapterNum = savedStory.chapters.length + 1;
    const shouldFinale = isFinale || nextChapterNum >= maxChapters;

    streamedProseRef.current = "";
    setStreamedProse("");
    setStreamStage("context");
    setStreamError(null);

    try {
      const { chapter } = await continueStoryStreaming(
        savedStory.id,
        requestId,
        {
          onStage: setStreamStage,
          onDelta: (chunk) => {
            streamedProseRef.current += chunk;
            setStreamedProse(streamedProseRef.current);
          },
        },
        shouldFinale,
        nextChapterNum,
        direction,
      );
      onCreditUsed(1);

      const updatedStory: Story = {
        ...savedStory,
        chapters: [...savedStory.chapters, chapter],
      };
      setStory(updatedStory);

      // Switch to the new chapter
      const newIndex = updatedStory.chapters.length - 1;
      setActiveChapterIndex(newIndex);
      setParagraphs(
        chapter.paragraphs.map((text) => ({
          text,
          isEditing: false,
          isProcessing: false,
        })),
      );
      streamedProseRef.current = "";
      setStreamedProse("");

      // Cleared only on success, and only here. A direction that survived into
      // the next chapter would keep steering chapters the reader never aimed
      // it at, with nothing on screen to say so. A failed continuation keeps
      // the text, because retyping it is the reader paying for our error.
      setNextInstruction("");
      setStep("editor");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Please try again.";
      // Same rule as the first chapter: prose the reader has already seen stays
      // on screen, and only a failure before that returns them to the editor.
      if (streamedProseRef.current.trim()) {
        setStreamError(message);
        setAddingChapter(false);
        return;
      }
      setStep("editor");
      Alert.alert(
        "Could not continue story",
        message,
      );
    } finally {
      setAddingChapter(false);
    }
  }, [story, addingChapter, credits, maxChapters, nextInstruction, onCreditUsed, saveEditorToStory]);

  const switchToChapter = useCallback((index: number) => {
    if (!story || index === activeChapterIndex) return;
    // Save current paragraphs to the story object
    const updatedChapters = story.chapters.map((ch, i) =>
      i === activeChapterIndex
        ? { ...ch, paragraphs: paragraphs.map((p) => p.text).filter(Boolean) }
        : ch,
    );
    setStory({ ...story, chapters: updatedChapters });

    // Load new chapter
    setActiveChapterIndex(index);
    const chapter = updatedChapters[index];
    setParagraphs(
      chapter.paragraphs.map((text) => ({
        text,
        isEditing: false,
        isProcessing: false,
      })),
    );
    setSelectedIndex(null);
  }, [story, activeChapterIndex, paragraphs]);

  const handleBackFromEditor = useCallback(() => {
    Alert.alert(
      "Discard draft?",
      "Your draft and all edits will be lost.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setStep("setup");
            setStory(null);
            setParagraphs([]);
            setSelectedIndex(null);
            setStoryTitle("");
            setCover({ coverStatus: "pending", coverRegenCount: 0 });
            setCoverPrompt("");
            setCoverError(null);
          },
        },
      ],
    );
  }, []);

  // -----------------------------------------------------------------------
  // Character management (Setup step)
  // -----------------------------------------------------------------------

  // The cap is checked inside the updater, against prev, not against the
  // draft captured when this callback was created. Two taps in the same frame
  // both saw the stale length and both appended, so a rapid double-tap on the
  // last slot produced a cast one over the cap - which validation.ts then
  // rejects. Checking prev also lets the dependency array empty out, so the
  // callback identity stops changing on every character edit.
  const addCharacter = useCallback(() => {
    setDraft((prev) =>
      prev.characters.length >= MAX_CHARACTERS ? prev : {
        ...prev,
        characters: [
          ...prev.characters,
          { name: "", description: "", isHero: false },
        ],
      }
    );
  }, []);

  const removeCharacter = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      characters: prev.characters.filter((_, i) => i !== index),
    }));
  }, []);

  const updateCharacter = useCallback(
    (index: number, field: keyof DraftCharacter, value: string | boolean) => {
      setDraft((prev) => ({
        ...prev,
        characters: prev.characters.map((c, i) => {
          if (i !== index) {
            // If setting hero on this index, unset others
            if (field === "isHero" && value === true) {
              return { ...c, isHero: false };
            }
            return c;
          }
          return { ...c, [field]: value };
        }),
      }));
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Render: Setup step
  // -----------------------------------------------------------------------

  if (step === "setup") {
    return (
      <CreateBriefFlow
        credits={credits}
        isAnonymous={isAnonymous}
        draft={draft}
        setDraft={setDraft}
        onGenerate={handleGenerate}
        onBack={onBack}
      />
    );
  }

  /*
   * The previous single-page setup renderer is retained below only until the
   * editor/publish refactor is split out of this legacy screen. CreateBriefFlow
   * above is the active source of the Idea, Shape, Review, and Craft character
   * experience.
   */
  if (false) {
    return (
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.setupScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.setupHeader}>
              <View style={styles.setupHeaderTop}>
                <Text style={styles.eyebrow}>Create</Text>
                <CreditPill credits={credits} />
              </View>
              <Text style={styles.h1}>Shape a new story</Text>
            </View>

            <View style={styles.formCard}>
              {/* Genre picker — 2 row horizontal scroll */}
              <Text style={styles.fieldLabel}>Genre</Text>
              <View style={styles.genreScrollWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreScrollRow}>
                  {GENRE_ROW_1.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => setDraft((prev) => ({ ...prev, primaryGenre: item }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: draft.primaryGenre === item }}
                      style={[styles.genreChip, draft.primaryGenre === item && styles.genreChipSelected]}
                    >
                      <Text style={[styles.genreChipText, draft.primaryGenre === item && styles.genreChipTextSelected]}>
                        {GENRE_EMOJI[item]} {genreLabels[item]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreScrollRow}>
                  {GENRE_ROW_2.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => setDraft((prev) => ({ ...prev, primaryGenre: item }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: draft.primaryGenre === item }}
                      style={[styles.genreChip, draft.primaryGenre === item && styles.genreChipSelected]}
                    >
                      <Text style={[styles.genreChipText, draft.primaryGenre === item && styles.genreChipTextSelected]}>
                        {GENRE_EMOJI[item]} {genreLabels[item]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Kids is a per-draft audience mode. */}
              <View style={styles.toggleChipRow}>
                {([
                  { key: "kids", label: "🧒 Kids" },
                ] as const).map((chip) => {
                  const isActive = draft.audienceMode === "kids";
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => setDraft((prev) => {
                        // Single-select: deselect all, then toggle the tapped one
                        const base = { ...prev, audienceMode: "adult" as const, identityLenses: [] };
                        if (isActive) return base; // Deselect
                        if (chip.key === "kids") return { ...base, audienceMode: "kids" as const };
                        return base;
                      })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isActive }}
                      style={[styles.toggleChip, isActive && styles.toggleChipActive]}
                    >
                      <Text style={[styles.toggleChipText, isActive && styles.toggleChipTextActive]}>
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {draft.audienceMode === "kids" && (
                <View style={styles.toggleChipRow}>
                  {(["kindness", "honesty", "courage", "patience", "sharing"] as const).map((value) => {
                    const selected = draft.storyValues?.includes(value) ?? false;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setDraft((prev) => {
                          const values = prev.storyValues ?? [];
                          return {
                            ...prev,
                            storyValues: selected
                              ? values.filter((item) => item !== value)
                              : [...values, value],
                          };
                        })}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        style={[styles.toggleChip, selected && styles.toggleChipActive]}
                      >
                        <Text style={[styles.toggleChipText, selected && styles.toggleChipTextActive]}>
                          {value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Story idea */}
              <Text style={styles.fieldLabel}>Your story idea</Text>
              <TextInput
                multiline
                value={draft.seed}
                onChangeText={(seed) =>
                  setDraft((prev) => ({ ...prev, seed }))
                }
                placeholder="Describe the story you want Katha to write..."
                placeholderTextColor={colors.tertiary}
                style={styles.seedInput}
              />
              <Text style={[
                styles.seedHint,
                // Styling only - every state is usable; none blocks Create.
                briefStrength.filled >= 2 && styles.seedHintWarm,
                briefStrength.filled >= 3 && styles.seedHintReady,
              ]}>
                {briefStrength.label
                  ? `${briefStrength.label} — ${briefStrength.detail}`
                  : briefStrength.detail}
              </Text>

              {/* Premise chips */}
              {draft.seed.trim().length < 20 && (
                <View>
                  {/* "Premise" is banned from the interface (section 1,
                      decision 2). The chips are a good asset; only the label
                      was wrong. */}
                  <Text style={styles.chipSectionLabel}>Try one</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.premiseChipScroll}>
                    {GENRE_STARTERS[draft.primaryGenre].map((premise) => (
                      <Pressable
                        key={premise}
                        onPress={() =>
                          setDraft((prev) => ({ ...prev, seed: premise }))
                        }
                        style={styles.premiseChip}
                      >
                        <Text style={styles.premiseChipText}>{premise}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Characters */}
              <View style={styles.charactersHeader}>
                <Text style={styles.fieldLabel}>Characters</Text>
                {draft.characters.length < MAX_CHARACTERS && (
                  <Pressable onPress={addCharacter}>
                    <Text style={styles.addCharacterText}>
                      + Add character
                    </Text>
                  </Pressable>
                )}
              </View>

              {draft.characters.map((character, index) => (
                <View key={index} style={styles.characterCard}>
                  <View style={styles.characterTopRow}>
                    <TextInput
                      value={character.name}
                      onChangeText={(name) =>
                        updateCharacter(index, "name", name)
                      }
                      placeholder="Name"
                      placeholderTextColor={colors.tertiary}
                      style={[styles.characterInput, styles.characterNameInput]}
                    />
                    {/* Every row is removable. The `index > 0` guard was
                        correct while INITIAL_DRAFT seeded row 0; now that the
                        cast starts empty, row 0 is one the user added, and
                        leaving it unremovable trapped them — a blank name is
                        rejected server-side, so a user who added a character
                        and changed their mind could not generate at all. */}
                    <Pressable
                      onPress={() => removeCharacter(index)}
                      style={styles.removeCharacterBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove character ${index + 1}`}
                      // The glyph is 16pt; the touch target must not be. 14pt
                      // of slop on each side brings the effective target to
                      // 44x44, which is the minimum both platforms specify.
                      hitSlop={14}
                    >
                      <X size={16} color={colors.muted} />
                    </Pressable>
                  </View>
                  <View style={styles.characterTopRow}>
                    <TextInput
                      value={character.description}
                      onChangeText={(description) =>
                        updateCharacter(index, "description", description)
                      }
                      placeholder="Role, personality, and what drives them"
                      placeholderTextColor={colors.tertiary}
                      style={[styles.characterInput, styles.characterNameInput]}
                    />
                    {character.description.length > 0 && (
                      <Pressable
                        onPress={() => updateCharacter(index, "description", "")}
                        style={styles.removeCharacterBtn}
                      >
                        <X size={14} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.heroRow}>
                    <Text style={styles.heroLabel}>Hero</Text>
                    <Pressable
                      onPress={() => updateCharacter(index, "isHero", !character.isHero)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: character.isHero }}
                      accessibilityLabel="Hero"
                      style={[styles.heroToggleTrack, character.isHero && styles.heroToggleTrackOn]}
                    >
                      <View style={[styles.heroToggleThumb, character.isHero && styles.heroToggleThumbOn]} />
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* Language */}
              <Text style={styles.fieldLabel}>Language</Text>
              <View style={styles.languageRow}>
                {LANGUAGES.map((lang) => (
                  <Pressable
                    key={lang.code}
                    onPress={() => setDraft((prev) => ({ ...prev, language: lang.label }))}
                    style={[styles.languageChip, draft.language === lang.label && styles.languageChipSelected]}
                  >
                    <Text style={[styles.languageChipText, draft.language === lang.label && styles.languageChipTextSelected]}>
                      {lang.flag} {lang.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Series toggle */}
              <View style={styles.seriesToggleRow}>
                <View style={styles.seriesToggleLeft}>
                  <Text style={styles.fieldLabel}>Make it a series</Text>
                  <Text style={styles.seriesHint}>
                    {draft.isSeries
                      ? "600-900 words per chapter, up to 7 chapters"
                      : draft.audienceMode === "kids"
                        ? "One complete story, 500-1,200 words"
                        : "One complete story, 500-1,500 words"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setDraft((prev) => ({ ...prev, isSeries: !prev.isSeries }))}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: draft.isSeries }}
                  accessibilityLabel="Make it a series"
                  style={[styles.heroToggleTrack, draft.isSeries && styles.heroToggleTrackOn]}
                >
                  <View style={[styles.heroToggleThumb, draft.isSeries && styles.heroToggleThumbOn]} />
                </Pressable>
              </View>
              {draft.isSeries && (
                <View style={styles.seriesInfoCard}>
                  <Text style={styles.seriesInfoText}>
                    Each chapter ends on a cliffhanger. The final chapter resolves the story. 1 credit per chapter.
                  </Text>
                </View>
              )}

              {/* Generate button */}
              <PrimaryButton onPress={handleGenerate}>
                {busy
                  ? "Generating..."
                  : draft.isSeries
                    ? "Generate Chapter 1 — 1 credit"
                    : "Generate Draft — 1 credit"}
              </PrimaryButton>
              {credits === 0 && (
                <Text style={styles.hintText}>
                  You need credits to generate a story
                </Text>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Generating step (loading overlay)
  // -----------------------------------------------------------------------

  if (step === "generating") {
    // The handoff. The loader holds only until the first token exists; from
    // that moment the reader is reading their own story instead of watching a
    // placeholder, which is the entire point of the streamed path. There is
    // deliberately no minimum time on this: if prose arrives at three seconds,
    // the reader starts at three seconds.
    if (streamedProse.length > 0) {
      return (
        <SafeAreaView style={styles.flex}>
          <StreamingProse
            testID="streaming-prose"
            text={streamedProse}
            stage={streamStage}
            title={addingChapter ? undefined : storyTitle || undefined}
            errorMessage={streamError}
            dismissLabel={addingChapter ? "Back to editor" : "Start over"}
            onDismissError={() => {
              streamedProseRef.current = "";
              setStreamedProse("");
              setStreamError(null);
              // A failed continuation still has a story to go back to; a failed
              // first chapter does not, so it returns to the brief the writer
              // filled in rather than to an empty editor.
              setStep(addingChapter ? "editor" : "setup");
              setAddingChapter(false);
            }}
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.flex}>
        <GeneratingOverlay
          genre={draft.primaryGenre}
          mode={addingChapter ? (story && story.chapters.length + 1 >= maxChapters ? "finale" : "chapter") : "story"}
        />
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Publish review step
  // -----------------------------------------------------------------------

  if (step === "review") {
    const genre = story?.genre ?? draft.primaryGenre;
    const gradient = genreGradients[genre];
    const totalWords = story
      ? story.chapters.reduce((sum, ch) => sum + ch.paragraphs.join(" ").split(/\s+/).filter(Boolean).length, 0)
      : wordCount;

    return (
      <SafeAreaView style={styles.flex}>
        {/* Header */}
        <View style={styles.editorHeader}>
          <Pressable onPress={handleBackToEditor} style={styles.editorBackBtn}>
            <ArrowLeft size={20} color={colors.ink} />
            <Text style={styles.editorBackText}>Back</Text>
          </Pressable>
          <Text style={styles.editorHeaderTitle}>Review</Text>
          <View style={{ width: 80 }} />
        </View>

        <ScrollView contentContainerStyle={styles.reviewScroll}>
          {/* The cover, as it actually is.
            *
            * §10.4: chapter 1's art *is* the cover, and it was generated when
            * chapter 1 was. So this shows the real image when there is one and
            * the free typographic concept card when there is not — and the
            * concept card is labelled CONCEPT rather than dressed up as a
            * preview, because keeping it is a legitimate published look and the
            * writer is entitled to know which of the two they are choosing.
            *
            * The three states below are the three the row can actually be in.
            * A spinner is shown only while the server says work is happening;
            * a cover that failed says so and offers the retry, rather than
            * spinning forever over a job nothing is running. */}
          <View style={styles.reviewCard}>
            {cover.coverImageUrl ? (
              <Image
                source={{ uri: cover.coverImageUrl }}
                style={styles.reviewCoverMini}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel={`Cover for ${storyTitle || "your story"}`}
                testID="review-cover-image"
              />
            ) : (
              <View
                style={[styles.reviewCoverMini, { backgroundColor: gradient[1] }]}
                accessibilityLabel="Concept cover"
                testID="review-concept-cover"
              >
                <Text style={styles.reviewCoverMiniTitle} numberOfLines={2}>
                  {storyTitle || "Untitled"}
                </Text>
                <Text style={styles.reviewCoverConceptTag}>CONCEPT</Text>
              </View>
            )}
            <View style={styles.reviewCardMeta}>
              <Text style={styles.reviewCardTitle}>{storyTitle || "Untitled"}</Text>
              <Text style={styles.reviewCardSubtitle}>
                {genreLabels[genre]} · {totalWords.toLocaleString()} words
              </Text>
              {cover.coverStatus === "generating" && !cover.coverImageUrl && (
                <View style={styles.reviewCoverStatusRow} testID="cover-generating">
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.reviewCoverStatusText}>
                    Painting chapter one&apos;s art
                  </Text>
                </View>
              )}
              {cover.coverStatus === "failed" && !cover.coverImageUrl && (
                <Text style={styles.reviewCoverStatusText} testID="cover-failed">
                  The cover didn&apos;t come through. Your concept card is a real
                  cover — or try again below.
                </Text>
              )}
            </View>
          </View>

          {/* Cover controls. Never a permanently disabled button: the price is
            * stated, the note is sent, and the only thing that turns the
            * control off is a request already in flight. */}
          <View style={styles.coverActions}>
            <TextInput
              value={coverPrompt}
              onChangeText={setCoverPrompt}
              maxLength={MAX_COVER_NOTE_CHARS}
              placeholder="Optional. Say what this cover should show."
              placeholderTextColor={colors.tertiary}
              style={styles.coverPromptInput}
              multiline
              accessibilityLabel="Cover note"
              accessibilityHint="Optional. Describe what the regenerated cover should show."
              testID="cover-note-input"
            />
            <Pressable
              onPress={handleRegenerateCover}
              disabled={coverBusy || !story}
              accessibilityRole="button"
              accessibilityState={{ disabled: coverBusy, busy: coverBusy }}
              accessibilityLabel={
                coverBusy
                  ? "Regenerating the cover"
                  : coverRegenCostsCredit
                    ? "Regenerate the cover, 1 credit"
                    : "Regenerate the cover, free"
              }
              style={[styles.regenerateBtn, coverBusy && styles.regenerateBtnBusy]}
              testID="regenerate-cover-button"
            >
              <RefreshCw size={16} color={colors.accent} />
              <Text style={styles.regenerateBtnText}>
                {coverBusy
                  ? "Regenerating..."
                  : `Regenerate cover · ${coverRegenCostsCredit ? "1 credit" : "free"}`}
              </Text>
            </Pressable>
            {coverError && (
              <Text style={styles.coverErrorText} testID="cover-error">
                {coverError}
              </Text>
            )}
            <Text style={styles.coverHint}>
              {coverRegenCostsCredit
                ? "Your free retry is used. Each new cover costs 1 credit."
                : "Your first new cover is free. After that each one costs 1 credit."}
              {"\n"}Keeping the concept card costs nothing.
            </Text>
          </View>

          {/* Chapter list (only for series with multiple chapters) */}
          {story && story.chapters.length > 1 && (
            <View style={styles.reviewChapterList}>
              <Text style={styles.reviewSectionTitle}>Chapters</Text>
              {story.chapters.map((ch) => (
                <View key={ch.id} style={styles.reviewChapterRow}>
                  <View style={styles.reviewChapterDot} />
                  <Text style={styles.reviewChapterName}>
                    {ch.title || `Chapter ${ch.chapterNumber}`}
                  </Text>
                  <Text style={styles.reviewChapterWords}>
                    {ch.paragraphs.join(" ").split(/\s+/).filter(Boolean).length} words
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* What happens next */}
          <View style={styles.reviewInfoCard}>
            <Text style={styles.reviewSectionTitle}>What happens next</Text>
            {/* The cover is deliberately not on this list any more. It was
              * generated with chapter 1, and promising it again here was the
              * same untruth the removed cover step told. */}
            <Text style={styles.reviewInfoText}>
              {"\u2022"} {cover.coverImageUrl
                ? "Your cover goes out with the story"
                : "Your concept card goes out as the cover"}{"\n"}
              {"\u2022"} Audio narration will be created in two voices{"\n"}
              {"\u2022"} {draft.visibility === "public"
                ? "Your story will be visible to all readers"
                : "Your story stays private until you publish it"}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom actions */}
        <View style={styles.reviewActions}>
          <Pressable onPress={handleBackToEditor} style={styles.reviewSecondaryBtn}>
            <Text style={styles.reviewSecondaryBtnText}>Back to Editor</Text>
          </Pressable>
          <Pressable onPress={handlePublish} style={styles.reviewPublishBtn}>
            <Text style={styles.reviewPublishBtnText}>
              {draft.visibility === "public" ? "Publish" : "Save to library"}
            </Text>
            <Check size={16} color={colors.surface} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Publishing step
  // -----------------------------------------------------------------------

  if (step === "publishing") {
    return (
      <SafeAreaView style={styles.flex}>
        <View style={styles.publishingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.publishingTitle}>
            {draft.visibility === "public" ? "Publishing your story..." : "Saving your story..."}
          </Text>
          <Text style={styles.publishingSubtitle}>
            {/* Not "generating cover image" any more. The cover was made with
              * chapter 1; this step saves the story. */}
            Saving your chapters and starting narration
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Editor step
  // -----------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {/* Editor header */}
        <View style={styles.editorHeader}>
          <Pressable
            onPress={handleBackFromEditor}
            style={styles.editorBackBtn}
          >
            <ArrowLeft size={20} color={colors.ink} />
            <Text style={styles.editorBackText}>Back</Text>
          </Pressable>
          <Text style={styles.editorHeaderTitle}>Edit Draft</Text>
          <Pressable
            onPress={handleDoneWriting}
            style={styles.publishHeaderBtn}
          >
            <Text style={styles.publishHeaderBtnText}>Next</Text>
            <ChevronRight size={14} color={colors.surface} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.editorScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Story info card.
            *
            * The cover thumbnail appears here the moment chapter 1's art lands
            * — §10.4 puts the cover with chapter 1, and a writer who has to
            * reach the review step to find out whether their story has a face
            * has been kept waiting for information that arrived minutes ago.
            * Deliberately a thumbnail in a header the writer is already looking
            * at, and never a modal: this is a reveal, not an interruption to
            * somebody who is reading. */}
          <View style={styles.storyInfoCard}>
            {cover.coverImageUrl && (
              <Image
                source={{ uri: cover.coverImageUrl }}
                style={styles.editorCoverThumb}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel="Your story's cover"
                testID="editor-cover-thumb"
              />
            )}
            {editingTitle ? (
              <TextInput
                autoFocus
                value={storyTitle}
                onChangeText={setStoryTitle}
                onBlur={() => setEditingTitle(false)}
                style={styles.titleInput}
                placeholder="Give your story a title"
                placeholderTextColor={colors.tertiary}
              />
            ) : (
              <Pressable
                onPress={() => setEditingTitle(true)}
                style={styles.titleRow}
              >
                <Text style={styles.storyInfoTitle}>
                  {storyTitle || "Untitled"}
                </Text>
                <Edit3 size={16} color={colors.muted} />
              </Pressable>
            )}
            <View style={styles.storyInfoRow}>
              <View style={styles.genreBadge}>
                <Text style={styles.genreBadgeText}>
                  {genreLabels[story?.genre ?? draft.primaryGenre]}
                </Text>
              </View>
              <Text style={styles.storyInfoMeta}>
                {wordCount} words · {readTimeMin} min read
              </Text>
              {story && story.chapters.length > 1 && (
                <Text style={styles.storyInfoMeta}>
                  · {story.chapters.length} chapters
                </Text>
              )}
            </View>
          </View>

          {/* Chapter tabs (visible for series or multi-chapter stories) */}
          {story && (draft.isSeries || story.chapters.length > 1) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chapterTabRow}
            >
              {story.chapters.map((ch, i) => (
                <Pressable
                  key={ch.id}
                  onPress={() => switchToChapter(i)}
                  style={[styles.chapterTab, i === activeChapterIndex && styles.chapterTabActive]}
                >
                  <Text style={[styles.chapterTabText, i === activeChapterIndex && styles.chapterTabTextActive]}>
                    Ch {ch.chapterNumber}
                  </Text>
                </Pressable>
              ))}
              {story.chapters.length < maxChapters && (
                <Pressable
                  onPress={() => handleContinueStory(false)}
                  disabled={addingChapter}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: addingChapter, busy: addingChapter }}
                  accessibilityLabel="Add the next chapter, 1 credit"
                  style={styles.chapterTabAdd}
                >
                  <Plus size={14} color={colors.accent} />
                  <Text style={styles.chapterTabAddText}>
                    {addingChapter ? "..." : "Add"}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          )}

          {/* Chapter content */}
          <View style={styles.chapterSection}>
            {(draft.isSeries || (story && story.chapters.length > 1)) && (
              <Text style={styles.chapterHeading}>
                {story?.chapters[activeChapterIndex]?.title ?? "Chapter one"}
              </Text>
            )}

            {paragraphs.map((paragraph, index) => (
              <View key={index}>
                {/* Paragraph */}
                <Pressable
                  onPress={() =>
                    setSelectedIndex(
                      selectedIndex === index ? null : index,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedIndex === index }}
                  accessibilityLabel={`Paragraph ${index + 1}`}
                  style={[
                    styles.paragraphWrap,
                    selectedIndex === index && styles.paragraphSelected,
                  ]}
                >
                  {paragraph.isProcessing ? (
                    <Animated.View
                      style={{ opacity: pulseAnim }}
                    >
                      <Text style={styles.paragraphText}>
                        {paragraph.text || "Processing..."}
                      </Text>
                      <Text style={styles.processingLabel}>
                        Rewriting...
                      </Text>
                    </Animated.View>
                  ) : paragraph.isEditing ? (
                    <TextInput
                      multiline
                      autoFocus
                      value={paragraph.text}
                      onChangeText={(text) =>
                        updateParagraphText(index, text)
                      }
                      onBlur={() => toggleEditing(index)}
                      style={styles.paragraphEditInput}
                    />
                  ) : (
                    <Text style={styles.paragraphText}>
                      {paragraph.text || "(empty paragraph)"}
                    </Text>
                  )}
                </Pressable>

                {/* Action toolbar */}
                {selectedIndex === index &&
                  !paragraph.isProcessing &&
                  !paragraph.isEditing && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.actionToolbar}
                    >
                      <Pressable
                        onPress={() => toggleEditing(index)}
                        style={styles.actionChip}
                      >
                        <Edit3 size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Edit
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => runAiAction(index, "rewrite")}
                        style={styles.actionChip}
                      >
                        <Sparkles size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Rewrite
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => runAiAction(index, "expand")}
                        style={styles.actionChip}
                      >
                        <Plus size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Expand
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => runAiAction(index, "shorten")}
                        style={styles.actionChip}
                      >
                        <Scissors size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Shorten
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setCustomPromptIndex(index);
                          setSelectedIndex(index);
                        }}
                        style={styles.actionChip}
                      >
                        <MessageCircle size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Custom
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => deleteParagraph(index)}
                        style={styles.actionChip}
                      >
                        <Trash2 size={14} color={colors.heart} />
                        <Text
                          style={[
                            styles.actionChipText,
                            { color: colors.heart },
                          ]}
                        >
                          Delete
                        </Text>
                      </Pressable>
                    </ScrollView>
                  )}

                {/* Custom prompt */}
                {customPromptIndex === index && (
                  <View style={styles.customPromptWrap}>
                    <TextInput
                      autoFocus
                      value={customPromptText}
                      onChangeText={setCustomPromptText}
                      placeholder="e.g. make the character older, add more dialogue..."
                      placeholderTextColor={colors.tertiary}
                      style={styles.customPromptInput}
                      multiline
                    />
                    <View style={styles.customPromptActions}>
                      <Pressable
                        onPress={() => {
                          setCustomPromptIndex(null);
                          setCustomPromptText("");
                        }}
                        style={styles.customPromptCancel}
                      >
                        <Text style={styles.customPromptCancelText}>
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          if (customPromptText.trim()) {
                            runAiAction(
                              index,
                              "custom",
                              customPromptText.trim(),
                            );
                          }
                        }}
                        style={[
                          styles.customPromptSubmit,
                          !customPromptText.trim() && styles.customPromptSubmitDisabled,
                        ]}
                      >
                        <Text style={styles.customPromptSubmitText}>
                          Apply
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* End of chapter: say what happens next, then Continue.
            *
            * This sits at the foot of the chapter because that is where a
            * reader arrives with an opinion about where the story should go.
            * The tab-strip "+ Add" chip is the same action reached from the
            * top of the screen; both call `handleContinueStory`, so there is
            * one continuation path and one set of guards behind it.
            *
            * Only the last chapter gets it. Offering Continue while the reader
            * is back editing chapter 1 of 3 would append to the end of the
            * story from a position that does not look like the end.
            *
            * The copy below is literal English like the rest of this screen,
            * which has no `useTranslation` yet. Every string here already has
            * its EN/ES/PT key under `editor.whatHappensNext` so the screen-wide
            * i18n pass has nothing left to translate when it happens. */}
          {story
            && activeChapterIndex === story.chapters.length - 1
            && story.chapters.length < maxChapters && (
            <View style={styles.continueBlock}>
              <Text style={styles.continueHeading}>What happens next?</Text>
              <TextInput
                multiline
                value={nextInstruction}
                onChangeText={setNextInstruction}
                maxLength={MAX_NEXT_INSTRUCTION_CHARS}
                placeholder="Optional. Leave this blank and Katha decides."
                placeholderTextColor={colors.tertiary}
                style={styles.continueInput}
                accessibilityLabel="What happens next"
                accessibilityHint="Optional. Leave blank and Katha decides what the next chapter does."
                testID="next-instruction-input"
              />
              {/* The counter appears only in the last stretch before the cap.
                * A permanent countdown reads as a quota on a field most
                * readers should feel free to leave empty; it earns its place
                * once the next sentence is the one that gets truncated. */}
              {nextInstruction.length >= MAX_NEXT_INSTRUCTION_CHARS - 60 && (
                <Text style={styles.continueCounter}>
                  {MAX_NEXT_INSTRUCTION_CHARS - nextInstruction.length} characters left
                </Text>
              )}
              <Pressable
                onPress={() => handleContinueStory(false)}
                disabled={addingChapter}
                accessibilityRole="button"
                accessibilityState={{ disabled: addingChapter, busy: addingChapter }}
                accessibilityLabel={
                  addingChapter
                    ? "Writing the next chapter"
                    : `${continueLabel}, 1 credit`
                }
                style={[
                  styles.continueBtn,
                  addingChapter && styles.continueBtnBusy,
                ]}
                testID="continue-chapter-button"
              >
                <Text style={styles.continueBtnText}>
                  {addingChapter ? "Writing..." : `${continueLabel} · 1 credit`}
                </Text>
              </Pressable>
              <Text style={styles.continueNote}>
                Saying what happens next is free. The credit pays for the chapter.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom toolbar */}
        <View style={styles.bottomToolbar}>
          <Pressable onPress={addParagraph} style={styles.addParagraphBtn}>
            <Plus size={18} color={colors.accent} />
            <Text style={styles.addParagraphText}>Add paragraph</Text>
          </Pressable>
          <Text style={styles.bottomWordCount}>
            {wordCount} words
          </Text>
          <Pressable
            onPress={handleDoneWriting}
            style={styles.bottomPublishBtn}
          >
            <Text style={styles.bottomPublishBtnText}>Next</Text>
            <ChevronRight size={16} color={colors.surface} />
          </Pressable>
        </View>

        {/* Undo toast */}
        {undoTarget && (
          <View style={styles.undoToast}>
            <Text style={styles.undoToastText}>Paragraph updated</Text>
            <Pressable onPress={handleUndo} style={styles.undoBtn}>
              <Text style={styles.undoBtnText}>Undo</Text>
            </Pressable>
          </View>
        )}

        {/* (publish modal removed — replaced by cover + review steps) */}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Setup step
  setupScroll: {
    paddingBottom: 116,
  },
  setupHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  setupHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  eyebrow: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  h1: {
    marginTop: 3,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35,
  },
  formCard: {
    margin: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  fieldLabel: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
  },
  genreScrollWrap: {
    gap: spacing.sm,
    marginHorizontal: -spacing.lg,
  },
  genreScrollRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  genreChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  genreChipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  genreChipTextSelected: {
    color: colors.accent,
    fontWeight: "800",
  },
  toggleChipRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  toggleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  toggleChipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  toggleChipTextActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  seedInput: {
    minHeight: 118,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    padding: spacing.lg,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 16,
    textAlignVertical: "top",
  },
  seedHint: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
    fontWeight: "600",
    marginTop: -spacing.xs,
  },
  seedHintWarm: {
    color: colors.heart,
  },
  seedHintReady: {
    color: colors.success,
  },
  chipSectionLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0,
    marginBottom: spacing.sm,
  },
  premiseChipScroll: {
    gap: spacing.sm,
  },
  premiseChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 260,
  },
  premiseChipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  charactersHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addCharacterText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 13,
  },
  characterCard: {
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  characterTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  characterInput: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
  },
  characterNameInput: {
    flex: 1,
  },
  removeCharacterBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  heroLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  heroToggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  heroToggleTrackOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  heroToggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  heroToggleThumbOn: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
  },
  languageRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  languageChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  languageChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  languageChipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 14,
  },
  languageChipTextSelected: {
    color: colors.accent,
    fontWeight: "800",
  },
  seriesToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  seriesToggleLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  seriesHint: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  seriesInfoCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  seriesInfoText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  hintText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },

  // Editor step
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  editorBackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  editorBackText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 14,
  },
  editorHeaderTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 18,
  },
  publishHeaderBtn: {
    flexDirection: "row",
    flexShrink: 0,
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  publishHeaderBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 13,
  },
  editorScroll: {
    paddingBottom: 100,
  },
  storyInfoCard: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  storyInfoTitle: {
    flex: 1,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    lineHeight: 26,
  },
  titleInput: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    lineHeight: 26,
    padding: 0,
    margin: 0,
    minHeight: 30,
  },
  storyInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  genreBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  genreBadgeText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  storyInfoMeta: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  chapterSection: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  chapterHeading: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    marginBottom: spacing.sm,
  },
  paragraphWrap: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  paragraphSelected: {
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderColor: colors.accentSoft,
  },
  paragraphText: {
    fontFamily: fonts.reader,
    color: colors.ink,
    fontSize: 18,
    lineHeight: 31,
  },
  paragraphEditInput: {
    fontFamily: fonts.reader,
    color: colors.ink,
    fontSize: 18,
    lineHeight: 31,
    padding: 0,
    margin: 0,
    minHeight: 60,
    textAlignVertical: "top",
  },
  processingLabel: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  actionToolbar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionChipText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 13,
  },
  customPromptWrap: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  customPromptInput: {
    minHeight: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    textAlignVertical: "top",
  },
  customPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  customPromptCancel: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  customPromptCancelText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  customPromptSubmit: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  customPromptSubmitDisabled: {
    opacity: 0.5,
  },
  customPromptSubmitText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 13,
  },

  // Chapter tabs
  chapterTabRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chapterTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chapterTabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chapterTabText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 13,
  },
  chapterTabTextActive: {
    color: colors.surface,
    fontWeight: "800",
  },
  chapterTabAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: "dashed",
  },
  chapterTabAddText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 13,
  },

  // End-of-chapter continuation
  continueBlock: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  continueHeading: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 18,
  },
  continueInput: {
    minHeight: 76,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    textAlignVertical: "top",
  },
  continueCounter: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    textAlign: "right",
  },
  continueBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  continueBtnBusy: {
    opacity: 0.6,
  },
  continueBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 15,
  },
  continueNote: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },

  // Bottom toolbar
  bottomToolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  addParagraphBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  addParagraphText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 13,
  },
  bottomWordCount: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  bottomPublishBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  bottomPublishBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14,
  },

  // Undo toast
  undoToast: {
    position: "absolute",
    bottom: 80,
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  undoToastText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "700",
    fontSize: 14,
  },
  undoBtn: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  undoBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 13,
  },

  // Publishing step
  publishingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  publishingTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 24,
  },
  publishingSubtitle: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },

  // Cover controls (review step)
  coverActions: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  coverPromptInput: {
    width: "100%",
    minHeight: 44,
    maxHeight: 80,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    textAlignVertical: "top",
  },
  regenerateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  regenerateBtnText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 14,
  },
  coverHint: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 18,
  },
  coverErrorText: {
    fontFamily: fonts.ui,
    // `heart` is what every other failure line in the create flow uses
    // (StreamingProse, the portrait error, the credit warning). There is no
    // separate danger token and inventing one here would be design drift.
    color: colors.heart,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  regenerateBtnBusy: {
    opacity: 0.6,
  },
  // Review step
  reviewScroll: {
    paddingBottom: 120,
  },
  reviewCard: {
    flexDirection: "row",
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
    alignItems: "center",
  },
  reviewCoverMini: {
    // Larger than the 64x88 it was. This is now the writer's confirmation of a
    // real image rather than a decorative chip beside a title, and at 64 wide a
    // generated cover is unjudgeable. The 3:4 ratio matches the card slot the
    // story will occupy on the shelf.
    width: 84,
    height: 116,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    overflow: "hidden",
  },
  reviewCoverMiniTitle: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 15,
  },
  reviewCoverConceptTag: {
    // The concept card says what it is. §10.4 makes keeping it a legitimate
    // published look, which is only a choice if the writer can tell it apart
    // from a generated cover that has not arrived.
    marginTop: spacing.xs,
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1,
    opacity: 0.75,
  },
  reviewCoverStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reviewCoverStatusText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    flexShrink: 1,
  },
  editorCoverThumb: {
    // Small on purpose. This is a reveal inside a header the writer is already
    // looking at, not a hero: chapter 1's art arriving must not push the prose
    // they are editing down the screen.
    width: 44,
    height: 60,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
  },
  reviewCardMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  reviewCardTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 20,
    lineHeight: 24,
  },
  reviewCardSubtitle: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  reviewChapterList: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  reviewSectionTitle: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  reviewChapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  reviewChapterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  reviewChapterName: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  reviewChapterWords: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  reviewInfoCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  reviewInfoText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
    fontWeight: "500",
  },
  reviewActions: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  reviewSecondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewSecondaryBtnText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 14,
  },
  reviewPublishBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  reviewPublishBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14,
  },
});
