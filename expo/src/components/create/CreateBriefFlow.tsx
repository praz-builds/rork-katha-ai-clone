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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  HelpCircle,
  ImagePlus,
  Lightbulb,
  Plus,
  UserPlus,
  X,
} from "lucide-react-native";
import { CreditPill } from "@/components/KathaPrimitives";
import { Toggle } from "@/components/Toggle";
import { IdeasSheet } from "@/components/create/IdeasSheet";
import { Dropdown, DropdownGroup } from "@/components/create/Dropdown";
import type { DropdownOption } from "@/components/create/Dropdown";
import DirectionStep from "@/components/create/DirectionStep";
import { GENRE_EMOJI } from "@/lib/genre-content";
import * as storyApi from "@/lib/api";
import {
  useCharacterImageBalance,
  useCharacterImagesRemaining,
} from "@/lib/character-image-allowance";
import { FREE_PORTRAITS_PER_ACCOUNT, portraitQuote } from "@/lib/entitlements";
import {
  CHAPTER_ART_CREDITS,
  CHAPTER_TEXT_CREDITS,
  STORY_START_CREDITS,
} from "@/lib/pricing-limits";
import { formatCredits } from "@/lib/pricing";
import {
  draftCharacterFromSaved,
  listSavedCharacters,
  saveCharacterToLibrary,
  savedCharacterInputFromDraft,
} from "@/lib/saved-characters";
import type { SavedCharacterInput } from "@/lib/saved-characters";
import { Button } from "@/components/Button";
import { colors, fonts, genreLabels, radius, shadows, spacing } from "@/theme";
import type {
  AudienceMode,
  CreateDraft,
  CreationLanguage,
  Genre,
  ImageStyle,
  PlannedChapterCountOffer,
  SavedCharacter,
  StoryFlow,
} from "@/types/domain";
import {
  KIDS_UI_GENRES,
  PLANNED_CHAPTER_COUNT_OFFER,
  UI_GENRES,
} from "@/types/domain";

type CharacterDraft = CreateDraft["characters"][number];

export type StudioCreateDraft = Omit<CreateDraft, "visibility"> & {
  isSeries: boolean;
  /** Publish intent only. Generation remains private until the final save. */
  visibility: "private" | "public";
};

/**
 * `review` is gone. The screen that restated the brief and asked the writer to
 * agree with themselves is now the direction step -- the same chips the reader
 * gets between chapters, derived from the idea they just typed. See
 * `components/create/DirectionStep.tsx`.
 */
type CreateStage = "main" | "character" | "direction";
/** Which half of "Who's in it" is showing: the saved library, or a new sheet. */
export type CastTab = "saved" | "new";

type Props = {
  credits: number;
  isAnonymous: boolean;
  draft: StudioCreateDraft;
  setDraft: Dispatch<SetStateAction<StudioCreateDraft>>;
  /**
   * Start the story with the opening the writer chose.
   *
   * The choice is handed over rather than written into the draft first,
   * because `setDraft` lands on the next render and the generation would read
   * the state as it was BEFORE the tap -- the story would be written without
   * the direction the writer had just picked.
   */
  onGenerate: (choice?: { direction?: string; beats?: string[] }) => void;
  onBack: () => void;
  /** Test seams for the saved-character library; default to the real store. */
  loadSavedCharacters?: () => Promise<SavedCharacter[]>;
  saveSavedCharacter?: (input: SavedCharacterInput) => Promise<SavedCharacter>;
};

/** A blank Craft character sheet. Exported for the saved-characters picker. */
export function emptyCharacterDraft(isHero: boolean): CharacterDraft {
  return { name: "", background: "", appearance: "", isHero };
}

/**
 * The reference cap, as `generate-character-image` enforces it.
 *
 * Kept in step with `MAX_REFERENCE_IMAGE_CHARS` on the endpoint deliberately.
 * A photo over it is refused there whatever this file believes, so measuring
 * it here is the difference between "that photo is too large, pick another"
 * and a portrait request that fails for reasons the writer cannot see.
 */
const MAX_REFERENCE_IMAGE_CHARS = 6 * 1024 * 1024;

/**
 * Attach a photo that steers a character's look. Returns the `data:` URL, or
 * null when the writer cancelled or the photo could not be read.
 *
 * Re-encoded at `quality: 0.8` and cropped to the portrait frame, then
 * MEASURED against the endpoint's cap. It is not resized: doing that needs
 * `expo-image-manipulator`, which is not a dependency of this app, and this
 * comment used to claim a 1024px long edge that no line of code produced --
 * so a large photo simply travelled, was refused by the endpoint, and the
 * writer was told their portrait had failed. An honest refusal here, naming
 * the photo, is worth more than a silent one two screens later.
 *
 * `base64: true` because the endpoint takes a data URL. The bytes never
 * touch our storage: the reference exists only for the length of one
 * portrait request and is dropped as soon as it has been used.
 */
export async function pickReferenceImage(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      "Photo access needed",
      "Katha needs permission to open your photos so you can attach a reference.",
    );
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.8,
    base64: true,
    allowsEditing: true,
    aspect: [2, 3],
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!asset.base64) {
    Alert.alert(
      "Couldn't read that photo",
      "Please pick a different image, or try a JPEG or PNG.",
    );
    return null;
  }

  // The endpoint's allowlist is JPEG, PNG and WebP; anything else is refused
  // there. Naming the type from the asset rather than assuming PNG is what
  // keeps that refusal about the actual file.
  const mime = asset.mimeType && /^image\/(jpeg|jpg|png|webp)$/.test(asset.mimeType)
    ? asset.mimeType
    : "image/jpeg";
  const dataUrl = `data:${mime};base64,${asset.base64}`;
  if (dataUrl.length > MAX_REFERENCE_IMAGE_CHARS) {
    Alert.alert(
      "That photo is too large",
      "Pick a smaller photo, or crop it tighter, and try again.",
    );
    return null;
  }
  return dataUrl;
}

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

