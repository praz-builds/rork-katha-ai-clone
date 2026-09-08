import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Image,
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
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  HelpCircle,
  ImagePlus,
  Lightbulb,
  Plus,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react-native";
import { CreditPill } from "@/components/KathaPrimitives";
import { Dropdown, DropdownGroup } from "@/components/create/Dropdown";
import type { DropdownOption } from "@/components/create/Dropdown";
import {
  GENRE_EMOJI,
  GENRE_STARTERS,
} from "@/lib/genre-content";
import * as storyApi from "@/lib/api";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme";
import type { AudienceMode, CreateDraft, CreationLanguage, Genre } from "@/types/domain";
import { KIDS_UI_GENRES, UI_GENRES } from "@/types/domain";

type CharacterDraft = CreateDraft["characters"][number];

export type StudioCreateDraft = Omit<CreateDraft, "visibility"> & {
  isSeries: boolean;
  /** Publish intent only. Generation remains private until the final save. */
  visibility: "private" | "public";
};

type CreateStage = "main" | "character" | "review";

type Props = {
  credits: number;
  isAnonymous: boolean;
  draft: StudioCreateDraft;
  setDraft: Dispatch<SetStateAction<StudioCreateDraft>>;
  onGenerate: () => void;
  onBack: () => void;
};

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
 * Minutes are derived from the word bands at 260 wpm, the measured mean
 * silent reading rate for adult English fiction (Brysbaert 2019, 190 studies,
 * 18,573 participants).
 *
 * The word figures are TARGETS, and they are hedged with a tilde on purpose.
 * `AGENTS.md` records a measured overshoot -- 2,056 to 2,331 words against a
 * 1,200-1,600 band -- so an unhedged number printed beside a control would read
 * as a contract the generator has never been held to. Showing them at all is a
 * deliberate reversal of STORY_GENERATION_FLOW.md section 9, made on the
 * product owner's instruction; the risk is recorded there.
 *
 * `words` mirrors `wordBandFor()` in
 * `backend/supabase/functions/_shared/types.ts`, the single source of truth
 * for the bands -- short 600-900, standard 1200-1600, long 2000-2600. It is
 * copied rather than imported because the Expo client cannot import a Deno
 * edge function module; if that function's bands ever move, update this
 * literal in the same change.
 *
 * Direct product-owner instruction (this file's task brief, 2026-09-07) asks
 * for the word count to be visible per option inside the dropdown. That
 * supersedes `source-of-truth/STORY_GENERATION_FLOW.md` section 9's current
 * "word bands stay out of the interface" stance, which was written when the
 * bands were unverified against real generations; that document should be
 * reconciled with this change.
 */
export const CHAPTER_LENGTHS = [
  { id: "short", label: "Short", minutes: 3, words: "~600-900 words" },
  { id: "standard", label: "Standard", minutes: 5, words: "~1,200-1,600 words" },
  { id: "long", label: "Long", minutes: 9, words: "~2,000-2,600 words" },
] as const;

const CHAPTER_COUNTS = [3, 7, 15] as const;

/**
 * Every Switch on this screen, in design-system colour.
 *
 * Spread rather than repeated because the Lead-character toggle in Craft
 * character was the one that got missed and rendered iOS's default GREEN
 * thumb-and-track under an orange track colour -- reported from a screenshot
 * as "the toggle looks wrong". `ios_backgroundColor` is the piece that is easy
 * to forget: without it iOS paints its own off-state fill behind the track
 * during the toggle animation, so `trackColor.false` alone does not hold.
 */
const SWITCH_COLORS = {
  trackColor: { false: colors.borderStrong, true: colors.accent },
  thumbColor: colors.surface,
  ios_backgroundColor: colors.borderStrong,
} as const;

/**
 * The real cap on a single moment's text is 300 characters --
 * `MAX_BRIEF_FIELD_LENGTH` in `backend/supabase/functions/_shared/types.ts`,
 * enforced again server-side by `validation.ts`'s `stringList()`. Mirrored
 * here as the composer's own input cap so a moment is never silently cut down
 * after the user believed they had written the whole thing.
 */
const MAX_MOMENT_CHARS = 300;
/**
 * How much of a moment's text a chip or the review row shows before an
 * ellipsis. Purely cosmetic -- it is a display cap, not a data cap. The full
 * text, up to `MAX_MOMENT_CHARS`, is still what gets sent.
 */
const MOMENT_DISPLAY_CHARS = 60;

function truncateForDisplay(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * How a character sheet is compared against the state it was opened in.
 *
 * Trimmed, because trailing whitespace the user never sees must not be able to
 * raise a "you have unsaved changes" dialog. `portraitStatus` is deliberately
 * NOT part of it: it moves idle -> generating -> ready on its own while the
 * user sits there, and a status transition is not an edit. `portraitUrl` is,
 * because a portrait that finished generating is real work to lose.
 */
function characterFingerprint(character: CharacterDraft) {
  return JSON.stringify({
    name: character.name.trim(),
    description: character.description.trim(),
    background: (character.background ?? "").trim(),
    appearance: (character.appearance ?? "").trim(),
    isHero: character.isHero,
    portraitUrl: character.portraitUrl ?? "",
  });
}

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

/**
 * How many slots `briefStrength()` scores out of. Named so the review meter's
 * denominator and its accessible value cannot drift from the score itself.
 */
const STRENGTH_SLOTS = 4;

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
  /**
   * The sheet exactly as it was opened, so Back can tell an untouched visit
   * from an edited one. A ref, not state: nothing renders from it, and putting
   * it in state would re-render the sheet on every open for no reason.
   */
  const openedCharacterRef = useRef<CharacterDraft | null>(null);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const { reduceMotion, select, confirm } = useMotionAndHaptics();
  const allowedGenres = draft.audienceMode === "kids" ? KIDS_UI_GENRES : UI_GENRES;
  const maxMoments = 5;
  const strength = briefStrength(draft);
  const isCharacter = stage === "character";
  const isReview = stage === "review";

  useEffect(() => {
    if (reduceMotion || stage === "character") return;
    fade.setValue(0.55);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fade, reduceMotion, stage]);

  const chooseAudience = useCallback((audienceMode: AudienceMode) => {
    select();
    setDraft((previous) => {
      const primaryGenre = audienceMode === "kids" && !KIDS_UI_GENRES.includes(previous.primaryGenre) ? "adventure" : previous.primaryGenre;
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
    let opened: CharacterDraft;
    if (typeof index === "number") {
      opened = draft.characters[index];
      setEditingCharacterIndex(index);
    } else {
      if (draft.characters.length >= 3) return;
      opened = { name: "", description: "", background: "", appearance: "", isHero: draft.characters.length === 0 };
      setEditingCharacterIndex(null);
    }
    setCharacterBuffer(opened);
    openedCharacterRef.current = opened;
    setUnsavedPromptOpen(false);
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
    setUnsavedPromptOpen(false);
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
    setUnsavedPromptOpen(false);
    confirm();
    setStage("main");
  }, [confirm, setDraft]);

  /**
   * Generate (or regenerate) the portrait from the sheet AS IT STANDS.
   *
   * The dependency array is `[characterBuffer, confirm]`, so every Reimagine
   * re-reads the current buffer rather than the values that were present when
   * the sheet opened -- `create-flow-character-portrait.test.tsx` asserts that
   * with an edit between two taps, because a stale closure here would silently
   * regenerate the OLD description and look like the model ignoring the user.
   *
   * `background` is not sent: the `generate-character-image` edge function
   * accepts `name`, `description` and `appearance` only and 400s on nothing
   * else, so adding it here would need the function and `CharacterImageInput`
   * to move first. Background still reaches the story prompt.
   */
  /**
   * Attach a photo that steers this character's look.
   *
   * Downscaled and re-encoded here rather than sent as the camera produced it:
   * a modern phone photo is 3-8 MB, the endpoint caps a reference at 6 MB of
   * base64, and a request that large is slow on the writer's connection before
   * it is anything else. 1024px on the long edge is well beyond what an image
   * model reads for build, hair and wardrobe.
   *
   * `base64: true` because the endpoint takes a data URL. The bytes never
   * touch our storage: the reference exists only for the length of one
   * portrait request and is dropped as soon as it has been used.
   */
  const pickCharacterReference = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo access needed",
        "Katha needs permission to open your photos so you can attach a reference.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [2, 3],
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert(
        "Couldn't read that photo",
        "Please pick a different image, or try a JPEG or PNG.",
      );
      return;
    }

    // The endpoint's allowlist is JPEG, PNG and WebP; anything else is refused
    // there. Naming the type from the asset rather than assuming PNG is what
    // keeps that refusal about the actual file.
    const mime = asset.mimeType && /^image\/(jpeg|jpg|png|webp)$/.test(asset.mimeType)
      ? asset.mimeType
      : "image/jpeg";
    setCharacterBuffer((previous) => ({
      ...previous,
      referenceImage: `data:${mime};base64,${asset.base64}`,
    }));
  }, []);

  const clearCharacterReference = useCallback(() => {
    setCharacterBuffer((previous) => ({ ...previous, referenceImage: undefined }));
  }, []);

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
        referenceImage: characterBuffer.referenceImage,
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

  /**
   * Back out of Craft character, with friction when there is something to lose.
   *
   * The sheet holds everything in a local buffer and only `Save` writes it into
   * the draft, so leaving any other way silently threw away every field the
   * user had typed -- including a portrait that had just cost twelve seconds
   * of waiting. An untouched visit still closes on the first tap; the dialog
   * only appears when the buffer actually differs from what was opened.
   */
  const requestCloseCharacter = useCallback(() => {
    const opened = openedCharacterRef.current;
    const dirty = opened !== null && characterFingerprint(opened) !== characterFingerprint(characterBuffer);
    if (dirty) {
      setUnsavedPromptOpen(true);
      return;
    }
    select();
    setStage("main");
  }, [characterBuffer, select]);

  const discardCharacter = useCallback(() => {
    setUnsavedPromptOpen(false);
    select();
    setStage("main");
  }, [select]);

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

  /**
   * The structured review screen, per source-of-truth/STORY_GENERATION_FLOW.md
   * section 2's own admission that main Create is otherwise "setup, shaping,
   * and review" on one surface: everything the user is about to spend credits
   * on is restated here before the paid generation call fires, and Back
   * returns to the same `main` stage with the same `draft` state untouched.
   */
  const goToReview = useCallback(() => {
    confirm();
    setStage("review");
  }, [confirm]);

  const backToMain = useCallback(() => {
    select();
    setStage("main");
  }, [select]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/*
        One shared group for every dropdown on this screen (Genre, Chapters,
        Chapter length, Language), so opening any one of them closes whichever
        other one was open -- see src/components/create/Dropdown.tsx.
      */}
      <DropdownGroup>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Animated.View style={[styles.flex, { opacity: fade }]}>
          {isReview ? (
            <ReviewScreen
              draft={draft}
              strength={strength}
              credits={credits}
              isAnonymous={isAnonymous}
              onBack={backToMain}
              onCreate={onGenerate}
            />
          ) : (
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
              onCreate={goToReview}
              onSelect={select}
            />
          )}
        </Animated.View>
      </KeyboardAvoidingView>
      <Modal animationType="slide" presentationStyle="fullScreen" visible={isCharacter} onRequestClose={requestCloseCharacter}>
        <CharacterCraftScreen
          character={characterBuffer}
          onChange={setCharacterBuffer}
          onBack={requestCloseCharacter}
          onSave={saveCharacter}
          onDelete={editingCharacterIndex === null ? undefined : () => deleteCharacter(editingCharacterIndex)}
          onCreateImage={createCharacterImage}
          onPickReference={pickCharacterReference}
          onClearReference={clearCharacterReference}
          unsavedPromptOpen={unsavedPromptOpen}
          onKeepEditing={() => setUnsavedPromptOpen(false)}
          onDiscard={discardCharacter}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </Modal>
      </DropdownGroup>
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
  allowedGenres: readonly Genre[];
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
  const update = (patch: Partial<StudioCreateDraft>) => onSetDraft((previous) => ({ ...previous, ...patch }));
  const hasCredits = credits >= 3;
  const hasPendingCharacterImage = draft.characters.some((character) => character.portraitStatus === "generating");
  const ideaReady = draft.seed.trim().length >= MIN_IDEA_LENGTH;
  const genreOptions: DropdownOption<Genre>[] = allowedGenres.map((genre) => ({
    value: genre,
    label: genreLabels[genre],
    accessibilityLabel: `Choose ${genreLabels[genre]}`,
    icon: GENRE_EMOJI[genre],
  }));
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.iconButton}><ArrowLeft size={20} color={colors.ink} /></Pressable>
        <CreditPill credits={credits} />
      </View>
      <View style={styles.parentControls}>
        <View style={styles.kidsMode}>
          <Switch value={draft.audienceMode === "kids"} onValueChange={(enabled) => onAudience(enabled ? "kids" : "adult")} {...SWITCH_COLORS} accessibilityLabel="Kids Mode" />
          <View style={styles.kidsModeLabel}>
            <Sparkles size={15} color={draft.audienceMode === "kids" ? colors.accent : colors.tertiary} />
            <Text style={[styles.kidsModeText, draft.audienceMode === "kids" && styles.kidsModeTextActive]}>Kids Mode</Text>
          </View>
        </View>
        <Dropdown
          id="genre"
          variant="pill"
          label="Genre"
          value={draft.primaryGenre}
          options={genreOptions}
          onChange={(primaryGenre) => update({ primaryGenre })}
          onOpen={onSelect}
          style={styles.genreControl}
        />
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

      {/*
        The cast rows show the generated portrait, not the initial. This card
        had the same bug as the Craft character panel -- it drew
        `character.name[0]` whichever portrait state the row was in, so a cast
        with three finished images was indistinguishable from one with none.
      */}
      <Section label="Who's in it" hint={draft.characters.length ? `${draft.characters.length} of 3` : undefined}>
        <View style={styles.characterList}>
          {draft.characters.map((character, index) => <Pressable key={`${character.name}-${index}`} onPress={() => onEditCharacter(index)} accessibilityRole="button" accessibilityLabel={`Edit ${character.name || "character"}`} style={styles.characterCard}><View style={[styles.avatar, character.isHero && styles.avatarLead, character.portraitStatus === "ready" && styles.avatarReady]}>{character.portraitStatus === "ready" && character.portraitUrl ? <Image source={{ uri: character.portraitUrl }} resizeMode="cover" style={styles.avatarImage} accessible accessibilityLabel={`Portrait of ${character.name.trim() || "this character"}`} /> : character.portraitStatus === "generating" ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.avatarText}>{character.name.trim().slice(0, 1).toUpperCase() || "?"}</Text>}</View><View style={styles.characterCopy}><Text style={styles.characterName}>{character.name || "Untitled character"}{character.isHero ? " · Lead" : ""}</Text><Text numberOfLines={1} style={styles.characterDescription}>{character.portraitStatus === "ready" ? "Image ready" : character.portraitStatus === "failed" ? "Image failed" : character.description || "Details waiting"}</Text></View><ChevronRight size={18} color={colors.tertiary} /></Pressable>)}
          {draft.characters.length < 3 ? <Pressable onPress={onAddCharacter} accessibilityRole="button" accessibilityLabel="Add a character" style={styles.addCharacter}><View style={styles.addCharacterIcon}><UserPlus size={20} color={colors.accent} /></View><View style={styles.addCharacterCopy}><Text style={styles.addCharacterTitle}>Add a character</Text></View><Plus size={20} color={colors.accent} /></Pressable> : null}
        </View>
      </Section>

      <View style={styles.optionsFamily}>
        <Pressable onPress={onToggleOptions} accessibilityRole="button" accessibilityLabel="More options" accessibilityState={{ expanded: moreOptionsOpen }} style={styles.optionsToggle}><Text style={styles.sectionTitle}>More options</Text><ChevronDown size={16} color={colors.ink} style={{ transform: [{ rotate: moreOptionsOpen ? "180deg" : "0deg" }] }} /></Pressable>
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

