/**
 * The shared onboarding questionnaire: name, genres, purpose, then the
 * purpose's own questions.
 *
 * ## What this file used to be
 *
 * It used to be the WHOLE of onboarding - the questions below, then a fake
 * progress ring ("Building your Katha profile"), a notification alert with an
 * auto-scrolling rail of invented five-star reviews, a "Katha Plus" paywall
 * with a seven-row Free-vs-Plus table promising unlimited and priority
 * generation, a countdown one-time offer, an email/OTP pair and a success
 * screen. All of that is gone (2026-09-11): the aha is now "make one character,
 * see their portrait", which `CharacterOnboarding.tsx` owns end to end,
 * including auth, the single paywall and the welcome hand-off.
 *
 * What is left is the part that was always worth asking: the questions whose
 * answers shape the first character and the first shelf. EVERY purpose leaves
 * through `onCharacterPath` - read, write and both. There is no longer a
 * branch here, because there is no longer a second flow to branch into.
 *
 * ## The reader's questions (2026-09-14)
 *
 * A reader answers three after "Reading": how they like their stories, what
 * they are in the mood for tonight, and when they usually read. The third is
 * the one optional question in the whole flow, because it is about routine
 * rather than taste, and it carries an UP NEXT card so the character screen
 * that follows is expected rather than a detour. Writers and "both" keep their
 * two.
 *
 * ## Which questions take several answers (2026-09-25)
 *
 * The writer's two questions ("What do you want to write?", "What usually
 * stops you?") and the reader's mood and routine questions take several
 * answers; everything else takes one. `selectionFor` is the table.
 * Purpose stays single-select because it routes: the screens after it are
 * that purpose's own, and "A bit of both" is already an option. The
 * reader's "How do you like your stories?" and the two "both" questions stay
 * single too, because one of their options IS the combination ("A mix of
 * both", "Balance both") or the question asks for the one that fits most.
 *
 * Every answer leaves as a list in TAP ORDER, and the first tap is the
 * primary: it is what a consumer that needs one value reads (Home's Tonight
 * rail keys on the first mood). An option marked `exclusive` ("Surprise me",
 * "Whenever I get time") is a whole answer on its own: choosing it clears the
 * others, and choosing another clears it.
 *
 * ## The progress row
 *
 * The same short pills the character screens draw, from the first question,
 * one per step, with the count read from `lib/onboarding-progress.ts`. This
 * file used to draw a filled track labelled `n/5`, and the row that replaced
 * it on the next screen started four pills in.
 */