/**
 * One chapter is on the list, and picking it still sets `isSeries`.
 *
 * A one-chapter story is a SERIES OF ONE, not a standalone. That is what makes
 * it growable: a series that has reached its plan offers the reader direction
 * chips at its end, and picking one buys the next chapter. A standalone has no
 * chapter two at all -- its ending is a rewrite -- so routing 1 there would
 * turn the shortest option into the only dead end.
 */
const CHAPTER_COUNTS = PLANNED_CHAPTER_COUNT_OFFER;

/**
 * The six dropdowns, defined once.
 *
 * Four of them sit above the text fields as the band of decisions that shape
 * what gets written -- how the story moves, how long it runs, and what its art
 * looks like per chapter -- and two sit at the foot of the screen, next to the
 * button that spends the credits, because they are the last two things a
 * writer changes their mind about: how it looks, and who can read it.
 *
 * They are arrays rather than inline literals so the same option list backs the
 * control, its accessible value and the tests, and cannot be respelled in one
 * place and not another.
 */
const STORY_FLOW_OPTIONS: DropdownOption<StoryFlow>[] = [
  {
    value: "interactive",
    label: "Interactive",
    detail: "You pick what happens next at the end of every chapter.",
  },
  {
    value: "auto",
    /*
      THE PRICE IS ON THIS OPTION BECAUSE THIS OPTION IS WHAT SPENDS IT.

      Auto buys its whole run the moment chapter one lands: the server works
      out how many of the planned chapters the balance affords and reserves
      them all at once. The Create button says "1 credit", which is true of the
      start and silent about the eleven that follow a moment later -- and a
      writer who watches their balance empty without having been told has been
      misled by us, not by the feature.

      The number is not quoted here because it is not knowable from the brief:
      it depends on the balance at the moment the run starts, which the brief
      cannot see. So the copy states the SHAPE of the charge -- all of it, up
      front, for as many chapters as the credits reach -- which is the part a
      writer needs before they pick, and the part that is true whatever their
      balance turns out to be.
    */
    label: "Auto-continue",
    detail:
      "Katha picks the direction itself and keeps writing. Charged up front " +
      "for as many chapters as your credits cover, then it stops.",
  },
];

const IMAGE_STYLE_OPTIONS: DropdownOption<ImageStyle>[] = [
  { value: "auto", label: "Auto", detail: "Katha matches the art to the genre." },
  { value: "anime", label: "Anime" },
  { value: "cinematic", label: "Cinematic" },
  { value: "comic", label: "Comic" },
  { value: "watercolor", label: "Watercolor" },
];

/**
 * Which art a story gets: one cover, or a fresh image per chapter.
 *
 * The stored field is still `illustrateChapters`, the boolean the generation
 * contract sends as `illustrate_chapters`. This dropdown replaced a switch, and
 * changing the wire field alongside the control would have made a UI change a
 * backend change for no reason.
 */
type ChapterCover = "cover" | "perChapter";

/**
 * Priced from the constants, never from a literal.
 *
 * Chapter one's art is the story's cover and is already inside the start price,
 * so it is never billed separately. That means EVERY chapter this option
 * actually charges for -- chapter two onward -- is text plus art. An earlier
 * revision said "1 credit for the first, 2 from the next", which mis-numbered
 * which chapter "the first" is: `CREDITS_AND_PRICING.md` prices a 3-chapter
 * illustrated story at 5 (1 + 2 + 2), so chapter two is 2 and there is no
 * chapter anywhere on this option that costs 1.
 *
 * Composed from the constants rather than hand-typed, because this is the only
 * place in the brief that quotes a price and a hand-typed number keeps saying
 * it long after the pricing document has moved on.
 */
const CHAPTER_COVER_OPTIONS: DropdownOption<ChapterCover>[] = [
  {
    value: "cover",
    label: "Cover art only",
    detail: "One cover for the whole story.",
  },
  {
    value: "perChapter",
    label: "Auto-generated per chapter",
    detail:
      `Its own art for every chapter · ` +
      `${CHAPTER_TEXT_CREDITS + CHAPTER_ART_CREDITS} credits a chapter ` +
      `instead of ${CHAPTER_TEXT_CREDITS}. The cover is already included.`,
  },
];

const CHAPTER_COUNT_OPTIONS: DropdownOption<string>[] = CHAPTER_COUNTS.map((count) => {
  const label = count === 1 ? "1 chapter" : `${count} chapters`;
  return {
    value: String(count),
    label,
    detail: count === 1
      // Not a warning, and not a standalone. The reader is told what the end
      // of a one-chapter story actually offers, because "1" otherwise reads
      // as the option that gets them the least.
      //
      // The price is stated here and only here, because a one-chapter story is
      // the ONE plan whose whole cost is knowable from the brief: the start
      // credit buys the cast, the chapter and the cover, and nothing follows
      // it. Every longer plan's total depends on how far the writer actually
      // goes, and quoting one would be quoting a number they may never spend.
      ? `One chapter, and the option to keep going at the end of it · ` +
        `${formatCredits(STORY_START_CREDITS)} in total.`
      : undefined,
    valueLabel: String(count),
    accessibilityLabel: label,
  };
});

