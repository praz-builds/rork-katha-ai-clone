import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import GeneratingOverlay from "@/components/GeneratingOverlay";
import {
  continueStory,
  createGenerationRequestId,
  editParagraph,
  generateStory,
  GenerationRequestError,
  publishStory,
} from "@/lib/api";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage";
import { MAX_CAST_SIZE } from "@/lib/pricing-limits";
import {
  colors,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  spacing,
} from "@/theme";
import type { AudienceMode, CreateDraft, Genre, IdentityLens, SpiceLevel, Story, TropeModule } from "@/types/domain";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type StudioStep = "setup" | "generating" | "editor" | "cover" | "review" | "publishing";

type DraftCharacter = {
  name: string;
  description: string;
  isHero: boolean;
  /** Voice, motivation, relationships. Drives the prose, never the portrait. */
  background?: string;
  /** Face, build, clothing. Drives the portrait, and detail in the prose. */
  appearance?: string;
};

type StudioDraft = {
  primaryGenre: Genre;
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  tropeModules: TropeModule[];
  seed: string;
  language: string;
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
  chapterLength?: "short" | "standard" | "long";
};

type ParagraphState = {
  text: string;
  isEditing: boolean;
  isProcessing: boolean;
  previousText?: string;
};

type CreateStudioProps = {
  credits: number;
  onCreditUsed: () => void;
  onPublished: (story: Story) => void;
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARACTERS = MAX_CAST_SIZE;

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
] as const;

const GENRE_EMOJI: Record<Genre, string> = {
  fantasy: "🐉",
  scifi: "🚀",
  thriller: "🔪",
  mystery: "🔍",
  horror: "👻",
  contemporary: "☕",
  historical: "🏛️",
  adventure: "🧭",
  comedy: "😂",
  poetry: "🪶",
  romance: "💕",
  romantasy: "✨",
  darkRomance: "🖤",
};

/** Split genres into 2 rows for horizontal scroll (Tumblr-style) */
const GENRE_ROW_1: Genre[] = [
  "fantasy", "romance", "thriller", "mystery", "horror", "scifi", "comedy",
];
const GENRE_ROW_2: Genre[] = [
  "romantasy", "darkRomance", "contemporary", "historical", "adventure", "poetry",
];

