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
import {
  inferOnboardingStoryBrief,
  inferStoryBrief,
  type StoryShapeBrief,
} from "@/lib/api";
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
  IconPalette,
  IconPencil,
  IconRefresh,
  IconRemove,
  IconTrash,
  controls,
  motion,
  onboardingType,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { CreateDraft, Genre, WriterEntryContext } from "@/types/domain";

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
 * Idea, details, email, crafting, preview, paywall, offer, notifications,
 * welcome. Auth sits before the crafting wait rather than after the preview,
 * which is a deviation from `ONBOARDING_FLOW.md` section 11 and follows the
 * newer design; the section is due a rewrite against it.
 *
 * ## Why there is no blueprint screen any more
 *
 * There used to be one between the loader and the preview: a card of facts
 * (concept, where and when, who is in it) over an editable chapter plan, ending
 * in a "See the preview" button. It was a toll gate. It showed the user a
 * summary of a story they had not been allowed to read yet, asked them to
 * approve it, and only then let them see a sentence of prose - so the payoff
 * they had waited through the loader for was one more screen away, and the one
 * question it really asked ("is this right?") is unanswerable before you have
 * read anything.
 *
 * The preview screen now carries what was worth keeping from it - the concept
 * cover, the title, the shelf, and the chapter plan as a numbered list - above
 * the opening prose, so the facts and the writing arrive together and the next
 * press is the one that saves the story. Beat editing does not survive the
 * merge: the plan is shown, not edited, and rewriting lands in the studio,
 * which is what the entitlements on this screen promise. That is a deliberate
 * loss of a capability, not an oversight.
 */

type Step =
  | "idea"
  | "details"
  | "email"
  | "code"
  | "crafting"
  | "craftError"
  | "preview"
  | "paywall"
  | "offer"
  | "notify"
  | "welcome";

export type WriterOnboardingResult = {
  draft: Partial<CreateDraft> & { seed: string };
  entryContext?: WriterOnboardingEntryContext;
  email: string;
  subscribed: boolean;
  notificationsEnabled: boolean;
};

export type WriterOnboardingEntryContext = WriterEntryContext;

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
  entryContext?: WriterOnboardingEntryContext;
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
  { Icon: IconPencil, text: "Rewrite any line by hand, free and unlimited" },
  { Icon: IconRefresh, text: "Ask Katha to redraft a chapter, 3 free per chapter" },
  { Icon: IconPalette, text: "Regenerate a cover you paid for, 1 free retry" },
  { Icon: IconTrash, text: "Delete it, publish it, or keep it private. Yours." },
];

const OFFER_SECONDS = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The most moments the onboarding brief carries. Never shown as a count. */
const MAX_MOMENTS = 5;

/**
 * How many dots the progress row draws, and which one is filled on each screen.
 *
 * SIX, because six is what a user can now see and act on: idea, details, email,
 * code, preview, paywall. Crafting, the one-time offer, the notification ask
 * and the welcome are not in it - the first is a wait, and the rest come after
 * the flow has stopped asking the user to build anything.
 *
 * It was seven, with the auth screens at 6 and 7, and both numbers came off the
 * approved auth design. They stopped being true twice over when the blueprint
 * screen was removed: the flow lost a screen, so seven counted one that does
 * not exist, AND the auth screens are the third and fourth of what remains
 * rather than the last two. A progress row that lies about both the length of
 * the journey and the position in it is worse than no progress row, so it is
 * corrected here rather than deferred to the reader flow. The visible change is
 * that the filled dot on the email and code screens moves from the end of the
 * row to the middle, which is where those screens actually are.
 *
 * WHY THE IDEA AND DETAILS SCREENS STILL DRAW NO DOTS. Their approved designs
 * do not have them, and adding a progress row to a screen is a design decision
 * about that screen, not a consequence of fixing a count. The row therefore
 * still appears at step 3. That is a real inconsistency and it is deliberate:
 * making it consistent means either adding dots to two signed-off screens or
 * removing them from three, and neither is this change's call to make.
 */
const ONBOARDING_STEPS = 6;
const IDEA_STEP = 1;
const DETAILS_STEP = 2;
const EMAIL_STEP = 3;
const CODE_STEP = 4;
const PREVIEW_STEP = 5;
const PAYWALL_STEP = 6;

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
  retryable: boolean;
  message?: string;
  shaped: Awaited<ReturnType<typeof inferStoryBrief>>;
};

type ShapeRequest = {
  seed: string;
  genre: Genre;
  brief: StoryShapeBrief;
};

/**
 * A shaping request, tagged with the exact inputs it was fired for.
 *
 * The tag is the whole invalidation mechanism. A warmed request is only usable
 * by a user whose idea and shelf are still the ones it asked about, and there
 * is no way to check that after the fact except to have written them down.
 */
type PendingShape = {
  key: string;
  outcome: Promise<ShapeOutcome>;
};

function shapeRequestKey(request: ShapeRequest): string {
  return JSON.stringify(request);
}

function storyShapeRetryable(error: unknown): boolean {
  const candidate = error as { name?: unknown; retryable?: unknown };
  return error instanceof Error &&
      candidate.name === "StoryShapeRequestError" &&
      typeof candidate.retryable === "boolean"
    ? candidate.retryable
    : true;
}

