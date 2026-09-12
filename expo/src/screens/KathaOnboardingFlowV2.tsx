/**
 * The shared onboarding questionnaire: name, genres, purpose, refine, moment.
 *
 * ## What this file used to be
 *
 * It used to be the WHOLE of onboarding - the five questions below, then a
 * fake progress ring ("Building your Katha profile"), a notification alert with
 * an auto-scrolling rail of invented five-star reviews, a "Katha Plus" paywall
 * with a seven-row Free-vs-Plus table promising unlimited and priority
 * generation, a countdown one-time offer, an email/OTP pair and a success
 * screen. All of that is gone (2026-09-11): the aha is now "make one character,
 * see their portrait", which `CharacterOnboarding.tsx` owns end to end,
 * including auth, the single paywall and the welcome hand-off.
 *
 * What is left is the part that was always worth asking: five questions whose
 * answers shape the first character and the first shelf. EVERY purpose leaves
 * through `onCharacterPath` - read, write and both. There is no longer a
 * branch here, because there is no longer a second flow to branch into.
 *
 * ## Why the copy is untouched
 *
 * These five screens are the only ones a person sees before they have any
 * reason to trust the app, and the wording has been through product review.
 * The migration below is tokens and types only: every string, option, order and
 * gate is exactly what it was.
 */

