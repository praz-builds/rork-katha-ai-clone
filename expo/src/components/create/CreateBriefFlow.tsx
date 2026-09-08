import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Lightbulb,
  Plus,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react-native";
import { CreditPill } from "@/components/KathaPrimitives";
import { PlanSection } from "@/components/create/PlanSection";
import {
  GENRE_EMOJI,
  GENRE_MOMENT_SUGGESTIONS,
  GENRE_STARTERS,
} from "@/lib/genre-content";
import * as storyApi from "@/lib/api";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme";
import type { AudienceMode, CreateDraft, Genre, SpiceLevel } from "@/types/domain";

type CharacterDraft = CreateDraft["characters"][number];

export type StudioCreateDraft = Omit<CreateDraft, "visibility"> & {
  isSeries: boolean;
  /** Publish intent only. Generation remains private until the final save. */
  visibility: "private" | "public";
};

type CreateStage = "main" | "character";

type Props = {
  credits: number;
  isAnonymous: boolean;
  draft: StudioCreateDraft;
  setDraft: Dispatch<SetStateAction<StudioCreateDraft>>;
  onGenerate: () => void;
  onBack: () => void;
};

const ADULT_GENRES: Genre[] = [
  "romance", "romantasy", "fantasy", "scifi", "thriller", "mystery",
  "horror", "contemporary", "historical", "adventure", "comedy", "poetry",
  "darkRomance",
];
const KIDS_GENRES: Genre[] = ["fantasy", "adventure", "mystery", "comedy", "contemporary", "poetry", "historical"];
const VALUES = [
  { value: "kindness", label: "Kindness" },
  { value: "courage", label: "Courage" },
  { value: "honesty", label: "Honesty" },
  { value: "patience", label: "Patience" },
  { value: "friendship", label: "Friendship" },
];
/**
 * The floor on an idea, shared with onboarding.
 *
 * Restored after being cut: the argument for removing it was that a character
 * counter teaches padding rather than structure, and that is true of a
 * *counter*. It is not true of a floor. Below roughly forty characters there is
 * not enough in the sentence for the shaping call to infer a world, a cast or a
 * plan from, so the user gets a generic blueprint and reads it as the product's
 * ceiling. The brief-strength meter still does the teaching; this only stops
 * the one case where the flow cannot work at all.
 */
export const MIN_IDEA_LENGTH = 40;

/**
 * Chapter length, labelled by the number a reader feels.
 *
 * Derived from the word bands in `_shared/types.ts` at 260 wpm, the measured
 * mean silent reading rate for adult English fiction (Brysbaert 2019, 190
 * studies, 18,573 participants). Word counts stay out of the interface: they
 * are unverified against real generations, and a number printed beside a
 * control is read as a promise.
 */
export const CHAPTER_LENGTHS = [
  { id: "short", label: "Short", minutes: 3 },
  { id: "standard", label: "Standard", minutes: 5 },
  { id: "long", label: "Long", minutes: 9 },
] as const;

const LENGTHS = ["short", "standard", "long"] as const;
const CHAPTER_COUNTS = [3, 7, 15] as const;
// Two tiers, and there is no third. The greyed-out "Explicit" chip that used
// to sit here advertised a tier the backend has retired: it promised the
// writer something the product will not ship, which is worse than not showing
// it at all. Heat above steamy is not a locked feature, it is not a feature.
const SPICE_OPTIONS: { value: SpiceLevel; label: string; icon: string }[] = [
  { value: "sweet", label: "Sweet", icon: "🍯" },
  { value: "steamy", label: "Steamy", icon: "🔥" },
];