import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BrandWordmark from "@/components/BrandWordmark";
import { genreChipLabel } from "@/components/explore/GenreStrip";
import { Field } from "@/components/onboarding/Field";
import {
  OnboardingTopBar,
  Primary,
} from "@/components/onboarding/primitives";
import { questionStep } from "@/lib/onboarding-progress";
import type { QuestionStep } from "@/lib/onboarding-progress";
import {
  colors,
  fonts,
  genreLabels,
  IconCheck,
  onboardingType,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import { UI_GENRES } from "@/types/domain";
import type { Genre, OnboardingPurpose } from "@/types/domain";
import { STAGE_CAST } from "@/lib/onboarding-cast";

/**
 * How many genre interests a reader must pick before Continue activates on
 * the genre screen. The helper copy and the button read this one number, so
 * they cannot drift apart the way "pick at least 2" and a button that
 * actually needed 3 once did.
 */
export const MIN_GENRE_SELECTIONS = 3;

/** The screens, in walking order. `mood` renders for readers only. */
type QuestionScreen = QuestionStep;

/** Clearance under a pinned CTA, before the safe-area inset. `CharacterOnboarding`'s. */
const CTA_BOTTOM = 40;

/**
 * What the questions collected, handed on to the character flow.
 *
 * The three answer lists are option keys in the order they were tapped; the
 * first is the primary. A single-select question leaves a list of one.
 */
export type KathaOnboardingAnswers = {
  name: string;
  genres: string[];
  otherGenre: string;
  refine: string[];
  /** The reader's "what are you in the mood for". Empty on the other paths. */
  mood: string[];
  /** Empty when a reader skipped "when do you usually read". */
  moment: string[];
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

type Option = {
  k: string;
  icon: string;
  label: string;
  sub?: string;
  /**
   * A whole answer on its own, on a multi-select screen: choosing it clears
   * the other picks, and choosing another option clears it. "Surprise me"
   * alongside "Something emotional" is not an answer anybody means.
   */
  exclusive?: boolean;
};

/** One answer, or as many as apply. */
export type Selection = "single" | "multi";

/**
 * Which questions take several answers. The one table; the screens and the
 * tests read it. See the file header for why each single-select stays single.
 */
export function selectionFor(
  screen: QuestionScreen,
  purpose: OnboardingPurpose | "",
): Selection {
  switch (screen) {
    case "refine":
      return purpose === "write" ? "multi" : "single";
    case "mood":
      return "multi";
    case "moment":
      return purpose === "both" ? "single" : "multi";
    default:
      return "single";
  }
}

/**
 * The answer list after a tap. Pure, so the rules are tested without a screen.
 *
 * Single-select replaces (and a second tap on the chosen row keeps it, the
 * way a radio does). Multi-select toggles, keeps tap order, and honours
 * `exclusive` options in both directions.
 */
export function toggleAnswer(
  current: readonly string[],
  key: string,
  mode: Selection,
  options: readonly Option[],
): string[] {
  if (mode === "single") return [key];
  if (current.includes(key)) return current.filter((k) => k !== key);
  const exclusive = new Set(
    options.filter((option) => option.exclusive).map((option) => option.k),
  );
  if (exclusive.has(key)) return [key];
  return [...current.filter((k) => !exclusive.has(k)), key];
}

// ── Static data ─────────────────────────────────────────────────────────────
const PURPOSES: readonly Option[] = [
  { k: "read", icon: "📖", label: "Reading", sub: "Get lost in stories from around the world" },
  { k: "write", icon: "✍️", label: "Writing", sub: "Create stories of my own with Katha" },
  { k: "both", icon: "✨", label: "A bit of both", sub: "I love to read and to write" },
];
const REFINE_READ: readonly Option[] = [
  { k: "read", icon: "📖", label: "Reading them myself", sub: "Words on the page, at my own pace" },
  { k: "listen", icon: "🎧", label: "Listening to audio", sub: "Narrated stories for commutes and nights" },
  { k: "mix", icon: "🔀", label: "A mix of both", sub: "Read sometimes, listen sometimes" },
];
const REFINE_WRITE: readonly Option[] = [
  { k: "novel", icon: "📕", label: "A full novel", sub: "A story big enough to get lost in" },
  { k: "short", icon: "✒️", label: "Short stories", sub: "Quick, complete, satisfying" },
  { k: "fan", icon: "💫", label: "Fan fiction", sub: "Worlds and characters I already love" },
  { k: "poetry", icon: "🕯️", label: "Poetry and verse", sub: "A whole feeling in a few lines" },
];
const REFINE_BOTH: readonly Option[] = [
  { k: "find", icon: "📚", label: "Find my next read", sub: "Start with a shelf built around my taste" },
  { k: "create", icon: "✍️", label: "Start a story", sub: "Open a blank page with Katha beside me" },
  { k: "balance", icon: "⚖️", label: "Balance both", sub: "Keep reading and writing close together" },
  { k: "surprise", icon: "✨", label: "Surprise me", sub: "Show me the best place to begin" },
];

/**
 * The reader's "what are you in the mood for". The keys are what Home's
 * Tonight rail reads (`lib/home-tonight.ts`), so they are ids, not labels.
 */
export const MOODS: readonly Option[] = [
  { k: "escape", icon: "🌊", label: "Something to escape into", sub: "Immersive worlds, long journeys." },
  { k: "guessing", icon: "🔍", label: "Something that keeps me guessing", sub: "Mystery, tension, twists." },
  { k: "emotional", icon: "💔", label: "Something emotional", sub: "Ache, catharsis, connection." },
  { k: "quick", icon: "⚡", label: "Something quick", sub: "Under 20 minutes." },
  { k: "comforting", icon: "🕯️", label: "Something comforting", sub: "Warm, low-stakes, safe." },
  { k: "surprise", icon: "🎲", label: "Surprise me", sub: "Katha picks based on your genres.", exclusive: true },
];

/** The reader's "when do you usually read". One line each: a routine, not a pitch. */
const MOMENTS_READ: readonly Option[] = [
  { k: "sleep", icon: "🌙", label: "Before bed" },
  { k: "commute", icon: "🚇", label: "During commutes" },
  { k: "breaks", icon: "☕", label: "Short breaks" },
  { k: "weekend", icon: "🌞", label: "Weekends" },
  { k: "whenever", icon: "🕒", label: "Whenever I get time", exclusive: true },
];
const MOMENTS_WRITE: readonly Option[] = [
  { k: "draft", icon: "💡", label: "Turn an idea into a draft", sub: "Help me get from blank page to first version" },
  { k: "voice", icon: "✎", label: "Rewrite in my voice", sub: "Make every line sound unmistakably mine" },
  { k: "chapters", icon: "🗂️", label: "Plan chapters", sub: "Shape the arc before I lose momentum" },
  { k: "publish", icon: "🚀", label: "Publish and find readers", sub: "Share the work and grow an audience" },
];
const MOMENTS_BOTH: readonly Option[] = [
  { k: "remix", icon: "🔁", label: "Read, then remix", sub: "Let great stories spark my own ideas" },
  { k: "publish", icon: "🚀", label: "Write, then publish", sub: "Create something and put it in front of readers" },
  { k: "unwind", icon: "🎧", label: "Listen, then unwind", sub: "Keep stories close without looking at a screen" },
  { k: "save", icon: "🔖", label: "Explore, then save", sub: "Collect ideas, worlds, and favorites" },
];

/** The screen after this one, for the purpose that was picked. */
function nextScreen(
  screen: QuestionScreen,
  purpose: OnboardingPurpose | "",
): QuestionScreen | null {
  switch (screen) {
    case "name":
      return "genres";
    case "genres":
      return "purpose";
    case "purpose":
      return "refine";
    case "refine":
      // The mood question is the reader's; the other two go straight on.
      return purpose === "read" ? "mood" : "moment";
    case "mood":
      return "moment";
    case "moment":
      return null;
  }
}

function previousScreen(
  screen: QuestionScreen,
  purpose: OnboardingPurpose | "",
): QuestionScreen | null {
  switch (screen) {
    case "name":
      return null;
    case "genres":
      return "name";
    case "purpose":
      return "genres";
    case "refine":
      return "purpose";
    case "mood":
      return "refine";
    case "moment":
      return purpose === "read" ? "mood" : "refine";
  }
}

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
  const [refine, setRefine] = useState<string[]>([]);
  const [mood, setMood] = useState<string[]>([]);
  const [moment, setMoment] = useState<string[]>([]);

  /**
   * Changing the purpose clears the answers that belong to the old one.
   *
   * Every question after this one is the purpose's own: a reader's "mood" has
   * no meaning on a writer's path, and a "refine" key from the reader's list
   * would light the writer's Continue with nothing selected. Without this,
   * Reading → mood → Back → Writing leaves a mood in the payload and the
   * writer opens Home to a Tonight rail they never asked for.
   */
  const choosePurpose = (next: OnboardingPurpose) => {
    if (next === purpose) return;
    setPurpose(next);
    setRefine([]);
    setMood([]);
    setMoment([]);
  };

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

  /**
   * Leave, once the last question is answered (or skipped).
   *
   * ONE EXIT, FOR ALL THREE PURPOSES. Readers used to go to a fake "building
   * your profile" ring and writers to a separate flow. Both are gone: the
   * character is the aha whichever box was ticked, and only the copy
   * downstream differs. `purpose` rides along so the character flow can voice
   * itself without re-asking.
   */
  const finish = (finalMoment: string[]) => {
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
        mood,
        moment: finalMoment,
      },
    });
  };

  const next = () => {
    const target = nextScreen(screen, purpose);
    if (target === null) {
      finish(moment);
      return;
    }
    setScreen(target);
  };

  const back = () => {
    const target = previousScreen(screen, purpose);
    if (target !== null) setScreen(target);
  };

  const { steps, currentStep } = questionStep(screen, purpose);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/*
        The character screens' top bar, not one of this file's own: the plate,
        the pills and their three colours are the same object on every screen
        from here to the Meet screen. The first screen has nowhere to go back
        to, and the bar keeps its slot rather than shifting the pills sideways.
      */}
      <OnboardingTopBar
        onBack={screen === "name" ? undefined : back}
        steps={steps}
        currentStep={currentStep}
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
        <PurposeScreen purpose={purpose} setPurpose={choosePurpose} onNext={next} />
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
      {screen === "mood" && (
        <MoodScreen fname={fname} mood={mood} setMood={setMood} onNext={next} />
      )}
      {screen === "moment" && (
        <MomentScreen
          fname={fname}
          purpose={purpose}
          moment={moment}
          setMoment={setMoment}
          onNext={next}
          // Skip is the reader's, and it leaves with no answer rather than
          // with whatever was tapped and then reconsidered.
          onSkip={purpose === "read" ? () => finish([]) : undefined}
        />
      )}
    </View>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

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