import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import BrandWordmark from "@/components/BrandWordmark";
import { genreChipLabel } from "@/components/explore/GenreStrip";
import { Field } from "@/components/onboarding/Field";
import { Primary } from "@/components/onboarding/primitives";
import {
  colors,
  controls,
  fonts,
  genreLabels,
  IconBack,
  motion,
  onboardingType,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import { UI_GENRES } from "@/types/domain";
import type { Genre, OnboardingPurpose } from "@/types/domain";

/**
 * How many genre interests a reader must pick before Continue activates on
 * the genre screen. The helper copy and the button read this one number, so
 * they cannot drift apart the way "pick at least 2" and a button that
 * actually needed 3 once did.
 */
export const MIN_GENRE_SELECTIONS = 3;

/** The five questions, in order. There is no sixth screen in this file. */
type QuestionScreen = "name" | "genres" | "purpose" | "refine" | "moment";

const QUESTION_COUNT = 5;

/** Clearance under a pinned CTA, before the safe-area inset. `CharacterOnboarding`'s. */
const CTA_BOTTOM = 40;

const STEP_OF: Record<QuestionScreen, number> = {
  name: 1,
  genres: 2,
  purpose: 3,
  refine: 4,
  moment: 5,
};

const NEXT_SCREEN: Record<Exclude<QuestionScreen, "moment">, QuestionScreen> = {
  name: "genres",
  genres: "purpose",
  purpose: "refine",
  refine: "moment",
};

const PREVIOUS_SCREEN: Record<Exclude<QuestionScreen, "name">, QuestionScreen> =
  {
    genres: "name",
    purpose: "genres",
    refine: "purpose",
    moment: "refine",
  };

/** What the five questions collected, handed on to the character flow. */
export type KathaOnboardingAnswers = {
  name: string;
  genres: string[];
  otherGenre: string;
  refine: string;
  moment: string;
};

export type KathaCharacterPathPayload = {
  purpose: OnboardingPurpose;
  /** The first pick that maps to a create genre, when there was one. */
  initialGenre?: Genre;
  onboarding: KathaOnboardingAnswers;
};

export type KathaOnboardingFlowV2Props = {
  /** The one exit. Read, write and both all leave through here. */
  onCharacterPath: (payload: KathaCharacterPathPayload) => void;
};

type Option = { k: string; icon: string; label: string; sub: string };

// ── Static data ─────────────────────────────────────────────────────────────
const PURPOSES: readonly Option[] = [
  { k: "read", icon: "\uD83D\uDCD6", label: "Reading", sub: "Get lost in stories from around the world" },
  { k: "write", icon: "\u270D\uFE0F", label: "Writing", sub: "Create stories of my own with Katha" },
  { k: "both", icon: "\u2728", label: "A bit of both", sub: "I love to read and to write" },
];
const REFINE_READ: readonly Option[] = [
  { k: "read", icon: "\uD83D\uDCD6", label: "Reading them myself", sub: "Words on the page, at my own pace" },
  { k: "listen", icon: "\uD83C\uDFA7", label: "Listening to audio", sub: "Narrated stories for commutes and nights" },
  { k: "mix", icon: "\uD83D\uDD00", label: "A mix of both", sub: "Read sometimes, listen sometimes" },
];
const REFINE_WRITE: readonly Option[] = [
  { k: "novel", icon: "\uD83D\uDCD5", label: "A full novel", sub: "A story big enough to get lost in" },
  { k: "short", icon: "\u2712\uFE0F", label: "Short stories", sub: "Quick, complete, satisfying" },
  { k: "fan", icon: "\uD83D\uDCAB", label: "Fan fiction", sub: "Worlds and characters I already love" },
  { k: "poetry", icon: "\uD83D\uDD6F\uFE0F", label: "Poetry and verse", sub: "A whole feeling in a few lines" },
];
const REFINE_BOTH: readonly Option[] = [
  { k: "find", icon: "\uD83D\uDCDA", label: "Find my next read", sub: "Start with a shelf built around my taste" },
  { k: "create", icon: "\u270D\uFE0F", label: "Start a story", sub: "Open a blank page with Katha beside me" },
  { k: "balance", icon: "\u2696\uFE0F", label: "Balance both", sub: "Keep reading and writing close together" },
  { k: "surprise", icon: "\u2728", label: "Surprise me", sub: "Show me the best place to begin" },
];
const MOMENTS_READ: readonly Option[] = [
  { k: "sleep", icon: "\uD83C\uDF19", label: "Before sleep", sub: "A calm chapter to end the day" },
  { k: "breaks", icon: "\u2615", label: "Commutes and breaks", sub: "Stories that fit into small pockets of time" },
  { k: "weekend", icon: "\uD83D\uDCDA", label: "Weekend binges", sub: "Long sessions when I can settle in" },
  { k: "escape", icon: "\u2728", label: "Whenever I need an escape", sub: "A new world on demand" },
];
const MOMENTS_WRITE: readonly Option[] = [
  { k: "draft", icon: "\uD83D\uDCA1", label: "Turn an idea into a draft", sub: "Help me get from blank page to first version" },
  { k: "voice", icon: "\u270E", label: "Rewrite in my voice", sub: "Make every line sound unmistakably mine" },
  { k: "chapters", icon: "\uD83D\uDDC2\uFE0F", label: "Plan chapters", sub: "Shape the arc before I lose momentum" },
  { k: "publish", icon: "\uD83D\uDE80", label: "Publish and find readers", sub: "Share the work and grow an audience" },
];
const MOMENTS_BOTH: readonly Option[] = [
  { k: "remix", icon: "\uD83D\uDD01", label: "Read, then remix", sub: "Let great stories spark my own ideas" },
  { k: "publish", icon: "\uD83D\uDE80", label: "Write, then publish", sub: "Create something and put it in front of readers" },
  { k: "unwind", icon: "\uD83C\uDFA7", label: "Listen, then unwind", sub: "Keep stories close without looking at a screen" },
  { k: "save", icon: "\uD83D\uDD16", label: "Explore, then save", sub: "Collect ideas, worlds, and favorites" },
];

// ── Root ────────────────────────────────────────────────────────────────────
export default function KathaOnboardingFlowV2(
  { onCharacterPath }: KathaOnboardingFlowV2Props,
) {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<QuestionScreen>("name");
  const [name, setName] = useState("");
  const [genres, setGenres] = useState<Partial<Record<Genre, boolean>>>({});
  const [genreOrder, setGenreOrder] = useState<Genre[]>([]);
  const [purpose, setPurpose] = useState<OnboardingPurpose | "">("");
  const [refine, setRefine] = useState("");
  const [moment, setMoment] = useState("");
  const reduceMotion = useReducedMotionPreference();

  const fname = name.trim() || "there";
  /** Selected genre ids, in the order they were tapped. */
  const selectedGenres = genreOrder.filter((key) => genres[key]);
  /*
    The first tap is the shelf the first character is seeded from. It is a
    plain `Genre` now rather than a lookup through a display string, because
    the chips ARE genre ids.
  */
  const firstCreateGenre = selectedGenres[0];
  const genreCount = selectedGenres.length;

  const toggleGenre = (g: Genre) => {
    setGenres((prev) => {
      const n = { ...prev };
      if (n[g]) {
        delete n[g];
      } else {
        n[g] = true;
      }
      return n;
    });
    setGenreOrder((prev) =>
      prev.includes(g) ? prev.filter((key) => key !== g) : [...prev, g]
    );
  };

  const next = () => {
    if (screen === "moment") {
      /*
        ONE EXIT, FOR ALL THREE PURPOSES.

        Readers used to go to a fake "building your profile" ring and writers to
        a separate flow. Both are gone: the character is the aha whichever box
        was ticked, and only the copy downstream differs. `purpose` rides along
        so the character flow can voice itself without re-asking.
      */
      if (purpose === "") return;
      onCharacterPath({
        purpose,
        initialGenre: firstCreateGenre,
        onboarding: {
          name: name.trim(),
          /*
            LABELS, not ids, on the way out. `App.tsx` maps this back through
            `genreLabels` (`toGenreKeys`) to key the first shelf, and the
            questionnaire's answers are also read as prose downstream. Sending
            labels keeps both true with one source: `genreLabels` itself.
          */
          genres: selectedGenres.map((genre) => genreLabels[genre]),
          otherGenre: "",
          refine,
          moment,
        },
      });
      return;
    }
    setScreen(NEXT_SCREEN[screen]);
  };

  const back = () => {
    if (screen === "name") return;
    setScreen(PREVIOUS_SCREEN[screen]);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TopBar
        step={STEP_OF[screen]}
        onBack={back}
        canBack={screen !== "name"}
        reduceMotion={reduceMotion}
      />

      {screen === "name" && (
        <NameScreen name={name} setName={setName} onNext={next} />
      )}
      {screen === "genres" && (
        <GenreScreen
          fname={fname}
          genres={genres}
          toggle={toggleGenre}
          count={genreCount}
          onNext={next}
        />
      )}
      {screen === "purpose" && (
        <PurposeScreen purpose={purpose} setPurpose={setPurpose} onNext={next} />
      )}
      {screen === "refine" && (
        <RefineScreen
          fname={fname}
          purpose={purpose}
          refine={refine}
          setRefine={setRefine}
          onNext={next}
        />
      )}
      {screen === "moment" && (
        <MomentScreen
          fname={fname}
          purpose={purpose}
          moment={moment}
          setMoment={setMoment}
          onNext={next}
        />
      )}
    </View>
  );
}

/**
 * Whether this person has asked the OS for less movement.
 *
 * Kept from the original file, and still load-bearing: the progress fill is
 * the one thing on these five screens that moves, and somebody who has turned
 * motion off should see it jump rather than slide.
 */
export function useReducedMotionPreference(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    const preference = AccessibilityInfo.isReduceMotionEnabled?.();
    preference?.then((enabled) => {
      if (mounted) setReduceMotion(Boolean(enabled));
    });
    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

// ── Shared ───────────────────────────────────────────────────────────────────
function TopBar({
  step,
  onBack,
  canBack,
  reduceMotion,
}: {
  step: number;
  onBack: () => void;
  canBack: boolean;
  reduceMotion: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const progress = useSharedValue(step / QUESTION_COUNT);

  useEffect(() => {
    const target = step / QUESTION_COUNT;
    progress.set(
      reduceMotion ? target : withTiming(target, { duration: motion.base }),
    );
  }, [progress, reduceMotion, step]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.get() * 100}%`,
  }));

  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={onBack}
        disabled={!canBack}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityState={{ disabled: !canBack }}
        hitSlop={12}
        style={[
          styles.backBtn,
          // The pressed plate, not a colour change: the icon button recipe in
          // DESIGN_SYSTEM section 6 swaps the shadow and leaves the fill alone.
          pressed && styles.backBtnPressed,
          !canBack && styles.backBtnDisabled,
        ]}
      >
        <IconBack size={20} color={colors.strong} />
      </Pressable>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step} of ${QUESTION_COUNT}`}
        accessibilityValue={{ min: 1, max: QUESTION_COUNT, now: step }}
      >
        <Animated.View style={[styles.progressFill, fillStyle]} />
      </View>
      <Text style={styles.stepLabel} accessibilityElementsHidden>
        {step}/{QUESTION_COUNT}
      </Text>
    </View>
  );
}

/**
 * The questionnaire's Continue.
 *
 * It used to draw the app-wide 64pt primary, so the button a person pressed
 * five times in the questionnaire changed height and corner radius the moment
 * they crossed into the character steps. It is the shared onboarding pill now
 * -- `Primary` from the onboarding primitives, exactly as W3-W7, the code
 * screen and WELCOME draw it -- and this wrapper exists only to keep the
 * `enabled` spelling every call site here already uses.
 */
function PrimaryButton({
  label,
  onPress,
  enabled = true,
}: {
  label: string;
  onPress: () => void;
  enabled?: boolean;
}) {
  return <Primary label={label} onPress={onPress} disabled={!enabled} />;
}

function OptionRow({
  icon,
  label,
  sub,
  selected,
  onPress,
}: Option & { selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={sub}
      accessibilityState={{ selected }}
      style={[styles.optRow, selected && styles.optRowSelected]}
    >
      {/* The emoji is content, not iconography: it is part of the option's
          copy and is what makes a list of four abstractions scannable. */}
      <Text style={styles.optIcon}>{icon}</Text>
      <View style={styles.optText}>
        <Text style={styles.optLabel}>{label}</Text>
        <Text style={styles.optSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <Text style={styles.radioMark}>{"\u2713"}</Text>}
      </View>
    </Pressable>
  );
}

// ── NAME ────────────────────────────────────────────────────────────────────
function NameScreen({
  name,
  setName,
  onNext,
}: {
  name: string;
  setName: (value: string) => void;
  onNext: () => void;
}) {
  const ready = name.trim().length > 0;
  return (
    <KeyboardAvoidingView
      style={styles.pad}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.grow}>
        <View style={styles.wordmarkSlot}>
          <BrandWordmark size={28} />
        </View>
        <Text style={styles.h1} accessibilityRole="header">
          First, what should we call you?
        </Text>
        <Text style={styles.sub}>
          {"Katha writes with you, so every story feels personal. Let's start with your name."}
        </Text>
        {/*
          The shared field, and no eyebrow above it: "Your first name" is
          already the placeholder, and a label repeating it is the third copy
          of one instruction on a screen whose headline asks the question.
          This input used to be its own recipe in the display face at title
          size, which is why a typed name looked nothing like the name typed
          on the Craft screen two steps later.
        */}
        <Field
          value={name}
          onChangeText={setName}
          placeholder="Your first name"
          accessibilityLabel="Your first name"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={() => ready && onNext()}
          containerStyle={styles.nameField}
        />
      </View>
      <PrimaryButton label="Continue" enabled={ready} onPress={onNext} />
    </KeyboardAvoidingView>
  );
}