function useMotionAndHaptics() {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => listener?.remove();
  }, []);
  const select = useCallback(() => {
    if (!reduceMotion && Platform.OS !== "web") void Haptics.selectionAsync();
  }, [reduceMotion]);
  const confirm = useCallback(() => {
    if (!reduceMotion && Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [reduceMotion]);
  return { reduceMotion, select, confirm };
}

function briefStrength(draft: StudioCreateDraft) {
  const slots = [draft.seed.trim(), draft.whereAndWhen?.trim(), draft.characters.some((item) => item.name.trim()), draft.moments?.length].filter(Boolean).length;
  if (slots >= 4) return { label: "Rich", detail: "Katha has plenty to work with.", slots };
  if (slots === 3) return { label: "Strong", detail: "This will sound like yours.", slots };
  if (slots === 2) return { label: "Good", detail: "Enough to write from.", slots };
  return { label: "Sparse", detail: "Katha will invent most of this. That can be good.", slots };
}

export default function CreateBriefFlow({ credits, isAnonymous, draft, setDraft, onGenerate, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<CreateStage>("main");
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [momentInput, setMomentInput] = useState("");
  const [editingCharacterIndex, setEditingCharacterIndex] = useState<number | null>(null);
  const [characterBuffer, setCharacterBuffer] = useState<CharacterDraft>({ name: "", description: "", background: "", appearance: "", isHero: false });
  const fade = useRef(new Animated.Value(1)).current;
  const { reduceMotion, select, confirm } = useMotionAndHaptics();
  const allowedGenres = draft.audienceMode === "kids" ? KIDS_GENRES : ADULT_GENRES;
  const maxMoments = 5;
  const strength = briefStrength(draft);
  const isCharacter = stage === "character";

  useEffect(() => {
    if (reduceMotion || stage === "character") return;
    fade.setValue(0.55);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fade, reduceMotion, stage]);

  const chooseAudience = useCallback((audienceMode: AudienceMode) => {
    select();
    setDraft((previous) => {
      const primaryGenre = audienceMode === "kids" && !KIDS_GENRES.includes(previous.primaryGenre) ? "adventure" : previous.primaryGenre;
      return {
        ...previous,
        audienceMode,
        primaryGenre,
        spiceLevel: audienceMode === "kids" ? "sweet" : previous.spiceLevel,
        chapterLength: audienceMode === "kids" ? "short" : previous.chapterLength,
        storyValues: audienceMode === "kids" ? previous.storyValues ?? [] : [],
      };
    });
  }, [select, setDraft]);

  const startCharacter = useCallback((index?: number) => {
    if (typeof index === "number") {
      setEditingCharacterIndex(index);
      setCharacterBuffer(draft.characters[index]);
    } else {
      if (draft.characters.length >= 3) return;
      setEditingCharacterIndex(null);
      setCharacterBuffer({ name: "", description: "", background: "", appearance: "", isHero: draft.characters.length === 0 });
    }
    confirm();
    setStage("character");
  }, [confirm, draft.characters]);

  const saveCharacter = useCallback(() => {
    if (!characterBuffer.name.trim()) return;
    setDraft((previous) => {
      const next = { ...characterBuffer, name: characterBuffer.name.trim(), description: characterBuffer.description.trim() };
      const characters = editingCharacterIndex === null
        ? [...previous.characters, next]
        : previous.characters.map((item, index) => index === editingCharacterIndex ? next : item);
      const requestedLeadIndex = editingCharacterIndex ?? characters.length - 1;
      const existingLeadIndex = characters.findIndex((item) => item.isHero);
      const leadIndex = next.isHero
        ? requestedLeadIndex
        : existingLeadIndex >= 0
        ? existingLeadIndex
        : 0;
      return {
        ...previous,
        characters: characters.map((item, index) => ({
          ...item,
          isHero: index === leadIndex,
        })),
      };
    });
    confirm();
    setStage("main");
  }, [characterBuffer, confirm, editingCharacterIndex, setDraft]);

  const deleteCharacter = useCallback((index: number) => {
    setDraft((previous) => {
      const characters = previous.characters.filter((_, itemIndex) => itemIndex !== index);
      const existingLeadIndex = characters.findIndex((item) => item.isHero);
      return {
        ...previous,
        characters: characters.map((item, itemIndex) => ({
          ...item,
          isHero: itemIndex === (existingLeadIndex >= 0 ? existingLeadIndex : 0),
        })),
      };
    });
    confirm();
    setStage("main");
  }, [confirm, setDraft]);

  const createCharacterImage = useCallback(async () => {
    const name = characterBuffer.name.trim();
    if (!name || characterBuffer.portraitStatus === "generating") return;
    setCharacterBuffer((previous) => ({
      ...previous,
      portraitStatus: "generating",
    }));
    try {
      const { url } = await storyApi.generateCharacterImage({
        requestId: storyApi.createGenerationRequestId(),
        name,
        description: characterBuffer.description,
        appearance: characterBuffer.appearance,
      });
      setCharacterBuffer((previous) => ({
        ...previous,
        portraitUrl: url,
        portraitStatus: "ready",
      }));
      confirm();
    } catch {
      setCharacterBuffer((previous) => ({
        ...previous,
        portraitStatus: "failed",
      }));
    }
  }, [characterBuffer, confirm]);

  const addMoment = useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    setDraft((previous) => {
      const moments = previous.moments ?? [];
      if (moments.length >= 5 || moments.includes(next)) return previous;
      return { ...previous, moments: [...moments, next] };
    });
    setMomentInput("");
    select();
  }, [select, setDraft]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Animated.View style={[styles.flex, { opacity: fade }]}>
          <StorySetupScreen
            draft={draft}
            allowedGenres={allowedGenres}
            maxMoments={maxMoments}
            moreOptionsOpen={moreOptionsOpen}
            momentInput={momentInput}
            onBack={onBack}
            onSetDraft={setDraft}
            onAudience={chooseAudience}
            onAddCharacter={startCharacter}
            onEditCharacter={startCharacter}
            onAddMoment={addMoment}
            onMomentInput={setMomentInput}
            onToggleOptions={() => { select(); setMoreOptionsOpen((open) => !open); }}
            isAnonymous={isAnonymous}
            strength={strength}
            credits={credits}
            onCreate={onGenerate}
            onSelect={select}
          />
        </Animated.View>
      </KeyboardAvoidingView>
      <Modal animationType="slide" presentationStyle="fullScreen" visible={isCharacter} onRequestClose={() => setStage("main")}>
        <CharacterCraftScreen
          character={characterBuffer}
          onChange={setCharacterBuffer}
          onBack={() => setStage("main")}
          onSave={saveCharacter}
          onDelete={editingCharacterIndex === null ? undefined : () => deleteCharacter(editingCharacterIndex)}
          onCreateImage={createCharacterImage}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </Modal>
    </View>
  );
}