/**
 * One option: an emoji, a label, an optional second line, and the check.
 *
 * ONE SELECTED LOOK. The peach fill, the accent border and the filled check
 * disc, from the spec's purpose card, on every option row on every path. The
 * design frames showed two treatments (a fill on one screen, a bare border on
 * the next); a person walking three of these screens in a row would read the
 * difference as a state they had not chosen. Unselected rows draw no ring at
 * all: an empty circle on every row is a column of controls that say nothing,
 * and the check appearing IS the state change.
 */
function OptionRow({
  icon,
  label,
  sub,
  selected,
  multi,
  onPress,
}: Option & { selected: boolean; multi: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      // A checkbox on a screen that takes several answers, a radio on one
      // that takes one: the role is how a screen reader user learns which
      // kind of question this is before they have tapped anything.
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityLabel={label}
      accessibilityHint={sub}
      // Both announce "checked"; `selected` stays so the state reads the
      // same way as the genre chips' in the tree.
      accessibilityState={{ selected, checked: selected }}
      style={[styles.optRow, selected && styles.optRowSelected]}
    >
      {/* The emoji is content, not iconography: it is part of the option's
          copy and is what makes a list of abstractions scannable. */}
      <Text style={styles.optIcon}>{icon}</Text>
      <View style={styles.optText}>
        <Text style={styles.optLabel}>{label}</Text>
        {sub ? <Text style={styles.optSub}>{sub}</Text> : null}
      </View>
      {selected
        ? (
          <View style={styles.check}>
            <IconCheck size={13} color={colors.surface} />
          </View>
        )
        : null}
    </Pressable>
  );
}

