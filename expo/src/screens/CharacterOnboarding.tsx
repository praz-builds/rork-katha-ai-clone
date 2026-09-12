import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { EmailCodeAuth } from "@/components/onboarding/EmailCodeAuth";
import { Field } from "@/components/onboarding/Field";
import { OnboardingPaywall } from "@/components/onboarding/OnboardingPaywall";
import {
  Enter,
  OnboardingTopBar,
  ReduceMotionContext,
  useReduceMotion,
} from "@/components/onboarding/primitives";
import {
  GlyphClothingAndCarry,
  GlyphFaceAndBuild,
  GlyphLeadsStories,
  GlyphSameFace,
  GlyphSavedCast,
  GlyphTheName,
  GlyphTile,
} from "@/components/onboarding/glyphs";
import type { GlyphComponent } from "@/components/onboarding/glyphs";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import * as storyApi from "@/lib/api";
import { enableNotifications } from "@/lib/notifications";
import { saveCharacterToLibrary } from "@/lib/saved-characters";
import { sendEmailCode } from "@/lib/session";
import {
  colors,
  controls,
  fonts,
  IconPerson,
  motion,
  onboardingType,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { Genre } from "@/types/domain";
import portraitAarav from "../../assets/onboarding/portrait-aarav.png";
import portraitPriya from "../../assets/onboarding/portrait-priya.png";

/**
 * The character path through onboarding: W3 to W7 of the 2026-09-11 hand-off.
 *
 * ## What the aha is now
 *
 * It used to be "type a story idea, wait, read 150 words of preview". It is now
 * "make one person, see their face". Read, write and both all come through
 * here; only the copy branches, because the thing being made is the same thing.
 *
 * ## Screen order, and why the email sits in the middle of it
 *
 * w3 (why a character), w4 (name and appearance), w5 (email), code, w6
 * (the portrait, loading then ready), paywall, welcome.
 *
 * THERE IS NO SOFT NOTIFICATION PROMPT. It used to sit between the paywall and
 * the welcome, and it was a screen asking permission to ask permission: people
 * who had just closed a paywall read a second full-screen ask as more selling
 * and declined both. The OS dialog now fires as the paywall closes, whichever
 * way it closed, at the one moment where there is something concrete to be told
 * about: a portrait that is finished and a story about to be written.
 *
 * THE PORTRAIT REQUEST IS FIRED BY W4's CTA, not by W6's mount and no longer
 * by W5's. A portrait takes about ten seconds; typing an address and then six
 * digits takes longer than that, so firing at the sheet turns the whole email
 * leg into the wait and most people arrive on W6 to a finished face instead of
 * to a scan animation. W6 still has a full loading state, because "most" is not
 * "all". The library row is written in the same press, on the anonymous
 * session, so abandoning at the code screen still leaves the person behind.
 *
 * ## What this spends
 *
 * One portrait request plus at most one reimagine. `generate-character-image`
 * is rate limited per user (12/hour, migration 00055) rather than priced, so
 * the budget below is a product decision about attention, not about money. The
 * first chapter is bought afterwards, from Home or from the Create studio.
 */

export type OnboardingPurpose = "read" | "write" | "both";

export type CharacterOnboardingEntryContext = {
  name: string;
  genreInterests: string[];
  otherGenre?: string;
  refine?: string;
  moment?: string;
};

export type OnboardingCharacter = {
  name: string;
  appearance: string;
  portraitUrl: string | null;
  savedCharacterId?: string;
};

export type CharacterOnboardingResult = {
  purpose: OnboardingPurpose;
  character: OnboardingCharacter;
  primaryGenre: Genre;
  email: string;
  subscribed: boolean;
  notificationsEnabled: boolean;
};

type Props = {
  purpose: OnboardingPurpose;
  /** The first shelf picked in the shared questionnaire, when there was one. */
  initialGenre?: Genre;
  entryContext?: CharacterOnboardingEntryContext;
  onDone: (result: CharacterOnboardingResult) => void;
  onExit?: () => void;
};

type Step = "w3" | "w4" | "w5" | "code" | "w6" | "paywall" | "welcome";

/**
 * THERE IS NO GENDER FIELD, and there is no gender on the wire either.
 *
 * W4 used to ask it as a required segmented row whose fourth option was
 * "Prefer not to say", and it was the only question in the whole flow that a
 * person could not answer by describing what they wanted. An appearance line
 * already says it whenever it matters ("a woman in her sixties", "a boy with a
 * kite") and says it in the person's own words, which is both a better prompt
 * and a shorter screen. The endpoint's `gender` parameter was removed with the
 * row rather than left accepting a value nothing sends: a dead contract is a
 * thing the next person has to work out is dead.
 */

/**
 * ONE free reimagine for the whole onboarding, not one per sheet.
 *
 * THE NUMBER IS NOT ON SCREEN. It used to be, as "1 free left" beside the pill,
 * and a counter next to the only button on the aha screen turns a delighted
 * look at a face into an accounting problem: people read the 1 before they read
 * the portrait. The budget still bounds the spend; at zero the pill quietly
 * becomes the plan's front door instead of expanding the editor, which is the
 * same truth told at the moment it is load-bearing.
 */
const REIMAGINE_BUDGET = 1;

/** Seven pills. W7 has none: it is a modal with a close, not a step. */
const ONBOARDING_STEPS = 7;
const W3_STEP = 4;
const W4_STEP = 5;
const W5_STEP = 6;
const CODE_STEP = 6;
const W6_STEP = 7;

/**
 * What W6 tells somebody the wait is, under the loading card.
 *
 * A constant rather than a literal because it is a MEASUREMENT, not copy: it
 * has to be re-set whenever the portrait path's real latency moves, and a
 * sentence buried in the middle of a JSX tree is a sentence nobody remembers to
 * re-measure. Naming it puts the number in one place, at the top of the file,
 * where the next person who times the endpoint will find it.
 */
export const PORTRAIT_WAIT_CAPTION = "Usually about 10 seconds";

const NAME_MAX = 40;
const APPEARANCE_MAX = 300;

const DEFAULT_GENRE: Genre = "mystery";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The hand-off frame is 390 x 844 with 30pt gutters, and its illustration
 * stages are fixed pixel sizes. They are multiplied by this, so a 360pt phone
 * shrinks the art instead of clipping it, and nothing above 390 grows: a
 * portrait card that scaled up on a Max would stop being a card and start
 * being the screen.
 */
const STAGE_BASIS = 330;

/** The CTA sits 40pt off the bottom, on top of the home-indicator inset. */
const CTA_BOTTOM = 40;

/**
 * The scan line's glow, and the smoked glass its status chip is made of.
 *
 * Both are written out rather than taken from `@/theme`: the glow is the only
 * coloured spread shadow in the app and the glass is a 0.72 scrim where the
 * token set stops at 0.55 (`colors.scrimHeavy`), which over a bright portrait
 * is not enough ink to read white text on. Scoped to this file.
 */
const SCAN_GLOW = "0 0 18px 4px rgba(255, 107, 26, 0.6)";
const GLASS = "rgba(15, 14, 12, 0.72)";

/** The hand-off's mount curves, built once: `Easing.bezier` allocates. */
const HERO_EASING = Easing.bezier(0.3, 0.7, 0.2, 1);
const SIDE_EASING = Easing.bezier(0.22, 0.9, 0.3, 1);
const HERO_MS = 2000;
const SIDE_DELAY_MS = 2100;
const SIDE_MS = 800;
/** The hero does not settle back. 1.08 is where it stops. */
const HERO_TO_SCALE = 1.08;

const SCAN_MS = 2200;
const DOT_MS = 1200;
const PULSE_MS = 1600;
const STATUS_MS = 2200;
/** Loading to ready. Long enough to read as the same card, not a swap. */
const MEET_CROSSFADE_MS = 300;

const STATUS_LINES = [
  "Reading your description",
  "Sketching the face",
  "Choosing the light",
  "Adding the last details",
] as const;

/**
 * The offline stand-in `generateCharacterImage` returns when Supabase is not
 * configured. It is not a URL any `<Image>` can load, so it must never reach
 * one: the placeholder card is what a person sees instead of a broken frame.
 */
const DRAFT_PORTRAIT_SCHEME = "draft-character://";

function isRenderablePortrait(url: string | null): url is string {
  return Boolean(url) && !url!.startsWith(DRAFT_PORTRAIT_SCHEME);
}

/**
 * The portrait request's result, in a form that cannot reject.
 *
 * `retryable` is a different question from `failed`. A provider having a bad
 * minute is worth another press; a refused rate-limit claim and a guest cap
 * are not, because neither clears by pressing. When it is false the server's
 * own sentence is the copy, because only it knows what the way out is.
 */
type PortraitOutcome = {
  url: string | null;
  failed: boolean;
  retryable: boolean;
  message?: string;
};

/** What the Meet card shows instead of a face. Null when there is a face. */
type PortraitFailure = { retryable: boolean; message?: string };

/**
 * Is this a refusal we must not offer a retry for?
 *
 * Wrapped in its own try because it runs INSIDE a catch. `instanceof` against
 * an export throws if the export is missing, and a throw here would reject the
 * outcome promise the Meet screen is waiting on: the portrait would never
 * resolve and the person would sit on the scan animation forever. A classifier
 * that cannot answer says "ordinary failure", which is the state with a way out
 * of it.
 */
function portraitRefusal(error: unknown): string | null {
  try {
    if (
      error instanceof storyApi.CharacterPortraitRateLimitError ||
      error instanceof storyApi.CharacterPortraitGuestCapError
    ) {
      return error.message;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * A portrait request tagged with the exact inputs and attempt it was fired for.
 *
 * The tag is the whole guard. React may render W6 more than once, and every
 * effect or handler that reruns must be able to ask "is the request I want
 * already in flight" and get a truthful answer, or a re-render spends one of
 * the twelve hourly requests the endpoint allows. The attempt number is part of
 * the key because a reimagine asks for the SAME sheet again and must not be
 * handed the answer that was already refused.
 */
type PendingPortrait = { key: string; outcome: Promise<PortraitOutcome> };

/**
 * The sheet, as one comparable value. Whitespace-insensitive on purpose.
 *
 * The separator is written as the escape `\u0000` rather than as a literal
 * control character: a raw NUL byte in the source makes the file binary to
 * `file`, to `grep` and to every diff viewer, which is a high price for a
 * delimiter. It stays NUL because nothing a person can type into either field
 * contains one, so "Ann" + "a Lee" cannot fingerprint the same as
 * "Anna" + " Lee".
 */
function sheetFingerprint(name: string, appearance: string): string {
  return `${name.trim()}\u0000${appearance.trim()}`;
}

export default function CharacterOnboarding(
  { purpose, initialGenre, entryContext, onDone, onExit }: Props,
) {
  const [step, setStep] = useState<Step>("w3");
  const reader = purpose !== "write";

  /**
   * A reader is making THEMSELVES, so their questionnaire name is the answer
   * to W4's first field and re-typing it would be the flow forgetting what it
   * was just told. A writer is making somebody else and starts empty.
   */
  const [name, setName] = useState(
    () => (reader ? (entryContext?.name ?? "").trim() : ""),
  );
  const [appearance, setAppearance] = useState("");
  /** Null until somebody picks. Required: see `sheetReady`. */

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * Has the code been entered? It is what W4's CTA walks FORWARD to.
   *
   * W4 is reachable from two directions now: from W3 on the way in, and by
   * pressing Back on W5 or on the Meet screen. Before the code it leads to W5;
   * after it, W5 is a screen this person has already finished, so it leads
   * straight to the face.
   */
  const [emailVerified, setEmailVerified] = useState(false);

  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [portraitFailure, setPortraitFailure] = useState<PortraitFailure | null>(
    null,
  );
  const [drawing, setDrawing] = useState(false);
  /** The sheet the portrait on screen was drawn from. See `redraw`. */
  const [portraitKey, setPortraitKey] = useState<string | null>(null);
  const [reimaginesUsed, setReimaginesUsed] = useState(0);

  const [savedCharacterId, setSavedCharacterId] = useState<string | undefined>();
  const [subscribed, setSubscribed] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const reduceMotion = useReduceMotion();

  const haptic = useCallback((kind: "select" | "confirm" = "select") => {
    if (Platform.OS === "web") return;
    if (kind === "confirm") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      void Haptics.selectionAsync();
    }
  }, []);

  const go = useCallback((next: Step) => {
    haptic("confirm");
    setStep(next);
  }, [haptic]);

  /* ── The portrait ───────────────────────────────────────────────────── */

  const pendingPortrait = useRef<PendingPortrait | null>(null);
  /** The request whose answer is still wanted. See `redraw`. */
  const wantedKey = useRef<string | null>(null);
  /** Monotonic, so a reimagine and a retry both mint a genuinely new key. */
  const attempt = useRef(0);
  /**
   * False once this screen is gone.
   *
   * A portrait request outlives the person who backgrounds the app or leaves
   * while it is in flight. Writing state from a dead screen is a warning at
   * best and a jump back into a flow they have already left at worst.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const startPortrait = useCallback(
    (
      key: string,
      request: {
        name: string;
        appearance: string;
      },
    ) => {
      const warm = pendingPortrait.current;
      if (warm && warm.key === key) return warm.outcome;
      const outcome = (async (): Promise<PortraitOutcome> => {
        try {
          const { url } = await storyApi.generateCharacterImage({
            // A fresh id every time. The endpoint has no idempotency key and no
            // credit reservation, so a replayed id would be a second paid
            // provider call wearing the first one's name.
            requestId: storyApi.createGenerationRequestId(),
            name: request.name,
            appearance: request.appearance,
            // Onboarding has no image-style picker, so the genre's own look.
            imageStyle: "auto",
          });
          return { url, failed: false, retryable: true };
        } catch (error) {
          // Folded into a value rather than left as a rejection: nothing awaits
          // this promise while the request runs, and an unhandled rejection
          // sitting on the microtask queue for twenty seconds is a red box in
          // development for a failure the screen already handles.
          const refusal = portraitRefusal(error);
          if (refusal) {
            return { url: null, failed: true, retryable: false, message: refusal };
          }
          return { url: null, failed: true, retryable: true };
        }
      })();
      pendingPortrait.current = { key, outcome };
      return outcome;
    },
    [],
  );

  /** The sheet a library save has already been written for. See `saveCharacter`. */
  const savedFor = useRef<string | null>(null);

  /**
   * Write the character to the library, on whatever session is current.
   *
   * `saveCharacterToLibrary` works on the anonymous session, and verifying an
   * email CONVERTS that anonymous user in place rather than creating a second
   * one, so the row written here is owned by the same user id afterwards.
   * Saving at W4, in the same press that starts the drawing, means somebody
   * who abandons on the email or the code screen still has the person they
   * made waiting for them.
   *
   * Never blocks and never awaited by a navigation: the flow's promise is the
   * portrait, and the library row is bookkeeping. Losing it costs a re-make;
   * refusing to continue over it costs the whole onboarding.
   */
  const saveCharacter = useCallback(async (
    key: string,
    url: string | null,
    // Passed in rather than read from state, because the Redraw button edits
    // the sheet and fires in the same tick: a closure over `appearance` would
    // save the text that was just replaced.
    sheet: { name: string; appearance: string },
  ) => {
    // Pressing Save again after walking back must not write a second row.
    // `saveCharacterToLibrary` already upserts on the name, but a duplicate
    // request is a duplicate round trip either way.
    if (savedFor.current === key) return;
    savedFor.current = key;
    try {
      const saved = await saveCharacterToLibrary({
        name: sheet.name,
        appearance: sheet.appearance,
        // A `draft-character://` stand-in is not an image and must not be
        // written as one. Absent is honest; a stored scheme nothing can load
        // would be a permanently broken thumbnail in the library.
        portraitUrl: isRenderablePortrait(url) ? url : undefined,
      });
      if (!alive.current) return;
      setSavedCharacterId(saved.id);
    } catch (error) {
      // Let the next attempt try again rather than remembering a save that
      // never landed.
      savedFor.current = null;
      console.warn("Could not save the onboarding character", error);
    }
  }, []);

  const fingerprint = useMemo(
    () => sheetFingerprint(name, appearance),
    [appearance, name],
  );
  const sheetReady = Boolean(name.trim() && appearance.trim());

  /**
   * Fire a portrait for `fp` and put W6 into its loading state until it lands.
   *
   * Every path that draws a face goes through here: W5's save, a reimagine and
   * a retry after a failure. They differ only in what they do to the reimagine
   * budget, which is the caller's business, not this function's.
   */
  const redraw = useCallback((
    fp: string,
    request: { name: string; appearance: string },
  ) => {
    const key = `${fp}#${++attempt.current}`;
    wantedKey.current = key;
    setPortraitKey(fp);
    setPortraitUrl(null);
    setPortraitFailure(null);
    setDrawing(true);

    void (async () => {
      const outcome = await startPortrait(key, request);
      // Two separate reasons to drop an answer. `alive` is the unmounted
      // screen: writing state there is a leak and a warning. `wantedKey` is
      // the superseded request: somebody pressed Reimagine while this one was
      // still running, and letting it land would replace the face they are
      // waiting for with the one they just rejected.
      if (!alive.current || wantedKey.current !== key) return;
      if (outcome.failed) {
        setPortraitFailure({
          retryable: outcome.retryable,
          message: outcome.message,
        });
      } else {
        setPortraitUrl(outcome.url);
        // The row saved at W4 has no face yet. Attach it now, under its own
        // key so the guard lets this second write through.
        void saveCharacter(`${fp}|${outcome.url ?? ""}`, outcome.url, request);
      }
      setDrawing(false);
    })();
  }, [saveCharacter, startPortrait]);

  /**
   * W5's one press: validate the address and send the code. Nothing else.
   *
   * It used to save and draw here too. The draw moved back a screen to W4 (see
   * `submitSheet`) because the wait is the whole problem this flow has: firing
   * at W5 bought the typing of six digits, firing at W4 buys the email screen
   * as well, and the two together are most of a ten second portrait. What is
   * left here is the thing that can genuinely fail and be fixed in place: a
   * send that does not go through leaves the person on W5 with a complaint next
   * to the field that caused it.
   */
  const submitSave = useCallback(async () => {
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setEmailError("That address does not look right. Check it and retry.");
      return;
    }
    setSending(true);
    setEmailError(null);
    try {
      await sendEmailCode(address);
    } catch {
      if (alive.current) {
        setEmailError(
          "We could not send that code. Check the address and retry.",
        );
        setSending(false);
      }
      return;
    }
    if (!alive.current) return;
    setSending(false);
    go("code");
  }, [email, go]);

  /**
   * W4's CTA: save the person, start the drawing, and walk on.
   *
   * THIS IS WHERE THE PORTRAIT IS FIRED, on the anonymous session, alongside
   * the library row. Everything after it -- the email box, the six digits, the
   * round trip to an inbox -- is wait that the drawing now happens underneath,
   * so the Meet screen usually opens on a finished face rather than on a scan
   * animation.
   *
   * Pressed a second time it must WALK FORWARD ONLY. W4 is reachable by Back
   * from W5 and from the Meet screen, and a sheet that has not been edited has
   * already been drawn and already been saved: redrawing it would spend a
   * second request on a navigation. A changed sheet is a different sheet, so it
   * gets its own draw; before the code that is still part of the first
   * portrait and costs nothing, and after it, it is a reimagine by another name
   * and is budgeted like one.
   */
  const submitSheet = useCallback(() => {
    if (!sheetReady) return;
    const next: Step = emailVerified ? "w6" : "w5";
    // `portraitKey` is the sheet the current request was fired for, set
    // synchronously by `redraw`, so this is true for a second press in the same
    // second as well as for a walk back from the Meet screen.
    if (portraitKey === fingerprint) {
      go(next);
      return;
    }
    if (emailVerified) {
      if (reimaginesUsed >= REIMAGINE_BUDGET) {
        go("paywall");
        return;
      }
      setReimaginesUsed((used) => used + 1);
    }
    const sheet = { name: name.trim(), appearance: appearance.trim() };
    void saveCharacter(fingerprint, null, sheet);
    redraw(fingerprint, sheet);
    go(next);
  }, [
    appearance,
    emailVerified,
    fingerprint,
    go,
    name,
    portraitKey,
    redraw,
    reimaginesUsed,
    saveCharacter,
    sheetReady,
  ]);

  /**
   * Redraw, from the inline editor on the Meet screen.
   *
   * The edited values arrive as arguments and are written to state on the way
   * past, rather than the editor writing state and this reading it back: both
   * happen in one press, and a `redraw` that read `appearance` from the render
   * it was defined in would draw the text the person just replaced.
   */
  const redrawEdited = useCallback(
    (nextAppearance: string) => {
      // Guarded here as well as at the pill, because this is the call that
      // spends: a control that became pressable through a re-render must not be
      // able to draw a second free portrait.
      if (reimaginesUsed >= REIMAGINE_BUDGET) {
        go("paywall");
        return;
      }
      const trimmed = nextAppearance.trim();
      if (!trimmed) return;
      setAppearance(nextAppearance);
      setReimaginesUsed((used) => used + 1);
      const fp = sheetFingerprint(name, nextAppearance);
      redraw(fp, { name: name.trim(), appearance: trimmed });
    },
    [go, name, redraw, reimaginesUsed],
  );

  // A failure did not produce a face, so it cannot have spent the chance to
  // reject one. Try again leaves the budget exactly where it was.
  const retryPortrait = useCallback(() => {
    redraw(fingerprint, { name: name.trim(), appearance: appearance.trim() });
  }, [appearance, fingerprint, name, redraw]);

  /**
   * The paywall closing, either way it closes, is the notification ask.
   *
   * `enableNotifications` raises the OS dialog, and iOS grants exactly one of
   * those per install: this is the moment worth spending it on, because there
   * is now a finished portrait and a first story about to be written, which is
   * a concrete thing to be told about. It is guarded rather than awaited
   * optimistically -- a permissions module that throws must not strand somebody
   * on a paywall they have already dismissed.
   */
  const leavePaywall = useCallback(async () => {
    let granted = false;
    try {
      granted = await enableNotifications();
    } catch {
      granted = false;
    }
    if (!alive.current) return;
    setNotificationsEnabled(granted);
    go("welcome");
  }, [go]);

  /* ── Exit ───────────────────────────────────────────────────────────── */

  const finish = useCallback(() => {
    alive.current = false;
    onDone({
      purpose,
      character: {
        name: name.trim(),
        appearance: appearance.trim(),
        portraitUrl,
        savedCharacterId,
      },
      primaryGenre: initialGenre ?? DEFAULT_GENRE,
      email: email.trim(),
      subscribed,
      notificationsEnabled,
    });
  }, [
    appearance,
    email,
    initialGenre,
    name,
    notificationsEnabled,
    onDone,
    portraitUrl,
    purpose,
    savedCharacterId,
    subscribed,
  ]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  const displayName = name.trim();
  const readerName = (entryContext?.name ?? "").trim();

  if (step === "paywall") {
    return (
      <OnboardingPaywall
        purpose={purpose}
        characterName={displayName}
        portraitUrl={isRenderablePortrait(portraitUrl) ? portraitUrl : null}
        onSubscribed={() => {
          setSubscribed(true);
          void leavePaywall();
        }}
        onDismiss={() => {
          void leavePaywall();
        }}
      />
    );
  }

  if (step === "welcome") {
    return <WelcomeScreen onOpen={finish} />;
  }

  return (
    <ReduceMotionContext.Provider value={reduceMotion}>
      {step === "w3"
        ? (
          <Frame onBack={onExit} currentStep={W3_STEP} glow centred>
            {/* Two spacers of equal weight, and the stage, the copy and the
                button between them as ONE object. The copy stays left aligned
                in the gutter as designed; only the stage is centred. */}
            <View style={styles.centredSpacer} />
            <View style={styles.w3Group}>
              <CharacterStage />
              <View style={[styles.headerGroup, styles.w3Copy]}>
                <Text style={styles.heading} accessibilityRole="header">
                  {reader
                    ? readerName
                      ? `${readerName}, what if you were in the story?`
                      : "What if you were in the story?"
                    : "Every story needs a lead."}
                </Text>
                <Text style={styles.sub}>
                  {reader
                    ? "Katha can write you into anything on your shelf. Describe yourself once, and every story gets a lead you recognize."
                    : "Describe them in a line. Katha draws them and builds the story around them."}
                </Text>
              </View>
              <View style={styles.w3Cta}>
                <Cta
                  label={reader ? "Put me in the story" : "Create my character"}
                  onPress={() => go("w4")}
                />
              </View>
            </View>
            <View style={styles.centredSpacer} />
          </Frame>
        )
        : step === "w4"
        ? (
          <Frame
            onBack={() => go("w3")}
            currentStep={W4_STEP}
            cta={
              <Cta
                label={reader
                  ? "Show me"
                  : displayName
                  ? `Bring ${displayName} to life`
                  : "Bring them to life"}
                disabled={!sheetReady}
                onPress={submitSheet}
              />
            }
          >
            <View style={styles.headerGroup}>
              <Text style={styles.heading} accessibilityRole="header">
                {reader ? "Craft your character" : "Craft your lead"}
              </Text>
              <Text style={styles.sub}>
                {reader
                  ? "This is you in the story. One line is enough."
                  : "Two details. Katha fills in the rest."}
              </Text>
            </View>

            <Field
              label="NAME"
              value={name}
              onChangeText={setName}
              placeholder="Aarav"
              maxLength={NAME_MAX}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Name"
            />

            <Field
              label="APPEARANCE"
              trailing={`${appearance.length} / ${APPEARANCE_MAX}`}
              value={appearance}
              onChangeText={setAppearance}
              placeholder="A tall, broad-shouldered man in his thirties. Denim shirt, sleeves rolled, tired eyes that miss nothing."
              maxLength={APPEARANCE_MAX}
              multiline
              accessibilityLabel="Appearance"
            />

            {/* What the two boxes above are actually FOR. The sheet asks for a
                look and gives back a face, and without this the connection
                between "denim shirt" and the thing that follows them into every
                chapter is left for the person to guess at. */}
            <InfoCard
              title="KATHA WILL DRAW"
              rows={[
                {
                  glyph: GlyphFaceAndBuild,
                  title: "Face and build",
                  body: "The portrait, from your first line",
                },
                {
                  glyph: GlyphClothingAndCarry,
                  title: "Clothes and props",
                  body: "What they carry into every chapter",
                },
                {
                  glyph: GlyphTheName,
                  title: "The name",
                  body: "How every story speaks to them",
                },
              ]}
            />
          </Frame>
        )
        : step === "w5"
        ? (
          <Frame
            onBack={() => go("w4")}
            currentStep={W5_STEP}
            cta={
              <>
                <Cta
                  label={reader
                    ? "Save and draw me"
                    : `Save and draw ${displayName}`}
                  busy={sending}
                  onPress={() => {
                    void submitSave();
                  }}
                />
                <Text style={styles.legal}>
                  By continuing you agree to our Terms and Privacy Policy.
                </Text>
              </>
            }
          >
            <SaveStage name={displayName} />
            <View style={styles.headerGroup}>
              <Text style={styles.heading} accessibilityRole="header">
                {reader
                  ? "Where should we send you?"
                  : `Where should we send ${displayName}?`}
              </Text>
              <Text style={styles.sub}>
                {`Your portrait is being drawn now. Save it to your account so ${
                  displayName || "they"
                } follows you into every story, on every device.`}
              </Text>
            </View>

            <Field
              label="EMAIL"
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                if (emailError) setEmailError(null);
              }}
              placeholder="priya@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              accessibilityLabel="Email address"
            />
            {/* The send failed, so the flow has not moved: the complaint
                belongs beside the field that caused it, not on the code
                screen, which is not a screen this person reached. */}
            {emailError ? <Text style={styles.error}>{emailError}</Text> : null}
          </Frame>
        )
        : step === "code"
        ? (
          // Code-only: W5 already collected the address and already called
          // `sendEmailCode`. Back is back to W5, not to an email box this
          // component would otherwise own.
          <EmailCodeAuth
            initialStep="code"
            email={email.trim()}
            headline="Check your inbox"
            sub={`Enter the 6-digit code we sent to ${email.trim()}.`}
            onBack={() => go("w5")}
            onVerified={() => {
              setEmailVerified(true);
              go("w6");
            }}
            steps={ONBOARDING_STEPS}
            currentStep={CODE_STEP}
            codeStep={CODE_STEP}
          />
        )
        : (
          <MeetScreen
            name={displayName}
            appearance={appearance.trim()}
            reader={reader}
            portraitUrl={portraitUrl}
            drawing={drawing}
            failure={portraitFailure}
            canReimagine={reimaginesUsed < REIMAGINE_BUDGET}
            onBack={() => go("w4")}
            onRedraw={redrawEdited}
            onPaywall={() => go("paywall")}
            onRetry={retryPortrait}
            onKeep={() => go("paywall")}
          />
        )}
    </ReduceMotionContext.Provider>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────── */

/**
 * Every W screen: the cream ground, the top bar, a scrolling body and a CTA
 * pinned to the bottom.
 *
 * The CTA is OUTSIDE the scroll view rather than the last child of it. These
 * screens are short enough not to scroll on a 390pt phone and long enough to
 * scroll on a 360 with the keyboard up, and a primary action that is sometimes
 * below the fold is an action people do not find.
 *
 * `centred` is the one exception, and it is W3's. That screen has no fields, so
 * it cannot grow under a keyboard and it never scrolls: docking its button at
 * the bottom left a band of dead cream between the copy and the CTA, and the
 * three things on the screen read as three unrelated bands rather than as one
 * object. With `centred` the caller supplies its own button inside `children`
 * and the whole group floats in the middle between two equal flex spacers.
 */
function Frame({
  children,
  cta,
  onBack,
  currentStep,
  glow,
  centred,
}: {
  children: React.ReactNode;
  cta?: React.ReactNode;
  onBack?: () => void;
  currentStep: number;
  glow?: boolean;
  centred?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {glow ? <AccentGlow /> : null}
      <OnboardingTopBar
        onBack={onBack}
        steps={ONBOARDING_STEPS}
        currentStep={currentStep}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            // `flexGrow` is what makes the spacers mean anything: a content
            // container sized to its children gives two `flex: 1` views zero
            // height each, and the group would sit at the top exactly as before.
            centred && [styles.scrollCentred, { paddingBottom: insets.bottom }],
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // W3 fits its viewport by construction (one centred group between
          // two spacers), so it must not scroll: a scrollbar on a screen with
          // nothing below the fold reads as missing content.
          scrollEnabled={!centred}
          bounces={!centred}
        >
          {children}
        </ScrollView>
        {cta
          ? (
            <View
              style={[
                styles.ctaDock,
                { paddingBottom: CTA_BOTTOM + insets.bottom },
              ]}
            >
              {cta}
            </View>
          )
          : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The warm bloom behind W3 and W6.
 *
 * The hand-off asks for a radial gradient and React Native has none, so this
 * is a vertical `accentSoft` fade clipped inside a circle: the falloff is real
 * top to bottom and approximated left to right by the circle's own edge. On a
 * #FAF7F2 ground the difference between the two is about four points of
 * luminance, which is below the threshold at which an edge is visible.
 */
function AccentGlow() {
  const { width } = useWindowDimensions();
  const size = width * 1.6;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.glow,
        { width: size, height: size, borderRadius: size / 2, left: (width - size) / 2 },
      ]}
    >
      <LinearGradient
        colors={[colors.accentSoft, `${colors.accentSoft}00`]}
        locations={[0, 0.7]}
        style={styles.flex}
      />
    </View>
  );
}

function Cta({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      style={({ pressed }) => [
        styles.cta,
        pressed && styles.ctaPressed,
        (disabled || busy) && styles.ctaDisabled,
      ]}
    >
      <Text style={styles.ctaText}>{label}</Text>
    </Pressable>
  );
}

/** One row of an `InfoCard`: a glyph on its own tile, a title and a line. */
type InfoRow = { glyph: GlyphComponent; title: string; body: string };

/**
 * The tile grounds, in the order the rows use them.
 *
 * Three rows in one accent tint read as three instances of one thing; three
 * grounds read as three things that belong to one card. They are existing
 * theme colours rather than new ones, and the cycle is indexed so a fourth row
 * would land back on the first rather than crash.
 */
const GLYPH_TINTS = [
  colors.accentSoft,
  colors.sepia,
  colors.onboardingPlate,
];

/**
 * The informational block both W4 and W6 draw: a titled card of glyph rows.
 *
 * One component for two screens because they are the same object saying two
 * halves of one thing -- what the sheet is for, then what the face is for -- and
 * two hand-built cards would have drifted apart by the second design pass. The
 * eyebrow above the card is optional; the Meet screen's benefits card has none.
 */
function InfoCard({ title, rows }: { title?: string; rows: InfoRow[] }) {
  return (
    <View style={styles.infoGroup}>
      {title ? <Text style={styles.eyebrow}>{title}</Text> : null}
      <View style={styles.infoCard}>
        {rows.map((row, index) => (
          <View
            key={row.title}
            style={[styles.infoRow, index > 0 && styles.infoRowDivided]}
          >
            <GlyphTile
              glyph={row.glyph}
              tint={GLYPH_TINTS[index % GLYPH_TINTS.length]}
            />
            <View style={styles.infoText}>
              <Text style={styles.infoTitle}>{row.title}</Text>
              <Text style={styles.infoBody}>{row.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A block that opens and closes in place.
 *
 * Height is animated against a MEASURED child rather than a guessed constant,
 * because the thing inside is a multiline field whose height depends on the
 * platform's own text metrics: a hard-coded height clips the Redraw button on
 * one phone and leaves a gap under it on another. The child is absolutely
 * positioned so it lays itself out (and reports a height) even while the shell
 * around it is zero tall.
 *
 * Reduced motion lands on the final value with no timing: somebody who asked
 * the OS for stillness gets the block, immediately, not a slower version of it.
 */
function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const reduceMotion = useContextReduceMotion();
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(open && reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = withTiming(open ? 1 : 0, { duration: motion.base });
  }, [open, progress, reduceMotion]);

  const shellStyle = useAnimatedStyle(() => ({
    height: height * progress.value,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[styles.collapsible, shellStyle]}
      // The children stay MOUNTED when closed, because that is the only way the
      // inner view can report the height this animates to. Mounted is not the
      // same as reachable: a zero-height block is invisible to the eye but its
      // field and its button are still in the accessibility tree and still
      // focusable, so a VoiceOver user would swipe into a Redraw nobody can
      // see. These three turn the closed block off for touch and for AT.
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      <View
        style={styles.collapsibleInner}
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/* ── W3: the three cards ──────────────────────────────────────────────── */

/**
 * Three portraits, arriving in two movements: the lead alone for two seconds,
 * then the pair fanning out behind it.
 *
 * The hero HOLDS at 1.08 rather than settling back to 1. That is the whole
 * point of the two seconds: a card that grows and then relaxes reads as a
 * bounce, while one that grows and stops reads as somebody stepping forward.
 */
function CharacterStage() {
  const { width } = useWindowDimensions();
  const scale = Math.min(1, (width - spacing.onboardingGutter * 2) / STAGE_BASIS);
  const card = { width: 150 * scale, height: 210 * scale };

  const reduceMotion = useContextReduceMotion();
  const heroScale = useSharedValue(reduceMotion ? HERO_TO_SCALE : 0.72);
  const heroOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const side = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      heroScale.value = HERO_TO_SCALE;
      heroOpacity.value = 1;
      side.value = 1;
      return;
    }
    heroScale.value = withTiming(HERO_TO_SCALE, {
      duration: HERO_MS,
      easing: HERO_EASING,
    });
    heroOpacity.value = withTiming(1, {
      duration: HERO_MS,
      easing: HERO_EASING,
    });
    side.value = withDelay(
      SIDE_DELAY_MS,
      withTiming(1, { duration: SIDE_MS, easing: SIDE_EASING }),
    );
  }, [heroOpacity, heroScale, reduceMotion, side]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ scale: heroScale.value }],
  }));

  return (
    <View
      style={{ width: 300 * scale, height: 290 * scale, alignSelf: "center" }}
      accessible
      accessibilityLabel="Three character portraits"
    >
      <SideCard
        progress={side}
        dir={1}
        card={card}
        position={{ left: 0, top: 34 * scale }}
      />
      <SideCard
        progress={side}
        dir={-1}
        card={card}
        position={{ right: 0, top: 34 * scale }}
      />
      <Animated.View
        style={[
          styles.stageCard,
          styles.heroCard,
          card,
          { left: 75 * scale, top: 10 * scale },
          heroStyle,
        ]}
      >
        <Image
          source={portraitAarav}
          resizeMode="cover"
          style={styles.stageImage}
        />
      </Animated.View>
    </View>
  );
}

/**
 * One of the two cards behind the lead. `dir` is 1 for the left card.
 *
 * A component rather than a `sideStyle(dir)` helper: `useAnimatedStyle` is a
 * hook, and calling it twice from one function body is the rules-of-hooks
 * violation that only shows up when one of the two stops rendering.
 */
function SideCard({
  progress,
  dir,
  card,
  position,
}: {
  progress: { value: number };
  dir: 1 | -1;
  card: { width: number; height: number };
  position: StyleProp<ViewStyle>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [75 * dir, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [-24, 0]) },
      {
        rotate: `${interpolate(progress.value, [0, 1], [0, -8 * dir])}deg`,
      },
      { scale: interpolate(progress.value, [0, 1], [0.86, 1]) },
    ],
  }));

  return (
    <Animated.View
      style={[styles.stageCard, card, position, animatedStyle]}
    >
      <Image
        source={portraitPriya}
        resizeMode="cover"
        style={styles.stageImage}
      />
    </Animated.View>
  );
}