const GENRE_PREMISE_CHIPS: Record<Genre, string[]> = {
  romance: [
    "Two rival bakery owners share a vanilla supplier",
    "A letter meant for someone else changes everything",
    "They keep meeting at the same bookshop, different shelves",
  ],
  romantasy: [
    "A healer whose magic fails when she lies falls for a spy",
    "The crown prince's bodyguard can read his emotions",
    "Two rival mages share one spell book that only works together",
  ],
  darkRomance: [
    "She inherits a vineyard and the debt collector who comes with it",
    "A hostage negotiator and the voice on the other end of the line",
    "They were enemies before the arranged marriage",
  ],
  fantasy: [
    "A mapmaker discovers her ink reveals places that shouldn't exist",
    "The last dragon lives in a subway tunnel",
    "A city where memories are currency and hers are stolen",
  ],
  scifi: [
    "The AI therapist starts asking for advice",
    "A colony ship wakes the wrong passengers",
    "Time runs backward in one room of the space station",
  ],
  thriller: [
    "A forensic accountant finds her dead father laundered money for 30 years",
    "The witness protection agent is being followed",
    "Someone is leaving reviews of crimes before they happen",
  ],
  mystery: [
    "A traveler vanishes from a Marrakech hotel. Her sister follows clues.",
    "The detective's own alibi doesn't hold up",
    "Every tenant in the building heard something different that night",
  ],
  horror: [
    "The house was cheap. That should have been a warning.",
    "A lullaby only one child in the family can hear",
    "The mirror shows the room as it was twenty years ago",
  ],
  contemporary: [
    "A mother writes letters to the ocean. One day, it writes back.",
    "Two strangers share a hospital waiting room for seven hours",
    "She finds her grandmother's diary and a name no one recognizes",
  ],
  historical: [
    "A silk trader's daughter decodes a message hidden in fabric patterns",
    "The last letter from a soldier arrives fifty years late",
    "A clockmaker in 1920s Vienna builds a device no one ordered",
  ],
  adventure: [
    "A raft guide finds a map of a river that doesn't exist",
    "The compass points somewhere below the ocean floor",
    "A rescue mission into a cave system that keeps changing shape",
  ],
  comedy: [
    "A dog walker accidentally enters a dog into a beauty pageant",
    "The world's worst wizard gets hired by the king",
    "Two neighbors compete over the most mundane things imaginable",
  ],
  poetry: [
    "The last payphone in the city, and who calls it",
    "A love story told through weather reports",
    "What the tide pool remembers",
  ],
};

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
  tropeModules: [],
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
  isSeries: false,
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
  onCreditUsed,
  onPublished,
  onBack,
}: CreateStudioProps) {
  const [step, setStep] = useState<StudioStep>("setup");
  const [draft, setDraft] = useState<StudioDraft>(INITIAL_DRAFT);
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

  // Cover prompt
  const [coverPrompt, setCoverPrompt] = useState("");

  // Chapter state
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [addingChapter, setAddingChapter] = useState(false);
  const MAX_CHAPTERS = 7;

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
    draft.seed.trim().length >= 1 && credits > 0 && !busy;
  const briefStrength = getBriefStrength(draft);

  const wordCount = paragraphs.reduce((acc, p) => {
    return acc + p.text.split(/\s+/).filter(Boolean).length;
  }, 0);

  const readTimeMin = Math.max(1, Math.round(wordCount / 200));

  // -----------------------------------------------------------------------
  // Step 1: Generate draft
  // -----------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    if (busy) return;
    if (!canGenerate) {
      Alert.alert(
        credits > 0 ? "Add a story seed" : "Credits needed",
        credits > 0
          ? "Give Katha one clear idea to shape."
          : "You need 1 credit to generate.",
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
      audienceMode: draft.audienceMode,
      spiceLevel: draft.spiceLevel,
      identityLenses: draft.identityLenses,
      tropeModules: draft.tropeModules,
      seed: draft.seed,
      language: draft.language,
      // Belt and braces with the clamp in loadDraft: validation.ts enforces the
      // same cap, and a request over it is a 400 rather than a truncation.
      characters: draft.characters.slice(0, MAX_CHARACTERS),
      isSeries: draft.isSeries,
    };

    try {
      const generated = await generateStory(createDraft, requestId);
      const firstChapter = generated.chapters[0];
      if (!firstChapter) {
        throw new Error("Story generation returned no chapter");
      }
      onCreditUsed();
      clearDraft();
      setStory(generated);
      setStoryTitle(generated.title);
      setActiveChapterIndex(0);
      setParagraphs(
        firstChapter.paragraphs.map((text) => ({
          text,
          isEditing: false,
          isProcessing: false,
        })),
      );
      setStep("editor");
    } catch (error) {
      if (
        error instanceof GenerationRequestError &&
        error.resetRequestId
      ) {
        requestIdRef.current = null;
      }
      setStep("setup");
      Alert.alert(
        "Could not create story",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [canGenerate, credits, draft]);

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
          result = await editParagraph(
            story.id,
            chapter.id,
            index,
            instruction as "rewrite" | "expand" | "shorten" | "custom",
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
        setParagraphs((prev) =>
          prev.map((p, i) =>
            i === index ? { ...p, isProcessing: false } : p,
          ),
        );
        Alert.alert("Edit failed", "Could not apply the edit. Please try again.");
      }

      setSelectedIndex(null);
      setCustomPromptIndex(null);
      setCustomPromptText("");
    },
    [paragraphs, showUndoToast, activeChapterIndex],
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
  // Step transitions: Editor → Cover → Review → Publish
  // -----------------------------------------------------------------------

  const handleDoneWriting = useCallback(() => {
    saveEditorToStory();
    setStep("cover");
  }, [saveEditorToStory]);

  const handleCoverNext = useCallback(() => {
    setStep("review");
  }, []);

  const handleBackToCover = useCallback(() => {
    setStep("cover");
  }, []);

  const handleBackToEditor = useCallback(() => {
    setStep("editor");
  }, []);

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

    const updatedChapters = edited.chapters.map((ch) => ({ ...ch, isPublished: true }));

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
        "Couldn't publish",
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
  }, [story, storyTitle, onPublished, saveEditorToStory]);

  const handleContinueStory = useCallback(async (isFinale = false) => {
    if (!story || addingChapter) return;
    if (story.chapters.length >= MAX_CHAPTERS) {
      Alert.alert("Series complete", "This story has reached its maximum of 7 chapters.");
      return;
    }
    if (credits < 1) {
      Alert.alert("Credits needed", "You need 1 credit to add a chapter.");
      return;
    }

    // Save current editor state before generating next chapter
    const savedStory = saveEditorToStory() ?? story;

    setAddingChapter(true);
    setStep("generating");

    const requestId = createGenerationRequestId();
    const nextChapterNum = savedStory.chapters.length + 1;
    const shouldFinale = isFinale || nextChapterNum >= MAX_CHAPTERS;

    try {
      const { chapter } = await continueStory(savedStory.id, requestId, shouldFinale, nextChapterNum);
      onCreditUsed();

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
      setStep("editor");
    } catch (error) {
      setStep("editor");
      Alert.alert(
        "Could not continue story",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setAddingChapter(false);
    }
  }, [story, addingChapter, credits, onCreditUsed, saveEditorToStory]);

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

              {/* Mode toggles — single-select: Kids, LGBTQ+, Vampire */}
              <View style={styles.toggleChipRow}>
                {([
                  { key: "kids", label: "🧒 Kids" },
                  { key: "queer", label: "🏳️‍🌈 LGBTQ+" },
                  { key: "vampire", label: "🧛 Vampire" },
                ] as const).map((chip) => {
                  const isActive =
                    chip.key === "kids" ? draft.audienceMode === "kids" :
                    chip.key === "queer" ? draft.identityLenses.includes("queer") :
                    draft.tropeModules.includes("vampire");
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => setDraft((prev) => {
                        // Single-select: deselect all, then toggle the tapped one
                        const base = { ...prev, audienceMode: "adult" as const, identityLenses: [] as IdentityLens[], tropeModules: [] as TropeModule[] };
                        if (isActive) return base; // Deselect
                        if (chip.key === "kids") return { ...base, audienceMode: "kids" as const };
                        if (chip.key === "queer") return { ...base, identityLenses: ["queer" as const] };
                        return { ...base, tropeModules: ["vampire" as const] };
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
                    {GENRE_PREMISE_CHIPS[draft.primaryGenre].map((premise) => (
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
    return (
      <SafeAreaView style={styles.flex}>
        <GeneratingOverlay
          genre={draft.primaryGenre}
          mode={addingChapter ? (story && story.chapters.length + 1 >= MAX_CHAPTERS ? "finale" : "chapter") : "story"}
        />
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Cover preview step
  // -----------------------------------------------------------------------

  if (step === "cover") {
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
          <Text style={styles.editorHeaderTitle}>Cover Preview</Text>
          <Pressable onPress={handleCoverNext} style={styles.publishHeaderBtn}>
            <Text style={styles.publishHeaderBtnText}>Next</Text>
            <ChevronRight size={14} color={colors.surface} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.coverScroll}>
          {/* Cover card with genre gradient */}
          <View style={styles.coverCardWrap}>
            <View style={[styles.coverCard, { backgroundColor: gradient[1] }]}>
              <View style={[styles.coverGradientTop, { backgroundColor: gradient[0] }]} />
              <View style={styles.coverTextOverlay}>
                <Text style={styles.coverGenreLabel}>
                  {genreLabels[genre]}
                </Text>
                <Text style={styles.coverTitle}>
                  {storyTitle || "Untitled"}
                </Text>
                {story && story.chapters.length > 1 && (
                  <Text style={styles.coverChapterCount}>
                    {story.chapters.length} chapters
                  </Text>
                )}
              </View>
              <View style={[styles.coverGradientBottom, { backgroundColor: gradient[2] }]} />
            </View>
          </View>

          {/* Cover prompt + regenerate */}
          <View style={styles.coverActions}>
            <TextInput
              value={coverPrompt}
              onChangeText={setCoverPrompt}
              placeholder="Describe your ideal cover (optional)"
              placeholderTextColor={colors.tertiary}
              style={styles.coverPromptInput}
              multiline
            />
            <Pressable
              style={[styles.regenerateBtn, { opacity: 0.5 }]}
              disabled
              accessibilityRole="button"
              accessibilityLabel="Regenerate cover — available after publishing"
            >
              <RefreshCw size={16} color={colors.accent} />
              <Text style={styles.regenerateBtnText}>Regenerate Cover</Text>
            </Pressable>
            <Text style={styles.coverHint}>
              Cover generation uses your prompt above.{"\n"}
              A unique AI cover will be created when you publish.
            </Text>
          </View>

          {/* Story summary */}
          <View style={styles.coverSummary}>
            <View style={styles.coverSummaryRow}>
              <Text style={styles.coverSummaryLabel}>Title</Text>
              <Text style={styles.coverSummaryValue}>{storyTitle || "Untitled"}</Text>
            </View>
            <View style={styles.coverSummaryRow}>
              <Text style={styles.coverSummaryLabel}>Genre</Text>
              <Text style={styles.coverSummaryValue}>{genreLabels[genre]}</Text>
            </View>
            <View style={styles.coverSummaryRow}>
              <Text style={styles.coverSummaryLabel}>Words</Text>
              <Text style={styles.coverSummaryValue}>{totalWords.toLocaleString()}</Text>
            </View>
            {story && story.chapters.length > 1 && (
              <View style={styles.coverSummaryRow}>
                <Text style={styles.coverSummaryLabel}>Chapters</Text>
                <Text style={styles.coverSummaryValue}>{story.chapters.length}</Text>
              </View>
            )}
          </View>
        </ScrollView>
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
          <Pressable onPress={handleBackToCover} style={styles.editorBackBtn}>
            <ArrowLeft size={20} color={colors.ink} />
            <Text style={styles.editorBackText}>Back</Text>
          </Pressable>
          <Text style={styles.editorHeaderTitle}>Review</Text>
          <View style={{ width: 80 }} />
        </View>

        <ScrollView contentContainerStyle={styles.reviewScroll}>
          {/* Mini cover + title */}
          <View style={styles.reviewCard}>
            <View style={[styles.reviewCoverMini, { backgroundColor: gradient[1] }]}>
              <Text style={styles.reviewCoverMiniTitle} numberOfLines={2}>
                {storyTitle || "Untitled"}
              </Text>
            </View>
            <View style={styles.reviewCardMeta}>
              <Text style={styles.reviewCardTitle}>{storyTitle || "Untitled"}</Text>
              <Text style={styles.reviewCardSubtitle}>
                {genreLabels[genre]} · {totalWords.toLocaleString()} words
              </Text>
            </View>
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
            <Text style={styles.reviewInfoText}>
              {"\u2022"} A unique AI cover image will be generated{"\n"}
              {"\u2022"} Audio narration will be created in two voices{"\n"}
              {"\u2022"} Your story will be visible to all readers
            </Text>
          </View>
        </ScrollView>

        {/* Bottom actions */}
        <View style={styles.reviewActions}>
          <Pressable onPress={handleBackToEditor} style={styles.reviewSecondaryBtn}>
            <Text style={styles.reviewSecondaryBtnText}>Back to Editor</Text>
          </Pressable>
          <Pressable onPress={handlePublish} style={styles.reviewPublishBtn}>
            <Text style={styles.reviewPublishBtnText}>Publish</Text>
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
            Publishing your story...
          </Text>
          <Text style={styles.publishingSubtitle}>
            Generating cover image and audio
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
          {/* Story info card */}
          <View style={styles.storyInfoCard}>
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
              {story.chapters.length < MAX_CHAPTERS && (
                <Pressable
                  onPress={() => handleContinueStory(false)}
                  disabled={addingChapter}
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

  // Cover preview step
  coverScroll: {
    paddingBottom: spacing.huge,
  },
  coverCardWrap: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  coverCard: {
    width: 220,
    height: 320,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  coverGradientTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "35%",
    opacity: 0.7,
  },
  coverGradientBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "25%",
    opacity: 0.8,
  },
  coverTextOverlay: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  coverGenreLabel: {
    fontFamily: fonts.ui,
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  coverTitle: {
    fontFamily: fonts.display,
    color: "#FFFFFF",
    fontSize: 22,
    textAlign: "center",
    lineHeight: 28,
  },
  coverChapterCount: {
    fontFamily: fonts.ui,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
  },
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
  coverSummary: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  coverSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  coverSummaryLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  coverSummaryValue: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
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
    width: 64,
    height: 88,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  reviewCoverMiniTitle: {
    fontFamily: fonts.display,
    color: "#FFFFFF",
    fontSize: 10,
    textAlign: "center",
    lineHeight: 13,
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