/**
 * Option rows under a heading, with a pinned CTA.
 *
 * `mode` decides whether a tap replaces the answer or adds to it
 * (`toggleAnswer`). A multi-select screen says so in a line under the
 * heading, because the rows look the same either way and a person who
 * cannot tell will pick one and move on.
 */
const MULTI_HINT = "Pick as many as you like.";

function OptionScreen({
  title,
  sub,
  options,
  value,
  onChange,
  mode = "single",
  cta,
  onNext,
  wordmark,
  footer,
  after,
}: {
  title: string;
  sub?: string;
  options: readonly Option[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  mode?: Selection;
  cta: string;
  onNext: () => void;
  wordmark?: boolean;
  /** Under the CTA: the reader's Skip. */
  footer?: React.ReactNode;
  /** After the options, inside the scroll: the reader's UP NEXT card. */
  after?: React.ReactNode;
}) {
  return (
    <View style={styles.grow}>
      <View style={styles.headPad}>
        {wordmark
          ? (
            <View style={styles.wordmarkSlot}>
              <BrandWordmark size={28} />
            </View>
          )
          : null}
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        {mode === "multi" ? <Text style={styles.multiHint}>{MULTI_HINT}</Text> : null}
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.optionBody}>
        {options.map((o) => (
          <OptionRow
            key={o.k}
            {...o}
            multi={mode === "multi"}
            selected={value.includes(o.k)}
            onPress={() => onChange(toggleAnswer(value, o.k, mode, options))}
          />
        ))}
        {after}
      </ScrollView>
      <View style={styles.footPad}>
        {/* Validation is one rule for every screen here: at least one answer.
            The reader's routine question is the only one that can be left,
            and it leaves through Skip, not through an enabled Continue. */}
        <PrimaryButton label={cta} enabled={value.length > 0} onPress={onNext} />
        {footer}
      </View>
    </View>
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
    <OptionScreen
      wordmark
      title="What brings you to Katha?"
      sub="We will shape your first experience around what matters most."
      options={PURPOSES}
      value={purpose ? [purpose] : []}
      // Always single: the purpose decides which screens follow.
      onChange={(value) => setPurpose(value[0] as OnboardingPurpose)}
      cta="Continue"
      onNext={onNext}
    />
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
  refine: string[];
  setRefine: (value: string[]) => void;
  onNext: () => void;
}) {
  const opts = purpose === "read"
    ? REFINE_READ
    : purpose === "write"
    ? REFINE_WRITE
    : REFINE_BOTH;
  // The reader's heading is the design's, and it has no sub: the three
  // options say what the question is about better than a line under it did.
  const title = purpose === "read"
    ? "How do you like your stories?"
    : purpose === "write"
    ? "What do you want to write?"
    : `Where should Katha start today, ${fname}?`;
  const sub = purpose === "read"
    ? undefined
    : purpose === "write"
    ? "We will prepare the right creative tools."
    : "Your shelf and writing room can work together.";
  return (
    <OptionScreen
      title={title}
      sub={sub}
      options={opts}
      value={refine}
      onChange={setRefine}
      mode={selectionFor("refine", purpose)}
      cta="Continue"
      onNext={onNext}
    />
  );
}

