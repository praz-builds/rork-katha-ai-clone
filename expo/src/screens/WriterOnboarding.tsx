import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { CraftingLoader } from "@/components/create/CraftingLoader";
import { PlanSection } from "@/components/create/PlanSection";
import { inferStoryBrief } from "@/lib/api";
import { enableNotifications } from "@/lib/notifications";
import { sendEmailCode, verifyEmailCode } from "@/lib/session";
import {
  GENRE_BAR,
  GENRE_EMOJI,
  GENRE_STARTERS,
} from "@/lib/genre-content";
import {
  colors,
  fonts,
  genreLabels,
  IconAdd,
  IconBack,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconRemove,
  motion,
  onboardingType,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { CreateDraft, Genre } from "@/types/domain";

/**
 * The writer path through onboarding.
 *
 * ## What this flow does and does not spend
 *
 * Everything before the paywall is free: one structured `shape-story` call in
 * the onboarding variant, which returns the blueprint, the plan and the opening
 * prose together. No image is generated, no story row is written, and no credit
 * is reserved. The real story is created afterwards, from the Create studio's
 * review screen, on either the purchased plan or the welcome grant.
 *
 * That call is now started when the user LEAVES the idea step rather than when
 * they reach the wait, because it needs only the idea and the shelf and both
 * are final at that point. See `startShaping` for what that costs and where
 * `ONBOARDING_FLOW.md`'s budget needs rewording.
 *
 * ## Why the user presses Create rather than us
 *
 * Generation is never automatic on arrival. The extra tap means a person who is
 * about to close the app has not silently burned credits on a story they will
 * never open, and it keeps the price on the button where
 * `CREDITS_AND_PRICING.md` decision 33 wants it.
 *
 * ## Screen order
 *
 * Idea, details, email, crafting, blueprint, preview, paywall, offer,
 * notifications, welcome. Auth sits before the crafting wait rather than after
 * the preview, which is a deviation from `ONBOARDING_FLOW.md` section 11 and
 * follows the newer design; the section is due a rewrite against it.
 */

type Step =
  | "idea"
  | "details"
  | "email"
  | "code"
  | "crafting"
  | "blueprint"
  | "preview"
  | "paywall"
  | "offer"
  | "notify"
  | "welcome";

export type WriterOnboardingResult = {
  draft: Partial<CreateDraft> & { seed: string };
  email: string;
  subscribed: boolean;
  notificationsEnabled: boolean;
};

type Props = {
  onDone: (result: WriterOnboardingResult) => void;
  onExit?: () => void;
  /**
   * The shelf chosen earlier in onboarding, when there was one. The writer path
   * branches at Purpose, before the reader genre screen, so most of the time
   * there is not - and the bar opens on a sensible default the user can change
   * rather than on nothing selected.
   */
  initialGenre?: Genre;
};

/**
 * Name and background. Deliberately not the full Craft character sheet.
 *
 * The second field used to be called `traits` and asked for them with an
 * example rather than a label, and users could not tell what was wanted. It has
 * always been the character's background - personality, relationships,
 * backstory - which is what `craft()` maps it to, so it is named that now.
 * Description and appearance stay out: the full sheet lives in Create.
 */
type CastMember = { name: string; background: string };

/**
 * The floor on an idea.
 *
 * Onboarding gets exactly one model call, and that call has to produce a title,
 * a world, a cast, a plan and 150 words of opening the reader will judge the
 * product by. Six words cannot carry that: the blueprint comes back generic,
 * and the user reads the generic result as what Katha is capable of. The Create
 * studio has no such floor - it has the brief-strength meter instead, and a
 * genre, a cast and a world to work from. Here there is only the sentence.
 */
const MIN_IDEA_LENGTH = 40;

/** Onboarding keeps the cast small. The studio allows three. */
const MAX_ONBOARDING_CAST = 2;

const DEFAULT_GENRE: Genre = "mystery";

const CHAPTER_COUNTS = [3, 7, 15] as const;

/**
 * Chapter length, labelled by the number a reader actually feels.
 *
 * Minutes are derived from the word bands in `_shared/types.ts` at **260 wpm**,
 * the measured mean silent reading rate for adult English fiction across 190
 * studies and 18,573 participants (Brysbaert 2019). Non-fiction is slower, at
 * 238, because its words are longer; most adults reading fiction fall between
 * 200 and 320, which is why every figure here is hedged with "about".
 *
 * Minutes rather than word counts on purpose. A word count is a number the
 * writer has to convert before it means anything, and it invites them to
 * optimise the one thing that does not make a story better. The word bands
 * themselves are still unverified against real generations - see
 * STORY_GENERATION_FLOW.md section 14 - so they stay out of the interface.
 */
const CHAPTER_LENGTHS = [
  { id: "short", label: "Short", minutes: 3 },
  { id: "standard", label: "Standard", minutes: 5 },
  { id: "long", label: "Long", minutes: 9 },
] as const;

function minutesFor(length: "short" | "standard" | "long"): number {
  return CHAPTER_LENGTHS.find((option) => option.id === length)?.minutes ?? 5;
}

const ENTITLEMENTS = [
  "Edit every word by hand, as much as you like",
  "3 free AI redrafts for every chapter",
  "20 free paragraph edits for every chapter",
  "1 free cover retry after a paid cover",
  "Your stories are yours to save, publish, unpublish, or delete",
];

const OFFER_SECONDS = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The most moments the onboarding brief carries. Never shown as a count. */
const MAX_MOMENTS = 5;

/**
 * How many dots the progress row draws, and where the auth screens sit in it.
 *
 * Seven is the count of steps a user can see and act on: idea, details, email,
 * code, blueprint, preview, and the paywall. Crafting, the offer, the
 * notification ask and the welcome are not in it - the first is a wait, and the
 * rest are after the flow has stopped asking the user to build anything.
 *
 * Only the two auth screens pass these today. The capability is on `StepScroll`
 * so the other five can adopt it without a second implementation.
 */
const ONBOARDING_STEPS = 7;
const EMAIL_STEP = 6;
const CODE_STEP = 7;

/**
 * The reference frame every measurement in this file is checked against, and
 * the geometry of the "Try one" rail at that width.
 *
 * `ONBOARDING_FLOW.md` fixes the frame at 390 x 844. The rail bleeds through
 * the `spacing.xxxl` gutter, so at 390 the first card starts at 32 and card two
 * starts at `32 + STARTER_CARD_WIDTH + STARTER_CARD_GAP` = 316, leaving 74pt of
 * card two on screen. That 74pt slice is the entire mechanism by which a user
 * learns the rail scrolls: nothing else on the screen says so, and a rail whose
 * second card lands exactly on the right gutter looks like a single card with
 * space after it. `writer-onboarding.test.tsx` asserts the peek at 390 rather
 * than trusting this comment.
 */
/**
 * The floor on the crafting wait, in milliseconds.
 *
 * `CraftingLoader` cycles four stages at `AUTO_CYCLE_MS` (1.25s) each, and the
 * single `inferStoryBrief` call can come back in well under a second. Without
 * a floor the loader is gone before the first stage has been read: the user
 * taps, something flashes, and the blueprint is simply there. The reveal then
 * lands as a jump cut instead of as the end of a wait they watched happen.
 *
 * 5000 is a PRODUCT DECISION, not a tuning constant - it is exactly ONE FULL
 * PASS of the loader at the current cadence (4 stages x 1250ms), so every
 * stage is on screen for its whole turn and the user reads all four before the
 * reveal. Not half a pass, not two passes: the sentences say what the one call
 * is doing, and reading them once is the point. If `AUTO_CYCLE_MS` moves, this
 * moves with it - the relationship is `stages x AUTO_CYCLE_MS`, not a number
 * somebody liked. It is a FLOOR and never a cap: a call that takes longer
 * keeps the loader up for exactly as long as it takes, and nothing here
 * shortens it.
 *
 * It is also not a fake progress bar. The stages name work the server is
 * genuinely doing on that one call, and the only thing this delay buys is the
 * time to read them. Do not "optimise" it away.
 *
 * The hold is measured from the moment the crafting step is ENTERED, never
 * from the moment the request was fired. Those used to be the same instant and
 * are not any more: the request is warmed from the idea step, so timing the
 * floor from the fire would find it already spent by the time the user
 * arrives, and the loader they were meant to read would be a single frame.
 */
export const CRAFTING_MIN_MS = 5000;

const REFERENCE_WIDTH = 390;
export const STARTER_CARD_WIDTH = 272;
export const STARTER_CARD_GAP = spacing.md;
export const STARTER_RAIL_PEEK = REFERENCE_WIDTH - spacing.xxxl -
  STARTER_CARD_WIDTH - STARTER_CARD_GAP;

/**
 * The one call's result, in a form that cannot throw.
 *
 * `failed` is not the same question as "did it come back empty". A provider
 * that answers with nothing still went through the work the loader stages
 * describe and still earns the floor; a request that rejected did not, and
 * `craft()` lets it straight through. Folding the rejection into a value here
 * rather than leaving it as a rejected promise is also what keeps a warmed
 * request from sitting on the microtask queue as an unhandled rejection for
 * the thirty seconds before anybody awaits it.
 */
type ShapeOutcome = {
  failed: boolean;
  shaped: Awaited<ReturnType<typeof inferStoryBrief>>;
};

/**
 * A shaping request, tagged with the exact inputs it was fired for.
 *
 * The tag is the whole invalidation mechanism. A warmed request is only usable
 * by a user whose idea and shelf are still the ones it asked about, and there
 * is no way to check that after the fact except to have written them down.
 */
type PendingShape = {
  seed: string;
  genre: Genre;
  outcome: Promise<ShapeOutcome>;
};

export default function WriterOnboarding(
  { onDone, onExit, initialGenre }: Props,
) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("idea");

  const [seed, setSeed] = useState("");
  const [genre, setGenre] = useState<Genre>(initialGenre ?? DEFAULT_GENRE);
  /** The genre list is closed until the chip is tapped. See the chip below. */
  const [genreOpen, setGenreOpen] = useState(false);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [moments, setMoments] = useState<string[]>([]);
  const [momentInput, setMomentInput] = useState("");
  const [writingStyle, setWritingStyle] = useState("");
  const [avoid, setAvoid] = useState("");
  const [chapterCount, setChapterCount] = useState<3 | 7 | 15>(3);
  const [chapterLength, setChapterLength] = useState<
    "short" | "standard" | "long"
  >("standard");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  /**
   * Auth is one-way. Walking back from the blueprint to change the idea must
   * not send a second code to an address already verified, and must not put a
   * signed-in user back in front of a sign-in form.
   */
  const [authenticated, setAuthenticated] = useState(false);

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [beats, setBeats] = useState<string[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const haptic = useCallback((kind: "select" | "confirm" = "select") => {
    if (Platform.OS === "web") return;
    if (kind === "confirm") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      void Haptics.selectionAsync();
    }
  }, []);

  /**
   * Commit whatever is in the composer as a moment.
   *
   * Shared by the Add control and the return key, because they are one action
   * with two affordances. Return alone was the whole control until now, and a
   * user who never pressed it concluded the screen took exactly one moment.
   *
   * The field clears and keeps focus, so a second moment is typed straight
   * away rather than after a tap back into the box. Duplicates are dropped
   * silently: the chip they would add is already on screen, so an error would
   * be telling the user something they can see.
   */
  const momentField = useRef<TextInput>(null);
  const addMoment = useCallback(() => {
    const next = momentInput.trim();
    if (!next || moments.includes(next) || moments.length >= MAX_MOMENTS) return;
    setMoments((all) => [...all, next]);
    setMomentInput("");
    haptic();
    momentField.current?.focus();
  }, [haptic, momentInput, moments]);

  const go = useCallback((next: Step) => {
    haptic("confirm");
    // An auth error belongs to the screen that produced it. Carried across a
    // step it becomes a complaint about a field that is no longer on screen -
    // "That code did not match" sitting under the box asking for an address.
    setAuthError(null);
    setStep(next);
  }, [haptic]);

  /* ── The one model call ─────────────────────────────────────────────── */

  /**
   * Start shaping, or hand back the request already shaping the same thing.
   *
   * ## Why it is fired from the idea step
   *
   * `inferStoryBrief` needs the idea and the shelf and nothing else - the cast
   * and the chapter count are applied to its RESPONSE, in `craft()`, and never
   * sent. Both are final the moment the user leaves the idea screen, and what
   * follows is the details screen, the email screen and a six-digit code:
   * thirty to sixty seconds in which the request can be in flight instead of
   * the user watching a loader for the eight or nine seconds the model takes.
   * By the time they reach the wait the answer is usually already here, and
   * the wait collapses to the CRAFTING_MIN_MS floor, which is the wait we
   * chose rather than the one the provider imposed.
   *
   * ## Why it is keyed, and what it costs
   *
   * The flow has a working Back control, so a user can return to the idea
   * screen after a request has already gone out and change the sentence or the
   * shelf. A warmed answer to a question they no longer asked is worse than no
   * warm answer at all, so every request is tagged with the pair it was fired
   * for and is only used by a `craft()` whose pair still matches. A discarded
   * request is simply dropped: nothing awaits it, so it can write no state and
   * navigate nowhere, and its rejection handler is already attached.
   *
   * The trigger is LEAVING the idea step, not typing in it - one press of
   * Continue, one request, however many keystrokes went into it - and the
   * matching key means pressing Continue again on an unchanged idea reuses the
   * warm one rather than firing a second.
   *
   * **The budget.** `ONBOARDING_FLOW.md`'s Summary says the pre-paywall flow
   * costs "one structured model call worst case", and with this change that
   * sentence is no longer true of the edit case. The honest number is **one
   * call per departure from the idea step with a changed idea or shelf**: a
   * user who goes straight through costs one, a user who backs up twice to
   * rewrite their sentence costs three, and there is no fixed ceiling because
   * there is no limit on how many times a person may reconsider. Abandonment
   * also costs one now where it used to cost nothing, since the user who quits
   * on the details screen has already fired the request. That sentence in the
   * Summary needs rewording to bound the call per *submitted idea* rather than
   * per flow; this file deliberately does not edit the spec.
   */
  const pendingShape = useRef<PendingShape | null>(null);

  const startShaping = useCallback(
    (forSeed: string, forGenre: Genre): Promise<ShapeOutcome> => {
      const warm = pendingShape.current;
      if (warm && warm.seed === forSeed && warm.genre === forGenre) {
        return warm.outcome;
      }
      // The rejection handler goes on HERE, at the moment the request is
      // fired, and not where it is awaited. Between the two there are three
      // screens and up to a minute of the user typing, and a rejected promise
      // that nobody is holding for that long is an unhandled rejection - a
      // warning in development and a crash in a release build.
      const outcome = inferStoryBrief(forSeed, "onboarding", forGenre).then(
        (shaped) => ({ failed: false, shaped }),
        // Silent. A failed convenience must never become an error screen in a
        // flow the user has not yet been given a reason to trust.
        () => ({ failed: true, shaped: null }),
      );
      pendingShape.current = { seed: forSeed, genre: forGenre, outcome };
      return outcome;
    },
    [],
  );

  const craft = useCallback(async (alive: () => boolean) => {
    // The floor is measured from HERE, the entry to the wait, and not from the
    // fire. See CRAFTING_MIN_MS.
    const startedAt = Date.now();
    // Warm if the idea and the shelf are still the ones it was fired for, and
    // a fresh call if they are not. `startShaping` decides which; this line
    // reads the same either way, which is the point of putting the key there.
    const { failed, shaped } = await startShaping(seed, genre);
    // The request outlives a user who backgrounds the app or taps Back while it
    // is in flight. Writing state and navigating from a dead screen is at best
    // a leak and at worst a jump back into a flow they already left.
    if (!alive()) return;

    // Hold the wait to its floor. See CRAFTING_MIN_MS: this exists so the
    // stages can be read, and it is a minimum rather than a duration - a warm
    // request has already resolved and still owes the user the full pass.
    //
    // A FAILED call is let straight through. The stages describe work on a
    // request that is already over, so holding would be the one thing the
    // floor is not: theatre. There is also nothing better waiting at the end
    // of it - the fallback blueprint is a title derived from the sentence the
    // user typed - and five seconds of "understanding the character" before
    // handing back their own words is worse than handing them back at once.
    if (!failed) {
      const remaining = CRAFTING_MIN_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      // Checked AGAIN, not only before the hold. The hold is a window several
      // seconds wide in which the user can tap Back or background the app, and
      // a screen that has been left must not be navigated out of afterwards.
      if (!alive()) return;
    }

    const resolved = shaped ?? null;

    // The chosen shelf leads, always. Inference may add secondary tags, but a
    // user who picked Horror and got Romance back would have watched the one
    // explicit choice on the screen be overruled by a guess.
    const inferred = (resolved?.genres ?? []) as Genre[];
    const genres = [genre, ...inferred.filter((item) => item !== genre)];

    // A cast the user typed outranks an inferred one, and their first
    // character is the lead. Inference only fills in when they added nobody.
    const typedCast = cast
      .filter((member) => member.name.trim())
      .map((member, index) => ({
        name: member.name.trim(),
        description: "",
        // Personality, relationships and backstory, which is what drives the
        // character's voice on the page.
        background: member.background.trim(),
        appearance: "",
        isHero: index === 0,
      }));
    const characters = typedCast.length ? typedCast : resolved?.characters ?? [];

    setBlueprint({
      title: resolved?.title ?? fallbackTitle(seed),
      genres,
      whereAndWhen: resolved?.whereAndWhen ?? "",
      lead: characters.find((character) => character.isHero) ??
        characters[0] ?? null,
      opening: resolved?.opening ?? "",
      characters,
      suggestedMoments: resolved?.suggestedMoments ?? [],
    });
    setBeats((resolved?.beats ?? []).slice(0, chapterCount));
    go("blueprint");
  }, [cast, chapterCount, genre, go, seed, startShaping]);

  useEffect(() => {
    if (step !== "crafting") return;
    let active = true;
    void craft(() => active);
    return () => {
      active = false;
    };
    // `craft` navigates on completion, so re-running it when its identity
    // changes would fire a second request and a second navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /* ── Auth ───────────────────────────────────────────────────────────── */

  const submitEmail = useCallback(async () => {
    if (!EMAIL_PATTERN.test(email.trim())) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await sendEmailCode(email);
      setCode("");
      go("code");
    } catch {
      setAuthError("We could not send that code. Check the address and retry.");
    } finally {
      setAuthBusy(false);
    }
  }, [email, go]);

  const submitCode = useCallback(async () => {
    if (code.trim().length < 6) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await verifyEmailCode(email, code);
      setAuthenticated(true);
      go("crafting");
    } catch {
      setAuthError("That code did not match. Try again or resend it.");
    } finally {
      setAuthBusy(false);
    }
  }, [code, email, go]);

  /* ── Exit ───────────────────────────────────────────────────────────── */

  const finish = useCallback(() => {
    onDone({
      draft: {
        seed: seed.trim(),
        primaryGenre: genre,
        genres: blueprint?.genres?.length ? blueprint.genres : [genre],
        whereAndWhen: blueprint?.whereAndWhen || undefined,
        characters: blueprint?.characters?.length
          ? blueprint.characters
          : undefined,
        moments: moments.length ? moments : undefined,
        beats: beats.length ? beats : undefined,
        writingStyle: writingStyle.trim() || undefined,
        avoid: avoid.trim() || undefined,
        plannedChapterCount: chapterCount,
        chapterLength,
      } as WriterOnboardingResult["draft"],
      email: email.trim(),
      subscribed,
      notificationsEnabled,
    });
  }, [
    avoid,
    beats,
    blueprint,
    chapterCount,
    chapterLength,
    email,
    genre,
    moments,
    notificationsEnabled,
    onDone,
    seed,
    subscribed,
    writingStyle,
  ]);

  const ideaReady = seed.trim().length >= MIN_IDEA_LENGTH;
  const totalMinutes = minutesFor(chapterLength) * chapterCount;
  const frame = { paddingTop: insets.top, paddingBottom: insets.bottom };

  /* ── Render ─────────────────────────────────────────────────────────── */

  if (step === "crafting") {
    return (
      <View style={[styles.screen, frame]}>
        <CraftingLoader autoCycle />
      </View>
    );
  }

  return (
    <View style={[styles.screen, frame]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {step === "idea"
          ? (
            <StepScroll
              onBack={onExit}
              title="What's your story about?"
              sub="One good sentence is enough. Katha builds the rest."
            >
              {/* One chip, not a rail of thirteen.

                  The shelf is a single decision, usually made once and rarely
                  revisited, and a thirteen-pill rail spent the top of the
                  screen competing with the idea box for the attention the idea
                  box needs. The chip states the current answer; the panel puts
                  every other answer one tap away, and the same tap on the chip
                  closes it again with the selection untouched. */}
              <View style={styles.section}>
                <Pressable
                  onPress={() => {
                    haptic();
                    setGenreOpen((open) => !open);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: genreOpen }}
                  // The label names the shelf and stays stable whether the
                  // list is open or shut, so it never reads as a different
                  // control mid-interaction. What the tap does is a hint.
                  accessibilityLabel={`Genre, ${genreLabels[genre]}`}
                  accessibilityHint={genreOpen
                    ? "Closes the list of genres"
                    : "Opens the list of genres"}
                  style={styles.genreChipButton}
                >
                  <Text style={styles.genreChipButtonText}>
                    {GENRE_EMOJI[genre]}  {genreLabels[genre]}
                  </Text>
                  <IconChevronDown size={16} color={colors.accent} />
                </Pressable>

                {genreOpen
                  ? (
                    <View style={styles.genrePanel} accessibilityRole="radiogroup">
                      {GENRE_BAR.map((option) => (
                        <Pressable
                          key={option}
                          onPress={() => {
                            haptic();
                            setGenre(option);
                            setGenreOpen(false);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: genre === option }}
                          accessibilityLabel={genreLabels[option]}
                          style={[
                            styles.genreOption,
                            genre === option && styles.genreOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.genreOptionText,
                              genre === option && styles.genreOptionTextActive,
                            ]}
                          >
                            {GENRE_EMOJI[option]}  {genreLabels[option]}
                          </Text>
                          {genre === option
                            ? <IconCheck size={16} color={colors.accent} />
                            : null}
                        </Pressable>
                      ))}
                    </View>
                  )
                  : null}
              </View>

              <View style={styles.section}>
                <TextInput
                  value={seed}
                  onChangeText={setSeed}
                  multiline
                  maxLength={1000}
                  placeholder="A woman inherits a boarded-up house and finds letters that arrive before they are written."
                  placeholderTextColor={colors.tertiary}
                  accessibilityLabel="Your idea"
                  style={styles.ideaInput}
                />

                {/* Left-aligned and stateful, not a countdown. A number ticking
                    down reads as a hurdle; this says what the idea needs and
                    then confirms it has it, which is the only moment the user
                    cares about. */}
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

              <View style={styles.section}>
                <Text style={styles.sectionHead}>TRY ONE</Text>
                {/* Keyed to the chosen shelf, and shown whole. A truncated
                    starter teaches nothing: the point of these is to show what
                    a usable idea looks like on this shelf. There is no
                    `numberOfLines` here and there must not be one.

                    Side by side, in a rail that visibly scrolls. Three cards
                    stacked full-width ate the screen and put the idea box
                    below the fold; three cards in a row invite comparison,
                    which is what "try one" is asking the user to do.

                    The rail bleeds through the gutter on both sides, so card
                    two runs off the physical edge of the screen instead of
                    stopping neatly at the right margin. Clipped at the margin
                    it reads as a card that was cut; running off the edge it
                    reads as more to the right, which is the only thing on this
                    screen that says the rail moves. See STARTER_CARD_WIDTH for
                    the measurement.

                    The copy grew to 30-word prompts, so the type drops to
                    `onboardingType.body` (14.5/18) rather than the card
                    growing to fit `type.subhead`. */}
                <View style={styles.starterRailBleed}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.starterRail}
                  >
                    {GENRE_STARTERS[genre].map((starter) => (
                      <Pressable
                        key={starter}
                        onPress={() => {
                          haptic();
                          setSeed(starter);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={starter}
                        style={styles.starterCard}
                      >
                        <Text style={styles.starterText}>{starter}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>

              {/* The cast lives here, beside the idea. A character is part of
                  what the story is about, not an afterthought on a later
                  screen. */}
              <View style={styles.section}>
                <Text style={styles.sectionHead}>WHO’S IN IT</Text>
                {cast.map((member, index) => (
                  <View key={index} style={styles.castCard}>
                    <View style={styles.castHead}>
                      <Text style={styles.castRole}>
                        {index === 0 ? "LEAD" : "ALSO IN IT"}
                      </Text>
                      <Pressable
                        onPress={() => {
                          haptic();
                          setCast((all) => all.filter((_, at) => at !== index));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove character ${index + 1}`}
                        hitSlop={12}
                      >
                        <IconRemove size={16} color={colors.tertiary} />
                      </Pressable>
                    </View>
                    {/* Two labelled fields, not two bare boxes. The second one
                        asked for "traits" through an example alone and people
                        could not tell what it wanted; naming it Background and
                        saying what belongs in it is the whole fix. */}
                    <View style={styles.section}>
                      <Text style={styles.fieldLabel}>Name</Text>
                      <TextInput
                        value={member.name}
                        onChangeText={(name) =>
                          setCast((all) =>
                            all.map((item, at) =>
                              at === index ? { ...item, name } : item
                            )
                          )}
                        placeholder="e.g. Emma"
                        placeholderTextColor={colors.tertiary}
                        accessibilityLabel={`Character ${index + 1} name`}
                        style={styles.castField}
                      />
                    </View>
                    <View style={styles.section}>
                      <Text style={styles.fieldLabel}>Background</Text>
                      <TextInput
                        value={member.background}
                        onChangeText={(background) =>
                          setCast((all) =>
                            all.map((item, at) =>
                              at === index ? { ...item, background } : item
                            )
                          )}
                        multiline
                        placeholder="Personality, relationships, backstory, traits, etc. e.g. Enjoys science class, makes nerdy jokes. Best friends with Lily. Lives in Austin, Texas with her dog."
                        placeholderTextColor={colors.tertiary}
                        accessibilityLabel={`Character ${index + 1} background`}
                        style={[styles.castField, styles.castBackground]}
                      />
                    </View>
                  </View>
                ))}
                {cast.length < MAX_ONBOARDING_CAST
                  ? (
                    <Pressable
                      onPress={() => {
                        haptic();
                        setCast((all) => [...all, { name: "", background: "" }]);
                      }}
                      accessibilityRole="button"
                      // Matches the visible text. A label that differs from
                      // what is on screen breaks voice control.
                      accessibilityLabel={cast.length
                        ? "Add one more"
                        : "Add a character"}
                      // The 48pt target comes from the slop, not from padding.
                      // Padding that big pushed the control away from the
                      // eyebrow it belongs to and broke the group.
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      style={styles.addRow}
                    >
                      <IconAdd size={18} color={colors.accent} />
                      <Text style={styles.addRowText}>
                        {cast.length ? "Add one more" : "Add a character"}
                      </Text>
                    </Pressable>
                  )
                  : null}
              </View>

              {/* Continue is where the one model call starts, not where the
                  loader does. Everything the request needs - the idea and the
                  shelf - is settled on this screen, and everything after it
                  is the user typing for the next half minute. See
                  `startShaping`. */}
              <Primary
                label="Continue"
                disabled={!ideaReady}
                onPress={() => {
                  void startShaping(seed, genre);
                  go("details");
                }}
              />
            </StepScroll>
          )
          : step === "details"
          ? (
            <StepScroll
              onBack={() => go("idea")}
              /* Not "Anything that has to happen?" any more. That was a
                 yes-or-no question about one of the five things on the screen,
                 and its honest answer is "no" - which told a writer who does
                 have a voice, a length and two scenes in mind that none of
                 that was being asked for. This screen's job is to collect what
                 the writer ALREADY holds, so the heading names that and the
                 sub keeps saying what happens to it. */
              title="The parts you already have in mind."
              sub="What you add here reaches the story. What you leave out, Katha decides."
            >
              {/* Five sections, and until this pass they did not read as five
                  of anything.

                  Every one of them headed itself with a 12pt uppercase label -
                  the smallest text in its own section, smaller than the helper
                  line under it and much smaller than the field under that - so
                  the head was the last thing the eye found rather than the
                  first. And the distance from one section to the next was the
                  container's single uniform gap, which was the same order as
                  the distance between a head and its own field, so nothing
                  grouped. One title, then an undifferentiated stack.

                  Both halves are fixed here rather than one: heads move to
                  `sectionHead` (21) so they outrank their contents, and the
                  vertical rhythm becomes `related` (8) inside a section
                  against `betweenGroups` (24) between them, three times wider.
                  Size says what a thing is; distance says what it belongs to.
                  Neither works without the other.

                  Optionality is still marked per section, not declared once
                  over the whole screen. A blanket "all optional" told the user
                  the screen did not matter, and it was also untrue: chapters
                  and chapter length always carry a value. */}
              <View style={styles.section}>
                <Text
                  style={styles.sectionHead}
                  accessibilityLabel="Moments, optional"
                >
                  MOMENTS
                  <Text style={styles.sectionHeadOptional}> (optional)</Text>
                </Text>
                <Text style={styles.helper}>
                  A scene you want in it. Katha places each one where it fits.
                </Text>
                {moments.length
                  ? (
                    <View style={styles.wrapChips}>
                      {moments.map((moment) => (
                        <Pressable
                          key={moment}
                          onPress={() => {
                            haptic();
                            setMoments((all) =>
                              all.filter((item) => item !== moment)
                            );
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${moment}`}
                          style={styles.momentChip}
                        >
                          <Text numberOfLines={1} style={styles.momentText}>
                            {moment}
                          </Text>
                          <IconRemove size={14} color={colors.accent} />
                        </Pressable>
                      ))}
                    </View>
                  )
                  : null}
                {/* The composer disappears at the cap, and that is the only
                    place the cap is ever mentioned. A "0 / 5" beside the field
                    counted a thing nobody was trying to fill: it turned an
                    invitation into a quota, and told a user with no moments
                    that they were four short of something. */}
                {moments.length < MAX_MOMENTS
                  ? (
                    <View style={styles.composer}>
                      {/* The roomy box, because this is the field on the
                          screen people actually use. A scene is a sentence,
                          not a tag, and a one-line box asked for a tag. */}
                      <TextInput
                        ref={momentField}
                        value={momentInput}
                        onChangeText={setMomentInput}
                        onSubmitEditing={addMoment}
                        multiline
                        submitBehavior="submit"
                        returnKeyType="done"
                        placeholder="e.g. they finally say the thing out loud"
                        placeholderTextColor={colors.tertiary}
                        accessibilityLabel="Add a moment"
                        style={[styles.composerInput, styles.freeText]}
                      />
                      {/* Return still commits. This exists because return was
                          the ONLY way to commit, and with nothing on screen
                          saying so, users read the field as taking one moment
                          and moved on. */}
                      <Pressable
                        onPress={addMoment}
                        accessibilityRole="button"
                        accessibilityLabel="Add moment"
                        style={({ pressed }) => [
                          styles.addMomentButton,
                          pressed && styles.addMomentButtonPressed,
                        ]}
                      >
                        <IconAdd size={16} color={colors.accent} />
                        <Text style={styles.addMomentText}>Add</Text>
                      </Pressable>
                    </View>
                  )
                  : null}
              </View>

              {/* The examples live in the placeholder, not in a chip row above
                  it. A chip row makes the user classify their taste from a
                  list we wrote; a placeholder shows the shape of an answer and
                  gets out of the way. */}
              <View style={styles.section}>
                <Text
                  style={styles.sectionHead}
                  accessibilityLabel="Writing style, optional"
                >
                  WRITING STYLE
                  <Text style={styles.sectionHeadOptional}> (optional)</Text>
                </Text>
                {/* One line, because the answer is one. A 62pt box invited a
                    paragraph and got a phrase, and the empty half read as a
                    field the user had failed to finish. "pov" left the
                    placeholder so the example fits on a single line at 390pt
                    without clipping. */}
                <TextInput
                  value={writingStyle}
                  onChangeText={setWritingStyle}
                  placeholder="e.g. 1st person, poetic, Shakespearean"
                  placeholderTextColor={colors.tertiary}
                  accessibilityLabel="Writing style"
                  style={styles.inlineInput}
                />
              </View>

              <View style={styles.section}>
                <Text
                  style={styles.sectionHead}
                  accessibilityLabel="Other instructions, optional"
                >
                  OTHER INSTRUCTIONS
                  <Text style={styles.sectionHeadOptional}> (optional)</Text>
                </Text>
                {/* Single line for the same reason, and shortened to fit one:
                    "respect certain values, exclude a topic" ran past the
                    field at 390pt. */}
                <TextInput
                  value={avoid}
                  onChangeText={setAvoid}
                  placeholder="e.g. keep it clean, avoid a topic"
                  placeholderTextColor={colors.tertiary}
                  accessibilityLabel="Other instructions"
                  style={styles.inlineInput}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionHead}>CHAPTERS</Text>
                <View style={styles.segmented} accessibilityRole="radiogroup">
                  {CHAPTER_COUNTS.map((count) => (
                    <Pressable
                      key={count}
                      onPress={() => {
                        haptic();
                        setChapterCount(count);
                        // A plan longer than the story promises beats no chapter
                        // can reach.
                        setBeats((all) => all.slice(0, count));
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chapterCount === count }}
                      accessibilityLabel={`${count} chapters`}
                      style={[
                        styles.segment,
                        chapterCount === count && styles.segmentActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          chapterCount === count && styles.segmentTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionHead}>CHAPTER LENGTH</Text>
                <View style={styles.segmented} accessibilityRole="radiogroup">
                  {CHAPTER_LENGTHS.map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={() => {
                        haptic();
                        setChapterLength(option.id);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: chapterLength === option.id,
                      }}
                      accessibilityLabel={`${option.label}, about ${option.minutes} minutes a chapter`}
                      style={[
                        styles.segmentTall,
                        chapterLength === option.id && styles.segmentActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          chapterLength === option.id &&
                          styles.segmentTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.segmentDetail}>
                        {option.minutes} min
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {/* The number a reader actually feels. Derived from the word
                    bands at 260 wpm, the measured silent reading rate for adult
                    fiction. */}
                <Text style={styles.helper}>
                  About {totalMinutes} minutes to read, across {chapterCount}{" "}
                  chapters.
                </Text>
              </View>

              {/* Auth is one-way. Walking back to change the idea must not
                  send a verified address a second code. */}
              <Primary
                label="Find the shape"
                onPress={() => go(authenticated ? "crafting" : "email")}
              />
            </StepScroll>
          )
          : step === "email"
          ? (
            /* The screen shows what is being saved before it asks for the
               address to save it against. A bare email box here is a form; the
               draft cards are the artifact, and the artifact is the reason a
               person hands over an address at all. ONBOARDING_FLOW.md section
               11. */
            <StepScroll
              onBack={() => go("details")}
              steps={ONBOARDING_STEPS}
              currentStep={EMAIL_STEP}
              art={<DraftArtwork />}
              title="Save your story before we shape it."
              sub="We’ll keep your idea and blueprint so you can come back to it anytime, on any device."
            >
              <View style={styles.section}>
                <Text style={styles.sectionHead}>EMAIL</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="elena@example.com"
                  placeholderTextColor={colors.tertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  autoComplete="email"
                  accessibilityLabel="Email address"
                  style={styles.inlineInput}
                />
                {/* The approved design says "We'll send a magic link." We do
                    not send one. `session.ts` chose a 6-digit code precisely
                    because a link opens a browser, which on a phone means
                    leaving the flow at the moment it has finally earned
                    something to save. Promising a link here and then showing a
                    code box on the next screen would break that promise on the
                    very screen that asks to be trusted with an address, so the
                    design's treatment is kept and its wording is not. */}
                <View style={styles.reassurance}>
                  <IconCheck size={16} color={colors.success} />
                  <Text style={styles.reassuranceText}>
                    We’ll send a 6-digit code. No password needed.
                  </Text>
                </View>
              </View>

              {authError
                ? <Text style={styles.error}>{authError}</Text>
                : null}
              <Primary
                label="Save & continue"
                pill
                busy={authBusy}
                disabled={!EMAIL_PATTERN.test(email.trim())}
                onPress={submitEmail}
              />
              <Text style={styles.legal}>
                By continuing you agree to our Terms and Privacy Policy.
              </Text>
            </StepScroll>
          )
          : step === "code"
          ? (
            /* Same top row, same field, same pill. The code screen sits
               between a redesigned email screen and a redesigned wait, and a
               screen in the old language between two in the new one reads as
               a different product for one step. Behaviour is untouched. */
            <StepScroll
              onBack={() => go("email")}
              steps={ONBOARDING_STEPS}
              currentStep={CODE_STEP}
              title="Check your inbox"
              sub={`Enter the 6-digit code we sent to ${email.trim()}.`}
            >
              <View style={styles.section}>
                <Text style={styles.sectionHead}>CODE</Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  placeholderTextColor={colors.tertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  accessibilityLabel="Verification code"
                  style={[styles.inlineInput, styles.codeInput]}
                />
              </View>

              {authError
                ? <Text style={styles.error}>{authError}</Text>
                : null}
              <Primary
                label="Verify and continue"
                pill
                busy={authBusy}
                disabled={code.trim().length < 6}
                onPress={submitCode}
              />
              <Pressable
                onPress={submitEmail}
                accessibilityRole="button"
                style={styles.quietButton}
              >
                <Text style={styles.quietText}>Resend code</Text>
              </Pressable>
            </StepScroll>
          )
          : step === "blueprint"
          ? (
            <StepScroll
              onBack={() => go("details")}
              /* This is the payoff screen, and "Here's the shape of it." was
                 an introduction to a diagram. It is also the copy fixed by
                 ONBOARDING_FLOW.md section 9, so this is a deliberate
                 deviation and the table there is due a rewrite against it -
                 the same standing deviation as the auth position in section
                 11. The heading names the moment the writer waited through the
                 craft screen for, and credits their idea rather than the tool.
                 The sub is unchanged and still the section 9 wording: it is
                 what turns the payoff into an invitation to edit. */
              title="Your idea just became a story."
              sub="Change the parts that make it yours."
            >
              <View style={styles.conceptCard}>
                {/* Each eyebrow hugs what it heads; the card's own gap does
                    the separating between one fact and the next. */}
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>CONCEPT</Text>
                  <Text style={styles.conceptTitle}>{blueprint?.title}</Text>
                  {blueprint?.genres?.length
                    ? (
                      <View style={styles.wrapChips}>
                        {blueprint.genres.map((genre) => (
                          <View key={genre} style={styles.genreChip}>
                            <Text style={styles.genreChipText}>
                              {genreLabels[genre] ?? genre}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )
                    : null}
                </View>
                {blueprint?.whereAndWhen
                  ? (
                    <View style={styles.section}>
                      <Text style={styles.eyebrow}>WHERE AND WHEN</Text>
                      <Text style={styles.conceptBody}>
                        {blueprint.whereAndWhen}
                      </Text>
                    </View>
                  )
                  : null}
                {blueprint?.lead
                  ? (
                    <View style={styles.section}>
                      <Text style={styles.eyebrow}>WHO’S IN IT</Text>
                      <Text style={styles.conceptBody}>
                        {blueprint.lead.name}
                        {blueprint.lead.description
                          ? `, ${blueprint.lead.description}`
                          : ""}
                      </Text>
                    </View>
                  )
                  : null}
              </View>

              {/* Called Chapters, never Arc. See PlanSection. */}
              <PlanSection beats={beats} onChange={setBeats} />

              <Primary label="See the preview" onPress={() => go("preview")} />
            </StepScroll>
          )
          : step === "preview"
          ? (
            <StepScroll
              onBack={() => go("blueprint")}
              title="This is the beginning."
              sub="You can keep shaping every part of it."
            >
              {blueprint?.opening
                ? (
                  <View style={styles.readerSurface}>
                    {blueprint.opening.split(/\n{2,}/).map((paragraph, i) => (
                      <Text key={i} style={styles.readerText}>
                        {paragraph.trim()}
                      </Text>
                    ))}
                  </View>
                )
                : null}

              {/* Entitlements never fade, dim, or move behind the paywall:
                  they are the answer to "am I stuck with this", and hiding
                  them behind the ask is what makes a preview feel like a
                  trap. ONBOARDING_FLOW.md section 10. */}
              <View style={styles.entitlements}>
                {ENTITLEMENTS.map((line) => (
                  <View key={line} style={styles.entitlementRow}>
                    <IconCheck size={16} color={colors.success} />
                    <Text style={styles.entitlementText}>{line}</Text>
                  </View>
                ))}
              </View>

              <Primary label="Save my story" onPress={() => go("paywall")} />
            </StepScroll>
          )
          : step === "paywall"
          ? (
            <Paywall
              title={blueprint?.title ?? "Your story"}
              leadName={blueprint?.lead?.name ?? "your lead"}
              onSubscribe={() => {
                setSubscribed(true);
                go("notify");
              }}
              onDismiss={() => go("offer")}
            />
          )
          : step === "offer"
          ? (
            <OneTimeOffer
              onAccept={() => {
                setSubscribed(true);
                go("notify");
              }}
              onDecline={() => go("notify")}
            />
          )
          : step === "notify"
          ? (
            <StepScroll
              title="Want to know when it's ready?"
              sub="Your story takes a couple of minutes to write. We'll tell you the moment it's done, and nothing else."
            >
              {/* A soft pre-prompt, not the OS dialog. iOS grants exactly one
                  system prompt per install; spending it before the value is
                  clear is unrecoverable. */}
              <Primary
                label="Notify me"
                onPress={async () => {
                  const granted = await enableNotifications();
                  setNotificationsEnabled(granted);
                  go("welcome");
                }}
              />
              <Pressable
                onPress={() => go("welcome")}
                accessibilityRole="button"
                style={styles.quietButton}
              >
                <Text style={styles.quietText}>Not now</Text>
              </Pressable>
            </StepScroll>
          )
          : (
            <StepScroll
              title="Welcome to Katha."
              sub="Your next chapter starts here."
            >
              {/* No numbers here. The balance is announced in-app after
                  landing, per ONBOARDING_FLOW.md section 15. */}
              <Primary label="Open Katha" onPress={finish} />
            </StepScroll>
          )}
      </KeyboardAvoidingView>
    </View>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

type Blueprint = {
  title: string;
  genres: Genre[];
  whereAndWhen: string;
  lead: CreateDraft["characters"][number] | null;
  opening: string;
  characters: CreateDraft["characters"];
  suggestedMoments: string[];
};

function fallbackTitle(seed: string): string {
  const words = seed.trim().split(/\s+/).slice(0, 4).join(" ");
  return words ? words.replace(/[.,;:]$/, "") : "Your story";
}

function StepScroll({
  children,
  art,
  title,
  sub,
  onBack,
  steps,
  currentStep,
}: {
  children: React.ReactNode;
  /**
   * Anything that belongs above the headline rather than below it. Only the
   * email screen uses it, for `DraftArtwork`: the artwork is what the headline
   * is talking about, so it cannot sit in `children` underneath it.
   */
  art?: React.ReactNode;
  /** Optional, because the paywall and the offer set their own headers. */
  title?: string;
  sub?: string;
  onBack?: () => void;
  /** Total dots to draw. Pass with `currentStep` or not at all. */
  steps?: number;
  /** Which dot is filled, 1-based. */
  currentStep?: number;
}) {
  const showProgress = Boolean(steps && currentStep);
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Two top rows, one control. With progress the back control sits on a
          rounded-square plate and the dots take the rest of the row; without
          it the chevron stands alone on the gutter as it always has. The plate
          only makes sense next to the dots: on its own it is a box drawn
          around a glyph for no reason. */}
      <View style={showProgress ? styles.topBarProgress : styles.topBar}>
        {onBack
          ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              style={showProgress ? styles.backTile : styles.backButton}
            >
              <IconBack
                size={20}
                color={showProgress ? colors.strong : colors.ink}
              />
            </Pressable>
          )
          : <View style={styles.iconButton} />}
        {showProgress
          ? <ProgressDots steps={steps!} current={currentStep!} />
          : null}
      </View>
      {art}
      {/* One group, not two siblings. The scroll container's
          `spacing.betweenGroups` gap is the distance between UNRELATED
          sections, and with the headline and its sub sitting in it directly
          the sub was as far from the heading it belongs to as it was from the
          first field of the form. Wrapped, the pair is `spacing.related` apart
          inside and keeps the larger gap below it. See the `related` rule in
          theme.ts. */}
      {title || sub
        ? (
          <View style={styles.headerGroup}>
            {title
              ? (
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
              )
              : null}
            {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          </View>
        )
        : null}
      {children}
    </ScrollView>
  );
}

/**
 * Where the user is, as short rounded bars rather than circles.
 *
 * Bars because a row of circles at this size reads as a carousel pager, which
 * is a control; these are not tappable and must not invite a tap. The filled
 * one is both wider and the only accent element in the row, so position
 * survives a colour-blind reading of it.
 *
 * The row itself carries the announcement, and the individual bars are hidden
 * from assistive technology: seven "dot" nodes in a swipe order is noise, and
 * the only useful fact is which of how many.
 */
function ProgressDots({ steps, current }: { steps: number; current: number }) {
  return (
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${steps}`}
      accessibilityValue={{ min: 1, max: steps, now: current }}
    >
      {Array.from({ length: steps }, (_, index) => (
        <View
          key={index}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.progressDot,
            index + 1 === current && styles.progressDotActive,
          ]}
        />
      ))}
    </View>
  );
}

/**
 * The saved draft, drawn rather than shipped as an asset.
 *
 * Two stacked cards: a dark one behind, tilted one way, and the live draft in
 * front tilted the other. It is built from Views and tokens on purpose. A PNG
 * of this would need a light and a dark variant, would go stale the moment the
 * card language changes anywhere else in the app, and would ship a few hundred
 * kilobytes to say something four rectangles already say.
 *
 * The contents are deliberately specific - a real title, a real timestamp -
 * because a generic placeholder would illustrate "a document" when the screen
 * is about *their* document. It is the same shape as the story cards the user
 * will meet after onboarding, so it reads as a preview of where their draft is
 * going rather than as decoration.
 */
function DraftArtwork() {
  return (
    <View style={styles.draftArt} accessibilityElementsHidden>
      <View style={styles.draftCardBack} />
      <View style={styles.draftCardFront}>
        <Text style={styles.draftEyebrow}>DRAFT · SAVED</Text>
        <Text style={styles.draftTitle}>The Room Behind the Wallpaper</Text>
        {/* Three rules standing in for body text. Not lorem ipsum: at this
            size real words would be read, and there is nothing to read. */}
        <View style={styles.draftLines}>
          <View style={styles.draftLine} />
          <View style={[styles.draftLine, styles.draftLineShort]} />
          <View style={[styles.draftLine, styles.draftLineShorter]} />
        </View>
        <View style={styles.draftSaved}>
          <View style={styles.draftSavedDot} />
          <Text style={styles.draftSavedText}>Saved just now</Text>
        </View>
      </View>
    </View>
  );
}

function Primary({
  label,
  onPress,
  disabled,
  busy,
  pill,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /**
   * Fully rounded, per the approved auth design. Opt-in rather than the
   * default so the rest of the flow keeps its `radius.lg` button until the
   * whole flow is redrawn, instead of going half-and-half screen by screen.
   */
  pill?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      style={({ pressed }) => [
        styles.primary,
        pill && styles.primaryPill,
        pressed && styles.primaryPressed,
        (disabled || busy) && styles.primaryDisabled,
      ]}
    >
      {busy
        ? <ActivityIndicator color={colors.surface} />
        : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

function Paywall({
  title,
  leadName,
  onSubscribe,
  onDismiss,
}: {
  title: string;
  leadName: string;
  onSubscribe: () => void;
  onDismiss: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <View style={styles.iconButton} />
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={16}
          style={styles.closeButton}
        >
          <IconClose size={22} color={colors.muted} />
        </Pressable>
      </View>
      {/* Eyebrow, headline and sub are one group here too, for the same
          reason StepScroll groups its own: they are three parts of one
          statement, not three sections. */}
      <View style={styles.headerGroup}>
        <Text style={styles.eyebrow}>KATHA WRITER</Text>
        <Text style={styles.title} accessibilityRole="header">
          “{title}” is ready to become yours.
        </Text>
        <Text style={styles.sub}>
          Keep shaping {leadName}’s story, with every Reader benefit included.
        </Text>
      </View>

      <View style={styles.planCard}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>3-DAY FREE TRIAL</Text>
        </View>
        <Text style={styles.planName}>Writer yearly</Text>
        <Text style={styles.planPrice}>$49.99 per year</Text>
        <Text style={styles.planNote}>50 credits every month</Text>
      </View>
      <View style={styles.planCardQuiet}>
        <Text style={styles.planName}>Writer weekly</Text>
        <Text style={styles.planPrice}>$6.99 per week</Text>
        <Text style={styles.planNote}>10 credits</Text>
      </View>
      <Text style={styles.fineprint}>
        Prefer monthly? Writer monthly is $12.99 per month with 50 credits every
        month.
      </Text>

      <View style={styles.entitlements}>
        {[
          "Everything in Reader",
          "Read without interruptions",
          "Take stories offline",
          "Unlock chapter audio and keep it",
          "50 credits every month on yearly or monthly",
        ].map((line) => (
          <View key={line} style={styles.entitlementRow}>
            <IconCheck size={16} color={colors.success} />
            <Text style={styles.entitlementText}>{line}</Text>
          </View>
        ))}
      </View>

      <Primary label="Start my 3-day free trial" onPress={onSubscribe} />
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        style={styles.quietButton}
      >
        <Text style={styles.quietText}>Not now</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * The only timer in the product, and it is a real one.
 *
 * The client clock is presentation only. Eligibility, expiry and the SKU are
 * owned by the server, so a user who backgrounds the app past zero cannot come
 * back to a live offer by holding the screen.
 */
function OneTimeOffer({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [remaining, setRemaining] = useState(OFFER_SECONDS);
  const announced = useRef(false);

  useEffect(() => {
    const timer = setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining > 0 || announced.current) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility?.("Offer expired.");
    const timeout = setTimeout(onDecline, motion.base);
    return () => clearTimeout(timeout);
  }, [onDecline, remaining]);

  const clock = useMemo(() => {
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [remaining]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <View style={styles.iconButton} />
        <Pressable
          onPress={onDecline}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={16}
          style={styles.closeButton}
        >
          <IconClose size={22} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.headerGroup}>
        <Text style={styles.eyebrow}>ONE-TIME OFFER</Text>
        <Text style={styles.title} accessibilityRole="header">
          One more way to stay with the story.
        </Text>
      </View>

      <View style={styles.planCard}>
        <Text style={styles.planName}>Reader yearly</Text>
        <Text style={styles.planPrice}>$19.99 for your first year</Text>
        <Text style={styles.planNote}>Then $29.99 per year.</Text>
        <Text style={styles.planNote}>You’ll never see this again.</Text>
        <Text style={styles.clock} accessibilityLiveRegion="polite">
          {clock}
        </Text>
      </View>

      <Primary
        label={remaining > 0 ? "Choose this offer" : "Offer expired"}
        disabled={remaining === 0}
        onPress={onAccept}
      />
      <Pressable
        onPress={onDecline}
        accessibilityRole="button"
        style={styles.quietButton}
      >
        <Text style={styles.quietText}>No thanks</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  /**
   * The gap here separates one *group* from the next, never two elements
   * inside a group. A uniform `spacing.md` between every child put a section's
   * head, its helper line and its field as far apart from each other as they
   * were from the following section, and the screen read as a flat list of
   * unrelated items. Groups are `styles.section` wrappers, tight inside.
   *
   * `betweenGroups` (24), not the `spacing.xl` (20) this used to carry. 20
   * against a section's own 8 is a ratio of 2.5, which reads, but 20 is not a
   * semantic value and nothing said what it meant; the pair the design system
   * names is `related` / `betweenGroups`, and the two distances on this screen
   * have to be the two halves of one documented rhythm rather than two numbers
   * that happen to differ. The extra 4pt is also the air the title needed when
   * it went from 22 to 28: this gap is what sits under the title/sub pair, and
   * `spacing`'s own doc comment names `betweenGroups` as exactly that.
   */
  scroll: {
    paddingHorizontal: spacing.xxxl,
    paddingBottom: spacing.huge + spacing.xxxl,
    gap: spacing.betweenGroups,
  },
  /**
   * One unit: a section head, its helper line, and the control they head.
   *
   * 8 inside against 24 outside. A section's parts sit three times closer to
   * each other than the section sits to its neighbour, which is the whole
   * mechanism by which five stacked sections read as five things instead of as
   * one list. Nothing in a section may add its own vertical margin on top of
   * this gap: two spacings doing one job is how the rhythm was lost the first
   * time.
   */
  section: { gap: spacing.related },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: spacing.huge,
  },
  /**
   * The progress variant. The dots take the free space and centre themselves
   * in it, so they sit on the screen's centreline rather than on the centre of
   * whatever is left over beside the back plate.
   */
  topBarProgress: {
    flexDirection: "row",
    alignItems: "center",
    height: spacing.huge,
    marginBottom: spacing.md,
  },
  /**
   * A rounded-square plate, not the circular `shadows.iconButton`. The circle
   * is the flow's lone-glyph control; here the chevron shares a row with the
   * dots, and a squircle on `surface2` sits back far enough that the dots stay
   * the thing the eye lands on.
   */
  backTile: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    boxShadow: shadows.card,
  },
  progressRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    // The plate is 48 wide on the leading edge only, so the row would centre
    // 48pt to the right of the screen's centre without this.
    marginRight: spacing.huge,
  },
  /**
   * `borderStrong`, not `track`. `track` is the divider hairline and is nearly
   * invisible as a filled shape on `bg`; an unreached step that cannot be seen
   * is not progress, it is a single orange bar floating in space.
   */
  progressDot: {
    width: 20,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  progressDotActive: { width: 24, backgroundColor: colors.accent },
  iconButton: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * Same 48pt touch target, glyph on the leading edge.
   *
   * Centring the glyph inside the box pushed it ~14pt inboard of the gutter,
   * so it read as floating rather than as the start of the column every
   * headline, field and button on the screen lines up to.
   */
  backButton: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  closeButton: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  /**
   * The headline and its sub, as ONE element in the scroll container's rhythm.
   *
   * `spacing.related` inside, and the container's `spacing.betweenGroups`
   * below the pair. As siblings of the scroll container the two lines were as
   * far apart as two unrelated sections, and the sub read as a standalone line
   * rather than as the second half of the heading.
   *
   * The gap BELOW the pair is where the title's move from 22 to 28 is paid
   * for. A 28pt heading wrapping to two lines is a much larger block than a
   * 22pt one, and it needs correspondingly more clear air under it before the
   * first control or it sits on the content. That air is the container's
   * `betweenGroups` (24, up from an unnamed 20) rather than a margin here:
   * `spacing`'s own doc names `betweenGroups` as the gap below a title/sub
   * pair, so the header is spaced by the same rule as everything else instead
   * of by a special case.
   */
  headerGroup: { gap: spacing.related },
  /**
   * Every screen headline in the flow, on the onboarding scale.
   *
   * This used to be `type.largeTitle` - Bricolage Grotesque at 34 - and
   * `onboardingType` was wired into the two auth screens only, so the flow ran
   * two different heading treatments and the product owner saw the old one on
   * five screens out of seven. There is now one heading style and one way to
   * set it: pass `title` to `StepScroll`.
   */
  title: { ...onboardingType.title, color: colors.ink },
  sub: { ...onboardingType.body, color: colors.muted },
  /** Green check plus secondary text, hugging the field it reassures about. */
  reassurance: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reassuranceText: { ...onboardingType.body, color: colors.muted, flex: 1 },
  legal: {
    ...type.caption,
    color: colors.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  /**
   * A PAGE-LEVEL section head: the second level of the screen, under the one
   * `title`, above one group of controls. MOMENTS, WRITING STYLE, TRY ONE.
   *
   * The token straight, at 21/26 with its +0.7 tracking, with nothing
   * overridden but the colour. This is the fix for the thing the product owner
   * saw on the details screen: the label that HEADS a section used to be 12pt,
   * which made it the smallest text in its own section and smaller than the
   * helper line underneath it. A group's head cannot be the quietest thing in
   * the group.
   *
   * WHY THE COLOUR IS `ink` AND NOT `muted`. `muted` was tried first, on the
   * theory that a colour step would keep five stacked 21pt caps from shouting.
   * It does not survive the screen: the helper lines under these heads are
   * `muted` too, so head and helper differed by 5pt and nothing else, and the
   * head stopped reading as a head at exactly the moment it mattered. The head
   * is `ink`, the helper is `muted`, and the two are then apart on size,
   * weight, case AND colour. Against the title the separation is the one
   * `onboardingType` measures: the head's caps stand 15.3pt against the
   * title's 20.4pt, three quarters as tall, which is a second level rather
   * than a rival.
   *
   * WHY IT STAYS UPPERCASE. `onboardingType`'s +0.7 tracking exists FOR the
   * uppercase treatment; the token's own doc says a sentence-case head at this
   * level is the wrong token and should be `title`. Sentence case here would
   * also give the screen two sentence-case levels seven points apart, which is
   * harder to tell apart at a glance than case-plus-size is.
   */
  sectionHead: { ...onboardingType.sectionHeader, color: colors.ink },
  /**
   * The optional marker, inline inside the section head so it wraps with it.
   *
   * `onboardingType.caption`, which is the aside level and is what this is: a
   * note about the section, not part of the section's name. At a 12pt head an
   * 11pt marker was a barely-visible step and had to be carried by tracking;
   * against a 21pt head the 12pt caption is a 1.75x drop and reads as an aside
   * on sight, so it needs nothing else. Sentence case and unspaced for the
   * same reason.
   *
   * The line height is the HEAD's, not the caption's. A nested `Text` shares
   * its parent's line box, and handing it a shorter one is either ignored or,
   * on Android, enough to nudge the whole line - so it is set to match rather
   * than left to chance.
   */
  sectionHeadOptional: {
    ...onboardingType.caption,
    lineHeight: onboardingType.sectionHeader.lineHeight,
    color: colors.tertiary,
  },
  /**
   * A COMPONENT-LEVEL label: 12pt uppercase, inside a card or above a title.
   * CONCEPT, WHERE AND WHEN, KATHA WRITER, ONE-TIME OFFER.
   *
   * Deliberately NOT `sectionHead`, and this distinction is the judgement in
   * the rebuild rather than an omission. `sectionHead` is the second level of
   * a SCREEN. These are neither: they head a single fact inside a card that is
   * itself one item on the page, or they sit above the title as a true
   * eyebrow. Promoting them to 21 would put three uppercase heads inside the
   * blueprint's concept card alongside its 28pt title, and would set the
   * paywall's eyebrow shouting over the headline it introduces - which is the
   * over-application the ramp is meant to prevent, not an instance of it.
   *
   * The family and the uppercase treatment come from the token; the size stays
   * at 12. `letterSpacing: 1` on 12px is 0.083em, which is ONBOARDING_FLOW.md
   * section 1's "0.08em on uppercase eyebrows"; `sectionHeader`'s 0.7px is the
   * same rule tuned for 21px, and carrying the pixel value down here would
   * have gutted it.
   */
  eyebrow: {
    ...onboardingType.sectionHeader,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
    color: colors.tertiary,
  },
  /**
   * The illustration well.
   *
   * Every number in this block was measured off the approved design at a 390pt
   * frame rather than estimated. Method, so the next person can redo it: the
   * mock's screen interior is 522px wide, which fixes the scale at 1.3385
   * px/pt; each card's side and top edges were least-squares fitted away from
   * the rounded corners to get the two rotations; and the widths and heights
   * came from those edge lines and the card bounding boxes, corrected for the
   * ~24px corner radius (a rotated rounded rectangle's bounding box is smaller
   * than its sharp-cornered one, and reading the extremes raw makes both cards
   * come out short).
   *
   * What that gives, at 390pt: back card 131 x 200 at -6deg, front card
   * 129 x 196 at +4deg, with the back offset 18pt left and 9pt up of the
   * front. The previous geometry - 186 and 196 wide at -9deg and +4deg, front
   * height driven by its own content - was both too wide and not portrait
   * enough, which is what the product owner was seeing.
   *
   * The height is fixed rather than a `minHeight` because the two cards are
   * now fixed too; it is the pair's own extent (about 214pt) plus room for the
   * shadows to fall.
   */
  draftArt: {
    alignItems: "center",
    justifyContent: "center",
    height: 236,
    marginBottom: spacing.lg,
  },
  /**
   * Behind, offset up and to the LEFT, tilted counter-clockwise. Tilted the
   * other way from the card in front, so the pair reads as two sheets set down
   * loosely rather than as one card with a drop shadow. The offsets are half
   * the measured back-to-front delta each, in opposite directions, so the pair
   * still sits centred in the well.
   */
  draftCardBack: {
    position: "absolute",
    width: 131,
    height: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.sepiaText,
    transform: [{ rotate: "-6deg" }, { translateX: -9 }, { translateY: -5 }],
    boxShadow: shadows.raised,
  },
  /**
   * In front, offset down and to the RIGHT, tilted slightly clockwise. The
   * height is explicit: with it driven by the content, one more line in the
   * title stretched the card and broke the overlap the design depends on.
   */
  draftCardFront: {
    width: 129,
    height: 196,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    transform: [{ rotate: "4deg" }, { translateX: 9 }, { translateY: 5 }],
    boxShadow: shadows.overlay,
  },
  /**
   * 11, not `type.caption`'s 12. "DRAFT · SAVED" at 12 with a point of
   * tracking is about 97pt wide, and the card has 97pt of content width, so it
   * sat on the edge of wrapping a two-word eyebrow onto two lines.
   */
  draftEyebrow: {
    ...onboardingType.sectionHeader,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    color: colors.accent,
  },
  /**
   * Sized to the CARD, not to the screen. At `onboardingType.title`'s 22 this
   * was the same size as the screen headline underneath it, inside a 129pt
   * card - it filled the card and left no room for the rules or the saved row.
   * 13/16.5 is what the design measures (its title lines sit 16pt apart), and
   * it wraps "The Room Behind the Wallpaper" to the three lines the design
   * shows.
   */
  draftTitle: {
    ...onboardingType.title,
    fontSize: 13,
    lineHeight: 16.5,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  draftLines: { gap: spacing.sm },
  draftLine: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  draftLineShort: { width: "88%" },
  draftLineShorter: { width: "62%" },
  draftSaved: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  draftSavedDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  /** 11 for the same reason as the eyebrow: it has 97pt of card to fit in. */
  draftSavedText: {
    ...onboardingType.body,
    fontSize: 11,
    lineHeight: 14,
    color: colors.muted,
  },
  ideaInput: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    boxShadow: shadows.card,
    padding: spacing.lg,
    minHeight: 132,
    textAlignVertical: "top",
  },
  counter: { ...type.caption, color: colors.tertiary, alignSelf: "flex-end" },
  ideaState: { ...onboardingType.body, alignSelf: "flex-start" },
  ideaStateWaiting: { color: colors.tertiary },
  ideaStateReady: { color: colors.success },
  freeText: { minHeight: 62, paddingTop: spacing.md, textAlignVertical: "top" },
  castField: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: spacing.huge,
  },
  helper: { ...onboardingType.body, color: colors.muted },
  /** A field's own name, sitting `spacing.related` above it. */
  fieldLabel: { ...type.caption, color: colors.muted },
  castCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    boxShadow: shadows.card,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  castHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  castRole: { ...type.caption, color: colors.accent, letterSpacing: 1 },
  castBackground: {
    minHeight: 84,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addRowText: { ...type.subhead, color: colors.accent },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  suggestionText: { ...type.subhead, color: colors.ink },
  counterNudge: { color: colors.accent },
  genreChipButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    boxShadow: shadows.card,
    minHeight: spacing.xxxl + spacing.xs,
  },
  genreChipButtonText: { ...type.subhead, color: colors.accent },
  genrePanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.sm,
    // It floats over the idea box below it, so it carries the deepest of the
    // three elevations rather than the flattest.
    boxShadow: shadows.overlay,
  },
  genreOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: spacing.huge,
  },
  genreOptionActive: { backgroundColor: colors.accentSoft },
  genreOptionText: { ...type.body, color: colors.ink },
  genreOptionTextActive: { color: colors.accent },
  /**
   * The bleed. Cancels the scroll view's `spacing.xxxl` gutter so the rail owns
   * the full 390, then the rail's own content padding puts card one back on the
   * gutter. Without this the peeking card would stop dead on the right margin
   * and read as clipped rather than as continuing.
   *
   * Horizontal only. It used to carry `marginTop: spacing.related` as well,
   * which stacked on top of the section's own `related` gap and put the rail
   * 16pt from the head that names it while every other section sat at 8. One
   * spacing per gap: the section owns the vertical rhythm, the rail owns the
   * bleed, and `starterRail`'s `paddingVertical` still gives the card shadows
   * their room.
   */
  starterRailBleed: {
    marginHorizontal: -spacing.xxxl,
  },
  /**
   * Breathing room above and below is `paddingVertical`, not a margin on the
   * bleed: the cards carry `shadows.card`, and a shadow with no room around it
   * is clipped by the scroll view's bounds and reads as a hard grey edge.
   */
  starterRail: {
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.md,
    gap: STARTER_CARD_GAP,
  },
  /**
   * Fixed width, unbounded height. The width is what creates the peek (see
   * STARTER_CARD_WIDTH); the height follows the copy, because `numberOfLines`
   * on a starter would defeat the only job these cards have.
   */
  starterCard: {
    width: STARTER_CARD_WIDTH,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  /**
   * A step down from `type.subhead`, with the line height tightened from 20 to
   * 18. At 16/20 a 199-character starter is eight lines in a 272pt card; at
   * 14.5/18 it is six, and the card stays under half the screen.
   */
  starterText: { ...onboardingType.body, color: colors.ink },
  segmentTall: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: 2,
  },
  segmentDetail: { ...type.caption, color: colors.tertiary },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  // Selection is carried by the accent fill and the accent label, and depth by
  // the shadow. The 1px accent ring it replaces was the only visible border
  // left in the group and read as an outline drawn on top of a filled chip.
  segmentActive: {
    backgroundColor: colors.accentSoft,
    boxShadow: shadows.card,
  },
  segmentText: { ...type.subhead, color: colors.muted },
  segmentTextActive: { color: colors.accent },
  inlineInput: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    boxShadow: shadows.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: spacing.huge,
  },
  codeInput: { letterSpacing: 8, textAlign: "center", fontSize: 22 },
  wrapChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  momentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    maxWidth: "100%",
  },
  momentText: { ...type.subhead, color: colors.accent, flexShrink: 1 },
  /**
   * The Add control aligns to the BOTTOM of the field, not its centre. The
   * field is a multi-line box that grows as a scene is typed; centred, the
   * button would drift down the screen while the user writes.
   */
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  composerInput: {
    ...type.body,
    flex: 1,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    boxShadow: shadows.card,
    paddingHorizontal: spacing.lg,
    minHeight: spacing.huge,
  },
  /**
   * Reads as a button at a glance: accent glyph, accent word, its own surface.
   * A bare "+" would have been the same invisible affordance the return key
   * already was.
   */
  addMomentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    height: spacing.huge,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    boxShadow: shadows.card,
  },
  addMomentButtonPressed: { backgroundColor: colors.surface2 },
  addMomentText: { ...type.subhead, color: colors.accent },
  conceptCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadows.card,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  conceptTitle: { ...onboardingType.title, color: colors.ink },
  conceptBody: { ...onboardingType.body, color: colors.muted },
  genreChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  genreChipText: { ...type.caption, color: colors.accent },
  /**
   * The one white surface in the flow that carried no elevation at all. On the
   * old ground that was survivable; against a lighter ground and a pure white
   * `surface` there is nothing left to separate the reader panel from the page
   * behind it, and the opening prose reads as loose text rather than as a page
   * from the story. `shadows.card` because it sits ON the page rather than
   * over it, which is the pairing `radius.xl` already implies.
   */
  readerSurface: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadows.card,
    padding: spacing.xl,
    gap: spacing.md,
  },
  readerText: { ...type.body, fontFamily: fonts.reader, color: colors.ink },
  entitlements: { gap: spacing.md, marginTop: spacing.lg },
  entitlementRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  entitlementText: { ...type.subhead, color: colors.ink, flex: 1 },
  /**
   * The led plan and the alternative, separated by elevation rather than by a
   * 2px accent ring against a 1px grey one. Depth is the honest signal here:
   * one card is in front, the other is behind it, which is exactly what the
   * page is saying.
   */
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadows.raised,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  planCardQuiet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadows.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  badgeText: { ...type.caption, color: colors.accent, letterSpacing: 1 },
  planName: { ...type.headline, color: colors.ink },
  planPrice: { ...type.body, color: colors.ink },
  planNote: { ...type.subhead, color: colors.muted },
  fineprint: { ...type.caption, color: colors.tertiary },
  /**
   * The countdown numerals. Not a heading, but the last thing in the flow that
   * was still `type.largeTitle`, and one Bricolage Grotesque element among
   * screens that are otherwise entirely Inter Tight reads as a stray rather
   * than as emphasis. `onboardingType` has no display step, so the token is
   * composed with an explicit 34 the same way `eyebrow` composes it down.
   * `tabular-nums` stays: a proportional 1 makes 1:01 jump on every tick.
   */
  clock: {
    ...onboardingType.title,
    fontSize: 34,
    lineHeight: 40,
    color: colors.accent,
    marginTop: spacing.sm,
    fontVariant: ["tabular-nums"],
  },
  primary: {
    marginTop: spacing.xl,
    height: spacing.huge + spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryPill: { borderRadius: radius.pill, height: spacing.huge + spacing.lg },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...type.headline, color: colors.surface },
  quietButton: {
    alignSelf: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  quietText: { ...type.subhead, color: colors.muted },
  error: { ...type.subhead, color: colors.accentPressed },
});