/* ── W5: the placeholder and its chip ─────────────────────────────────── */

/**
 * What the portrait is going to be, drawn as an empty frame.
 *
 * A dashed card and a ticket rather than a real face: W5 is the one screen
 * that asks for something before giving anything, and showing a finished
 * portrait here would be promising a face that has not been drawn yet.
 */
function SaveStage({ name }: { name: string }) {
  const { width } = useWindowDimensions();
  const scale = Math.min(1, (width - spacing.onboardingGutter * 2) / STAGE_BASIS);
  return (
    <View
      style={{ width: 220 * scale, height: 230 * scale, alignSelf: "center" }}
    >
      <View
        style={[
          styles.placeholderCard,
          {
            left: 35 * scale,
            top: 16 * scale,
            width: 150 * scale,
            height: 196 * scale,
          },
        ]}
      >
        <View style={styles.placeholderDisc}>
          <Text style={styles.placeholderEmoji}>🎨</Text>
        </View>
        <Text style={styles.eyebrow}>PORTRAIT</Text>
      </View>
      <View
        style={[styles.readyChip, { right: 6 * scale, top: 120 * scale }]}
      >
        <Text style={styles.chipEyebrow}>CHARACTER</Text>
        <Text style={styles.chipName}>{name}</Text>
        <View style={styles.chipStatus}>
          <View style={styles.chipDot} />
          <Text style={styles.chipStatusText}>Ready to draw</Text>
        </View>
      </View>
    </View>
  );
}

