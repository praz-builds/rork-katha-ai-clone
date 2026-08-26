import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
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
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react-native";
import {
  Chip,
  CreditPill,
  GenreSwatch,
  PrimaryButton,
} from "@/components/KathaPrimitives";
import {
  createGenerationRequestId,
  generateStory,
  GenerationRequestError,
} from "@/lib/api";
import { genres } from "@/data/seed";
import {
  colors,
  fonts,
  genreLabels,
  radius,
  spacing,
} from "@/theme";
import type { CreateDraft, Genre, Story } from "@/types/domain";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type StudioStep = "setup" | "editor" | "publishing";

type DraftCharacter = {
  name: string;
  description: string;
  isHero: boolean;
};

type StudioDraft = {
  genre: Genre;
  seed: string;
  language: string;
  characters: DraftCharacter[];
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

const MAX_CHARACTERS = 5;

const TONE_OPTIONS = [
  "darker",
  "lighter",
  "more poetic",
  "more dramatic",
  "simpler",
] as const;

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "pt", label: "Portuguese", flag: "🇧🇷" },
] as const;

const INITIAL_DRAFT: StudioDraft = {
  genre: "fantasy",
  seed: "",
  language: "English",
  characters: [
    { name: "Mira", description: "Curious, stubborn, quietly brave", isHero: true },
  ],
};

// ---------------------------------------------------------------------------
// Mock AI edit (backend endpoint does not exist yet)
// ---------------------------------------------------------------------------