function StorySetupScreen({
  draft,
  allowedGenres,
  maxMoments,
  moreOptionsOpen,
  momentInput,
  isAnonymous,
  strength,
  credits,
  onBack,
  onSetDraft,
  onAudience,
  onAddCharacter,
  onEditCharacter,
  onAddMoment,
  onMomentInput,
  onToggleOptions,
  onCreate,
  onSelect,
}: {
  draft: StudioCreateDraft;
  allowedGenres: Genre[];
  maxMoments: number;
  moreOptionsOpen: boolean;
  momentInput: string;
  isAnonymous: boolean;
  strength: ReturnType<typeof briefStrength>;
  credits: number;
  onBack: () => void;
  onSetDraft: Dispatch<SetStateAction<StudioCreateDraft>>;
  onAudience: (mode: AudienceMode) => void;
  onAddCharacter: () => void;
  onEditCharacter: (index: number) => void;
  onAddMoment: (value: string) => void;
  onMomentInput: (value: string) => void;
  onToggleOptions: () => void;
  onCreate: () => void;
  onSelect: () => void;
}) {
  const [genreOpen, setGenreOpen] = useState(false);
  const update = (patch: Partial<StudioCreateDraft>) => onSetDraft((previous) => ({ ...previous, ...patch }));
  const hasCredits = credits >= 3;
  const hasPendingCharacterImage = draft.characters.some((character) => character.portraitStatus === "generating");
  const ideaReady = draft.seed.trim().length >= MIN_IDEA_LENGTH;
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.iconButton}><ArrowLeft size={20} color={colors.ink} /></Pressable>
        <CreditPill credits={credits} />
      </View>
      <View style={styles.parentControls}>
        <View style={styles.kidsMode}>
          <Switch value={draft.audienceMode === "kids"} onValueChange={(enabled) => onAudience(enabled ? "kids" : "adult")} trackColor={{ false: colors.borderStrong, true: colors.accent }} thumbColor={colors.surface} accessibilityLabel="Kids Mode" />
          <View style={styles.kidsModeLabel}>
            <Sparkles size={15} color={draft.audienceMode === "kids" ? colors.accent : colors.tertiary} />
            <Text style={[styles.kidsModeText, draft.audienceMode === "kids" && styles.kidsModeTextActive]}>Kids Mode</Text>
          </View>
        </View>
        <View style={styles.genreControl}>
          <Pressable onPress={() => { onSelect(); setGenreOpen((open) => !open); }} accessibilityRole="button" accessibilityLabel="Genre" accessibilityState={{ expanded: genreOpen }} style={styles.genreButton}>
            <Text style={styles.genreIcon}>{GENRE_EMOJI[draft.primaryGenre]}</Text>
            <Text numberOfLines={1} style={styles.genreButtonText}>{genreLabels[draft.primaryGenre]}</Text>
            <ChevronDown size={16} color={colors.accent} />
          </Pressable>
          {genreOpen ? (
            <View style={styles.genreMenu}>
              {allowedGenres.map((genre) => <Pressable key={genre} onPress={() => { update({ primaryGenre: genre }); setGenreOpen(false); onSelect(); }} accessibilityRole="button" accessibilityLabel={`Choose ${genreLabels[genre]}`} accessibilityState={{ selected: draft.primaryGenre === genre }} style={[styles.genreOption, draft.primaryGenre === genre && styles.genreOptionActive]}><View style={styles.genreOptionLabel}><Text style={styles.genreIcon}>{GENRE_EMOJI[genre]}</Text><Text style={[styles.genreOptionText, draft.primaryGenre === genre && styles.genreOptionTextActive]}>{genreLabels[genre]}</Text></View>{draft.primaryGenre === genre ? <Check size={16} color={colors.accent} /> : null}</Pressable>)}
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.ideaHero}>
        <Text style={styles.eyebrow}>Create</Text>
        <Text style={styles.title}>What is your story about?</Text>
        <Text style={styles.subtitle}>A sentence is enough. Katha takes it from there.</Text>
      </View>
      <View style={styles.fieldGroup}>
        <TextInput
          value={draft.seed}
          onChangeText={(seed) => update({ seed })}
          placeholder="A stranger slips a note into her grocery basket, and it changes the rest of her week."
          placeholderTextColor={colors.tertiary}
          multiline
          maxLength={1000}
          textAlignVertical="top"
          accessibilityLabel="Story idea"
          style={[styles.textArea, styles.ideaInput]}
        />
        {/* Stateful, and leading-aligned. A countdown reads as a hurdle; this
            says what the idea still needs and then confirms it has it. */}
        <Text
          style={[
            styles.ideaState,
            ideaReady ? styles.ideaStateReady : styles.ideaStateWaiting,
          ]}
          accessibilityLiveRegion="polite"
        >
          {ideaReady
            ? "Enough to write from."
            : "Add a little more so Katha has something to build on."}
        </Text>
      </View>
      <View style={styles.tryOneHeader}><Lightbulb size={16} color={colors.accent} /><Text style={styles.sectionOverline}>Try one</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChips}>
        {GENRE_STARTERS[draft.primaryGenre].map((starter) => <Pressable key={starter} accessibilityRole="button" accessibilityLabel={`Use starter: ${starter}`} onPress={() => update({ seed: starter })} style={styles.starterChip}><Text numberOfLines={3} ellipsizeMode="tail" style={styles.starterText}>{starter}</Text></Pressable>)}
      </ScrollView>

      <Section label="Premise" hint="Optional">
        <View style={styles.inlineField}><TextInput value={draft.whereAndWhen ?? ""} onChangeText={(whereAndWhen) => update({ whereAndWhen })} placeholder="A neighborhood grocery store, present day" placeholderTextColor={colors.tertiary} style={styles.inlineInput} /><Edit3 size={16} color={colors.tertiary} /></View>
      </Section>

      {draft.audienceMode === "kids" ? <Section label="Values" hint="Woven into the story, never taught at the reader"><View style={styles.wrapChips}>{VALUES.map(({ value, label }) => <ChoiceChip key={value} label={label} selected={draft.storyValues?.includes(value)} onPress={() => { update({ storyValues: draft.storyValues?.includes(value) ? draft.storyValues.filter((item) => item !== value) : [...(draft.storyValues ?? []), value] }); onSelect(); }} />)}</View></Section> : null}

      <Section label="Who's in it" hint={draft.characters.length ? `${draft.characters.length} of 3` : undefined}>
        <View style={styles.characterList}>
          {draft.characters.map((character, index) => <Pressable key={`${character.name}-${index}`} onPress={() => onEditCharacter(index)} accessibilityRole="button" accessibilityLabel={`Edit ${character.name || "character"}`} style={styles.characterCard}><View style={[styles.avatar, character.isHero && styles.avatarLead, character.portraitStatus === "ready" && styles.avatarReady]}><Text style={styles.avatarText}>{character.name.trim().slice(0, 1).toUpperCase() || "?"}</Text></View><View style={styles.characterCopy}><Text style={styles.characterName}>{character.name || "Untitled character"}{character.isHero ? " · Lead" : ""}</Text><Text numberOfLines={1} style={styles.characterDescription}>{character.portraitStatus === "ready" ? "Image ready" : character.portraitStatus === "failed" ? "Image failed" : character.description || "Details waiting"}</Text></View><ChevronRight size={18} color={colors.tertiary} /></Pressable>)}
          {draft.characters.length < 3 ? <Pressable onPress={onAddCharacter} accessibilityRole="button" accessibilityLabel="Add a character" style={styles.addCharacter}><View style={styles.addCharacterIcon}><UserPlus size={20} color={colors.accent} /></View><View style={styles.addCharacterCopy}><Text style={styles.addCharacterTitle}>Add a character</Text></View><Plus size={20} color={colors.accent} /></Pressable> : null}
        </View>
      </Section>

      <View style={styles.optionsFamily}>
        <Pressable onPress={onToggleOptions} accessibilityRole="button" accessibilityLabel="More options" accessibilityState={{ expanded: moreOptionsOpen }} style={styles.optionsToggle}><Text style={styles.sectionTitle}>More options</Text><ChevronDown size={20} color={colors.ink} style={{ transform: [{ rotate: moreOptionsOpen ? "180deg" : "0deg" }] }} /></Pressable>
        {moreOptionsOpen ? <MoreOptions draft={draft} isAnonymous={isAnonymous} maxMoments={maxMoments} momentInput={momentInput} onMomentInput={onMomentInput} onAddMoment={onAddMoment} update={update} onSelect={onSelect} /> : null}
      </View>
      <View style={styles.costCard}><View style={styles.costIcon}><Sparkles size={18} color={colors.accent} /></View><View style={styles.costCopy}><Text style={styles.costTitle}>Starting this story</Text><Text style={styles.costDetail}>Characters, chapter one, and its cover are 3 credits. Later chapters are charged as you create them.</Text></View></View>
      {!hasCredits ? <Text style={styles.creditWarning}>You need 3 credits to start this story.</Text> : null}
      {!ideaReady ? <Text style={styles.creditWarning}>Add a little more before generating this story.</Text> : null}
      {hasPendingCharacterImage ? <Text style={styles.creditWarning}>Wait for character images to finish before creating the story.</Text> : null}
      <Pressable disabled={!ideaReady || !hasCredits || hasPendingCharacterImage} onPress={onCreate} accessibilityRole="button" accessibilityState={{ disabled: !ideaReady || !hasCredits || hasPendingCharacterImage }} style={[styles.primaryCta, (!ideaReady || !hasCredits || hasPendingCharacterImage) && styles.primaryCtaDisabled]}><Text style={styles.primaryCtaText}>Create · 3 credits</Text><Sparkles size={18} color={colors.surface} /></Pressable>
      <Text style={styles.ctaStrength}>strength {Math.min(100, strength.slots * 25)}% · {strength.label.toLowerCase()}</Text>
    </ScrollView>
  );
}