/* ── W6: the Meet screen ──────────────────────────────────────────────── */

function MeetScreen({
  name,
  appearance,
  reader,
  portraitUrl,
  drawing,
  failure,
  canReimagine,
  onBack,
  onRedraw,
  onPaywall,
  onRetry,
  onKeep,
}: {
  name: string;
  appearance: string;
  reader: boolean;
  portraitUrl: string | null;
  drawing: boolean;
  failure: PortraitFailure | null;
  /** False once the one free reimagine is spent. See `REIMAGINE_BUDGET`. */
  canReimagine: boolean;
  onBack: () => void;
  onRedraw: (appearance: string) => void;
  onPaywall: () => void;
  onRetry: () => void;
  onKeep: () => void;
}) {
  const ready = !drawing && !failure;

  /**
   * The inline editor, opened by the Reimagine pill.
   *
   * It replaced a row of three controls (Reimagine, a "1 free left" counter and
   * an "Edit details" link back to W4). All three were the same intention -- the
   * face is not right -- answered in three places, and the one that walked back
   * to W4 threw the person out of the screen they were reacting to. Now the
   * fix happens under the portrait, against the portrait.
   */
  const [editing, setEditing] = useState(false);
  const [draftAppearance, setDraftAppearance] = useState(appearance);

  const toggleEditor = () => {
    // At zero the pill is the plan's front door rather than a dead control, and
    // it never opens an editor whose only button cannot fire.
    if (!canReimagine) {
      onPaywall();
      return;
    }
    if (!editing) {
      // Seeded at open, not at mount: the sheet may have changed underneath
      // (a walk back to W4) since this screen first rendered.
      setDraftAppearance(appearance);
    }
    setEditing((open) => !open);
  };

  const submitRedraw = () => {
    setEditing(false);
    onRedraw(draftAppearance);
  };

  return (
    <Frame
      onBack={onBack}
      currentStep={W6_STEP}
      glow
      cta={ready
        ? (
          <Cta
            label={reader ? "Keep this me" : `Keep ${name}`}
            onPress={onKeep}
          />
        )
        : (
          <Cta
            label={`Drawing ${name}…`}
            disabled
            onPress={() => undefined}
          />
        )}
    >
      {ready
        ? (
          // A fade, not a swap: the loading card and this one are the same
          // object at two moments, and a hard cut would read as a second card
          // replacing the first.
          <Enter duration={MEET_CROSSFADE_MS} rise={0}>
            <View style={styles.meetHead}>
              <Text style={styles.eyebrowAccent}>
                {reader ? "THIS IS YOU" : "YOUR LEAD"}
              </Text>
              <Text style={styles.meetHeading} accessibilityRole="header">
                {reader ? `Hello, ${name}.` : `Meet ${name}.`}
              </Text>
            </View>
            <MeetCard>
              <PortraitFill name={name} url={portraitUrl} />
              <View style={styles.glassChip}>
                <Text style={styles.glassAppearance}>{appearance}</Text>
              </View>
            </MeetCard>

            <View style={styles.reimagineBlock}>
              <Pressable
                onPress={toggleEditor}
                accessibilityRole="button"
                accessibilityLabel="Reimagine"
                accessibilityState={{ expanded: editing }}
                style={styles.reimaginePill}
              >
                <Text style={styles.reimagineText}>🔄 Reimagine</Text>
              </Pressable>

              <Collapsible open={editing}>
                <Field
                  label="APPEARANCE"
                  value={draftAppearance}
                  onChangeText={setDraftAppearance}
                  maxLength={APPEARANCE_MAX}
                  multiline
                  accessibilityLabel="Appearance"
                />
                <Pressable
                  onPress={submitRedraw}
                  disabled={!draftAppearance.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Redraw"
                  accessibilityState={{
                    disabled: !draftAppearance.trim(),
                  }}
                  style={({ pressed }) => [
                    styles.cta,
                    pressed && styles.ctaPressed,
                    !draftAppearance.trim() && styles.ctaDisabled,
                  ]}
                >
                  <Text style={styles.ctaText}>Redraw</Text>
                </Pressable>
              </Collapsible>
            </View>

            <View style={styles.meetBenefits}>
              <InfoCard
                rows={[
                  reader
                    ? {
                      glyph: GlyphLeadsStories,
                      title: "You, in every story",
                      body: "Step into anything on your shelf",
                    }
                    : {
                      glyph: GlyphLeadsStories,
                      title: "Leads your stories",
                      body: "At the centre of what you write",
                    },
                  {
                    glyph: GlyphSameFace,
                    title: "Same face, every time",
                    body: "Consistent across every chapter and story",
                  },
                  {
                    glyph: GlyphSavedCast,
                    title: "Saved to your cast",
                    body: "Reuse them in any story, any time",
                  },
                ]}
              />
            </View>
          </Enter>
        )
        : (
          <>
            <View style={styles.meetHead}>
              <Text style={styles.eyebrowAccent}>DRAWING</Text>
              <Text style={styles.meetHeading} accessibilityRole="header">
                {`${name} is taking shape.`}
              </Text>
            </View>
            <MeetCard>
              {/* The previous face, if there was one, under the ground:
                  during a reimagine the card is not empty, it is the old
                  portrait being drawn over. `blurRadius` plus a 12% opacity
                  does the work; React Native has no grayscale filter, so the
                  opacity carries the desaturation as well as the recession. */}
              {isRenderablePortrait(portraitUrl)
                ? (
                  <Image
                    source={{ uri: portraitUrl }}
                    blurRadius={6}
                    resizeMode="cover"
                    style={styles.ghostPortrait}
                  />
                )
                : null}
              <LinearGradient
                colors={[colors.onboardingPlate, colors.onboardingStone]}
                style={styles.meetGround}
                pointerEvents="none"
              />
              {failure ? null : <ScanBand />}
              <View style={styles.glassChip}>
                {failure
                  ? (
                    <FailureChip
                      name={name}
                      failure={failure}
                      onRetry={onRetry}
                    />
                  )
                  : <StatusChip />}
              </View>
            </MeetCard>
            {failure
              ? null
              : (
                <Text style={styles.meetCaption}>
                  {PORTRAIT_WAIT_CAPTION}
                </Text>
              )}
          </>
        )}
    </Frame>
  );
}

/** The 270 x 338 frame both states are drawn inside. */
function MeetCard({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const scale = Math.min(1, (width - spacing.onboardingGutter * 2) / STAGE_BASIS);
  return (
    <View
      style={[styles.meetCard, { width: 270 * scale, height: 338 * scale }]}
    >
      {children}
    </View>
  );
}

function PortraitFill({ name, url }: { name: string; url: string | null }) {
  if (!isRenderablePortrait(url)) {
    return (
      <View
        style={styles.portraitPlaceholder}
        accessible
        accessibilityLabel={`${name || "This character"} has no portrait yet`}
      >
        <IconPerson size={28} color={colors.tertiary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      // Cover, not contain. A provider that returns a slightly different ratio
      // must fill the frame rather than letterbox inside it.
      resizeMode="cover"
      style={styles.portraitFill}
      accessible
      accessibilityLabel={`Portrait of ${name || "this character"}`}
    />
  );
}

/** The sweep. One band and one line, on the same 2.2s linear pass. */
function ScanBand() {
  const { width } = useWindowDimensions();
  const scale = Math.min(1, (width - spacing.onboardingGutter * 2) / STAGE_BASIS);
  const cardHeight = 338 * scale;
  const reduceMotion = useContextReduceMotion();
  const scan = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      // Parked a third of the way down rather than hidden: the band is what
      // says the card is working, and a card with nothing on it at all reads
      // as a failed image load.
      scan.value = 0.33;
      return;
    }
    scan.value = 0;
    scan.value = withRepeat(
      withTiming(1, { duration: SCAN_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [reduceMotion, scan]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scan.value, [0, 1], [-4, cardHeight]) },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.scanShell, { height: 120 * scale }, sweepStyle]}
    >
      <LinearGradient
        colors={[
          `${colors.accent}00`,
          `${colors.accent}47`,
          `${colors.accent}E6`,
        ]}
        locations={[0, 0.7, 1]}
        style={styles.flex}
      />
      <View style={styles.scanLine} />
    </Animated.View>
  );
}

/** Three dots and a line of what the drawing is doing right now. */
function StatusChip() {
  const reduceMotion = useContextReduceMotion();
  const [index, setIndex] = useState(0);
  const pulse = useSharedValue(reduceMotion ? 1 : 0.55);

  // The text rotates even under reduced motion: it is information, not
  // decoration, and it is the only thing on the card that says the wait is
  // progressing rather than stuck.
  useEffect(() => {
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % STATUS_LINES.length),
      STATUS_MS,
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS / 2 }),
        withTiming(0.55, { duration: PULSE_MS / 2 }),
      ),
      -1,
      false,
    );
  }, [pulse, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.statusRow}>
      <View style={styles.dotRow}>
        <StatusDot delay={0} />
        <StatusDot delay={200} />
        <StatusDot delay={400} />
      </View>
      <Animated.Text
        style={[styles.statusText, pulseStyle]}
        accessibilityLiveRegion="polite"
      >
        {STATUS_LINES[index]}
      </Animated.Text>
    </View>
  );
}