const CHAPTER_LENGTH_OPTIONS: DropdownOption<string>[] = CHAPTER_LENGTHS.map((item) => ({
  value: item.id,
  label: item.label,
  detail: `About ${item.minutes} min · ${item.words}`,
}));

const LANGUAGE_OPTIONS: DropdownOption<CreationLanguage>[] = [
  { value: "English", label: "English" },
];

/*
 * There is no `SWITCH_COLORS` here any more, and no `Switch`.
 *
 * The four toggles on this screen used React Native's `Switch` with a spread
 * of colour props. `Switch` paints its thumb and its off-state fill from the
 * PLATFORM palette, so the Kids Mode row shipped an orange track under an iOS
 * GREEN thumb -- a colour that appears in no token file in this repository.
 * They are all `@/components/Toggle` now, which draws every pixel from
 * `@/theme` and has no platform fallback to fall back to.
 */

/**
 * The real cap on a single moment's text is 300 characters --
 * `MAX_BRIEF_FIELD_LENGTH` in `backend/supabase/functions/_shared/types.ts`,
 * enforced again server-side by `validation.ts`'s `stringList()`. Mirrored
 * here as the composer's own input cap so a moment is never silently cut down
 * after the user believed they had written the whole thing.
 */
const MAX_MOMENT_CHARS = 300;
/**
 * How much of a moment's text a chip shows before an ellipsis. Purely cosmetic -- it is a display cap, not a data cap. The full
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
    appearance: character.appearance.trim(),
    background: (character.background ?? "").trim(),
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
 * How many slots `briefStrength()` scores out of. Named so the percentage
 * under the Create button and the score itself cannot drift apart.
 */
const STRENGTH_SLOTS = 4;

function briefStrength(draft: StudioCreateDraft) {
  const slots = [draft.seed.trim(), draft.whereAndWhen?.trim(), draft.characters.some((item) => item.name.trim()), draft.moments?.length].filter(Boolean).length;
  if (slots >= 4) return { label: "Rich", detail: "Katha has plenty to work with.", slots };
  if (slots === 3) return { label: "Strong", detail: "This will sound like yours.", slots };
  if (slots === 2) return { label: "Good", detail: "Enough to write from.", slots };
  return { label: "Sparse", detail: "Katha will invent most of this. That can be good.", slots };
}