function MoreOptions({
  draft,
  isAnonymous,
  maxMoments,
  momentInput,
  onMomentInput,
  onAddMoment,
  update,
  onSelect,
}: {
  draft: StudioCreateDraft;
  isAnonymous: boolean;
  maxMoments: number;
  momentInput: string;
  onMomentInput: (value: string) => void;
  onAddMoment: (value: string) => void;
  update: (patch: Partial<StudioCreateDraft>) => void;
  onSelect: () => void;
}) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const moments = draft.moments ?? [];
  const suggestions = GENRE_MOMENT_SUGGESTIONS[draft.primaryGenre].filter((item) => !moments.includes(item));
  // A moment that names someone from the cast is what the prompt links back to
  // that character, so the cast is offered here as one tap rather than left to
  // be retyped (and misspelled) into the box. A character sheet only requires a
  // name eventually, so unnamed rows have nothing to insert and the row is
  // hidden entirely rather than rendered empty.
  const namedCharacters = draft.characters.filter((character) => character.name.trim());
  const appendCharacterName = (name: string) => {
    const base = momentInput.trimEnd();
    onMomentInput(base ? `${base} ${name.trim()}` : name.trim());
    onSelect();
  };
  return <View style={styles.optionsPanel}>
    <OptionLabel label="Moments to include" />
    {namedCharacters.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.characterTokens}>{namedCharacters.map((character) => <Pressable key={character.name} accessibilityRole="button" accessibilityLabel={`Add ${character.name.trim()} to this moment`} onPress={() => appendCharacterName(character.name)} style={styles.nameToken}><Text style={styles.nameTokenText}>{character.name.trim()}</Text></Pressable>)}</ScrollView> : null}
    <View style={styles.wrapChips}>{moments.map((moment) => <Pressable key={moment} onPress={() => { update({ moments: moments.filter((item) => item !== moment) }); onSelect(); }} style={styles.momentChip}><Text numberOfLines={1} style={styles.momentText}>{moment}</Text><X size={14} color={colors.accent} /></Pressable>)}</View>
    {moments.length < maxMoments ? <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChips}>{suggestions.slice(0, 2).map((item) => <Pressable key={item} onPress={() => onAddMoment(item)} style={styles.suggestionChip}><Plus size={14} color={colors.accent} /><Text style={styles.suggestionText}>{item}</Text></Pressable>)}</ScrollView><View style={styles.momentComposer}><TextInput value={momentInput} onChangeText={onMomentInput} onSubmitEditing={() => onAddMoment(momentInput)} returnKeyType="done" placeholder="Add a moment" placeholderTextColor={colors.tertiary} style={styles.momentInput} /><Pressable accessibilityRole="button" accessibilityLabel="Add moment" onPress={() => onAddMoment(momentInput)} style={styles.momentAddButton}><Plus size={18} color={colors.surface} /></Pressable></View></> : null}
    {draft.beats?.length ? (
      <>
        <OptionLabel label="Chapter plan" />
        <PlanSection beats={draft.beats} onChange={(beats) => update({ beats })} />
      </>
    ) : null}
    <OptionLabel label="Chapters" />
    <View style={styles.optionChips}>{CHAPTER_COUNTS.map((count) => <MiniSegment key={count} label={String(count)} accessibilityLabel={`${count} chapters`} selected={draft.plannedChapterCount === count} onPress={() => { update({ plannedChapterCount: count, isSeries: true, beats: draft.beats?.slice(0, count) }); onSelect(); }} />)}</View>
    <OptionLabel label="Chapter length" />
    <View style={styles.optionChips}>{LENGTHS.map((length) => <MiniSegment key={length} label={length[0].toUpperCase() + length.slice(1)} selected={(draft.chapterLength ?? (draft.audienceMode === "kids" ? "short" : "standard")) === length} onPress={() => { update({ chapterLength: length }); onSelect(); }} />)}</View>
    <View style={styles.switchRow}><View><Text style={styles.switchLabel}>Chapter art</Text><Text style={styles.switchHint}>Illustrate chapters after the cover</Text></View><Switch value={Boolean(draft.illustrateChapters)} onValueChange={(illustrateChapters) => { update({ illustrateChapters }); onSelect(); }} trackColor={{ false: colors.borderStrong, true: colors.accent }} thumbColor={colors.surface} accessibilityLabel="Chapter art" /></View>
    <OptionLabel label="Writing style" />
    <TextInput accessibilityLabel="Writing style" value={draft.writingStyle ?? ""} onChangeText={(writingStyle) => update({ writingStyle })} placeholder="e.g. Warm, witty, first person" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
    {draft.audienceMode === "adult" ? <><OptionLabel label="Spice" /><View style={styles.optionChips}>{SPICE_OPTIONS.map((option) => <MiniSegment key={option.value} label={option.label} icon={<Text style={styles.miniSegmentIcon}>{option.icon}</Text>} selected={draft.spiceLevel === option.value} onPress={() => { update({ spiceLevel: option.value }); onSelect(); }} />)}</View></> : null}
    <Pressable onPress={() => setLanguageOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: languageOpen }} accessibilityLabel="Language" style={styles.languageMenu}><View><Text style={styles.optionLabel}>Language</Text><Text style={styles.languageValue}>{draft.language}</Text></View><ChevronDown size={18} color={colors.tertiary} /></Pressable>
    {languageOpen ? <View style={styles.optionChips}><MiniSegment label="English" selected={draft.language === "English"} onPress={() => { update({ language: "English" }); setLanguageOpen(false); onSelect(); }} /><MiniSegment label="Portuguese" selected={draft.language === "Portuguese"} onPress={() => { update({ language: "Portuguese" }); setLanguageOpen(false); onSelect(); }} /></View> : null}
    <OptionLabel label="Avoid" />
    <TextInput accessibilityLabel="Avoid" value={draft.avoid ?? ""} onChangeText={(avoid) => update({ avoid })} placeholder="e.g. No cheating or graphic violence" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
    <View style={styles.switchRow}><View><Text style={styles.switchLabel}>Visibility</Text><Text style={styles.switchHint}>{isAnonymous ? "Public unlocks when sign-in is available." : draft.visibility === "public" ? "This story can be shared after creation." : "Only you can see this story."}</Text></View><Switch value={draft.visibility === "public"} disabled={isAnonymous} onValueChange={(visible) => { update({ visibility: visible ? "public" : "private" }); onSelect(); }} trackColor={{ false: colors.borderStrong, true: colors.accent }} thumbColor={colors.surface} accessibilityLabel="Public visibility" /></View>
  </View>;
}