// ── GENRES ──────────────────────────────────────────────────────────────────
function GenreScreen({
  fname,
  genres,
  toggle,
  count,
  onNext,
}: {
  fname: string;
  genres: Partial<Record<Genre, boolean>>;
  toggle: (genre: Genre) => void;
  count: number;
  onNext: () => void;
}) {
  const ready = count >= MIN_GENRE_SELECTIONS;
  const remaining = MIN_GENRE_SELECTIONS - count;
  const cta = ready
    ? `Continue with ${count}`
    : remaining === 1
    ? "Pick 1 more"
    : `Pick at least ${MIN_GENRE_SELECTIONS}`;
  return (
    <View style={styles.grow}>
      <View style={styles.headPad}>
        <Text style={styles.h1} accessibilityRole="header">
          Nice to meet you, {fname}. What worlds pull you in?
        </Text>
        <Text style={styles.sub}>
          {`Pick at least ${MIN_GENRE_SELECTIONS} and we'll build your shelf around them.`}
        </Text>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.scrollBody}>
        {/*
          `UI_GENRES`, in its own order, and not a list of its own.

          Onboarding used to keep a private list of sixteen display strings,
          each with an emoji and a hand-written mapping back to a create
          genre - which is how it came to offer "Cozy Fantasy" and
          "Paranormal Romance", two names that exist nowhere else in the app
          and quietly resolved to plain fantasy and plain romance. A person
          who picked them met a shelf and a Create picker that had never
          heard of them. The picker in `CreateBriefFlow` reads `UI_GENRES`;
          so does this, so the two can never drift again. "Other" went with
          them: a free-text genre had nothing downstream to be.
        */}
        <View style={styles.chipWrap}>
          {UI_GENRES.map((genre) => {
            const on = Boolean(genres[genre]);
            return (
              <Pressable
                key={genre}
                onPress={() => toggle(genre)}
                accessibilityRole="button"
                accessibilityLabel={`${genreLabels[genre]} genre`}
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  styles.chip,
                  on && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text style={[styles.chipLabel, on && styles.chipLabelSelected]}>
                  {genreChipLabel(genre)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footPad}>
        <PrimaryButton label={cta} enabled={ready} onPress={onNext} />
      </View>
    </View>
  );
}

// ── PURPOSE ─────────────────────────────────────────────────────────────────
function PurposeScreen({
  purpose,
  setPurpose,
  onNext,
}: {
  purpose: OnboardingPurpose | "";
  setPurpose: (value: OnboardingPurpose) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.grow}>
      <View style={styles.headPad}>
        <View style={styles.wordmarkSlot}>
          <BrandWordmark size={28} />
        </View>
        <Text style={styles.h1} accessibilityRole="header">
          What brings you to Katha?
        </Text>
        <Text style={styles.sub}>
          We will shape your first experience around what matters most.
        </Text>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.optionBody}>
        {PURPOSES.map((o) => (
          <OptionRow
            key={o.k}
            {...o}
            selected={purpose === o.k}
            onPress={() => setPurpose(o.k as OnboardingPurpose)}
          />
        ))}
      </ScrollView>
      <View style={styles.footPad}>
        <PrimaryButton label="Continue" enabled={Boolean(purpose)} onPress={onNext} />
      </View>
    </View>
  );
}

// ── REFINE (adaptive) ───────────────────────────────────────────────────────
function RefineScreen({
  fname,
  purpose,
  refine,
  setRefine,
  onNext,
}: {
  fname: string;
  purpose: OnboardingPurpose | "";
  refine: string;
  setRefine: (value: string) => void;
  onNext: () => void;
}) {
  const opts = purpose === "read"
    ? REFINE_READ
    : purpose === "write"
    ? REFINE_WRITE
    : REFINE_BOTH;
  const title = purpose === "read"
    ? `How do you want to enjoy stories, ${fname}?`
    : purpose === "write"
    ? "What do you want to write?"
    : `Where should Katha start today, ${fname}?`;
  const sub = purpose === "read"
    ? "We will tune reading and narration around you."
    : purpose === "write"
    ? "We will prepare the right creative tools."
    : "Your shelf and writing room can work together.";
  return (
    <View style={styles.grow}>
      <View style={styles.headPad}>
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.optionBody}>
        {opts.map((o) => (
          <OptionRow
            key={o.k}
            {...o}
            selected={refine === o.k}
            onPress={() => setRefine(o.k)}
          />
        ))}
      </ScrollView>
      <View style={styles.footPad}>
        <PrimaryButton label="Continue" enabled={Boolean(refine)} onPress={onNext} />
      </View>
    </View>
  );
}