export default function CreateBriefFlow({
  credits,
  isAnonymous,
  draft,
  setDraft,
  onGenerate,
  onBack,
  loadSavedCharacters = listSavedCharacters,
  saveSavedCharacter = saveCharacterToLibrary,
}: Props) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<CreateStage>("main");
  /**
   * The saved library, read once per mount. `null` until the first read
   * settles so the Saved tab is not chosen as the default on an empty list
   * that is merely still loading.
   */
  const [savedCharacters, setSavedCharacters] = useState<SavedCharacter[] | null>(null);
  /**
   * Which half of "Who's in it" is showing. Saved leads when the library
   * already has someone in it, but only ever as the *opening* choice: it is
   * decided once, when the first read settles, and never recomputed. Deriving
   * it from the list on every render would yank a writer from New to Saved
   * the moment they finish crafting their first character - mid-flow, with
   * the "Add a character" row disappearing under their thumb.
   */
  const [castTab, setCastTab] = useState<CastTab>("new");
  const castTabDecided = useRef(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [momentInput, setMomentInput] = useState("");
  const [editingCharacterIndex, setEditingCharacterIndex] = useState<number | null>(null);
  const [characterBuffer, setCharacterBuffer] = useState<CharacterDraft>({ name: "", background: "", appearance: "", isHero: false });
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
  const isDirection = stage === "direction";

  useEffect(() => {
    let cancelled = false;
    loadSavedCharacters().then(
      (list) => {
        if (cancelled) return;
        setSavedCharacters(list);
        if (!castTabDecided.current) {
          castTabDecided.current = true;
          if (list.length > 0) setCastTab("saved");
        }
      },
      () => {
        if (cancelled) return;
        setSavedCharacters([]);
        castTabDecided.current = true;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadSavedCharacters]);

  /**
   * One tap adds a saved character to the cast; tapping the same chip again
   * removes exactly that row (matched on `savedCharacterId`, never on name,
   * so a hand-typed namesake is left alone). The cap is evaluated inside the
   * updater, like `addCharacter` - see cast-cap.test.ts for why.
   */
  const toggleSavedCharacter = useCallback((saved: SavedCharacter) => {
    setDraft((previous) => {
      const existingIndex = previous.characters.findIndex((item) => item.savedCharacterId === saved.id);
      if (existingIndex >= 0) {
        const characters = previous.characters.filter((_, index) => index !== existingIndex);
        const stillHasLead = characters.some((item) => item.isHero);
        return {
          ...previous,
          characters: characters.map((item, index) => ({ ...item, isHero: stillHasLead ? item.isHero : index === 0 })),
        };
      }
      if (previous.characters.length >= 3) return previous;
      return {
        ...previous,
        characters: [
          ...previous.characters,
          draftCharacterFromSaved(saved, previous.characters.length === 0),
        ],
      };
    });
    select();
  }, [select, setDraft]);

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
      opened = { name: "", background: "", appearance: "", isHero: draft.characters.length === 0 };
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
    const next = { ...characterBuffer, name: characterBuffer.name.trim(), appearance: characterBuffer.appearance.trim() };
    setDraft((previous) => {
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
    // Every character crafted here is also a saved character. Fire and forget:
    // a library write failing must not cost the writer their cast, and the
    // list simply refreshes when it lands.
    // The row this save belongs to, decided BEFORE the round trip: the one
    // being edited, or the one just appended. Matching by name afterwards
    // stamped the library id onto every unsaved cast member sharing it, so a
    // brief with two people called "Naina" ended up with both pointing at one
    // library entry -- and editing either would have overwritten the other.
    const savedIndex = editingCharacterIndex ?? draft.characters.length;
    saveSavedCharacter(savedCharacterInputFromDraft(next)).then(
      (saved) => {
        setSavedCharacters((previous) => [saved, ...(previous ?? []).filter((item) => item.id !== saved.id)]);
        setDraft((previous) => ({
          ...previous,
          characters: previous.characters.map((item, index) =>
            index === savedIndex && !item.savedCharacterId
              ? { ...item, savedCharacterId: saved.id }
              : item
          ),
        }));
      },
      () => {},
    );
  }, [characterBuffer, confirm, draft.characters.length, editingCharacterIndex, saveSavedCharacter, setDraft]);

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
   * regenerate the OLD appearance and look like the model ignoring the user.
   *
   * `background` is not sent: the `generate-character-image` edge function
   * accepts `name`, `appearance` and `image_style` only and 400s on nothing
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
    const referenceImage = await pickReferenceImage();
    if (!referenceImage) return;
    setCharacterBuffer((previous) => ({ ...previous, referenceImage }));
  }, []);

  const clearCharacterReference = useCallback(() => {
    setCharacterBuffer((previous) => ({ ...previous, referenceImage: undefined }));
  }, []);

  /**
   * Why the last image attempt was refused, in the server's own words.
   *
   * Every failure used to land on `portraitStatus: "failed"` and nothing else,
   * so "you are out of credits", "you have made a lot of these just now" and
   * "the provider could not draw it" were one silent empty card. Only the
   * server knows which of those it was -- the six and the price are its
   * counters, not ours -- so its sentence is what is shown.
   */
  const [portraitNotice, setPortraitNotice] = useState<string | null>(null);

  const createCharacterImage = useCallback(async () => {
    const name = characterBuffer.name.trim();
    if (!name || characterBuffer.portraitStatus === "generating") return;
    setPortraitNotice(null);
    setCharacterBuffer((previous) => ({
      ...previous,
      portraitStatus: "generating",
    }));
    try {
      const { url } = await storyApi.generateCharacterImage({
        requestId: storyApi.createGenerationRequestId(),
        name,
        appearance: characterBuffer.appearance,
        referenceImage: characterBuffer.referenceImage,
        // The look the cover will be drawn in. Without it the portrait on this
        // very screen comes back in the house style, next to a cover the
        // writer asked to be something else.
        imageStyle: draft.imageStyle,
      });
      setCharacterBuffer((previous) => ({
        ...previous,
        portraitUrl: url,
        portraitStatus: "ready",
      }));
      confirm();
    } catch (error) {
      setPortraitNotice(
        error instanceof Error && error.message
          ? error.message
          : "Could not create the character image. Please try again.",
      );
      setCharacterBuffer((previous) => ({
        ...previous,
        portraitStatus: "failed",
      }));
    }
  }, [characterBuffer, confirm, draft.imageStyle]);

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
   * Create hands off to the direction step, not to a review screen.
   *
   * Nothing is spent here: the step shapes the idea for free and the writer
   * picks the opening, which is the tap that actually starts the story. Back
   * returns to the same `main` stage with the same `draft` untouched.
   */
  const goToDirection = useCallback(() => {
    confirm();
    setStage("direction");
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
          {isDirection ? (
            <DirectionStep
              brief={{
                seed: draft.seed,
                primaryGenre: draft.primaryGenre,
                characters: draft.characters,
                moments: draft.moments,
                writingStyle: draft.writingStyle,
                avoid: draft.avoid,
                chapterLength: draft.chapterLength,
                plannedChapterCount: draft.plannedChapterCount,
              }}
              credits={credits}
              onBack={backToMain}
              onStart={onGenerate}
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
              savedCharacters={savedCharacters ?? []}
              castTab={castTab}
              onCastTab={(tab) => { select(); setCastTab(tab); }}
              onToggleSavedCharacter={toggleSavedCharacter}
              onAddMoment={addMoment}
              onMomentInput={setMomentInput}
              onToggleOptions={() => { select(); setMoreOptionsOpen((open) => !open); }}
              isAnonymous={isAnonymous}
              strength={strength}
              credits={credits}
              onCreate={goToDirection}
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
          credits={credits}
          isAnonymous={isAnonymous}
          portraitNotice={portraitNotice}
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
  savedCharacters,
  castTab,
  onCastTab,
  onToggleSavedCharacter,
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
  savedCharacters: SavedCharacter[];
  castTab: CastTab;
  onCastTab: (tab: CastTab) => void;
  onToggleSavedCharacter: (character: SavedCharacter) => void;
  onAddMoment: (value: string) => void;
  onMomentInput: (value: string) => void;
  onToggleOptions: () => void;
  onCreate: () => void;
  onSelect: () => void;
}) {
  const update = (patch: Partial<StudioCreateDraft>) => onSetDraft((previous) => ({ ...previous, ...patch }));
  // Opened by "View ideas", closed by picking, the close button, the scrim or
  // hardware back. Never a value the brief persists: it is a detour off the
  // idea box, not a step of the brief.
  const [ideasOpen, setIdeasOpen] = useState(false);
  // The constant, not a literal. This read `credits >= 3` while the studio's
  // own guard read `STORY_START_CREDITS`, so when the start price moved to 1
  // the brief would have gone on refusing to write a story the writer could
  // afford -- a disabled Create button and copy demanding credits they already
  // had.
  const hasCredits = credits >= STORY_START_CREDITS;
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
          <Toggle value={draft.audienceMode === "kids"} onValueChange={(enabled) => onAudience(enabled ? "kids" : "adult")} accessibilityLabel="Kids Mode" accessibilityHint="Keeps the story safe for children and limits the genres offered." />
          {/* No icon. A sparkle next to "Kids Mode" said nothing about
              children and everything about generation -- it is the glyph this
              app uses for "the AI is doing something", which is not what this
              switch is. The switch and the words are the whole control. */}
          <View style={styles.kidsModeLabel}>
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
      {/*
        One control where three cards used to stack. The starters still exist
        and are still keyed to the genre chip above -- they are just one tap
        away instead of occupying most of the first screen. See
        src/components/create/IdeasSheet.tsx.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${genreLabels[draft.primaryGenre]} ideas`}
        accessibilityHint="Opens starter ideas for the genre you picked."
        onPress={() => { onSelect(); setIdeasOpen(true); }}
        style={styles.viewIdeas}
      >
        <Lightbulb size={15} color={colors.accent} />
        <Text style={styles.viewIdeasLabel}>View ideas</Text>
        <ChevronRight size={15} color={colors.tertiary} />
      </Pressable>
      <IdeasSheet
        visible={ideasOpen}
        genre={draft.primaryGenre}
        onClose={() => setIdeasOpen(false)}
        onPick={(seed) => { update({ seed }); setIdeasOpen(false); onSelect(); }}
      />

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
        {/*
          Two ways in: the saved library (one tap per person) and a new sheet.
          Saved leads when the library has anyone in it; a first-time writer
          sees New, where the only useful action is.
        */}
        <View style={styles.castTabs} accessibilityRole="tablist">
          {(["saved", "new"] as const).map((tab) => {
            const selected = castTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => onCastTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={tab === "saved" ? "Saved characters" : "New character"}
                style={[styles.castTab, selected && styles.castTabSelected]}
              >
                <Text style={[styles.castTabLabel, selected && styles.castTabLabelSelected]}>
                  {tab === "saved" ? "Saved" : "New"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {castTab === "saved" ? (
          savedCharacters.length === 0 ? (
            <Text style={styles.savedEmpty}>Characters you create in a story are saved here automatically.</Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChips}>
                {savedCharacters.map((saved) => {
                  const added = draft.characters.some((item) => item.savedCharacterId === saved.id);
                  const atCap = !added && draft.characters.length >= 3;
                  return (
                    <Pressable
                      key={saved.id}
                      onPress={() => onToggleSavedCharacter(saved)}
                      disabled={atCap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: added, disabled: atCap }}
                      accessibilityLabel={added ? `Remove ${saved.name} from this story` : `Add ${saved.name} to this story`}
                      style={[styles.savedChip, added && styles.savedChipAdded, atCap && styles.savedChipDisabled]}
                    >
                      {saved.portraitUrl
                        ? <Image source={{ uri: saved.portraitUrl }} resizeMode="cover" style={styles.savedChipPortrait} />
                        : <View style={[styles.savedChipPortrait, styles.savedChipInitialWrap]}><Text style={styles.savedChipInitial}>{saved.name.trim().slice(0, 1).toUpperCase() || "?"}</Text></View>}
                      <Text numberOfLines={1} style={[styles.savedChipLabel, atCap && styles.savedChipLabelDisabled]}>{saved.name}</Text>
                      {/* A tick when this person is already in the story, a
                          plus when tapping would add them. The chip used to
                          show a tick or nothing at all, so an unused saved
                          character read as a label rather than as something
                          you could put in the story. */}
                      {added
                        ? <CheckCircle2 size={14} color={colors.accent} />
                        : <Plus size={14} color={atCap ? colors.tertiary : colors.accent} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
              {draft.characters.length >= 3 ? <Text style={styles.savedCapHint}>Up to three characters per story.</Text> : null}
            </>
          )
        ) : null}
        <View style={styles.characterList}>
          {draft.characters.map((character, index) => <Pressable key={`${character.name}-${index}`} onPress={() => onEditCharacter(index)} accessibilityRole="button" accessibilityLabel={`Edit ${character.name || "character"}`} style={styles.characterCard}><View style={[styles.avatar, character.isHero && styles.avatarLead, character.portraitStatus === "ready" && styles.avatarReady]}>{character.portraitStatus === "ready" && character.portraitUrl ? <Image source={{ uri: character.portraitUrl }} resizeMode="cover" style={styles.avatarImage} accessible accessibilityLabel={`Portrait of ${character.name.trim() || "this character"}`} /> : character.portraitStatus === "generating" ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.avatarText}>{character.name.trim().slice(0, 1).toUpperCase() || "?"}</Text>}</View><View style={styles.characterCopy}><Text style={styles.characterName}>{character.name || "Untitled character"}{character.isHero ? " · Lead" : ""}</Text><Text numberOfLines={1} style={styles.characterDescription}>{character.portraitStatus === "ready" ? "Image ready" : character.portraitStatus === "failed" ? "Image failed" : character.appearance || "Details waiting"}</Text></View><ChevronRight size={18} color={colors.tertiary} /></Pressable>)}
          {castTab === "new" && draft.characters.length < 3 ? <Pressable onPress={onAddCharacter} accessibilityRole="button" accessibilityLabel="Add a character" style={styles.addCharacter}><View style={styles.addCharacterIcon}><UserPlus size={20} color={colors.accent} /></View><View style={styles.addCharacterCopy}><Text style={styles.addCharacterTitle}>Add a character</Text></View><Plus size={20} color={colors.accent} /></Pressable> : null}
        </View>
      </Section>

      <View style={styles.optionsFamily}>
        <Pressable onPress={onToggleOptions} accessibilityRole="button" accessibilityLabel="More options" accessibilityState={{ expanded: moreOptionsOpen }} style={styles.optionsToggle}><Text style={styles.sectionTitle}>More options</Text><ChevronDown size={16} color={colors.ink} style={{ transform: [{ rotate: moreOptionsOpen ? "180deg" : "0deg" }] }} /></Pressable>
        {moreOptionsOpen ? <MoreOptions draft={draft} isAnonymous={isAnonymous} maxMoments={maxMoments} momentInput={momentInput} onMomentInput={onMomentInput} onAddMoment={onAddMoment} update={update} onSelect={onSelect} /> : null}
      </View>
      {/* The cost card is gone. It restated a number that is on the button
          directly above it, and the number itself moves with what the brief
          asks for -- chapter art, cover mode, chapter count -- so stating it
          twice meant two places to be wrong. */}
      {!hasCredits ? <Text style={styles.creditWarning}>You need {formatCredits(STORY_START_CREDITS)} to start this story.</Text> : null}
      {!ideaReady ? <Text style={styles.creditWarning}>Add a little more before generating this story.</Text> : null}
      {hasPendingCharacterImage ? <Text style={styles.creditWarning}>Wait for character images to finish before creating the story.</Text> : null}
      <Button label="Create story" onPress={onCreate} disabled={!ideaReady || !hasCredits || hasPendingCharacterImage} style={styles.primaryCta} />
      <Text style={styles.ctaStrength}>strength {Math.min(100, Math.round((strength.slots / STRENGTH_SLOTS) * 100))}% · {strength.label.toLowerCase()}</Text>
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
  // noise the model has to ignore, and the moment chips echo that text back
  // verbatim.
  const appendCharacterName = (name: string) => {
    const base = momentInput.trimEnd();
    onMomentInput(base ? `${base} ${name.trim()}` : name.trim());
    onSelect();
  };

  return <View style={styles.optionsPanel}>
    {/*
      MOMENTS OPEN THIS PANEL, above the craft fields and the dropdowns.
      The cast tags come from `draft.characters`, so a saved character added to
      the story and a newly made one both show up here as soon as they're named.

      Both halves of the control -- the help toggle with its caption and the
      composer with its cast tags -- moved together, because they are one
      control: the caption explains what the box below it is asking for, and
      splitting them would leave an unexplained text field in one place and an
      explanation of nothing in another.
    */}
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
    {moments.length < maxMoments ? <View style={styles.momentComposer}><TextInput value={momentInput} onChangeText={onMomentInput} onSubmitEditing={() => onAddMoment(momentInput)} returnKeyType="done" maxLength={MAX_MOMENT_CHARS} placeholder="Moments to include in general or between characters" placeholderTextColor={colors.tertiary} style={styles.momentInput} /><Pressable accessibilityRole="button" accessibilityLabel="Add moment" onPress={() => onAddMoment(momentInput)} style={styles.momentAddButton}><Plus size={18} color={colors.surface} /></Pressable></View> : null}

    {/* Writing style and Avoid are both craft constraints on the prose, so
        they read as one group rather than two unrelated fields. */}
    <View style={styles.groupedFieldCard}>
      <OptionLabel label="Writing style" />
      <TextInput accessibilityLabel="Writing style" value={draft.writingStyle ?? ""} onChangeText={(writingStyle) => update({ writingStyle })} placeholder="e.g. Warm, witty, first person" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
      <View style={styles.groupedFieldDivider} />
      <OptionLabel label="Avoid" />
      <TextInput accessibilityLabel="Avoid" value={draft.avoid ?? ""} onChangeText={(avoid) => update({ avoid })} placeholder="e.g. No cheating or graphic violence" placeholderTextColor={colors.tertiary} style={styles.optionInput} />
    </View>

    {/*
      No "Chapter plan" here. The beats are still in the draft and still go to
      generation, and the direction step is where the opening is chosen -- but
      surfacing chapter summaries inside More options, before the user has
      pressed Create at all, showed them the story's plan as a settings field
      and read as a leak rather than a control.
    */}

    {/*
      Every dropdown lives here now, below the writing fields: the four that
      shape the story, then the art and who can read it. The two-column wrap
      reflows to one column on a narrow device or a large `fontScale`.
    */}
    <View style={styles.optionGrid}>
      <Dropdown
        id="storyFlow"
        help
        label="Story mode"
        value={draft.storyFlow ?? "interactive"}
        options={STORY_FLOW_OPTIONS}
        onChange={(storyFlow) => { update({ storyFlow }); onSelect(); }}
        style={styles.optionGridItem}
      />
      <Dropdown
        id="chapters"
        label="Chapters"
        value={String(draft.plannedChapterCount ?? 3)}
        options={CHAPTER_COUNT_OPTIONS}
        onChange={(value) => {
          const count = Number(value) as PlannedChapterCountOffer;
          update({ plannedChapterCount: count, isSeries: true, beats: draft.beats?.slice(0, count) });
          onSelect();
        }}
        style={styles.optionGridItem}
      />
      <Dropdown
        id="chapterLength"
        help
        label="Chapter length"
        value={storyApi.effectiveChapterLength(draft)}
        options={CHAPTER_LENGTH_OPTIONS}
        onChange={(value) => { update({ chapterLength: value as "short" | "standard" | "long" }); onSelect(); }}
        style={styles.optionGridItem}
      />
      <Dropdown
        id="chapterCover"
        help
        label="Chapter cover"
        value={draft.illustrateChapters ? "perChapter" : "cover"}
        options={CHAPTER_COVER_OPTIONS}
        onChange={(value) => { update({ illustrateChapters: value === "perChapter" }); onSelect(); }}
        style={styles.optionGridItem}
      />
      <Dropdown
        id="imageStyle"
        help
        label="Image style"
        value={draft.imageStyle ?? "auto"}
        options={IMAGE_STYLE_OPTIONS}
        onChange={(imageStyle) => { update({ imageStyle }); onSelect(); }}
        style={styles.optionGridItem}
      />
      {/*
        A guest can see the choice and cannot make it -- the option's own words
        carry the reason. Onboarding requires email sign-in, so only a dev
        session that skipped it ever lands here as a guest.
      */}
      <Dropdown
        id="visibility"
        help
        label="Who can read it"
        value={isAnonymous ? "private" : draft.visibility}
        options={[
          { value: "private", label: "Private", detail: "Only you can see this story." },
          {
            value: "public",
            label: "Public",
            detail: isAnonymous
              ? "Public unlocks when sign-in is available."
              : "Anyone on Katha can read it once it's written.",
          },
        ]}
        disabled={isAnonymous}
        onChange={(visibility) => { update({ visibility }); onSelect(); }}
        style={styles.optionGridItem}
      />
    </View>

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
      options={LANGUAGE_OPTIONS}
      onChange={(language) => { update({ language }); onSelect(); }}
    />
  </View>;
}

export function CharacterCraftScreen({
  character,
  onChange,
  onBack,
  onSave,
  onDelete,
  onCreateImage,
  credits,
  /**
   * An anonymous identity may use its six free images and buy none, so the
   * sheet must refuse rather than quote a price its own server will decline.
   */
  isAnonymous = false,
  portraitNotice = null,
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
  isAnonymous?: boolean;
  /**
   * The caller's live balance, so a priced button that cannot be paid for is
   * not offered.
   *
   * Optional because this sheet is also opened from the reader, through the
   * saved-characters picker, and the reader carries no balance. Absent falls
   * back to the last balance the server reported alongside the free count.
   */
  credits?: number;
  /** Why the last attempt was refused, in the server's own words. */
  portraitNotice?: string | null;
  onPickReference: () => void;
  onClearReference: () => void;
  unsavedPromptOpen: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  topInset: number;
  bottomInset: number;
}) {
  const set = (key: keyof CharacterDraft, value: string | boolean) => onChange((previous) => ({ ...previous, [key]: value }));
  // What the next image costs, from the server's own count of what this
  // account has left. The button used to carry no price at all, so the first
  // charged image spent a credit the writer was never quoted -- and the count
  // it quoted from was a prop nobody passed, so it always said "free".
  const freeRemaining = useCharacterImagesRemaining();
  const lastKnownBalance = useCharacterImageBalance();
  const affordable = credits ?? lastKnownBalance;
  const portraitPrice = freeRemaining === null
    ? null
    : portraitQuote({
      usedOnAccount: FREE_PORTRAITS_PER_ACCOUNT - freeRemaining,
      isAnonymous,
    });
  const imageReady = character.portraitStatus === "ready" && Boolean(character.portraitUrl);
  const imageBusy = character.portraitStatus === "generating";
  // A priced image the balance cannot buy is a button that will certainly
  // fail. Quoting the price and then letting them press it is worse than not
  // offering it: they wait, and the refusal arrives where the portrait should.
  // Two ways a priced image is unreachable, and a guest hits the second while
  // holding enough credits for the first: `requiresAccount` means the server
  // will refuse whatever the balance says, because an anonymous identity may
  // not buy a seventh at all.
  const cannotAfford = portraitPrice !== null && !portraitPrice.free &&
    (portraitPrice.requiresAccount === true ||
      (affordable !== null && affordable < 1));
  const canCreateImage = Boolean(
    character.name.trim() &&
      character.appearance.trim() &&
      !imageBusy &&
      !cannotAfford,
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
          <Field label="Background"><TextInput accessibilityLabel="Background" value={character.background ?? ""} onChangeText={(value) => set("background", value)} placeholder="Personality, relationships, backstory, traits. e.g. Keeps her late father's recipes but never uses them." placeholderTextColor={colors.tertiary} multiline textAlignVertical="top" style={[styles.textArea, styles.characterArea]} /></Field>
          <Field label="Appearance"><TextInput accessibilityLabel="Appearance" value={character.appearance} onChangeText={(value) => set("appearance", value)} placeholder="Who they are and what they look like. e.g. A 29-year-old baker with a practical streak, curly hair, flour on her sleeves." placeholderTextColor={colors.tertiary} multiline textAlignVertical="top" style={[styles.textArea, styles.characterArea]} /></Field>
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
                What the next portrait costs, beside the button that spends it.
                A price line rather than a suffix on the label, so the control
                keeps one name for the whole of its life: the label is what
                assistive technology announces and what every test presses by,
                and a name that changes with the writer's balance is a
                different control every time they open the sheet.
              */}
              {imageBusy || !portraitPrice ? null : (
                <Text style={styles.portraitPrice}>
                  {cannotAfford ? `${portraitPrice.label} — you have none` : portraitPrice.label}
                </Text>
              )}
              {portraitNotice ? (
                <Text style={styles.portraitPrice} accessibilityLiveRegion="polite">{portraitNotice}</Text>
              ) : null}
              {/*
                A photo steers the LOOK. It is not a likeness target, and the
                copy says so where the writer is deciding whether to attach one
                -- not buried in a policy page. The backend states the same rule
                to the model.
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
          <View style={styles.switchRow}><View><Text style={styles.switchLabel}>Lead character</Text><Text style={styles.switchHint}>Katha follows this character most closely.</Text></View><Toggle value={character.isHero} onValueChange={(value) => set("isHero", value)} accessibilityLabel="Lead character" /></View>
          {onDelete ? <Pressable onPress={onDelete} accessibilityRole="button" style={styles.deleteButton}><Text style={styles.deleteText}>Delete character</Text></Pressable> : null}
        </ScrollView>
        <View style={[styles.stickyFooter, { paddingBottom: Math.max(bottomInset, spacing.md) }]}>
          <Button label="Save" onPress={onSave} disabled={!character.name.trim() || imageBusy} icon={<Check size={20} color={colors.surface} />} style={styles.primaryCta} />
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
            <Button
              label={canSave ? "Save character" : "Keep editing"}
              accessibilityLabel={canSave ? "Save character" : "Keep editing this character"}
              onPress={canSave ? onSave : onKeepEditing}
            />
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
  viewIdeas: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  viewIdeasLabel: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "700" },
  horizontalChips: { gap: spacing.sm, paddingRight: spacing.xl },
  grow: { flex: 1, minHeight: spacing.lg },
  /** Layout only. The recipe is `Button`'s; this used to be a 54pt `radius.md` slab. */
  primaryCta: { marginTop: spacing.sm },

  ctaStrength: { marginTop: -spacing.lg, color: colors.tertiary, fontFamily: fonts.ui, fontSize: 11, fontWeight: "700", textAlign: "center", textTransform: "lowercase" },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  // The one secondary heading treatment: Premise, Who's in it (the section
  // that heads Add a character), and More options. It used to have a twin,
  // `sectionOverline`, kept apart so a change here could not reach the "Try
  // one" heading; that heading is gone -- the starters live behind "View
  // ideas" now -- so there is one token again.
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
  castTabs: { flexDirection: "row", height: 36, padding: 3, borderRadius: radius.md, backgroundColor: colors.surface2, gap: 2 },
  castTab: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.md - 3 },
  castTabSelected: { backgroundColor: colors.surface, boxShadow: shadows.card },
  castTabLabel: { color: colors.muted, fontFamily: fonts.ui, fontSize: 14, fontWeight: "600" },
  castTabLabelSelected: { color: colors.ink },
  savedEmpty: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, paddingVertical: spacing.xs },
  savedChip: { height: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: 6, paddingRight: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  savedChipAdded: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  savedChipDisabled: { opacity: 0.55 },
  savedChipPortrait: { width: 32, height: 32, borderRadius: 16, overflow: "hidden" },
  savedChipInitialWrap: { backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  savedChipInitial: { color: colors.accent, fontFamily: fonts.display, fontSize: 14 },
  savedChipLabel: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "700", maxWidth: 140 },
  savedChipLabelDisabled: { color: colors.tertiary },
  savedCapHint: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12 },
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
  // Two per row, and they REFLOW. `flexBasis: "48%"` with `flexGrow` means the
  // pair splits whatever width there is and drops to one per row when the
  // labels grow -- a narrow device, or a large `fontScale` -- instead of a
  // fixed two-column grid clipping the longer label.
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  optionGridItem: { flexBasis: "48%", flexGrow: 1 },
  optionCell: { flex: 1, gap: spacing.xs },
  optionLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 13, marginTop: spacing.xs },
  optionHint: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
  compactSegments: { flexDirection: "row", gap: spacing.xs },
  optionChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  switchLabel: { color: colors.ink, fontFamily: fonts.ui, fontWeight: "800", fontSize: 14 },
  switchHint: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
  optionInput: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.ink, fontFamily: fonts.ui, fontSize: 14 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  helpButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  helpCaption: { color: colors.muted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, marginTop: -spacing.xs },
  groupedFieldCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  groupedFieldDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
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
  portraitPrice: { fontFamily: fonts.ui, fontSize: 12, lineHeight: 16, color: colors.tertiary, letterSpacing: 0, marginTop: -spacing.sm },
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

  dialogDestructive: { minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  dialogDestructiveText: { color: colors.heart, fontFamily: fonts.ui, fontWeight: "800", fontSize: 15 },
  stickyFooter: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