function CharacterCraftScreen({
  character,
  onChange,
  onBack,
  onSave,
  onDelete,
  onCreateImage,
  topInset,
  bottomInset,
}: {
  character: CharacterDraft;
  onChange: Dispatch<SetStateAction<CharacterDraft>>;
  onBack: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onCreateImage: () => void;
  topInset: number;
  bottomInset: number;
}) {
  const set = (key: keyof CharacterDraft, value: string | boolean) => onChange((previous) => ({ ...previous, [key]: value }));
  const imageReady = character.portraitStatus === "ready" && Boolean(character.portraitUrl);
  const imageBusy = character.portraitStatus === "generating";
  const canCreateImage = Boolean(
    character.name.trim() &&
      (character.description.trim() || character.appearance?.trim()) &&
      !imageBusy,
  );
  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.characterScroll, { paddingTop: topInset + spacing.md, paddingBottom: 116 + bottomInset }]} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to review and start" onPress={onBack} style={styles.iconButton}><ArrowLeft size={20} color={colors.ink} /></Pressable>
            <Text style={styles.topTitle}>Craft character</Text>
            <View style={styles.topSpacer} />
          </View>
          <Text style={styles.characterIntro}>A little detail here gives the story a stronger voice and a more recognizable cast.</Text>
          <Field label="Name"><TextInput accessibilityLabel="Name" value={character.name} onChangeText={(value) => set("name", value)} placeholder="e.g. Naina Mistry" placeholderTextColor={colors.tertiary} style={styles.characterInput} /></Field>
          <Field label="Description"><TextInput accessibilityLabel="Description" value={character.description} onChangeText={(value) => set("description", value)} placeholder="Role, age, and who they are. e.g. A 29-year-old baker with a practical streak." placeholderTextColor={colors.tertiary} multiline textAlignVertical="top" style={[styles.textArea, styles.characterArea]} /></Field>
          <Field label="Background"><TextInput accessibilityLabel="Background" value={character.background ?? ""} onChangeText={(value) => set("background", value)} placeholder="Personality, relationships, backstory, traits. e.g. Keeps her late father's recipes but never uses them." placeholderTextColor={colors.tertiary} multiline textAlignVertical="top" style={[styles.textArea, styles.characterArea]} /></Field>
          <Field label="Appearance"><TextInput accessibilityLabel="Appearance" value={character.appearance ?? ""} onChangeText={(value) => set("appearance", value)} placeholder="Face, build, clothing, accessories. e.g. Curly hair, flour on her sleeves, her grandmother's signet ring." placeholderTextColor={colors.tertiary} multiline textAlignVertical="top" style={[styles.textArea, styles.characterArea]} /></Field>
          <View style={styles.portraitPanel}>
            <View style={[styles.portraitPreview, imageReady && styles.portraitPreviewReady]}>
              {imageReady ? <Text style={styles.portraitInitial}>{character.name.trim().slice(0, 1).toUpperCase()}</Text> : <Text style={styles.portraitHint}>Character image will appear here.</Text>}
            </View>
            <View style={styles.portraitActions}>
              <Pressable disabled={!canCreateImage} onPress={onCreateImage} accessibilityRole="button" accessibilityState={{ disabled: !canCreateImage, busy: imageBusy }} style={[styles.outlineButton, !canCreateImage && styles.outlineButtonDisabled]}>
                <Text style={styles.outlineButtonText}>{imageBusy ? "Creating..." : imageReady ? "Reimagine" : "Create image"}</Text>
              </Pressable>
              {imageReady ? <Pressable onPress={() => onChange((previous) => ({ ...previous, portraitUrl: undefined, portraitStatus: "idle" }))} accessibilityRole="button" style={styles.outlineButton}><Text style={styles.outlineButtonText}>Edit</Text></Pressable> : null}
              {character.portraitStatus === "failed" ? <Text style={styles.portraitError}>Image failed. Check the character details and try again.</Text> : null}
            </View>
          </View>
          <Text style={styles.optionHint}>No real people or characters you do not have rights to.</Text>
          <View style={styles.switchRow}><View><Text style={styles.switchLabel}>Lead character</Text><Text style={styles.switchHint}>Katha follows this character most closely.</Text></View><Switch value={character.isHero} onValueChange={(value) => set("isHero", value)} trackColor={{ false: colors.borderStrong, true: colors.accent }} thumbColor={colors.surface} accessibilityLabel="Lead character" /></View>
          {onDelete ? <Pressable onPress={onDelete} accessibilityRole="button" style={styles.deleteButton}><Text style={styles.deleteText}>Delete character</Text></Pressable> : null}
        </ScrollView>
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(bottomInset, spacing.md) }]}>
          <Pressable disabled={!character.name.trim() || imageBusy} onPress={onSave} accessibilityRole="button" accessibilityState={{ disabled: !character.name.trim() || imageBusy }} style={[styles.primaryCta, (!character.name.trim() || imageBusy) && styles.primaryCtaDisabled]}>
            <Text style={styles.primaryCtaText}>Save</Text><Check size={20} color={colors.surface} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <View style={styles.section}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{label}</Text>{hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}</View>{children}</View>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>; }
function ChoiceChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) { return <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: Boolean(selected) }} style={[styles.choiceChip, selected && styles.choiceChipActive]}><Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{label}</Text></Pressable>; }
function MiniSegment({ label, accessibilityLabel, selected, disabled = false, icon, onPress }: { label: string; accessibilityLabel?: string; selected: boolean; disabled?: boolean; icon?: React.ReactNode; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled }} style={[styles.miniSegment, selected && styles.miniSegmentActive, disabled && styles.miniSegmentDisabled]}>{icon}<Text style={[styles.miniSegmentText, selected && styles.miniSegmentTextActive, disabled && styles.miniSegmentTextDisabled]}>{label}</Text></Pressable>; }
function OptionLabel({ label }: { label: string }) { return <Text style={styles.optionLabel}>{label}</Text>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  topTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 20, flex: 1, textAlign: "center" },
  topSpacer: { width: 40 },
  parentControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, zIndex: 20 },
  genreControl: { position: "relative", alignItems: "flex-end", zIndex: 30 },
  genreButton: { minWidth: 128, maxWidth: 170, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: spacing.md },
  genreIcon: { fontSize: 15 },
  genreButtonText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  kidsMode: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.xs },
  kidsModeLabel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  kidsModeText: { color: colors.muted, fontFamily: fonts.display, fontSize: 15 },
  kidsModeTextActive: { color: colors.accent },
  genreMenu: { position: "absolute", top: 48, right: 0, width: 238, maxHeight: 316, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden", zIndex: 50, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  genreOption: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  genreOptionActive: { backgroundColor: colors.accentSoft },
  genreOptionLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  genreOptionText: { color: colors.ink, fontFamily: fonts.ui, fontSize: 13, fontWeight: "700" },
  genreOptionTextActive: { color: colors.accent, fontWeight: "800" },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  ideaHero: { gap: spacing.sm, paddingTop: spacing.lg },
  eyebrow: { color: colors.accent, fontFamily: fonts.ui, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
  subtitle: { color: colors.muted, fontFamily: fonts.ui, fontSize: 16, lineHeight: 23 },
  fieldGroup: { gap: spacing.xs },
  textArea: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.ink, fontFamily: fonts.ui, fontSize: 16, lineHeight: 23, padding: spacing.lg },
  ideaInput: { minHeight: 158 },
  counter: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12, textAlign: "right" },
  ideaState: { fontFamily: fonts.ui, fontSize: 13, fontWeight: "600", alignSelf: "flex-start" },
  ideaStateWaiting: { color: colors.tertiary },
  ideaStateReady: { color: colors.success },
  tryOneHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sectionOverline: { color: colors.ink, fontFamily: fonts.ui, fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
  horizontalChips: { gap: spacing.sm, paddingRight: spacing.xl },
  starterChip: { width: 184, height: 78, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  starterText: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  grow: { flex: 1, minHeight: spacing.lg },
  primaryCta: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  primaryCtaDisabled: { opacity: 0.42 },
  primaryCtaText: { color: colors.surface, fontFamily: fonts.ui, fontWeight: "800", fontSize: 16 },
  ctaStrength: { marginTop: -spacing.lg, color: colors.tertiary, fontFamily: fonts.ui, fontSize: 11, fontWeight: "700", textAlign: "center", textTransform: "lowercase" },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 20 },
  sectionHint: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12, textAlign: "right", flexShrink: 1 },
  inlineField: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  inlineInput: { flex: 1, minHeight: 50, color: colors.ink, fontFamily: fonts.ui, fontSize: 15 },
  wrapChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choiceChip: { minHeight: 38, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  choiceChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: colors.accent, fontWeight: "800" },
  characterList: { gap: spacing.sm },
  addCharacter: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  addCharacterIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  addCharacterCopy: { flex: 1, gap: 2 },
  addCharacterTitle: { color: colors.accent, fontFamily: fonts.ui, fontSize: 16, fontWeight: "800" },
  addCharacterHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  characterCard: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  avatarLead: { backgroundColor: colors.accentSoft },
  avatarReady: { borderWidth: 1, borderColor: colors.accent },
  avatarText: { color: colors.accent, fontFamily: fonts.display, fontSize: 17 },
  characterCopy: { flex: 1, gap: 2 },
  characterName: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "800" },
  characterDescription: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12 },
  characterTokens: { gap: spacing.xs },
  nameToken: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  nameTokenText: { color: colors.accent, fontFamily: fonts.ui, fontWeight: "800", fontSize: 12 },
  momentChip: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 34, borderRadius: radius.pill, backgroundColor: colors.accentSoft, paddingHorizontal: spacing.md },
  momentText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  suggestionChip: { maxWidth: 250, minHeight: 34, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  suggestionText: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  momentComposer: { flexDirection: "row", minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingLeft: spacing.md, overflow: "hidden" },
  momentInput: { flex: 1, color: colors.ink, fontFamily: fonts.ui, fontSize: 14 },
  momentAddButton: { width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  optionsFamily: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface2 },
  optionsToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs },
  optionsTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 17 },
  optionsHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  optionsPanel: { gap: spacing.sm, paddingTop: spacing.xs },
  optionGrid: { flexDirection: "row", gap: spacing.sm },
  optionCell: { flex: 1, gap: spacing.xs },
  optionLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 13, marginTop: spacing.xs },
  optionHint: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  compactSegments: { flexDirection: "row", gap: spacing.xs },
  optionChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  miniSegment: { minHeight: 36, minWidth: 72, flexDirection: "row", gap: spacing.xs, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  miniSegmentActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  miniSegmentDisabled: { opacity: 0.62 },
  miniSegmentIcon: { fontSize: 14 },
  miniSegmentText: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, fontWeight: "700" },
  miniSegmentTextActive: { color: colors.accent, fontWeight: "800" },
  miniSegmentTextDisabled: { color: colors.tertiary },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  switchLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  switchHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2, maxWidth: 240 },
  optionInput: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.ink, fontFamily: fonts.ui, fontSize: 14 },
  languageMenu: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  languageValue: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, marginTop: 2 },
  reviewHero: { gap: spacing.sm, paddingTop: spacing.lg },
  strengthCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: "#FFD8C0" },
  strengthHead: { flexDirection: "row", justifyContent: "space-between" },
  strengthLabel: { color: colors.accent, fontFamily: fonts.display, fontSize: 19 },
  strengthSlots: { color: colors.accent, fontFamily: fonts.ui, fontWeight: "800", fontSize: 13 },
  strengthTrack: { flexDirection: "row", gap: spacing.xs },
  strengthBar: { height: 5, flex: 1, borderRadius: 3, backgroundColor: "#FFD8C0" },
  strengthBarActive: { backgroundColor: colors.accent },
  strengthDetail: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  reviewCard: { borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  reviewRow: { minHeight: 68, flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewCopy: { flex: 1, gap: 3 },
  reviewLabel: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  reviewValue: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  costCard: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface2 },
  costIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  costCopy: { flex: 1, gap: 2 },
  costTitle: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  costDetail: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 18 },
  creditWarning: { color: colors.heart, fontFamily: fonts.ui, fontSize: 13, fontWeight: "700", textAlign: "center" },
  characterScroll: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.lg },
  characterIntro: { color: colors.muted, fontFamily: fonts.ui, fontSize: 15, lineHeight: 22 },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "800" },
  characterInput: { minHeight: 50, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.ink, fontFamily: fonts.ui, fontSize: 16 },
  characterArea: { minHeight: 108 },
  portraitPanel: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.sm },
  portraitPreview: { width: 128, height: 192, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  portraitPreviewReady: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  portraitInitial: { color: colors.accent, fontFamily: fonts.display, fontSize: 42 },
  portraitHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, textAlign: "center", paddingHorizontal: spacing.md },
  portraitActions: { flex: 1, gap: spacing.md, alignItems: "flex-start" },
  outlineButton: { minHeight: 46, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.accent, paddingHorizontal: spacing.xl, alignItems: "center", justifyContent: "center" },
  outlineButtonDisabled: { opacity: 0.45 },
  outlineButtonText: { color: colors.ink, fontFamily: fonts.ui, fontSize: 16, fontWeight: "800" },
  portraitError: { color: colors.heart, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  deleteButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.heart, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  stickyFooter: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