// ── MOOD (readers) ──────────────────────────────────────────────────────────
function MoodScreen({
  fname,
  mood,
  setMood,
  onNext,
}: {
  fname: string;
  mood: string[];
  setMood: (value: string[]) => void;
  onNext: () => void;
}) {
  return (
    <OptionScreen
      title={`${fname}, what are you in the mood for?`}
      // "Tonight only" is a promise Home keeps: the answer is the Tonight
      // rail at the top of the first shelf, and it is not stored past the
      // session.
      sub="Tonight only. It sets the story, and who you'll be in it."
      options={MOODS}
      value={mood}
      onChange={setMood}
      mode={selectionFor("mood", "read")}
      cta="Continue"
      onNext={onNext}
    />
  );
}

// ── MOMENT (adaptive) ───────────────────────────────────────────────────────
function MomentScreen({
  fname,
  purpose,
  moment,
  setMoment,
  onNext,
  onSkip,
}: {
  fname: string;
  purpose: OnboardingPurpose | "";
  moment: string[];
  setMoment: (value: string[]) => void;
  onNext: () => void;
  onSkip?: () => void;
}) {
  const opts = purpose === "read"
    ? MOMENTS_READ
    : purpose === "write"
    ? MOMENTS_WRITE
    : MOMENTS_BOTH;
  const title = purpose === "read"
    ? "When do you usually read?"
    : purpose === "write"
    ? "What usually stops you?"
    : `Which loop sounds most like you, ${fname}?`;
  const sub = purpose === "read"
    ? "So the right length arrives at the right time."
    : purpose === "write"
    ? "Your answer decides what we put within reach first."
    : "We will connect discovery and creation around this rhythm.";
  return (
    <OptionScreen
      title={title}
      sub={sub}
      options={opts}
      value={moment}
      onChange={setMoment}
      mode={selectionFor("moment", purpose)}
      // "Build my profile" pointed at a progress ring that no longer exists;
      // every purpose goes to the same next screen, and the button says so.
      cta="Continue"
      onNext={onNext}
      after={purpose === "read" ? <UpNextCard /> : null}
      footer={onSkip
        ? (
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip"
            hitSlop={8}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        )
        : null}
    />
  );
}