function StatusDot({ delay }: { delay: number }) {
  const reduceMotion = useContextReduceMotion();
  const beat = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      beat.value = 1;
      return;
    }
    beat.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_MS * 0.4 }),
          withTiming(0, { duration: DOT_MS * 0.6 }),
        ),
        -1,
        false,
      ),
    );
  }, [beat, delay, reduceMotion]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(beat.value, [0, 1], [0.4, 1]),
    transform: [{ scale: interpolate(beat.value, [0, 1], [0.6, 1]) }],
  }));

  return <Animated.View style={[styles.dot, dotStyle]} />;
}

/**
 * The card's chip when there is no face and there is not going to be one yet.
 *
 * A refusal (the hourly cap, or the guest portrait cap) carries the server's
 * own sentence and NO retry: both windows outlast the patience of anybody who
 * would press it, so a Try again there is a control guaranteed to fail, which
 * teaches people the app is broken rather than that they are early.
 */
function FailureChip({
  name,
  failure,
  onRetry,
}: {
  name: string;
  failure: PortraitFailure;
  onRetry: () => void;
}) {
  const retryable = failure.retryable || !failure.message;
  return (
    <View style={styles.failureChip}>
      <Text style={styles.statusText}>
        {retryable ? `We couldn't draw ${name}. Try again.` : failure.message}
      </Text>
      {retryable
        ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        )
        : null}
    </View>
  );
}