function MomentScreen({
  fname,
  purpose,
  moment,
  setMoment,
  onNext,
}: {
  fname: string;
  purpose: OnboardingPurpose | "";
  moment: string;
  setMoment: (value: string) => void;
  onNext: () => void;
}) {
  const opts = purpose === "read"
    ? MOMENTS_READ
    : purpose === "write"
    ? MOMENTS_WRITE
    : MOMENTS_BOTH;
  const title = purpose === "read"
    ? `When will Katha fit your day, ${fname}?`
    : purpose === "write"
    ? "What usually stops you?"
    : `Which loop sounds most like you, ${fname}?`;
  const sub = purpose === "read"
    ? "We will pace recommendations around your real routine."
    : purpose === "write"
    ? "Your answer decides what we put within reach first."
    : "We will connect discovery and creation around this rhythm.";
  return (
    <View style={styles.grow}>
      <View style={styles.headPad}>
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.optionBody}>
        {opts.map((o) => (
          <OptionRow
            key={o.k}
            {...o}
            selected={moment === o.k}
            onPress={() => setMoment(o.k)}
          />
        ))}
      </ScrollView>
      <View style={styles.footPad}>
        <PrimaryButton
          // The reader's "Build my profile" pointed at a progress ring that no
          // longer exists, and every purpose now goes to the same next screen.
          label={purpose === "write" ? "Continue" : "Build my profile"}
          enabled={Boolean(moment)}
          onPress={onNext}
        />
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  grow: { flex: 1 },
  pad: {
    flex: 1,
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
  },
  headPad: {
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  /*
    The pinned CTA's dock, matching `CharacterOnboarding`'s: `spacing.sm` above
    (the pill carries its own `spacing.md` top margin) and 40pt below, on top
    of the safe-area inset the root already pads for.
  */
  footPad: {
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.sm,
    paddingBottom: CTA_BOTTOM,
  },
  scrollBody: {
    paddingHorizontal: spacing.xxxl,
    paddingBottom: spacing.lg,
  },
  optionBody: {
    paddingHorizontal: spacing.xxxl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  wordmarkSlot: { marginBottom: spacing.xxxl, marginTop: spacing.xs },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: controls.iconButton,
    height: controls.iconButton,
    borderRadius: controls.iconButton / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.iconButton,
  },
  backBtnPressed: { boxShadow: shadows.iconButtonPressed },
  /**
   * The first screen has nowhere to go back to. Dimmed rather than removed, so
   * the progress row does not shift sideways between screen one and two.
   */
  backBtnDisabled: { opacity: 0.35 },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  stepLabel: { ...type.caption, color: colors.tertiary },
  h1: { ...onboardingType.title, color: colors.ink },
  sub: { ...onboardingType.helper, color: colors.muted, marginTop: spacing.related },
  /*
    One step below the sub, not two. The field sat `spacing.xxl` under a sub
    that already carries its own `related` top margin, which read as a gap
    between two unrelated things rather than a question and its answer.
  */
  nameField: { marginTop: spacing.lg },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.md,
    columnGap: spacing.sm + spacing.xs,
    paddingTop: spacing.sm,
  },
  /*
    EXPLORE'S CHIP, scaled up for a screen that is nothing but chips.
    `surface` on a hairline border, the label bold in `muted`, `ink` fill with
    `surface` text when it is on, and the label is `genreChipLabel` - the same
    emoji-and-name pair Explore's filter row draws - so the genre a person
    picks in their first minute is recognisably the genre they will filter
    Explore with an hour later. Explore's row is one line of a busy screen and
    sits at 40pt; this IS the screen, so the tap target is 44 and the padding
    and label are a step larger. The styles are copied rather than imported
    because `GenreStrip` is a single-select horizontal row; this is a
    multi-select wrap. The accessibility label stays the plain genre name: a
    screen reader should not have to read an emoji out.
  */
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipPressed: { opacity: 0.86 },
  chipLabel: {
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.muted,
    fontWeight: "700",
  },
  chipLabelSelected: { color: colors.surface },
  optRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  optRowSelected: { backgroundColor: colors.accentSoft },
  optIcon: { fontSize: 24 },
  optText: { flex: 1 },
  optLabel: { ...type.headline, color: colors.ink },
  optSub: { ...type.meta, color: colors.muted, marginTop: spacing.tight },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  radioMark: { ...type.caption, color: colors.surface },
});