/**
 * What the reader is about to be asked, shown before the ask.
 *
 * The next screen puts three portraits in front of somebody who has only
 * answered questions so far, and a person who does not know why a character
 * is suddenly being offered reads it as a detour. This card says it a screen
 * early, in the design's words, with the hero portrait the next screen
 * fans open. Not a control: it has no press and is one accessible element.
 */
function UpNextCard() {
  return (
    <View
      style={styles.upNext}
      accessible
      accessibilityLabel="Up next: be the lead in these stories. Describe yourself once. Katha writes you in."
    >
      <Image
        // The next screen's hero, so the face here is the one that steps
        // forward there.
        source={STAGE_CAST[0].source}
        resizeMode="cover"
        style={styles.upNextPortrait}
      />
      <View style={styles.upNextCopy}>
        <Text style={styles.upNextEyebrow}>UP NEXT</Text>
        <Text style={styles.upNextTitle}>Be the lead in these stories</Text>
        <Text style={styles.upNextBody}>
          Describe yourself once. Katha writes you in.
        </Text>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.onboardingBg },
  grow: { flex: 1 },
  // The same 40pt the pinned dock gives every other screen's CTA, so the
  // button does not jump 8pt between the first screen and the second.
  pad: {
    flex: 1,
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.md,
    paddingBottom: CTA_BOTTOM,
  },
  headPad: {
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.md,
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
  h1: { ...onboardingType.title, color: colors.ink },
  sub: { ...onboardingType.helper, color: colors.muted, marginTop: spacing.related },
  // Ink, not accent: the orange is under 3:1 on this ground at helper size.
  multiHint: {
    ...onboardingType.helper,
    color: colors.ink,
    fontWeight: "700",
    marginTop: spacing.related,
  },
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
    ...type.bodySmall,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
  },
  chipLabelSelected: { color: colors.surface },
  /*
    The border is always drawn, in the card's own colour when the row is not
    selected, so selecting a row changes its colour and never its size: a
    border that appears on selection moves every row under it by three
    points, and a list that reflows when you tap it reads as a layout bug.
  */
  optRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.onboardingCard,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  optRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  optIcon: { fontSize: 26, lineHeight: 32 },
  optText: { flex: 1 },
  optLabel: { ...type.headline, color: colors.ink },
  optSub: { ...type.meta, color: colors.muted, marginTop: spacing.tight },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  skip: {
    alignSelf: "center",
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  skipText: {
    ...onboardingType.helper,
    color: colors.muted,
    textDecorationLine: "underline",
  },
  upNext: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.onboardingCard,
    backgroundColor: colors.accentSoft,
  },
  /** The W3 side card at a fifth of its size, same 5:7 as the stage's cards. */
  upNextPortrait: {
    width: 80,
    height: 112,
    borderRadius: radius.md,
    backgroundColor: colors.onboardingStone,
  },
  upNextCopy: { flex: 1, gap: spacing.tight },
  upNextEyebrow: {
    ...onboardingType.sectionHeader,
    color: colors.accent,
    letterSpacing: 1.5,
  },
  upNextTitle: {
    ...onboardingType.body,
    fontWeight: "700",
    color: colors.ink,
  },
  upNextBody: { ...onboardingType.helper, color: colors.muted },
});