/**
 * The flow's reduced-motion answer, read from the context the screen provides.
 *
 * A named wrapper rather than `useContext(ReduceMotionContext)` at nine call
 * sites: every animated piece in this file has to ask the same question, and
 * the one that forgets is the one that animates for somebody who asked the OS
 * for stillness.
 */
function useContextReduceMotion(): boolean {
  return useContext(ReduceMotionContext);
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.onboardingBg },
  flex: { flex: 1 },
  glow: { position: "absolute", top: "-14%", overflow: "hidden" },
  scroll: {
    paddingHorizontal: spacing.onboardingGutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.betweenGroups,
  },
  /**
   * W3's body. `gap` is zeroed because the centred group sets its own two
   * distances (xxl, then xl) and a container gap would add a third between the
   * spacers and the group, which is free space the spacers cannot then balance.
   */
  scrollCentred: { flexGrow: 1, gap: 0, paddingTop: 0 },
  centredSpacer: { flex: 1 },
  w3Group: { alignSelf: "stretch" },
  w3Copy: { marginTop: spacing.xxl },
  w3Cta: { marginTop: spacing.xl },
  ctaDock: {
    paddingHorizontal: spacing.onboardingGutter,
    paddingTop: spacing.sm,
  },
  headerGroup: { gap: spacing.md },
  heading: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "700",
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.ui,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
  /** 11/800 at 0.14em, the hand-off's eyebrow. Uppercase strings only. */
  eyebrow: {
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.54,
    color: colors.tertiary,
  },
  eyebrowAccent: {
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.76,
    color: colors.accent,
  },
  counter: {
    fontFamily: fonts.ui,
    fontSize: 11.5,
    color: colors.tertiary,
  },
  /* The field itself is `@/components/onboarding/Field`: one recipe, in the UI
     face, shared with the name and email screens. This file used to set its own
     inputs in the reader serif, which made the Craft sheet look like a
     different product from the two screens either side of it. */

  /* The informational cards on W4 and W6 */
  infoGroup: { gap: spacing.sm },
  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.onboardingBorder,
    borderRadius: radius.onboardingCard,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  infoRowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.onboardingPlate,
  },
  infoText: { flex: 1, gap: spacing.tight },
  infoTitle: { ...onboardingType.body, fontWeight: "700", color: colors.ink },
  infoBody: { ...onboardingType.helper, color: colors.muted },
  /* The shell is clipped and the child floats, so the child can report a real
     height while the shell is still zero tall. See `Collapsible`. */
  collapsible: { overflow: "hidden", width: "100%" },
  collapsibleInner: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  legal: {
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18,
    color: colors.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  error: { ...type.subhead, color: colors.accentPressed },
  cta: {
    height: controls.onboardingCtaHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.onboardingCta,
  },
  ctaPressed: { backgroundColor: colors.accentPressed },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    fontFamily: fonts.ui,
    fontSize: 17,
    fontWeight: "700",
    color: colors.surface,
  },

  /* W3 */
  stageCard: {
    position: "absolute",
    borderRadius: radius.onboardingCard,
    backgroundColor: colors.onboardingStone,
    overflow: "hidden",
    boxShadow: shadows.onboardingCard,
  },
  heroCard: {
    zIndex: 2,
    borderWidth: 3,
    borderColor: colors.onboardingBg,
    boxShadow: shadows.onboardingHeroCard,
  },
  stageImage: { width: "100%", height: "100%" },

  /* W5 */
  placeholderCard: {
    position: "absolute",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.onboardingBorderStrong,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    transform: [{ rotate: "-5deg" }],
  },
  placeholderDisc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderEmoji: { fontSize: 24 },
  readyChip: {
    position: "absolute",
    minWidth: 150,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.onboardingBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    boxShadow: shadows.onboardingChip,
    transform: [{ rotate: "3deg" }],
  },
  chipEyebrow: {
    fontFamily: fonts.ui,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: colors.accent,
  },
  chipName: {
    fontFamily: fonts.display,
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
    marginTop: spacing.tight + 1,
  },
  chipStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  chipStatusText: {
    fontFamily: fonts.ui,
    fontSize: 10.5,
    color: colors.muted,
  },

  /* W6 */
  meetHead: { alignItems: "center", gap: 6 },
  meetHeading: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 37,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  meetCard: {
    alignSelf: "center",
    // `Enter` and the loading fragment are bare wrappers with no gap of their
    // own, so the card carries the gap under the heading in both states rather
    // than each branch spelling it out and one of them forgetting.
    marginTop: spacing.betweenGroups,
    // 26: the Meet card's own radius from the hand-off; no token sits at 26.
    borderRadius: 26,
    borderWidth: 4,
    borderColor: colors.surface,
    backgroundColor: colors.onboardingStone,
    overflow: "hidden",
    boxShadow: shadows.onboardingPortrait,
  },
  meetGround: { ...StyleSheet.absoluteFillObject, opacity: 0.88, zIndex: -1 },
  ghostPortrait: { ...StyleSheet.absoluteFillObject, opacity: 0.12 },
  portraitFill: { ...StyleSheet.absoluteFillObject },
  portraitPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scanShell: { position: "absolute", left: 0, right: 0, top: 0 },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.accent,
    boxShadow: SCAN_GLOW,
  },
  glassChip: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: GLASS,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotRow: { flexDirection: "row", gap: 4 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  statusText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.accentSoft,
  },
  failureChip: { gap: spacing.sm },
  retryButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  retryText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.accent,
  },
  glassAppearance: {
    fontFamily: fonts.readerItalic,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.accentSoft,
  },
  meetCaption: {
    marginTop: spacing.md,
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
  /**
   * `spacing.xl` off the portrait, and the only gap on this screen that is not
   * `betweenGroups`: the pill is a reaction to the face directly above it, and
   * a full group gap would read as the start of a new section.
   */
  reimagineBlock: { marginTop: spacing.xl },
  meetBenefits: { marginTop: spacing.betweenGroups },
  reimaginePill: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  reimagineText: {
    fontFamily: fonts.ui,
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
});