function normalizeTypedCast(cast: CastMember[]): CreateDraft["characters"] {
  return cast
    .filter((member) => member.name.trim())
    .map((member, index) => ({
      name: member.name.trim(),
      description: "",
      background: member.background.trim() || undefined,
      appearance: "",
      isHero: index === 0,
    }));
}

export default function WriterOnboarding(
  { onDone, onExit, initialGenre, entryContext }: Props,
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
  const [chapterCountOpen, setChapterCountOpen] = useState(false);
  const [chapterLengthOpen, setChapterLengthOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [shapeRetryable, setShapeRetryable] = useState(true);
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
    setShapeError(null);
    setShapeRetryable(true);
    setStep(next);
  }, [haptic]);

  /* ── The one model call ─────────────────────────────────────────────── */

  const pendingShape = useRef<PendingShape | null>(null);

  const typedCast = useMemo(() => normalizeTypedCast(cast), [cast]);
  const shapeRequest = useMemo<ShapeRequest>(() => ({
    seed: seed.trim(),
    genre,
    brief: {
      characters: typedCast.length ? typedCast : undefined,
      moments: moments.length ? moments : undefined,
      writingStyle: writingStyle.trim() || undefined,
      avoid: avoid.trim() || undefined,
      chapterLength,
      plannedChapterCount: chapterCount,
    },
  }), [avoid, chapterCount, chapterLength, genre, moments, seed, typedCast, writingStyle]);

  /**
   * Start shaping, or hand back the request already shaping the same complete
   * brief. The preview depends on these details, so the call is coordinated
   * with the backend request instead of hidden behind a fixed client timer.
   */
  const startShaping = useCallback(
    (request: ShapeRequest): Promise<ShapeOutcome> => {
      const key = shapeRequestKey(request);
      const warm = pendingShape.current;
      if (warm && warm.key === key) {
        return warm.outcome;
      }
      const outcome = (async (): Promise<ShapeOutcome> => {
        try {
          const shaped = await inferOnboardingStoryBrief(
            request.seed,
            request.genre,
            request.brief,
          );
          return { failed: false, retryable: true, shaped };
        } catch (error) {
          if (pendingShape.current?.key === key) {
            pendingShape.current = null;
          }
          return {
            failed: true,
            retryable: storyShapeRetryable(error),
            message: error instanceof Error ? error.message : undefined,
            shaped: null,
          };
        }
      })();
      pendingShape.current = { key, outcome };
      return outcome;
    },
    [],
  );

  const craft = useCallback(async (alive: () => boolean) => {
    const { failed, message, retryable, shaped } = await startShaping(shapeRequest);
    // The request outlives a user who backgrounds the app or taps Back while it
    // is in flight. Writing state and navigating from a dead screen is at best
    // a leak and at worst a jump back into a flow they already left.
    if (!alive()) return;

    if (failed || !shaped) {
      setShapeRetryable(retryable);
      setShapeError(message ??
        (retryable
          ? "We could not shape the preview. Try again and we will keep your idea and details."
          : "We could not shape the preview from that response. Your idea and details are still here."));
      setStep("craftError");
      return;
    }

    const resolved = shaped;

    // The chosen shelf leads, always. Inference may add secondary tags, but a
    // user who picked Horror and got Romance back would have watched the one
    // explicit choice on the screen be overruled by a guess.
    const inferred = (resolved?.genres ?? []) as Genre[];
    const genres = [genre, ...inferred.filter((item) => item !== genre)];

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
      grounding: resolved?.grounding,
      groundingEntities: resolved?.groundingEntities,
    });
    setBeats(resolved.beats ?? []);
    go("preview");
  }, [genre, go, seed, shapeRequest, startShaping, typedCast]);

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
        grounding: blueprint?.grounding,
        groundingEntities: blueprint?.groundingEntities,
      } as WriterOnboardingResult["draft"],
      entryContext,
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
    entryContext,
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

  /**
   * The byline under the story title on the preview screen.
   *
   * The three facts the removed blueprint card used to give a labelled row
   * each - shelf, world, lead - set as one middot-joined line, because that is
   * how a reader reads a book's metadata and because three eyebrowed rows for
   * three short strings was most of what made that screen feel like a form.
   *
   * Every part is dropped when it is empty rather than rendered blank: a
   * failed shape call leaves the title and nothing else, and the line must not
   * become a row of stranded separators.
   */
  const conceptMeta = useMemo(() => {
    const shelves = (blueprint?.genres?.length ? blueprint.genres : [genre])
      .map((id) => genreLabels[id] ?? id);
    return [
      ...shelves,
      blueprint?.whereAndWhen,
      blueprint?.lead?.name,
    ].filter(Boolean).join(" \u00b7 ");
  }, [blueprint, genre]);
  const previewBeats = useMemo(() => beats.slice(0, chapterCount > 3 ? 4 : 3), [
    beats,
    chapterCount,
  ]);
  const remainingPreviewBeats = Math.max(0, beats.length - previewBeats.length);
  const frame = { paddingTop: insets.top, paddingBottom: insets.bottom };

  /* ── Render ─────────────────────────────────────────────────────────── */

  if (step === "crafting") {
    return (
      <View style={[styles.screen, frame]}>
        <OnboardingTopBar
          onBack={() => go("details")}
          steps={ONBOARDING_STEPS}
          currentStep={PREVIEW_STEP}
        />
        <View style={styles.loaderFrame}>
          <CraftingLoader autoCycle />
        </View>
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
              steps={ONBOARDING_STEPS}
              currentStep={IDEA_STEP}
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
                <Text style={styles.eyebrowDark}>TRY ONE</Text>
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
                    `onboardingType.helper` (14.5/18) rather than the card
                    growing to fit it. */}
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
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.eyebrowDark}>WHO’S IN IT</Text>
                  <View
                    accessibilityLabel="Character details are optional"
                    style={styles.helpDot}
                  >
                    <Text style={styles.helpDotText}>?</Text>
                  </View>
                </View>
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
                onPress={() => go("details")}
              />
            </StepScroll>
          )
          : step === "details"
          ? (
            <StepScroll
              onBack={() => go("idea")}
              steps={ONBOARDING_STEPS}
              currentStep={DETAILS_STEP}
              /* Not "Anything that has to happen?" any more. That was a
                 yes-or-no question about one of the five things on the screen,
                 and its honest answer is "no" - which told a writer who does
                 have a voice, a length and two scenes in mind that none of
                 that was being asked for. This screen's job is to collect what
                 the writer ALREADY holds, so the heading names that and the
                 sub keeps saying what happens to it. */
              title="Shape the Story"
              sub="What you add here reaches the story. What you leave out, Katha decides."
            >
              {/* Five sections, and what makes them read as five is DISTANCE,
                  not size.

                  This screen has been through both answers. It first headed
                  every section with a 12pt uppercase label and separated the
                  sections with the container's single uniform gap - the same
                  order as the gap between a label and its own field - so
                  nothing grouped and the screen read as one title over an
                  undifferentiated stack. The next pass diagnosed that as a
                  SIZE problem and promoted the labels to 21, which gave the
                  screen five things that looked like titles and made it worse.

                  The gap was the real fault and it is the half that stays
                  fixed: `related` (8) inside a section against
                  `betweenGroups` (24) between them, three times wider. The
                  labels are back at 12, told apart from their helper lines by
                  case, weight, tracking and colour rather than by size. Size
                  says what a thing is; distance says what it belongs to.

                  Optionality is still marked per section, not declared once
                  over the whole screen. A blanket "all optional" told the user
                  the screen did not matter, and it was also untrue: chapters
                  and chapter length always carry a value. */}
              <View style={styles.section}>
                <Text
                  style={styles.eyebrowDark}
                  accessibilityLabel="Moments, optional"
                >
                  MOMENTS
                  <Text style={styles.eyebrowOptional}> (optional)</Text>
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
                  style={styles.eyebrowDark}
                  accessibilityLabel="Writing style, optional"
                >
                  WRITING STYLE
                  <Text style={styles.eyebrowOptional}> (optional)</Text>
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
                  style={styles.eyebrowDark}
                  accessibilityLabel="Other instructions, optional"
                >
                  OTHER INSTRUCTIONS
                  <Text style={styles.eyebrowOptional}> (optional)</Text>
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

              <View style={styles.lengthCountRow}>
                <View
                  style={[
                    styles.filterGroup,
                    chapterLengthOpen && styles.filterGroupOpen,
                  ]}
                >
                  <Text style={styles.eyebrowDark}>CHAPTER LENGTH</Text>
                  <Pressable
                    onPress={() => {
                      haptic();
                      setChapterLengthOpen((open) => !open);
                      setChapterCountOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: chapterLengthOpen }}
                    accessibilityLabel={`Chapter length, ${
                      CHAPTER_LENGTHS.find((option) =>
                        option.id === chapterLength
                      )?.label ?? "Standard"
                    }, about ${minutesFor(chapterLength)} minutes`}
                    style={styles.filterChip}
                  >
                    <Text style={styles.filterChipText}>
                      {CHAPTER_LENGTHS.find((option) =>
                        option.id === chapterLength
                      )?.label ?? "Standard"} · {minutesFor(chapterLength)} min
                    </Text>
                    <IconChevronDown size={14} color={colors.accent} />
                  </Pressable>
                  {chapterLengthOpen
                    ? (
                      <View style={styles.filterMenu} accessibilityRole="menu">
                        {CHAPTER_LENGTHS.map((option) => (
                          <Pressable
                            key={option.id}
                            onPress={() => {
                              haptic();
                              setChapterLength(option.id);
                              setChapterLengthOpen(false);
                            }}
                            accessibilityRole="menuitem"
                            accessibilityState={{
                              selected: chapterLength === option.id,
                            }}
                            style={[
                              styles.filterMenuItem,
                              chapterLength === option.id &&
                              styles.filterMenuItemActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterMenuText,
                                chapterLength === option.id &&
                                styles.filterMenuTextActive,
                              ]}
                            >
                              {option.label} · {option.minutes} min
                            </Text>
                            {chapterLength === option.id
                              ? <IconCheck size={14} color={colors.accent} />
                              : null}
                          </Pressable>
                        ))}
                      </View>
                    )
                    : null}
                </View>

                <View
                  style={[
                    styles.filterGroup,
                    chapterCountOpen && styles.filterGroupOpen,
                  ]}
                >
                  <Text style={styles.eyebrowDark}>CHAPTERS</Text>
                  <Pressable
                    onPress={() => {
                      haptic();
                      setChapterCountOpen((open) => !open);
                      setChapterLengthOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: chapterCountOpen }}
                    accessibilityLabel={`Chapters, ${chapterCount} chapters`}
                    style={styles.filterChip}
                  >
                    <Text style={styles.filterChipText}>
                      {chapterCount} chapters
                    </Text>
                    <IconChevronDown size={14} color={colors.accent} />
                  </Pressable>
                  {chapterCountOpen
                    ? (
                      <View style={styles.filterMenu} accessibilityRole="menu">
                        {CHAPTER_COUNTS.map((count) => (
                          <Pressable
                            key={count}
                            onPress={() => {
                              haptic();
                              setChapterCount(count);
                              setBeats((all) => all.slice(0, count));
                              setChapterCountOpen(false);
                            }}
                            accessibilityRole="menuitem"
                            accessibilityState={{ selected: chapterCount === count }}
                            style={[
                              styles.filterMenuItem,
                              chapterCount === count &&
                              styles.filterMenuItemActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterMenuText,
                                chapterCount === count &&
                                styles.filterMenuTextActive,
                              ]}
                            >
                              {count} chapters
                            </Text>
                            {chapterCount === count
                              ? <IconCheck size={14} color={colors.accent} />
                              : null}
                          </Pressable>
                        ))}
                      </View>
                    )
                    : null}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.helper}>
                  About {totalMinutes} minutes to read, across {chapterCount}{" "}
                  chapters.
                </Text>
              </View>

              {/* Auth is one-way. Walking back to change the idea must not
                  send a verified address a second code. */}
              <Primary
                label="Create my story"
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
                <Text style={styles.eyebrowDark}>EMAIL</Text>
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
                <Text style={styles.eyebrowDark}>CODE</Text>
                <OtpBoxes
                  value={code}
                  onChangeText={(next) => setCode(next)}
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
                style={styles.resendButton}
              >
                <Text style={styles.quietText}>Resend code</Text>
              </Pressable>
            </StepScroll>
          )
          : step === "craftError"
          ? (
            <StepScroll
              onBack={() => go("details")}
              steps={ONBOARDING_STEPS}
              currentStep={PREVIEW_STEP}
              title="Preview needs one more try"
              sub={shapeError ??
                "We could not shape the preview. Your idea and details are still here."}
            >
              {shapeRetryable
                ? <Primary label="Try again" onPress={() => go("crafting")} />
                : null}
              <Pressable
                onPress={() => go("details")}
                accessibilityRole="button"
                style={styles.quietButton}
              >
                <Text style={styles.quietText}>Back to details</Text>
              </Pressable>
            </StepScroll>
          )
          : step === "preview"
          ? (
            /* The payoff screen, and now the only one between the loader and
               the ask. It carries the approved design's content in the
               approved design's order: the story's title, its cover and facts,
               the chapter plan as a numbered list, the opening prose in a
               card, and the standing entitlements last. The one departure is
               the title's position, and the comment on it below says why.

               NO SCREEN HEADING. "This is the beginning." used to sit above
               all of this, and the design does not have it because it does not
               need it: the story's own title is the heading of the screen
               about that story, and a second sentence-case line above it would
               have been the flow's only screen with two titles. This is the
               one place `StepScroll`'s `title` is deliberately unused. */
            <StepScroll
              onBack={() => go("details")}
              steps={ONBOARDING_STEPS}
              currentStep={PREVIEW_STEP}
            >
              {/* The title takes the full column, and the cover sits under it
                  rather than beside it.

                  The design draws them side by side, which is the book-listing
                  convention and was the first thing tried. It does not survive
                  the measurement: a 94pt cover and a `spacing.lg` gap leave
                  216pt of the 326pt column, and at 28pt Inter Tight that is
                  about fifteen characters a line, so a four-word title sets in
                  four ragged lines. The alternative was to shrink the title,
                  which is a fifth size and the exact move the details screen
                  was just corrected for.

                  So the arrangement moves and the type stays: one 28pt heading
                  across the full measure, then cover and facts as a row under
                  it. Everything the design groups is still grouped, and
                  nothing on this screen is set at a size the ramp does not
                  have. */}
              <Text style={styles.title} accessibilityRole="header">
                {blueprint?.title}
              </Text>
              <View style={styles.conceptRow}>
                <ConceptCover title={blueprint?.title ?? "Your story"} />
                <View style={styles.conceptMeta}>
                  {/* One line, not three eyebrowed rows in a card. The shelf,
                      the world and the lead were three labelled facts on the
                      screen this replaces; here they are the byline under a
                      title, which is where a reader looks for them. */}
                  {conceptMeta
                    ? <Text style={styles.conceptByline}>{conceptMeta}</Text>
                    : null}
                  {previewBeats.length
                    ? (
                      <View
                        style={styles.chapterList}
                        accessibilityRole="list"
                      >
                        {previewBeats.map((beat, index) => (
                          <View key={`${index}-${beat}`} style={styles.chapterRow}>
                            {/* Zero-padded and accent-coloured, so the column
                                of numbers reads as a plan rather than as a
                                bulleted list of sentences. */}
                            <Text style={styles.chapterNumber}>
                              {String(index + 1).padStart(2, "0")}
                            </Text>
                            <Text numberOfLines={1} style={styles.chapterText}>
                              {beat}
                            </Text>
                          </View>
                        ))}
                        {remainingPreviewBeats
                          ? (
                            <Text style={styles.chapterMore}>
                              + {remainingPreviewBeats} more shaped chapters
                            </Text>
                          )
                          : null}
                      </View>
                    )
                    : null}
                </View>
              </View>

              {blueprint?.opening
                ? (
                  <View style={styles.readerSurface}>
                    <View style={styles.previewTag}>
                      <Text style={styles.previewTagText}>PREVIEW</Text>
                    </View>
                    {blueprint.opening.split(/\n{2,}/).slice(0, 2).map((paragraph, i) => (
                      <Text key={i} numberOfLines={i === 0 ? 3 : 2} style={styles.readerText}>
                        {paragraph.trim()}
                      </Text>
                    ))}
                  </View>
                )
                : null}

              {/* Entitlements never fade, dim, or move behind the paywall:
                  they are the answer to "am I stuck with this", and hiding
                  them behind the ask is what makes a preview feel like a
                  trap. ONBOARDING_FLOW.md section 10.

                  They also now carry the promise the removed blueprint screen
                  used to make in person: the first line is the one that says
                  the chapter list above is editable, later, by hand. */}
              {/* Two nested groups, not one flat list. The eyebrow sits
                  `related` from the rows it heads; the rows sit `md` from each
                  other. Flat, the eyebrow would have been the same distance
                  from the list as the rows are from one another, which is the
                  rhythm rule in theme.ts stated backwards. */}
              <View style={styles.entitlements}>
                <Text style={styles.eyebrowDark}>YOU CAN ALWAYS</Text>
                <View style={styles.entitlementRows}>
                  {ENTITLEMENTS.map(({ Icon, text }) => (
                    <View key={text} style={styles.entitlementRow}>
                      <View style={styles.entitlementIconTile}>
                        <Icon size={18} color={colors.accent} />
                      </View>
                      <Text style={styles.entitlementText}>{text}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <Primary label="Continue" onPress={() => go("paywall")} />
            </StepScroll>
          )
          : step === "paywall"
          ? (
            <Paywall
              title={blueprint?.title ?? "Your story"}
              genres={blueprint?.genres?.length ? blueprint.genres : [genre]}
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
  /** Carried opaquely from the shaping call through to the paid generation. */
  grounding?: unknown[];
  groundingEntities?: unknown[];
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
    <View style={styles.stepFrame}>
      <OnboardingTopBar
        onBack={onBack}
        steps={showProgress ? steps : undefined}
        currentStep={showProgress ? currentStep : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {art}
        {/* One group, not two siblings. The scroll container's
            `spacing.betweenGroups` gap is the distance between UNRELATED
            sections, and with the headline and its sub sitting in it directly
            the sub was as far from the heading it belongs to as it was from the
            first field of the form. Wrapped, the pair is `spacing.related`
            apart inside and keeps the larger gap below it. */}
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
    </View>
  );
}

function OnboardingTopBar({
  onBack,
  steps,
  currentStep,
  onClose,
}: {
  onBack?: () => void;
  steps?: number;
  currentStep?: number;
  onClose?: () => void;
}) {
  const showProgress = Boolean(steps && currentStep);
  return (
    <View style={styles.fixedTopBar}>
      {onBack
        ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.backTile}
          >
            <IconBack size={20} color={colors.strong} />
          </Pressable>
        )
        : <View style={styles.iconButton} />}
      {showProgress
        ? <ProgressDots steps={steps!} current={currentStep!} />
        : null}
      {onClose
        ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={16}
            style={styles.closeTile}
          >
            <IconClose size={20} color={colors.strong} />
          </Pressable>
        )
        : <View style={styles.iconButton} />}
    </View>
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

function OtpBoxes({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.replace(/\D/g, "").slice(0, 6);

  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={() => inputRef.current?.focus()}
      style={styles.otpShell}
    >
      <View style={styles.otpRow}>
        {Array.from({ length: 6 }, (_, index) => {
          const active = index === digits.length;
          const filled = Boolean(digits[index]);
          return (
            <View
              key={index}
              style={[
                styles.otpCell,
                active && styles.otpCellActive,
                filled && styles.otpCellFilled,
              ]}
            >
              <Text style={styles.otpDigit}>{digits[index] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={digits}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, "").slice(0, 6))}
        accessibilityLabel="Verification code"
        accessibilityHint="Enter the six digit code"
        keyboardType="number-pad"
        maxLength={6}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        style={styles.otpHidden}
        caretHidden
        autoFocus
      />
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

/**
 * The story's cover, before there is a cover.
 *
 * A real cover is a paid, generated image that does not exist yet at this
 * point in the flow and must not be implied to. This is the placeholder that
 * stands in its place on the preview screen: a dark portrait card carrying the
 * word CONCEPT and the story's own title, at the 3:4.4 proportion the story
 * cards elsewhere in the app use, so the shape a user meets here is the shape
 * they will meet in their library.
 *
 * Drawn from Views and tokens rather than shipped as an asset, for the same
 * reason `DraftArtwork` is: an image would need a light and a dark variant and
 * would go stale the first time the card language moves.
 */
function ConceptCover({ title }: { title: string }) {
  return (
    <View style={styles.cover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.coverTag}>
        <Text style={styles.coverTagText}>CONCEPT</Text>
      </View>
      {/* Three lines, then ellipsis. The title is already stated in full
          beside the card; this is the cover's echo of it, not a second
          reading of it, and a title that grew the card would break the row. */}
      <Text style={styles.coverTitle} numberOfLines={3}>
        {title}
      </Text>
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
  genres,
  onSubscribe,
  onDismiss,
}: {
  title: string;
  genres: Genre[];
  onSubscribe: () => void;
  onDismiss: () => void;
}) {
  const visibleGenres = genres.slice(0, 2);
  return (
    <View style={styles.stepFrame}>
      <OnboardingTopBar
        steps={ONBOARDING_STEPS}
        currentStep={PAYWALL_STEP}
        onClose={onDismiss}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

      <View style={styles.paywallStoryCard}>
        <ConceptCover title={title} />
        <View style={styles.paywallStoryMeta}>
          <Text style={styles.paywallStoryTitle}>{title}</Text>
          <View style={styles.paywallPills}>
            {visibleGenres.map((item) => (
              <View key={item} style={styles.paywallPill}>
                <Text style={styles.paywallPillText}>{genreLabels[item]}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.headerGroup}>
        <Text style={styles.title} accessibilityRole="header">
          Your story is ready to be created.
        </Text>
        <Text style={styles.sub}>
          A full chapter is 3 credits. The text, its cover, its characters.
        </Text>
      </View>

      <View style={styles.paywallBenefits}>
        {[
          { Icon: IconPencil, lead: "50 credits a month.", body: "Around 16 full chapters." },
          { Icon: IconPalette, lead: "Covers and characters included.", body: "Every chapter, not an add-on." },
          { Icon: IconPencil, lead: "Editing is free.", body: "Type, rewrite and restructure as much as you want." },
          { Icon: IconRefresh, lead: "A failed generation refunds itself.", body: "Every time, automatically." },
          { Icon: IconCheck, lead: "Reading stays free.", body: "It always was." },
        ].map(({ Icon, lead, body }) => (
          <View key={lead} style={styles.paywallBenefitRow}>
            <View style={styles.paywallBenefitIconTile}>
              <Icon size={18} color={colors.accent} />
            </View>
            <Text style={styles.paywallBenefitText}>
              <Text style={styles.paywallBenefitLead}>{lead}</Text> {body}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.planGrid}>
        <View style={styles.planCardQuiet}>
          <Text style={styles.planEyebrow}>WEEKLY</Text>
          <Text style={styles.planPriceLarge}>$6.99</Text>
          <Text style={styles.planNote}>10 credits</Text>
        </View>
        <View style={styles.planCardSelected}>
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>3 DAYS FREE</Text>
          </View>
          <Text style={styles.planEyebrow}>YEARLY</Text>
          <Text style={styles.planPriceLarge}>$49.99</Text>
          <Text style={styles.planNote}>50 credits / mo</Text>
        </View>
      </View>
      <Text style={styles.fineprint}>
        Or $12.99 monthly for 50 credits.
      </Text>

        <Primary label="Create my story" onPress={onSubscribe} />
        <Text style={styles.legal}>Cancel anytime. Trial gives you 15 credits.</Text>
      </ScrollView>
    </View>
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
  stepFrame: { flex: 1 },
  loaderFrame: { flex: 1 },
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
  fixedTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xxxl,
    height: spacing.huge,
    marginBottom: spacing.md,
  },
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
    backgroundColor: "transparent",
  },
  closeTile: {
    width: spacing.huge,
    height: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: "transparent",
  },
  progressRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
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
  /** The line under a screen title. Secondary, so `helper` rather than `body`. See `helper`. */
  sub: { ...onboardingType.helper, color: colors.muted },
  /** Green check plus secondary text, hugging the field it reassures about. */
  reassurance: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reassuranceText: { ...onboardingType.helper, color: colors.muted, flex: 1 },
  legal: {
    ...type.caption,
    color: colors.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  /**
   * The one uppercase label in the flow: MOMENTS, TRY ONE, CHAPTERS, EMAIL,
   * YOU CAN ALWAYS, KATHA WRITER, ONE-TIME OFFER.
   *
   * `onboardingType.sectionHeader` straight, with the colour set. 12pt
   * uppercase, semibold family, +1 tracking, tertiary.
   *
   * WHY IT WENT BACK DOWN FROM 21. A previous pass promoted these on the
   * argument that a label heading a group cannot be the quietest thing in the
   * group. That argument is right about a HEADING and wrong about an EYEBROW,
   * and the details screen is what proved it: five 21pt uppercase heads down
   * one scroll gave the screen five things that looked like titles and one
   * actual title, and the hierarchy the promotion was meant to create is what
   * it destroyed. One large size per screen. This is not it.
   *
   * WHAT CARRIES IT INSTEAD OF SIZE. Case, weight, tracking and colour, all
   * four at once and none of them shared with anything near it: the helper
   * line under it is sentence case, regular, +0.3 and `muted`; the field under
   * that is 16pt `ink`. A signpost does not have to be the biggest thing on
   * the road to be read first.
   *
   * ONE STYLE, NOT TWO. There used to be a page-level `sectionHead` at 21 and
   * a component-level `eyebrow` at 12, and the split existed only to stop the
   * promotion from reaching inside cards. With the promotion gone the two
   * collapsed to the same five properties, so they collapse to one name here
   * rather than sitting as a duplicate somebody has to keep in sync.
   */
  eyebrow: { ...onboardingType.sectionHeader, color: colors.tertiary },
  eyebrowDark: { ...onboardingType.sectionHeader, color: colors.ink },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  helpDot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  helpDotText: {
    ...type.caption,
    color: colors.muted,
    fontFamily: fonts.ui,
    fontWeight: "600",
    lineHeight: 15,
  },
  /**
   * The optional marker, inline inside an eyebrow so it wraps with it.
   *
   * Same size as the label it sits in, told apart by family and case: the
   * label is semibold uppercase, this is regular sentence case. A fifth size
   * for a two-word aside would be a size nobody could pick out of a lineup,
   * and at 12pt there is no room below to take one.
   *
   * The line height is the LABEL's. A nested `Text` shares its parent's line
   * box, and handing it a different one is either ignored or, on Android,
   * enough to nudge the whole line.
   */
  eyebrowOptional: {
    ...onboardingType.caption,
    lineHeight: onboardingType.sectionHeader.lineHeight,
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
    ...onboardingType.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: controls.formFieldRadius,
    boxShadow: shadows.formField,
    padding: spacing.lg,
    minHeight: 132,
    textAlignVertical: "top",
  },
  counter: { ...type.caption, color: colors.tertiary, alignSelf: "flex-end" },
  ideaState: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "600",
    lineHeight: 16,
    alignSelf: "flex-start",
  },
  ideaStateWaiting: { color: colors.tertiary },
  ideaStateReady: { color: colors.success },
  freeText: { minHeight: 62, paddingTop: spacing.md, textAlignVertical: "top" },
  castField: {
    ...onboardingType.body,
    color: colors.ink,
    backgroundColor: colors.surface2,
    borderRadius: controls.formFieldRadius,
    boxShadow: shadows.formField,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: controls.formFieldMinHeight,
  },
  /**
   * Secondary copy under an eyebrow. `helper` (14.5), never `body` (16).
   *
   * At `body` it was the same size as the text the user types into the field
   * below it, which gave our sentence the same billing as theirs and made the
   * supporting copy the widest block on the screen. Secondary text is smaller
   * than the content it supports.
   */
  helper: { ...onboardingType.helper, color: colors.muted },
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
  genreChipButtonText: {
    ...type.subhead,
    color: colors.accent,
    fontWeight: "700",
  },
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
   * `helper`, not `body`, and this is a size the card's geometry decides rather
   * than a preference. At 16/21 a 199-character starter is eight lines in a
   * 272pt card and the rail takes over half the screen; at 14.5/18 it is six
   * and the card sits under it. The measurement was made when this level
   * existed, lost when the ramp briefly dropped 14.5, and is restored here.
   */
  starterText: { ...onboardingType.helper, color: colors.muted },
  lengthCountRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    zIndex: 20,
  },
  filterGroup: {
    flex: 1,
    gap: spacing.related,
    position: "relative",
    zIndex: 1,
  },
  filterGroupOpen: { zIndex: 30 },
  filterChip: {
    minHeight: spacing.huge,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    boxShadow: shadows.card,
  },
  filterChipText: {
    ...type.subhead,
    color: colors.accent,
    fontWeight: "700",
  },
  filterMenu: {
    position: "absolute",
    top: onboardingType.sectionHeader.lineHeight + spacing.related +
      spacing.huge + spacing.sm,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xs,
    boxShadow: shadows.overlay,
    zIndex: 40,
  },
  filterMenuItem: {
    minHeight: spacing.huge,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  filterMenuItemActive: { backgroundColor: colors.accentSoft },
  filterMenuText: { ...type.subhead, color: colors.ink },
  filterMenuTextActive: { color: colors.accent, fontWeight: "700" },
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
    ...onboardingType.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: controls.formFieldRadius,
    boxShadow: shadows.formField,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: controls.formFieldMinHeight,
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
    ...onboardingType.body,
    flex: 1,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: controls.formFieldRadius,
    boxShadow: shadows.formField,
    paddingHorizontal: spacing.lg,
    minHeight: controls.formFieldMinHeight,
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
    width: spacing.huge,
    height: spacing.huge,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    boxShadow: shadows.iconCta,
  },
  addMomentButtonPressed: { backgroundColor: colors.surface2 },
  addMomentText: { ...type.subhead, color: colors.accent },
  /**
   * The one white surface in the flow that carried no elevation at all. On the
   * old ground that was survivable; against a lighter ground and a pure white
   * `surface` there is nothing left to separate the reader panel from the page
   * behind it, and the opening prose reads as loose text rather than as a page
   * from the story. `shadows.card` because it sits ON the page rather than
   * over it, which is the pairing `radius.xl` already implies.
   */
  /**
   * Cover and text side by side, the way a book is listed.
   *
   * `alignItems: "flex-start"` and not `stretch`: the right column is taller
   * than the cover as soon as there are three chapters, and stretching the
   * card to match would turn a 3:4.4 cover into whatever shape the plan
   * happened to need.
   */
  conceptRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.lg,
    /* The row belongs to the title above it, so it sits at `related` rather
       than at the scroll container's `betweenGroups`. See the spacing rule in
       theme.ts: the pair of gaps is what does the grouping, not either one. */
    marginTop: spacing.related - spacing.betweenGroups,
  },
  conceptMeta: { flex: 1, gap: spacing.sm },
  /**
   * 94 x 139, which is 1:1.48 - the proportion of the mini card in the
   * library, so this is recognisably the same object seen earlier.
   */
  cover: {
    width: 94,
    height: 139,
    borderRadius: radius.md,
    backgroundColor: colors.sepiaText,
    padding: spacing.md,
    justifyContent: "space-between",
    boxShadow: shadows.raised,
  },
  coverTag: {
    alignSelf: "flex-start",
    backgroundColor: colors.sepia,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  /** 9, not the eyebrow's 12: the tag has 70pt of card to sit in and CONCEPT is seven caps. */
  coverTagText: {
    ...onboardingType.sectionHeader,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.7,
    color: colors.sepiaText,
  },
  /** The reader family, because this is standing in for a book cover and not for a UI card. */
  coverTitle: {
    ...onboardingType.helper,
    fontFamily: fonts.tightSemiBold,
    color: colors.sepia,
  },
  /** Shelf, world and lead as one middot-joined line. Secondary, so `helper`. */
  conceptByline: { ...onboardingType.helper, color: colors.muted },
  /**
   * The plan, read-only. It was an editable list on the screen this replaces;
   * see the block comment at the top of the file for why the editing went and
   * where it went to.
   */
  chapterList: { gap: spacing.related, marginTop: spacing.sm },
  chapterRow: { flexDirection: "row", gap: spacing.sm },
  /**
   * Zero-padded, accent, and set at the body size in the semibold family so
   * the numbers form a straight column down the left of the plan. Tabular
   * alignment by fixed width rather than by font feature, because Inter Tight
   * is registered here without one.
   */
  chapterNumber: {
    ...onboardingType.helper,
    fontFamily: fonts.tightSemiBold,
    color: colors.accent,
    width: 22,
  },
  chapterText: { ...onboardingType.helper, color: colors.ink, flex: 1 },
  chapterMore: {
    ...onboardingType.caption,
    color: colors.tertiary,
    paddingLeft: 22 + spacing.sm,
  },
  readerSurface: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.betweenGroups,
    boxShadow: shadows.card,
  },
  /**
   * Right-aligned inside the card, so it labels the card without taking a line
   * of its own away from the prose. It is the one thing on this screen that
   * says the text below stops early on purpose.
   */
  previewTag: {
    alignSelf: "flex-end",
    backgroundColor: colors.sepia,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  previewTagText: { ...onboardingType.sectionHeader, color: colors.sepiaText },
  readerText: { ...type.body, fontFamily: fonts.reader, color: colors.ink },
  /**
   * The entitlement block: the top margin that separates it from what is
   * above, plus `related`, because on the preview its only two children are
   * the eyebrow and the list it heads.
   *
   * The paywall has no eyebrow, so there the block and the list are the same
   * thing and it composes both styles to get `md` between its rows. Splitting
   * the two gaps is what lets one block serve both without either screen
   * inheriting the other's rhythm.
   */
  entitlements: { gap: spacing.related, marginTop: spacing.betweenGroups },
  /** The rows themselves, `md` apart. One line each, so they need air the eyebrow does not. */
  entitlementRows: { gap: spacing.md },
  entitlementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  entitlementIconTile: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  entitlementText: { ...onboardingType.helper, color: colors.ink, flex: 1 },
  paywallStoryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    boxShadow: shadows.card,
  },
  paywallStoryMeta: { flex: 1, gap: spacing.sm },
  paywallStoryTitle: {
    ...onboardingType.body,
    fontFamily: fonts.tightSemiBold,
    fontWeight: "600",
    color: colors.ink,
  },
  paywallPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  paywallPill: {
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  paywallPillText: {
    ...type.caption,
    color: colors.ink,
    fontWeight: "700",
  },
  paywallBenefits: { gap: spacing.md },
  paywallBenefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  paywallBenefitIconTile: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  paywallBenefitText: {
    ...onboardingType.helper,
    color: colors.ink,
    flex: 1,
  },
  paywallBenefitLead: {
    fontFamily: fonts.tightSemiBold,
    fontWeight: "600",
  },
  planGrid: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "stretch",
  },
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
    flex: 1,
  },
  planCardSelected: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.accent,
    boxShadow: shadows.raised,
    padding: spacing.lg,
    gap: spacing.xs,
    flex: 1,
  },
  trialBadge: {
    alignSelf: "center",
    marginTop: -spacing.xxxl,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.premium,
  },
  trialBadgeText: {
    ...type.caption,
    color: colors.surface,
    fontWeight: "700",
    letterSpacing: 1,
  },
  planEyebrow: { ...onboardingType.sectionHeader, color: colors.tertiary },
  planPriceLarge: {
    ...onboardingType.title,
    fontSize: 30,
    lineHeight: 36,
    color: colors.ink,
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
    marginTop: spacing.md,
    height: controls.primaryCtaHeight,
    borderRadius: controls.primaryCtaRadius,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.primaryCta,
  },
  primaryPill: {
    borderRadius: controls.primaryCtaRadius,
    height: controls.primaryCtaHeight,
  },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { ...type.headline, color: colors.surface },
  quietButton: {
    alignSelf: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  resendButton: {
    alignSelf: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  quietText: { ...type.subhead, color: colors.muted },
  error: { ...type.subhead, color: colors.accentPressed },
  otpShell: {
    minHeight: controls.otpCellHeight,
    justifyContent: "center",
  },
  otpRow: { flexDirection: "row", gap: spacing.sm },
  otpCell: {
    flex: 1,
    height: controls.otpCellHeight,
    borderRadius: controls.otpCellRadius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.formField,
  },
  otpCellActive: {
    borderColor: colors.accent,
  },
  otpCellFilled: {
    borderColor: colors.borderStrong,
  },
  otpDigit: {
    ...onboardingType.body,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 22,
    lineHeight: 26,
  },
  otpHidden: {
    position: "absolute",
    width: "100%",
    height: "100%",
    opacity: 0,
  },
});