/**
 * Structured review before the paid generation call.
 *
 * Restates every choice the setup screen collected — idea, genre, cast,
 * chapters, length, style, visibility — as a plain label/value list, and
 * nothing here is editable. Back returns to the same `main` stage with the
 * same draft, so "changing something" means going back and using the control
 * that already owns that field, not a second copy of it.
 */
function ReviewScreen({
  draft,
  strength,
  credits,
  isAnonymous,
  onBack,
  onCreate,
}: {
  draft: StudioCreateDraft;
  strength: ReturnType<typeof briefStrength>;
  credits: number;
  isAnonymous: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  const hasCredits = credits >= 3;
  const hasPendingCharacterImage = draft.characters.some(
    (character) => character.portraitStatus === "generating",
  );
  const chapterLength = storyApi.effectiveChapterLength(draft);
  const chapterLengthLabel = chapterLength.charAt(0).toUpperCase() + chapterLength.slice(1);
  const chapterMinutes = CHAPTER_LENGTHS.find((item) => item.id === chapterLength)?.minutes;
  const plannedChapterCount = draft.plannedChapterCount ?? 3;
  const visibilityLabel = isAnonymous
    ? "Private — sign in to publish"
    : draft.visibility === "public" ? "Public" : "Private";
  const charactersValue = draft.characters.length
    ? draft.characters
        .map((character) => `${character.name.trim() || "Untitled"}${character.isHero ? " (Lead)" : ""}`)
        .join(", ")
    : "None added";
  const disabled = !hasCredits || hasPendingCharacterImage;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to edit" onPress={onBack} hitSlop={2} style={styles.iconButton}>
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>
        <CreditPill credits={credits} />
      </View>
      <View style={styles.reviewHero}>
        <Text style={styles.eyebrow}>Review and create</Text>
        <Text style={styles.title}>Here is what Katha will write</Text>
        <Text style={styles.subtitle}>Check every choice below. Go back to change anything before generating.</Text>
      </View>
      {/*
        A meter, not a card. The same `briefStrength()` score as before -- this
        is presentation only -- but the old block spent a full padded card and
        three lines of type on four bits of information, above the review list
        it was meant to introduce. The bar is the reading; the label carries
        the meaning for anyone who cannot see the bar, which is why the
        accessible name states the level and the count rather than leaving a
        screen reader with a coloured rectangle.
      */}
      <View
        style={styles.strengthMeter}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Brief strength: ${strength.label}, ${strength.slots} of 4 details added. ${strength.detail}`}
        accessibilityValue={{ min: 0, max: STRENGTH_SLOTS, now: strength.slots }}
      >
        <View style={styles.strengthMeterHead}>
          <Text style={styles.strengthMeterLabel}>Brief strength · {strength.label}</Text>
          <Text style={styles.strengthMeterCount}>{strength.slots}/{STRENGTH_SLOTS}</Text>
        </View>
        <View style={styles.strengthTrack}>
          <View style={[styles.strengthFill, { width: `${(strength.slots / STRENGTH_SLOTS) * 100}%` }]} />
        </View>
      </View>
      <View style={styles.reviewCard}>
        <ReviewRow label="Your idea" value={draft.seed.trim() || "Not written yet"} />
        <ReviewRow
          label="Genre"
          value={`${GENRE_EMOJI[draft.primaryGenre]} ${genreLabels[draft.primaryGenre]}${draft.audienceMode === "kids" ? " · Kids mode" : ""}`}
        />
        <ReviewRow label="Premise" value={draft.whereAndWhen?.trim() || "Not set"} />
        <ReviewRow label="Who's in it" value={charactersValue} />
        <ReviewRow
          label="Moments to include"
          value={draft.moments?.length
            ? draft.moments.map((moment) => truncateForDisplay(moment, MOMENT_DISPLAY_CHARS)).join(" · ")
            : "None added"}
        />
        <ReviewRow label="Chapters" value={String(plannedChapterCount)} />
        <ReviewRow
          label="Chapter length"
          value={chapterMinutes ? `${chapterLengthLabel} · about ${chapterMinutes} min each` : chapterLengthLabel}
        />
        <ReviewRow
          label="Chapter art"
          value={draft.illustrateChapters ? "On for chapters 2 and later" : "Off"}
        />
        <ReviewRow label="Writing style" value={draft.writingStyle?.trim() || "Not set"} />
        {/* Spice is inferred server-side from the idea now, never chosen here
            -- see MoreOptions and CreateStudioScreen's initial draft. */}
        <ReviewRow label="Language" value={draft.language} />
        <ReviewRow label="Avoid" value={draft.avoid?.trim() || "Nothing excluded"} />
        <ReviewRow label="Visibility" value={visibilityLabel} />
      </View>
      {!hasCredits ? <Text style={styles.creditWarning}>You need 3 credits to start this story.</Text> : null}
      {hasPendingCharacterImage ? <Text style={styles.creditWarning}>Wait for character images to finish before creating the story.</Text> : null}
      <Pressable
        disabled={disabled}
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityLabel="Create your story"
        accessibilityState={{ disabled }}
        style={[styles.primaryCta, disabled && styles.primaryCtaDisabled]}
      >
        <Text style={styles.primaryCtaText}>Create · 3 credits</Text>
        <Sparkles size={18} color={colors.surface} />
      </Pressable>
    </ScrollView>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <View style={styles.reviewCopy}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
    </View>
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
  const [momentsHelpOpen, setMomentsHelpOpen] = useState(false);
  const moments = draft.moments ?? [];
  // A moment that names someone from the cast is what the prompt links back to
  // that character, so the cast is offered here as one tap rather than left to
  // be retyped (and misspelled) into the box. A character sheet only requires a
  // name eventually, so unnamed rows have nothing to insert and the row is
  // hidden entirely rather than rendered empty.
  const namedCharacters = draft.characters.filter((character) => character.name.trim());
  // The chip reads "@Naina" so it is obviously a tag, but what it INSERTS is
  // still the bare name. The moment text goes to the prompt, where an "@" is
  // noise the model has to ignore, and the review screen and the moment chips
  // both echo that text back verbatim.
  const appendCharacterName = (name: string) => {
    const base = momentInput.trimEnd();
    onMomentInput(base ? `${base} ${name.trim()}` : name.trim());
    onSelect();
  };

  const chapterCountOptions: DropdownOption<string>[] = CHAPTER_COUNTS.map((count) => ({
    value: String(count),
    label: `${count} chapters`,
    valueLabel: String(count),
    accessibilityLabel: `${count} chapters`,
  }));
  const chapterLength = storyApi.effectiveChapterLength(draft);
  const chapterLengthOptions: DropdownOption<string>[] = CHAPTER_LENGTHS.map((item) => ({
    value: item.id,
    label: item.label,
    detail: `About ${item.minutes} min · ${item.words}`,
  }));
  const languageOptions: DropdownOption<CreationLanguage>[] = [{ value: "English", label: "English" }];

  return <View style={styles.optionsPanel}>
    <View style={styles.labelRow}>
      <OptionLabel label="Moments to include" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What are moments to include?"
        accessibilityState={{ expanded: momentsHelpOpen }}
        hitSlop={10}
        onPress={() => { setMomentsHelpOpen((open) => !open); onSelect(); }}
        style={styles.helpButton}
      >
        <HelpCircle size={15} color={colors.tertiary} />
      </Pressable>
    </View>
    {momentsHelpOpen ? (
      <Text style={styles.helpCaption}>
        A scene you want somewhere in the story or series, like a conversation between two characters.
      </Text>
    ) : null}
    {namedCharacters.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.characterTokens}>{namedCharacters.map((character) => <Pressable key={character.name} accessibilityRole="button" accessibilityLabel={`Add ${character.name.trim()} to this moment`} onPress={() => appendCharacterName(character.name)} style={styles.nameToken}><Text style={styles.nameTokenText}>@{character.name.trim()}</Text></Pressable>)}</ScrollView> : null}
    <View style={styles.wrapChips}>{moments.map((moment) => <Pressable key={moment} onPress={() => { update({ moments: moments.filter((item) => item !== moment) }); onSelect(); }} style={styles.momentChip}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.momentText}>{truncateForDisplay(moment, MOMENT_DISPLAY_CHARS)}</Text><X size={14} color={colors.accent} /></Pressable>)}</View>
    {moments.length < maxMoments ? <View style={styles.momentComposer}><TextInput value={momentInput} onChangeText={onMomentInput} onSubmitEditing={() => onAddMoment(momentInput)} returnKeyType="done" maxLength={MAX_MOMENT_CHARS} placeholder="Add a moment" placeholderTextColor={colors.tertiary} style={styles.momentInput} /><Pressable accessibilityRole="button" accessibilityLabel="Add moment" onPress={() => onAddMoment(momentInput)} style={styles.momentAddButton}><Plus size={18} color={colors.surface} /></Pressable></View> : null}
    {/*
      No "Chapter plan" here. The beats are still in the draft and still go to
      generation, and the blueprint screen is where they are shown and edited --
      but surfacing chapter summaries inside More options, before the user has
      pressed Create at all, showed them the story's plan as a settings field
      and read as a leak rather than a control.
    */}

    {/* One line, two dropdowns -- checked to fit at 390pt without overflow. */}
    <View style={styles.chapterRow}>
      <Dropdown
        id="chapters"
        label="Chapters"
        value={String(draft.plannedChapterCount ?? 3)}
        options={chapterCountOptions}
        onChange={(value) => {
          const count = Number(value) as 3 | 7 | 15;
          update({ plannedChapterCount: count, isSeries: true, beats: draft.beats?.slice(0, count) });
          onSelect();
        }}
        style={styles.chapterRowItem}
      />
      <Dropdown
        id="chapterLength"
        label="Chapter length"
        value={chapterLength}
        options={chapterLengthOptions}
        onChange={(value) => { update({ chapterLength: value as "short" | "standard" | "long" }); onSelect(); }}
        style={styles.chapterRowItem}
      />
    </View>

    <View style={styles.switchRow}>
      <View style={styles.switchCopy}>
        <Text style={styles.switchLabel}>Chapter art</Text>
        {/* CREDITS_AND_PRICING.md: illustrating a chapter is +1 credit on top
            of its base 1 (so 2 total), matching every chapter from 2 onward --
            chapter 1's art is compulsory and already the cover. */}
        <Text style={styles.switchHint}>Adds an illustration to every chapter after the first, for 1 more credit each.</Text>
      </View>
      <Switch value={Boolean(draft.illustrateChapters)} onValueChange={(illustrateChapters) => { update({ illustrateChapters }); onSelect(); }} {...SWITCH_COLORS} accessibilityLabel="Chapter art" />
    </View>

    {/* Writing style and Avoid are both craft constraints on the prose, so
        they read as one group rather than two unrelated fields. */}
    <View style={styles.groupedFieldCard}>
      <OptionLabel label="Writing style" />
      <TextInput accessibilityLabel="Writing style" value={draft.writingStyle ?? ""} onChangeText={(writingStyle) => update({ writingStyle })} placeholder="e.g. Warm, witty, first person" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
      <View style={styles.groupedFieldDivider} />
      <OptionLabel label="Avoid" />
      <TextInput accessibilityLabel="Avoid" value={draft.avoid ?? ""} onChangeText={(avoid) => update({ avoid })} placeholder="e.g. No cheating or graphic violence" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
    </View>

    <View style={styles.switchRow}><View style={styles.switchCopy}><Text style={styles.switchLabel}>Visibility</Text><Text style={styles.switchHint}>{isAnonymous ? "Public unlocks when sign-in is available." : draft.visibility === "public" ? "This story can be shared after creation." : "Only you can see this story."}</Text></View><Switch value={draft.visibility === "public"} disabled={isAnonymous} onValueChange={(visible) => { update({ visibility: visible ? "public" : "private" }); onSelect(); }} {...SWITCH_COLORS} accessibilityLabel="Public visibility" /></View>

    {/*
      English only, at the bottom, for now. The spice control was removed
      outright (see chooseAudience / CreateStudioScreen); language stays
      visible on purpose so `draft.language` keeps flowing to the generation
      payload -- existing stories and the backend contract still carry a
      language, and Portuguese remains a valid stored value. This dropdown
      just stops offering it as a creation choice until it is actually ready.
    */}
    <Dropdown
      id="language"
      label="Language"
      value={draft.language}
      options={languageOptions}
      onChange={(language) => { update({ language }); onSelect(); }}
    />
  </View>;
}

function CharacterCraftScreen({
  character,
  onChange,
  onBack,
  onSave,
  onDelete,
  onCreateImage,
  onPickReference,
  onClearReference,
  unsavedPromptOpen,
  onKeepEditing,
  onDiscard,
  topInset,
  bottomInset,
}: {
  character: CharacterDraft;
  onChange: Dispatch<SetStateAction<CharacterDraft>>;
  onBack: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onCreateImage: () => void;
  onPickReference: () => void;
  onClearReference: () => void;
  unsavedPromptOpen: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
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
  const canSave = Boolean(character.name.trim()) && !imageBusy;
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
              {/*
                Render the portrait the user just paid ~12s of waiting for.

                This branch used to draw the first letter of the character's
                NAME in a 42pt display face whenever the image was ready, and
                never mounted an <Image> at all -- so a successful generation
                and a failed one looked identical. It was reported as "the
                character isn't getting generated, tried 2 times", with a
                screenshot of a big "P"; the backend had been returning a real
                public URL the whole time and the UI was throwing it away.
                The hint below is now only what a genuinely EMPTY card shows.
              */}
              {imageReady ? (
                <Image
                  source={{ uri: character.portraitUrl }}
                  // The stored asset is 2:3 portrait and so is this card, but
                  // cover (not contain) so a provider that returns a slightly
                  // different ratio still fills the frame instead of letterboxing.
                  resizeMode="cover"
                  style={styles.portraitImage}
                  accessible
                  accessibilityLabel={`Portrait of ${character.name.trim() || "this character"}`}
                />
              ) : (
                <Text style={styles.portraitHint}>Character image will appear here.</Text>
              )}
              {/*
                The busy state belongs on the CARD, not only on the button.
                Generation takes about twelve seconds; a card that sits
                completely idle for that long is exactly what got read as
                broken, whatever the button label said.
              */}
              {imageBusy ? (
                <View style={styles.portraitBusy} accessibilityLiveRegion="polite">
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.portraitBusyText}>Creating image…</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.portraitActions}>
              {/*
                Reimagine is the only image action. The "Edit" button that used
                to sit beside it simply deleted `portraitUrl` to get back to an
                empty card, which is not an edit -- and Reimagine already
                covers regenerating from the current fields.
              */}
              <Pressable disabled={!canCreateImage} onPress={onCreateImage} accessibilityRole="button" accessibilityState={{ disabled: !canCreateImage, busy: imageBusy }} style={[styles.outlineButton, !canCreateImage && styles.outlineButtonDisabled]}>
                <Text style={styles.outlineButtonText}>{imageBusy ? "Creating..." : imageReady ? "Reimagine" : "Create image"}</Text>
              </Pressable>
              {/*
                A photo steers the LOOK. It is not a likeness target, and the
                copy says so where the writer is deciding whether to attach one
                -- not buried in a policy page. The backend states the same rule
                to the model, and naming a real person locks the story private
                regardless of what was attached.
              */}
              <Pressable
                onPress={character.referenceImage ? onClearReference : onPickReference}
                accessibilityRole="button"
                accessibilityLabel={character.referenceImage
                  ? "Remove the reference photo"
                  : "Attach a reference photo"}
                style={styles.referenceButton}
              >
                <ImagePlus size={15} color={colors.accent} />
                <Text style={styles.referenceButtonText}>
                  {character.referenceImage ? "Remove reference photo" : "Attach a reference photo"}
                </Text>
              </Pressable>
              {character.referenceImage
                ? (
                  <Text style={styles.referenceHint}>
                    Used for build, hair and wardrobe only. The face will be an
                    original illustration, never a real person&apos;s likeness.
                  </Text>
                )
                : null}
              {character.portraitStatus === "failed" ? <Text style={styles.portraitError}>Image failed. Check the character details and try again.</Text> : null}
            </View>
          </View>
          <Text style={styles.optionHint}>No real people or characters you do not have rights to.</Text>
          <View style={styles.switchRow}><View><Text style={styles.switchLabel}>Lead character</Text><Text style={styles.switchHint}>Katha follows this character most closely.</Text></View><Switch value={character.isHero} onValueChange={(value) => set("isHero", value)} {...SWITCH_COLORS} accessibilityLabel="Lead character" /></View>
          {onDelete ? <Pressable onPress={onDelete} accessibilityRole="button" style={styles.deleteButton}><Text style={styles.deleteText}>Delete character</Text></Pressable> : null}
        </ScrollView>
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(bottomInset, spacing.md) }]}>
          <Pressable disabled={!character.name.trim() || imageBusy} onPress={onSave} accessibilityRole="button" accessibilityState={{ disabled: !character.name.trim() || imageBusy }} style={[styles.primaryCta, (!character.name.trim() || imageBusy) && styles.primaryCtaDisabled]}>
            <Text style={styles.primaryCtaText}>Save</Text><Check size={20} color={colors.surface} />
          </Pressable>
        </View>
      {/*
        Rendered as an overlay inside this screen rather than as a second
        React Native modal. Craft character is ALREADY a fullScreen modal, and
        nesting one inside another is the RN case that intermittently renders
        nothing on iOS. An absolutely-positioned sibling of the scroll view
        sits above everything here anyway, and it cannot be dismissed by an
        accidental swipe the way a sheet can.

        (create-flow-more-options.test.tsx counts modal elements in this file
        by source scan, so the literal tag name is deliberately not written
        here even in prose.)
      */}
      {unsavedPromptOpen ? (
        <View style={styles.dialogRoot}>
          <Pressable style={styles.dialogBackdrop} onPress={onKeepEditing} accessibilityRole="button" accessibilityLabel="Keep editing this character" />
          <View style={[styles.dialogCard, { paddingBottom: Math.max(bottomInset, spacing.xl) }]}>
            <Text style={styles.dialogTitle}>Save this character?</Text>
            <Text style={styles.dialogBody}>
              You have changes that are not saved yet. Discarding loses everything you typed on this screen{character.portraitUrl ? ", including the image you generated" : ""}.
            </Text>
            {/*
              The safe action is the big filled one and the destructive action
              says exactly what it destroys -- "Discard changes", never "Go
              back", because a user who taps the wrong control here loses the
              whole sheet. When the name is still empty there is nothing that
              CAN be saved, so the primary offers the other safe way out
              instead of sitting disabled with no explanation.
            */}
            <Pressable
              onPress={canSave ? onSave : onKeepEditing}
              accessibilityRole="button"
              accessibilityLabel={canSave ? "Save character" : "Keep editing this character"}
              style={styles.dialogPrimary}
            >
              <Text style={styles.dialogPrimaryText}>{canSave ? "Save character" : "Keep editing"}</Text>
            </Pressable>
            <Pressable
              onPress={onDiscard}
              accessibilityRole="button"
              accessibilityLabel="Discard changes to this character"
              style={styles.dialogDestructive}
            >
              <Text style={styles.dialogDestructiveText}>Discard changes</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <View style={styles.section}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{label}</Text>{hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}</View>{children}</View>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>; }
function ChoiceChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) { return <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: Boolean(selected) }} style={[styles.choiceChip, selected && styles.choiceChipActive]}><Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{label}</Text></Pressable>; }
function OptionLabel({ label }: { label: string }) { return <Text style={styles.optionLabel}>{label}</Text>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  topTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 20, flex: 1, textAlign: "center" },
  topSpacer: { width: 40 },
  parentControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, zIndex: 20 },
  genreControl: { alignSelf: "flex-start" },
  kidsMode: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.xs },
  kidsModeLabel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  kidsModeText: { color: colors.muted, fontFamily: fonts.display, fontSize: 15 },
  kidsModeTextActive: { color: colors.accent },
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
  // Matches `sectionOverline` ("Try one") on purpose -- section 2 of this
  // task asks for the same secondary heading treatment on Premise, Who's in
  // it (the section that heads Add a character), and More options. Kept as a
  // separate token from `sectionOverline` only so "Try one" itself is never
  // touched by a future change to this one.
  sectionTitle: { color: colors.ink, fontFamily: fonts.ui, fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
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
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
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
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  switchCopy: { flex: 1, gap: 2 },
  switchLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  switchHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  optionInput: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.ink, fontFamily: fonts.ui, fontSize: 14 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  helpButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  helpCaption: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, marginTop: -spacing.xs },
  chapterRow: { flexDirection: "row", gap: spacing.sm },
  chapterRowItem: { flex: 1 },
  groupedFieldCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  groupedFieldDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  reviewHero: { gap: spacing.sm, paddingTop: spacing.lg },
  // spacing.related is the label-to-control gap: the caption and the bar are
  // one unit, so they hug, and the meter as a whole is parted from the review
  // card by the scroll container's own larger gap.
  strengthMeter: { gap: spacing.related },
  strengthMeterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  strengthMeterLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 13 },
  strengthMeterCount: { color: colors.tertiary, fontFamily: fonts.ui, fontWeight: "800", fontSize: 13 },
  strengthTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderStrong, overflow: "hidden" },
  strengthFill: { height: "100%", borderRadius: 3, backgroundColor: colors.accent },
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
  portraitImage: { width: "100%", height: "100%" },
  // Sits over the card rather than replacing it, so a Reimagine keeps the
  // previous portrait visible underneath while the new one is generating.
  portraitBusy: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.accentSoft, opacity: 0.94 },
  portraitBusyText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12, fontWeight: "800" },
  portraitHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, textAlign: "center", paddingHorizontal: spacing.md },
  portraitActions: { flex: 1, gap: spacing.md, alignItems: "flex-start" },
  referenceButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  referenceButtonText: { fontFamily: fonts.ui, fontSize: 13, fontWeight: "700", color: colors.accent, letterSpacing: 0 },
  referenceHint: { fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.tertiary, letterSpacing: 0 },
  outlineButton: { minHeight: 46, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.accent, paddingHorizontal: spacing.xl, alignItems: "center", justifyContent: "center" },
  outlineButtonDisabled: { opacity: 0.45 },
  outlineButtonText: { color: colors.ink, fontFamily: fonts.ui, fontSize: 16, fontWeight: "800" },
  portraitError: { color: colors.heart, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  deleteButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.heart, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  dialogRoot: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  dialogBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink, opacity: 0.5 },
  dialogCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.related },
  dialogTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 22 },
  dialogBody: { color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  dialogPrimary: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  dialogPrimaryText: { color: colors.surface, fontFamily: fonts.ui, fontWeight: "800", fontSize: 16 },
  dialogDestructive: { minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  dialogDestructiveText: { color: colors.heart, fontFamily: fonts.ui, fontWeight: "800", fontSize: 15 },
  stickyFooter: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