async function mockEditParagraph(
  paragraphText: string,
  instruction: string,
  _customNote?: string,
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (instruction === "expand") {
    return (
      paragraphText +
      " The details sharpened as the moment stretched on."
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
  // tone / custom — return with a small suffix for demo purposes
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
  const [showTonePicker, setShowTonePicker] = useState(false);
  const [customPromptIndex, setCustomPromptIndex] = useState<number | null>(null);
  const [customPromptText, setCustomPromptText] = useState("");

  // Undo toast
  const [undoTarget, setUndoTarget] = useState<{
    index: number;
    previous: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Publish modal
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishing, setPublishing] = useState(false);

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

  const canGenerate =
    draft.seed.trim().length > 3 && credits > 0 && !busy;

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
    const requestId =
      requestIdRef.current ?? createGenerationRequestId();
    requestIdRef.current = requestId;

    const createDraft: CreateDraft = {
      genre: draft.genre,
      seed: draft.seed,
      language: draft.language,
      characters: draft.characters,
    };

    try {
      const generated = await generateStory(createDraft, requestId);
      const firstChapter = generated.chapters[0];
      if (!firstChapter) {
        throw new Error("Story generation returned no chapter");
      }
      onCreditUsed();
      setStory(generated);
      setStoryTitle(generated.title);
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
      setParagraphs((prev) =>
        prev.map((p, i) =>
          i === index ? { ...p, isProcessing: true } : p,
        ),
      );

      try {
        const result = await mockEditParagraph(
          previousText,
          instruction,
          customNote,
        );
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
        setParagraphs((prev) =>
          prev.map((p, i) =>
            i === index ? { ...p, isProcessing: false } : p,
          ),
        );
        Alert.alert("Edit failed", "Could not apply the edit. Please try again.");
      }

      setSelectedIndex(null);
      setShowTonePicker(false);
      setCustomPromptIndex(null);
      setCustomPromptText("");
    },
    [paragraphs, showUndoToast],
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
  // Step 3: Publish
  // -----------------------------------------------------------------------

  const handlePublish = useCallback(async () => {
    if (!story) return;
    setShowPublishModal(false);
    setPublishing(true);
    setStep("publishing");

    // Simulate cover generation delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const publishedStory: Story = {
      ...story,
      title: storyTitle || story.title,
      chapters: [
        {
          ...story.chapters[0],
          paragraphs: paragraphs.map((p) => p.text).filter(Boolean),
          isPublished: true,
        },
      ],
    };

    setPublishing(false);
    onPublished(publishedStory);
  }, [story, storyTitle, paragraphs, onPublished]);

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

  const addCharacter = useCallback(() => {
    if (draft.characters.length >= MAX_CHARACTERS) return;
    setDraft((prev) => ({
      ...prev,
      characters: [
        ...prev.characters,
        { name: "", description: "", isHero: false },
      ],
    }));
  }, [draft.characters.length]);

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
              <View>
                <Text style={styles.eyebrow}>Create</Text>
                <Text style={styles.h1}>Shape a new story</Text>
              </View>
              <CreditPill credits={credits} />
            </View>

            <View style={styles.formCard}>
              {/* Genre picker */}
              <Text style={styles.fieldLabel}>Genre</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.genreRow}
              >
                {genres.slice(0, 12).map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setDraft((prev) => ({
                        ...prev,
                        genre: item,
                      }));
                    }}
                    style={[
                      styles.genreChoice,
                      draft.genre === item && styles.genreChoiceSelected,
                    ]}
                  >
                    <GenreSwatch genre={item} />
                    <Text style={styles.genreChoiceText}>
                      {genreLabels[item]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Story seed */}
              <Text style={styles.fieldLabel}>Story seed</Text>
              <TextInput
                multiline
                value={draft.seed}
                onChangeText={(seed) =>
                  setDraft((prev) => ({ ...prev, seed }))
                }
                placeholder="A lighthouse keeper receives a letter from the future..."
                placeholderTextColor={colors.tertiary}
                style={styles.seedInput}
              />

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
                    {index > 0 && (
                      <Pressable
                        onPress={() => removeCharacter(index)}
                        style={styles.removeCharacterBtn}
                      >
                        <X size={16} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.characterTopRow}>
                    <TextInput
                      value={character.description}
                      onChangeText={(description) =>
                        updateCharacter(index, "description", description)
                      }
                      placeholder="Traits, desire, or secret"
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
                    <Switch
                      value={character.isHero}
                      onValueChange={(value) =>
                        updateCharacter(index, "isHero", value)
                      }
                      trackColor={{
                        false: colors.border,
                        true: colors.accent,
                      }}
                      thumbColor={colors.surface}
                    />
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

              {/* Generate button */}
              <PrimaryButton onPress={handleGenerate}>
                {busy
                  ? "Generating..."
                  : "Generate Draft — 1 credit"}
              </PrimaryButton>
              {!canGenerate && !busy && credits > 0 && draft.seed.trim().length <= 3 && (
                <Text style={styles.hintText}>
                  Write at least 4 characters in your story seed
                </Text>
              )}
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
            Generating cover image
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
            onPress={() => setShowPublishModal(true)}
            style={styles.publishHeaderBtn}
          >
            <Text style={styles.publishHeaderBtnText}>Publish</Text>
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
              />
            ) : (
              <Pressable onPress={() => setEditingTitle(true)}>
                <Text style={styles.storyInfoTitle}>
                  {storyTitle || "Untitled"}
                </Text>
              </Pressable>
            )}
            <View style={styles.storyInfoRow}>
              <View style={styles.genreBadge}>
                <Text style={styles.genreBadgeText}>
                  {genreLabels[story?.genre ?? draft.genre]}
                </Text>
              </View>
              <Text style={styles.storyInfoMeta}>
                {wordCount} words · {readTimeMin} min read
              </Text>
            </View>
          </View>

          {/* Chapter content */}
          <View style={styles.chapterSection}>
            <Text style={styles.chapterHeading}>
              {story?.chapters[0].title ?? "Chapter one"}
            </Text>

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
                        <Edit3 size={14} color={colors.accent} />
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
                          setShowTonePicker(true);
                          setSelectedIndex(index);
                        }}
                        style={styles.actionChip}
                      >
                        <Type size={14} color={colors.accent} />
                        <Text style={styles.actionChipText}>
                          Change tone
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleEditing(index)}
                        style={styles.actionChip}
                      >
                        <Edit3 size={14} color={colors.ink} />
                        <Text style={styles.actionChipText}>
                          Edit
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
                    </ScrollView>
                  )}

                {/* Tone picker */}
                {showTonePicker && selectedIndex === index && (
                  <View style={styles.tonePicker}>
                    {TONE_OPTIONS.map((tone) => (
                      <Pressable
                        key={tone}
                        onPress={() => {
                          setShowTonePicker(false);
                          runAiAction(index, "change_tone", tone);
                        }}
                        style={styles.toneOption}
                      >
                        <Text style={styles.toneOptionText}>
                          {tone.charAt(0).toUpperCase() + tone.slice(1)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
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
            onPress={() => setShowPublishModal(true)}
            style={styles.bottomPublishBtn}
          >
            <Text style={styles.bottomPublishBtnText}>Publish</Text>
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

        {/* Publish confirmation modal */}
        <Modal
          visible={showPublishModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPublishModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Ready to publish?</Text>
              <Text style={styles.modalBody}>
                Your story will be visible to all readers. A cover image
                will be generated automatically.
              </Text>
              <View style={styles.modalTitlePreview}>
                <Text style={styles.modalTitlePreviewLabel}>
                  Title
                </Text>
                <Text style={styles.modalTitlePreviewValue}>
                  {storyTitle || "Untitled"}
                </Text>
              </View>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setShowPublishModal(false)}
                  style={styles.modalSecondaryBtn}
                >
                  <Text style={styles.modalSecondaryBtnText}>
                    Keep editing
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handlePublish}
                  style={styles.modalPrimaryBtn}
                >
                  <Text style={styles.modalPrimaryBtnText}>
                    Publish
                  </Text>
                  <Check size={16} color={colors.surface} />
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  genreRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  genreChoice: {
    minWidth: 132,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  genreChoiceSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  genreChoiceText: {
    fontFamily: fonts.ui,
    color: colors.ink,
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
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
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
  storyInfoTitle: {
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
  tonePicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  toneOption: {
    paddingHorizontal: spacing.md,
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  toneOptionText: {
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

  // Publish modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    padding: spacing.xxl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    gap: spacing.lg,
  },
  modalTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 24,
  },
  modalBody: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  modalTitlePreview: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    gap: spacing.xs,
  },
  modalTitlePreviewLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  modalTitlePreviewValue: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 18,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  modalSecondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSecondaryBtnText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 14,
  },
  modalPrimaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  modalPrimaryBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14,
  },
});
