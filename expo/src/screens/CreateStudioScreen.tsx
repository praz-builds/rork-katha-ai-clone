import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
} from "lucide-react-native";
import CreateBriefFlow from "@/components/create/CreateBriefFlow";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import StreamingProse from "@/components/create/StreamingProse";
import PublicEntityWarningModal from "@/components/create/PublicEntityWarningModal";
import StoryGatedPrivateModal from "@/components/create/StoryGatedPrivateModal";
import { pendingGatingReason } from "@/lib/entity-gate";
import {
  continueStoryStreaming,
  type CoverState,
  createGenerationRequestId,
  editParagraphStreaming,
  fetchCoverState,
  generateStoryStreaming,
  GenerationRequestError,
  publishStory,
  regenerateCover,
  StoryGatedPrivateError,
  type StoryGatingReason,
} from "@/lib/api";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage";
import { normalizeText, paginateChapter } from "@/lib/paginate";
import {
  CHAPTER_TEXT_CREDITS,
  COVER_POLL_INTERVAL_MS,
  COVER_POLL_MAX_ATTEMPTS,
  MAX_CAST_SIZE,
  MAX_COVER_NOTE_CHARS,
  MAX_NEXT_INSTRUCTION_CHARS,
  WRITE_THE_REST_MIN_CHAPTERS,
} from "@/lib/pricing-limits";
import {
  colors,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  spacing,
} from "@/theme";
import type { AudienceMode, CreateDraft, Genre, IdentityLens, SpiceLevel, Story } from "@/types/domain";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * The steps the studio actually has.
 *
 * There used to be a `cover` step between the editor and review, and every
 * thing on it was untrue: it drew a gradient concept card and called it a
 * preview of a cover that had in fact already been generated, it said the cover
 * "will be created when you publish" when `generate-story` schedules it the
 * moment chapter 1 persists, and its Regenerate button was permanently
 * disabled next to a prompt box whose contents were never sent anywhere.
 *
 * §10.4 settles where the cover belongs: chapter 1's art *is* the cover, so it
 * is revealed in the editor as soon as it lands and confirmed at review, which
 * is the step that was always going to show it. A step of its own was a step
 * about a thing that had already happened.
 */
type StudioStep = "setup" | "generating" | "editor" | "review" | "publishing";

type DraftCharacter = {
  name: string;
  description: string;
  isHero: boolean;
  /** Voice, motivation, relationships. Drives the prose, never the portrait. */
  background?: string;
  /** Face, build, clothing. Drives the portrait, and detail in the prose. */
  appearance?: string;
  portraitUrl?: string;
  portraitStatus?: "idle" | "generating" | "ready" | "failed";
  /** Set when the row came from the saved library. See `CreateDraft`. */
  savedCharacterId?: string;
};

type StudioDraft = {
  primaryGenre: Genre;
  genres?: Genre[];
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  seed: string;
  language: CreateDraft["language"];
  /** Private by default. This is publish intent, never a generation input. */
  visibility: NonNullable<CreateDraft["visibility"]>;
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
  storyValues?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: "short" | "standard" | "long";
  plannedChapterCount?: 3 | 7 | 15;
  illustrateChapters?: boolean;
  /**
   * Grounding resolved during onboarding, carried through to generation.
   *
   * Shaping resolves these for free while the writer edits chips, so a draft
   * that arrives from onboarding already has them. They were reaching this
   * screen and then being dropped when `createDraft` was rebuilt, which meant
   * the paid generation either re-derived them or, past its tighter fallback
   * deadline, lost them entirely -- silently, because `api.ts` forwards these
   * only when present.
   */
  grounding?: unknown[];
  groundingEntities?: unknown[];
  /**
   * The server's own visibility verdict, once `shape-story` returns one.
   * Optional and untyped here because `api.ts` (owned by the backend branch)
   * has yet to carry it; `pendingGatingReason` prefers it when present and
   * falls back to reading `groundingEntities` the way the server does.
   */
  gatingReason?: unknown;
};

/**
 * What one trip through the continuation path did.
 *
 * The single-chapter Continue button used to be the only caller, so it could
 * raise its own alerts inline and return nothing. "Write the rest" drives the
 * same function in a loop and has to *decide* what to do next, which a void
 * function cannot tell it: a guard that refused before spending anything ends
 * a run quietly, a failure ends it loudly, and a written chapter is the base
 * story for the next iteration. Hence a returned value rather than a thrown
 * error — a throw would collapse those three into one shape and the loop would
 * have to re-derive the difference from a message string.
 */
type ContinueOutcome =
  /** A chapter was written, persisted and charged. `story` includes it. */
  | { status: "written"; story: Story }
  /** A guard refused. Nothing was requested, nothing was spent. */
  | { status: "blocked"; title: string; message: string }
  /**
   * The request failed. The credit is refunded server-side by the existing
   * single-chapter path. `keptPartial` says whether prose had already reached
   * the reader, because that decides which screen they are looking at.
   */
  | { status: "failed"; message: string; keptPartial: boolean };

/**
 * A "Write the rest" run in flight, as the UI needs to see it.
 *
 * Nothing about a run outlives the mount that started it. `written` and
 * `stopping` are only meaningful inside the process that owns the loop, and
 * there is deliberately no persisted counterpart — see the note on the unmount
 * teardown for why resume is not implemented.
 */
type ActiveRun = {
  /** Chapter count the run is driving toward. */
  target: number;
  /** Chapters this run has written so far. */
  written: number;
  /** Stop has been pressed; the in-flight chapter is being allowed to finish. */
  stopping: boolean;
};

type ParagraphState = {
  text: string;
  isEditing: boolean;
  isProcessing: boolean;
  previousText?: string;
};

type CreateStudioProps = {
  credits: number;
  isAnonymous?: boolean;
  onCreditUsed: (amount: number) => void;
  onPublished: (story: Story) => void;
  onBack: () => void;
  /**
   * The blueprint a user built during onboarding.
   *
   * It arrives as a draft rather than as a story, and the user still presses
   * Create themselves. Generating on arrival would spend their whole welcome
   * grant on a story they have not asked for a second time and may never open.
   */
  initialDraft?: Partial<StudioDraft>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARACTERS = MAX_CAST_SIZE;

const INITIAL_DRAFT: StudioDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
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
  isSeries: true,
  chapterLength: "standard",
  plannedChapterCount: 3,
  illustrateChapters: false,
  visibility: "private",
};

// ---------------------------------------------------------------------------
// When the reader is shown the chapter
// ---------------------------------------------------------------------------

/**
 * Streaming is the transport. It is no longer the presentation.
 *
 * What shipped before: the moment the first token landed, `StreamingProse`
 * replaced the loader and the reader watched their chapter assemble itself
 * word by word, mid-sentence, for the whole generation. That is a real
 * property of the transport being shown as if it were a feature, and product
 * ruled against it: a reader should be handed a finished page, not watched
 * over the model's shoulder while it types.
 *
 * What replaced it is *not* buffering. The stream still runs, the chunks still
 * arrive as fast as they ever did, and nothing waits for the response to
 * close. What changed is the gate on the door: prose is shown only once enough
 * of it has *settled* to be read as finished pages, and only ever in whole
 * pages.
 *
 * Two rules make "finished" mean something:
 *
 * 1. **Only whole paragraphs are settled.** The tail of the stream is always a
 *    half-written sentence, so everything after the last blank line is held
 *    back. This alone kills the letter-by-letter effect: a paragraph appears
 *    complete or not at all.
 * 2. **Only whole pages are shown.** The last page of the settled text is the
 *    one still filling up, so it is dropped too, and the cut is then pulled
 *    back to the nearest paragraph boundary — pages break on sentences, so a
 *    page boundary lands mid-paragraph most of the time, and handing that over
 *    verbatim would put a paragraph cut off in the middle on screen, which is
 *    the exact thing rule 1 exists to prevent. So: the *threshold* is measured
 *    in finished pages, and the *content* handed over is the whole paragraphs
 *    inside them. A page the reader is looking at can therefore never grow
 *    underneath them — the pages behind it can, which is the point.
 *
 * Both are prefix-stable, which is the property the whole thing rests on:
 * `paginateChapter` walks forward greedily from character zero, so once page
 * *k* has a boundary, more text arriving after it cannot move that boundary.
 * Page 1 is finished and fixed at the instant it is revealed and stays that
 * way for the rest of the generation.
 */

/**
 * A nominal phone page, deliberately not the real device viewport.
 *
 * The threshold is a claim about the chapter ("five of its ten pages exist"),
 * not about the handset, and measuring the real window would make the same
 * chapter reveal at a different point on a tablet than on a phone — and, worse,
 * reveal at a different point depending on whether the keyboard happened to be
 * up. 390x640 is the reference geometry this app is designed against
 * (`expo/CLAUDE.md`: 390x844) minus the chrome above and below the prose.
 *
 * The typography is `StreamingProse`'s own, so a "page" here is the same
 * quantity of words the reader will actually get on a page.
 */
const REVEAL_PAGE_VIEWPORT = { width: 390, height: 640 };
const REVEAL_PAGE_TYPOGRAPHY = { fontSize: 18, lineHeight: 31 };

/**
 * How many finished pages must exist before the chapter is revealed.
 *
 * The product owner's illustration was "if a chapter is ten pages, they give
 * you the first five" — half the chapter, with the rest arriving behind you.
 * Ten pages is not this product's chapter, so the number is derived rather
 * than copied. A series chapter is held to 600-900 words by `wordBandFor()` in
 * the backend — call it 3,300 to 5,000 characters — and at the geometry above
 * `paginateChapter` fits about 650 characters on a page. So a chapter is five
 * to eight pages, and the product owner's "first five of ten" is, in this
 * product's units, three.
 *
 * Three is also the smallest number that keeps the promise for more than an
 * instant. At three finished pages the reader lands on page 1 with two more
 * already written behind it, so they can turn twice before they could possibly
 * outrun the writer — and the generation is still running the whole time,
 * filling in further ahead.
 *
 * **The other half of the rule is "or the chapter is complete, whichever comes
 * first", and it needs no code here.** A completed generation resolves
 * `generateStoryStreaming` / `continueStoryStreaming`, which moves the screen
 * to the editor with the server's own persisted chapter. So a chapter too short
 * to reach three pages is never left behind a loader: it goes straight from the
 * crafting screen to the finished text, which is the same experience one beat
 * earlier.
 */
export const REVEAL_MIN_PAGES = 3;

/**
 * The prose the reader may be shown, given everything received so far.
 *
 * Returns `""` while the chapter is still below the threshold — that is the
 * signal to keep the crafting loader up. Once non-empty it only ever grows,
 * and always by whole pages, so a caller can render it directly without
 * tracking whether a reveal has already happened.
 *
 * Exported for `expo/src/__tests__/chapter-reveal.test.ts`, which is where the
 * page arithmetic is pinned; a threshold that can only be observed by driving a
 * whole generation is a threshold nobody will check again.
 */
export function revealableChapterProse(raw: string): string {
  // Everything after the last blank line is a paragraph still being written.
  const lastBreak = raw.lastIndexOf("\n\n");
  if (lastBreak < 0) return "";
  const settled = normalizeText(raw.slice(0, lastBreak));
  if (!settled) return "";

  const pages = paginateChapter(
    settled,
    REVEAL_PAGE_VIEWPORT,
    REVEAL_PAGE_TYPOGRAPHY,
  );
  // Drop the last page: it is the one the next chunk lands in.
  const finished = pages.slice(0, -1);
  if (finished.length < REVEAL_MIN_PAGES) return "";

  // Back off to the last paragraph that ends inside those pages. A page
  // boundary is a sentence boundary, so cutting at it directly would end the
  // reveal in the middle of a paragraph.
  const pageEnd = finished[finished.length - 1].end;
  const paragraphEnd = settled.lastIndexOf("\n\n", pageEnd);
  if (paragraphEnd <= 0) return "";

  return settled.slice(0, paragraphEnd);
}

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
  isAnonymous = true,
  onCreditUsed,
  onPublished,
  onBack,
  initialDraft,
}: CreateStudioProps) {
  const [step, setStep] = useState<StudioStep>("setup");
  // Everything received from the server so far, raw, mid-word tail and all.
  //
  // A ref and not state, because nothing renders it. It is the input to
  // `revealableChapterProse`, which decides how much of it a person may see;
  // re-rendering the screen for a chunk that does not change that answer was
  // the old letter-by-letter behaviour.
  const streamedProseRef = useRef("");
  // The part of it the reader is actually shown: whole paragraphs, whole
  // pages, never the sentence being typed. Empty until the chapter clears
  // `REVEAL_MIN_PAGES`, which is what keeps the crafting loader up.
  const [revealedProse, setRevealedProse] = useState("");
  // The same value, readable synchronously by the error handler.
  //
  // That handler runs in a closure created before any chunk arrived, so it
  // sees the initial state value and cannot tell "failed before the reader saw
  // anything" from "failed after they were handed finished pages" - which are
  // two different screens. Note this is now keyed off what was *revealed*, not
  // off what arrived: prose that never cleared the threshold was never on
  // screen, so keeping the reader on it would be showing them a fragment for
  // the first time as an epitaph.
  const revealedProseRef = useRef("");
  const [streamStage, setStreamStage] = useState<string>("context");
  // Set only when generation failed after prose had already been shown. The
  // text stays on screen; erasing what somebody has read is the worse outcome.
  const [streamError, setStreamError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioDraft>(() =>
    initialDraft ? { ...INITIAL_DRAFT, ...initialDraft } : INITIAL_DRAFT
  );
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  /**
   * Take one chunk off the wire and decide whether it changed what is visible.
   *
   * Both generation paths share it so the reveal rule cannot drift between
   * "the first chapter" and "every chapter after it". The length comparison is
   * what keeps this cheap: `revealableChapterProse` re-paginates, but the
   * result only changes when a whole new page has settled, so the screen
   * re-renders a handful of times per chapter instead of once per token.
   */
  const acceptStreamChunk = useCallback((chunk: string) => {
    streamedProseRef.current += chunk;
    const next = revealableChapterProse(streamedProseRef.current);
    if (next.length === revealedProseRef.current.length) return;
    revealedProseRef.current = next;
    setRevealedProse(next);
  }, []);

  /** Start (or restart) a chapter with nothing received and nothing shown. */
  const resetStreamState = useCallback(() => {
    streamedProseRef.current = "";
    revealedProseRef.current = "";
    setRevealedProse("");
  }, []);

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

  // The cover, which is chapter 1's art (§10.4).
  //
  // Held apart from `story` rather than folded into it because it moves on a
  // different clock: the story object is rewritten on every keystroke in the
  // editor, and the cover is settled by a background task on the server that
  // this screen only observes. Seeded from the generation response, advanced by
  // `fetchCoverState`, replaced outright by a regeneration.
  const [cover, setCover] = useState<CoverState>({
    coverStatus: "pending",
    coverRegenCount: 0,
  });
  /** The writer's optional steer for the next cover. Sent, not discarded. */
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  /**
   * How many times the cover watch has asked, across every interval it has had.
   *
   * A ref rather than an effect-local counter because the watch is torn down
   * and rebuilt whenever `step` changes, and the whole point of the bound is
   * that one image gets a fixed number of asks in total. It is reset when a
   * *new* image starts being made — a fresh story, or a regeneration — because
   * that is a different job and deserves its own budget.
   */
  const coverPollAttemptsRef = useRef(0);

  // Chapter state
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [addingChapter, setAddingChapter] = useState(false);
  const maxChapters = story?.plannedChapterCount ?? draft.plannedChapterCount ?? 3;

  // The reader's optional steer for the chapter that has not been written yet.
  //
  // Blank is the normal case and means Katha decides — the field exists so a
  // reader who *does* have something in mind is not forced to accept whatever
  // the plan had queued up. It costs nothing: the credit is charged for the
  // chapter, never for saying what should be in it.
  const [nextInstruction, setNextInstruction] = useState("");

  // -----------------------------------------------------------------------
  // "Write the rest" — the same loop, under program control (§10.2)
  // -----------------------------------------------------------------------

  /**
   * The re-entrancy guard, and why it is a ref and not the state below.
   *
   * A run is the only thing in this screen that can spend a whole balance, so
   * "start a second one" has to be impossible rather than merely unlikely.
   * `runActiveRef` is set synchronously in the first statement of the starter,
   * before any await, so two presses in the same tick cannot both get past it.
   * A `useState` flag could not do that job: the second press would read the
   * pre-render value and start a parallel loop, and two loops appending to two
   * diverging copies of the same story would double-charge and lose chapters.
   *
   * `activeRun` is the render-time mirror of it, for disabling controls and
   * drawing progress. It is never the guard.
   */
  const runActiveRef = useRef(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  /**
   * Stop, as a ref for the same reason: the loop reads it between chapters
   * from inside a closure that was created before the press happened.
   */
  const runStopRef = useRef(false);
  /** The itemised confirm. Null means it is closed; nothing is spent while it is open. */
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  /** What the last run did, said once in the editor rather than as an alert. */
  const [runNotice, setRunNotice] = useState<string | null>(null);

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

  /**
   * A run must not outlive the screen silently.
   *
   * Switching tabs unmounts the studio, and the loop would otherwise keep
   * buying chapters against a tree nobody is looking at. It cannot be
   * cancelled mid-chapter without abandoning a reservation, so it is asked to
   * stop after the one in flight — the same semantics as the Stop button.
   *
   * **What is deliberately not here: resume.** An earlier revision persisted
   * the run's intent to AsyncStorage so the remainder could be re-offered on
   * the way back. It could never fire. `story` is only ever set by a generation
   * inside the current mount — the studio has no way to *open* an existing
   * story — so after the unmount the screen comes back at `setup` with
   * `story === null`, and every condition an offer could be gated on is false
   * forever. Making resume real needs a fetch-by-id and navigation the studio
   * does not have, so the whole record is gone rather than shipped as a code
   * path that cannot run. The gap is written down in
   * `source-of-truth/STORY_GENERATION_FLOW.md` §10.2 instead of being implied
   * by dead code. What survives either way is the part that costs money: every
   * chapter the run wrote is on the server, paid for, and nothing further is
   * ever charged without another confirm.
   */
  useEffect(() => {
    return () => {
      if (!runActiveRef.current) return;
      runStopRef.current = true;
    };
  }, []);

  // Restore persisted draft on mount
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    // An onboarding blueprint outranks anything in AsyncStorage: the user built
    // it seconds ago, and restoring over it would silently discard the whole
    // reason they finished the flow.
    if (initialDraft) {
      draftRestoredRef.current = true;
      return;
    }
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
    // Runs once. `initialDraft` is fixed for the life of the mount, and a
    // re-run would restore over whatever the user has typed since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    draft.seed.trim().length >= 1 && credits >= 3 && !busy;

  const wordCount = paragraphs.reduce((acc, p) => {
    return acc + p.text.split(/\s+/).filter(Boolean).length;
  }, 0);

  const readTimeMin = Math.max(1, Math.round(wordCount / 200));

  // What the Continue button calls itself.
  //
  // Three readings of the same action, and the label is the only place the
  // difference shows: the chapter that closes the planned run is the finale,
  // a typed direction is being followed rather than invented, and blank is
  // Katha's own choice. There is still one handler and one request behind all
  // three — the wording follows the state, it does not create one.
  const continueIsFinale = story
    ? story.chapters.length + 1 >= maxChapters
    : false;
  const continueLabel = continueIsFinale
    ? "Write the finale"
    : nextInstruction.trim()
      ? "Continue this way"
      : "Continue";

  // -----------------------------------------------------------------------
  // Step 1: Generate draft
  // -----------------------------------------------------------------------

  /**
   * The pre-generation entity warning (spec §6).
   *
   * Set when the writer asked for a public story and shaping has already
   * classified the idea as naming a living public figure or a private
   * individual. The server would force the story private regardless
   * (migration 00050); this says so before a credit is spent. Only ever set
   * from a shape result that is already on the draft - when shaping has not
   * run, generation proceeds and `StoryGatedPrivateModal` is the backstop.
   */
  const [publicEntityWarning, setPublicEntityWarning] = useState<StoryGatingReason | null>(null);

  const handleGenerate = useCallback(async (options?: { forcePrivate?: boolean }) => {
    if (busy) return;
    if (!options?.forcePrivate && draft.visibility === "public") {
      const reason = pendingGatingReason({
        gatingReason: draft.gatingReason,
        groundingEntities: draft.groundingEntities,
      });
      if (reason) {
        setPublicEntityWarning(reason);
        return;
      }
    }
    if (!canGenerate) {
      Alert.alert(
        credits >= 3 ? "Add a story seed" : "Credits needed",
        credits >= 3
          ? "Give Katha one clear idea to shape."
          : "You need 3 credits to start a story.",
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
      genres: draft.genres,
      audienceMode: draft.audienceMode,
      spiceLevel: draft.spiceLevel,
      identityLenses: draft.identityLenses,
      seed: draft.seed,
      language: draft.language,
      visibility: options?.forcePrivate ? "private" : draft.visibility,
      // Belt and braces with the clamp in loadDraft: validation.ts enforces the
      // same cap, and a request over it is a 400 rather than a truncation.
      characters: draft.characters.slice(0, MAX_CHARACTERS),
      isSeries: draft.isSeries,
      whereAndWhen: draft.whereAndWhen,
      moments: draft.moments,
      storyValues: draft.storyValues,
      writingStyle: draft.writingStyle,
      avoid: draft.avoid,
      chapterLength: draft.chapterLength,
      plannedChapterCount: draft.plannedChapterCount,
      illustrateChapters: draft.illustrateChapters,
      // Carried through from onboarding, where shaping already resolved it for
      // free. Omitting them here meant the paid generation arrived ungrounded
      // and re-derived what had already been paid for -- or, past the fallback
      // deadline, simply lost it. `api.ts` forwards these only when present, so
      // dropping them was silent.
      grounding: draft.grounding,
      groundingEntities: draft.groundingEntities,
    };

    resetStreamState();
    setStreamStage("context");
    setStreamError(null);

    try {
      const generated = await generateStoryStreaming(createDraft, requestId, {
        onStage: setStreamStage,
        onDelta: acceptStreamChunk,
      });
      const firstChapter = generated.chapters[0];
      if (!firstChapter) {
        throw new Error("Story generation returned no chapter");
      }
      onCreditUsed(3);
      clearDraft();
      setStory(generated);
      // Chapter 1's art is already in flight by the time this response arrives
      // — `generate-story` schedules it the moment the chapter persists — so
      // the studio starts watching from here rather than pretending the cover
      // is a publish-time concern.
      // A new story is a new image, so the watch gets its full budget back.
      coverPollAttemptsRef.current = 0;
      setCover({
        coverImageUrl: generated.coverImageUrl,
        coverStatus: generated.coverStatus ?? "generating",
        coverRegenCount: generated.coverRegenCount ?? 0,
      });
      setCoverPrompt("");
      setCoverError(null);
      setStoryTitle(generated.title);
      setActiveChapterIndex(0);
      setParagraphs(
        firstChapter.paragraphs.map((text) => ({
          text,
          isEditing: false,
          isProcessing: false,
        })),
      );
      resetStreamState();
      setStep("editor");
    } catch (error) {
      if (
        error instanceof GenerationRequestError &&
        error.resetRequestId
      ) {
        requestIdRef.current = null;
      }
      const message = error instanceof Error
        ? error.message
        : "Please try again.";
      // A failure before the chapter was ever revealed is an ordinary error:
      // back to setup with an alert. A failure after it is not, because the
      // reader is looking at finished pages of their story. Keep them on the
      // text, say what happened underneath it, and let them decide - the credit
      // is already refunded. The condition reads `revealedProseRef`, not the
      // raw stream: text that never cleared the reveal threshold was never on
      // screen, and dumping a half-page fragment on somebody at the moment it
      // fails is worse than an honest alert.
      if (revealedProseRef.current.trim()) {
        setStreamError(message);
      } else {
        setStep("setup");
        Alert.alert("Could not create story", message);
      }
    } finally {
      setBusy(false);
    }
  }, [
    acceptStreamChunk,
    busy,
    canGenerate,
    credits,
    draft,
    onCreditUsed,
    resetStreamState,
  ]);

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
          // The rewrite replaces the paragraph as it is written, in place.
          //
          // This is the edit path's whole point: the writer is looking directly
          // at the sentence being changed, so a spinner over it is the most
          // conspicuous wait in the product. `partial` accumulates outside
          // React for the same reason the chapter stream does - chunks arrive
          // faster than a render.
          let partial = "";
          result = await editParagraphStreaming(
            story.id,
            chapter.id,
            index,
            instruction as "rewrite" | "expand" | "shorten" | "custom",
            {
              onDelta: (chunk) => {
                partial += chunk;
                // A chapter switch mid-edit must not paint one chapter's text
                // onto another's paragraph.
                if (editChapterIndex !== activeChapterIndex) return;
                setParagraphs((prev) =>
                  prev.map((p, i) =>
                    i === index ? { ...p, text: partial } : p,
                  ),
                );
              },
            },
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
        // Put the original paragraph back.
        //
        // The streamed rewrite has been painting over this paragraph as it
        // arrived, so a failure would otherwise leave the writer holding half a
        // sentence where their finished one used to be. Nothing was saved -
        // the server only persists a completed rewrite - so restoring the text
        // it started from is both correct and what the writer expects. Editing
        // is free, so the retry costs them nothing.
        setParagraphs((prev) =>
          prev.map((p, i) =>
            i === index
              ? { ...p, text: previousText, isProcessing: false }
              : p,
          ),
        );
        Alert.alert("Edit failed", "Could not apply the edit. Please try again.");
      }

      setSelectedIndex(null);
      setCustomPromptIndex(null);
      setCustomPromptText("");
    },
    [paragraphs, showUndoToast, activeChapterIndex, story],
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
  // Step transitions: Editor → Review → Publish
  // -----------------------------------------------------------------------

  const handleDoneWriting = useCallback(() => {
    saveEditorToStory();
    setStep("review");
  }, [saveEditorToStory]);

  const handleBackToEditor = useCallback(() => {
    setStep("editor");
  }, []);

  // -----------------------------------------------------------------------
  // The cover
  // -----------------------------------------------------------------------

  /**
   * Watch for chapter 1's art while the writer is in the studio.
   *
   * `generate-story` returns `cover_status: "generating"` and then finishes the
   * job on a background task, so this screen is handed a promise and no way to
   * hear it kept. Without this the cover could only ever appear on a later
   * launch, and the studio would be back to describing a cover it had never
   * seen — which is the thing §10.4 is a correction to.
   *
   * It runs only while there is something to wait for: the effect re-runs when
   * the status changes and returns immediately once it is no longer
   * `generating`, which is what tears the interval down. It is bounded so a
   * server-side claim that died leaves the writer with the concept card rather
   * than a spinner that never resolves.
   *
   * **It is deliberately not gated on `step` any more.** It used to run only on
   * `editor` and `review`, which meant the one activity that takes minutes —
   * writing the next chapter, or a whole "Write the rest" run, both of which
   * sit on `generating` — was also the one activity during which the cover was
   * not being watched for. A writer would continue their story, come back, and
   * find the studio still saying "painting chapter one\u2019s art" about an image
   * that had been sitting finished in Storage for several minutes, because
   * nobody asked while they were away. The whole promise of §10.4 is that the
   * cover happens *behind* what the writer is doing, and a watch that stops
   * whenever they do something is not a background watch.
   *
   * Two things the bound has to survive to mean anything. The attempt count
   * lives in a ref rather than in the effect body, so it survives every re-run
   * of this effect; a local `let` would reset to zero and a writer moving
   * between screens would poll a dead job forever. And the callback is `async`,
   * so a fetch slower than the interval would otherwise be re-entered while the
   * previous one is still out, stacking requests and burning attempts on
   * answers nobody waited for. The in-flight flag makes a tick that arrives
   * during a fetch a no-op instead.
   */
  useEffect(() => {
    const storyId = story?.id;
    if (!storyId) return;
    if (cover.coverStatus !== "generating") return;

    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      if (coverPollAttemptsRef.current >= COVER_POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      inFlight = true;
      coverPollAttemptsRef.current += 1;
      try {
        const next = await fetchCoverState(storyId);
        if (cancelled) return;
        if (next) setCover(next);
      } finally {
        inFlight = false;
      }
    }, COVER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [story?.id, cover.coverStatus]);

  /**
   * Only the author gets to change the cover, and in this screen "the author"
   * is not a comparison — it is a fact about how the story got here.
   *
   * The studio has no open-an-existing-story path (see the unmount note above:
   * `story` is only ever set by a generation inside the current mount), so any
   * story these controls can reach is one this session just paid for and
   * created. That is stronger evidence of authorship than anything the client
   * could check today: `isOwnStory` compares `authorId` against the `"me"`
   * sentinel that only the *offline mock* stamps, so a real server-generated
   * story fails it, and there is still no signed-in user id in the client to
   * compare a real `author_id` against.
   *
   * It is named rather than left implicit because the day the studio can open
   * someone else's story — a shared draft, a co-write — this is the line that
   * has to start doing real work, and a bare `!story` in the disabled prop
   * would not have told anybody that.
   */
  const viewerIsAuthor = story !== null;

  /** 1 free retry, then 1 credit — `CREDITS_AND_PRICING.md`, §10.4. */
  const coverRegenCostsCredit = cover.coverRegenCount >= 1;

  /**
   * An image is already being made for this story.
   *
   * The server holds one claim per story and answers a second request with a
   * 409 `in_flight`, so pressing Regenerate while chapter 1's own cover is
   * still being painted is a guaranteed error dressed up as a button. This is
   * not the permanently disabled control §10.4 removed: it is off only while
   * the server says work is happening, and it comes back the moment the status
   * resolves to `ready` or `failed` — including via the watch above, which is
   * running for exactly this state.
   */
  const coverGenerating = cover.coverStatus === "generating";
  /** Either reason the control is off, so the label and the guard agree. */
  const coverActionBusy = coverBusy || coverGenerating;

  const handleRegenerateCover = useCallback(async () => {
    // `viewerIsAuthor` is `story !== null`, so this is also the null guard.
    // Written as the authorship check rather than as a null check because that
    // is the rule being enforced; the two only happen to coincide today.
    if (!story || !viewerIsAuthor || coverActionBusy) return;
    if (coverRegenCostsCredit && credits < 1) {
      Alert.alert(
        "Credits needed",
        "You need 1 credit to regenerate this cover. The first one was free.",
      );
      return;
    }

    setCoverBusy(true);
    setCoverError(null);
    // A regeneration is a new image, so the watch that will pick it up starts
    // its bound again rather than inheriting whatever the last one spent.
    coverPollAttemptsRef.current = 0;
    const note = coverPrompt.trim();
    // A fresh id every press. A regeneration is not a retry of the last one —
    // the writer wants a different picture — and the server refuses a request
    // id that has already bought a cover rather than handing out a second one.
    const requestId = createGenerationRequestId();

    try {
      const next = await regenerateCover(story.id, requestId, note || undefined);
      setCover({
        coverImageUrl: next.coverImageUrl,
        coverStatus: next.coverStatus,
        coverRegenCount: next.coverRegenCount,
      });
      // The server says what it charged. Deriving it here from the count would
      // be a second copy of the pricing rule, and the two would drift.
      if (next.charged) onCreditUsed(1);
      // Cleared only on success, for the same reason the continuation box is:
      // a failed regeneration that also ate what the writer typed charges them
      // twice for one of our failures.
      setCoverPrompt("");
    } catch (error) {
      setCoverError(
        error instanceof Error
          ? error.message
          : "The cover could not be regenerated. Please try again.",
      );
    } finally {
      setCoverBusy(false);
    }
  }, [
    story,
    viewerIsAuthor,
    coverActionBusy,
    coverRegenCostsCredit,
    credits,
    coverPrompt,
    onCreditUsed,
  ]);

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

    const shouldPublish = draft.visibility === "public";
    const updatedChapters = edited.chapters.map((ch) => ({
      ...ch,
      isPublished: shouldPublish,
    }));

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
          visibility: draft.visibility,
          chapters: edited.chapters.map((ch) => ({
            id: ch.id,
            content: ch.paragraphs.filter((p) => p.trim()).join("\n\n"),
          })),
        }),
        // Bounded so the UI never hangs on a stalled request.
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
    } catch (err) {
      setStep("review");
      // The entity visibility gate. The server still saved every edit before
      // refusing to go public - see publish-story - so this is not a failure
      // to explain away with a retry button. It is a decision to explain once,
      // with the modal, and the story finishes the flow the moment the writer
      // acknowledges it.
      if (err instanceof StoryGatedPrivateError) {
        setGatedPrivateReason(err.gatingReason);
        setGatedPrivateStory({
          ...edited,
          title: storyTitle || edited.title,
          chapters: edited.chapters.map((ch) => ({ ...ch, isPublished: false })),
        });
        return;
      }
      Alert.alert(
        shouldPublish ? "Couldn't publish" : "Couldn't save",
        "Your story and every edit are still here. Check your connection and try again.",
      );
      return;
    }

    // The cover the studio has actually been showing, not the one the story
    // arrived with.
    //
    // `cover` is separate state, and for good reason: the image is made
    // asynchronously and arrives through a poll (and again through
    // `regenerateCover`) long after `setStory` last ran. But that means
    // `edited.coverImageUrl` is still whatever `generate-story` answered with,
    // which for a cover that was not finished yet is nothing at all. Handing
    // that to `onPublished` meant the writer watched their cover appear in the
    // studio, published, and landed on a story showing the placeholder
    // gradient -- with the real image sitting in Storage the whole time.
    // Reopening the story later fetched it and it reappeared, which made the
    // bug look like a fluke rather than a certainty.
    //
    // The three fields move together because they describe one thing. Taking
    // the url without the status would leave a story whose status still says
    // "generating" over an image that has arrived, and the reader's UI keys
    // its placeholder off that.
    const publishedStory: Story = {
      ...edited,
      title: storyTitle || edited.title,
      chapters: updatedChapters,
      coverImageUrl: cover.coverImageUrl ?? edited.coverImageUrl,
      coverStatus: cover.coverStatus ?? edited.coverStatus,
      coverRegenCount: cover.coverRegenCount ?? edited.coverRegenCount,
    };

    onPublished(publishedStory);
  }, [
    draft.visibility,
    story,
    storyTitle,
    onPublished,
    saveEditorToStory,
    cover.coverImageUrl,
    cover.coverStatus,
    cover.coverRegenCount,
  ]);

  const [gatedPrivateReason, setGatedPrivateReason] = useState<StoryGatingReason | null>(null);
  const [gatedPrivateStory, setGatedPrivateStory] = useState<Story | null>(null);

  const handleAcknowledgeGatedPrivate = useCallback(() => {
    setGatedPrivateReason(null);
    if (gatedPrivateStory) onPublished(gatedPrivateStory);
    setGatedPrivateStory(null);
  }, [gatedPrivateStory, onPublished]);

  /**
   * Write exactly one more chapter. The single continuation path.
   *
   * Extracted from `handleContinueStory` so that "Write the rest" can drive it
   * rather than reimplement it. §10.2 is explicit that the run "is not a second
   * mode — each chapter is still its own request, its own reservation and its
   * own credit", and the only way to hold that true in code is for both callers
   * to be the same code. Everything a continuation has to get right — the
   * chapter-count guard, the credit guard, the fresh request id per chapter,
   * the finale flag, the streamed-prose bookkeeping, and above all the
   * partial-stream rule that keeps text the reader has already seen on screen
   * — lives here once.
   *
   * The three things the caller supplies rather than this function reading from
   * state, and why each has to be a parameter:
   *
   * - **`baseStory`.** Inside a run, chapter N+1 is appended to the story that
   *   chapter N produced, which the `story` state variable will not hold yet:
   *   this closure was created before that render. Reading state here would
   *   append every chapter of a run to the same base and silently lose all but
   *   the last.
   * - **`budget`.** Same problem with `credits`, which arrives as a prop from a
   *   parent that re-renders on its own schedule. A run tracks what it has
   *   spent and passes the remainder down, so the guard cannot be fooled by a
   *   balance that has not caught up.
   * - **`settle`.** A single Continue ends in the editor. A run ends in the
   *   editor *once*, after its last chapter; settling between chapters would
   *   flash the editor between every one.
   */
  const continueOnce = useCallback(async (options: {
    baseStory: Story;
    direction?: string;
    isFinale?: boolean;
    budget: number;
    /** Default true: return to the editor and drop the busy flag when done. */
    settle?: boolean;
    /** Default false. Only a caller that actually sent the box may empty it. */
    clearDirectionOnSuccess?: boolean;
  }): Promise<ContinueOutcome> => {
    const {
      baseStory,
      direction,
      isFinale = false,
      budget,
      settle = true,
      clearDirectionOnSuccess = false,
    } = options;

    if (baseStory.chapters.length >= maxChapters) {
      return {
        status: "blocked",
        title: "Series complete",
        message: `This story has reached its planned ${maxChapters} chapters.`,
      };
    }
    if (budget < CHAPTER_TEXT_CREDITS) {
      return {
        status: "blocked",
        title: "Credits needed",
        message: "You need 1 credit to add a chapter.",
      };
    }

    setAddingChapter(true);
    setStep("generating");

    // A fresh id per chapter, never per run. The id is what makes a
    // reservation idempotent, so reusing one across chapters would make the
    // server treat chapter 6 as a replay of chapter 5 and hand back the text
    // the writer already has.
    const requestId = createGenerationRequestId();
    const nextChapterNum = baseStory.chapters.length + 1;
    const shouldFinale = isFinale || nextChapterNum >= maxChapters;

    resetStreamState();
    setStreamStage("context");
    setStreamError(null);

    try {
      const { chapter } = await continueStoryStreaming(
        baseStory.id,
        requestId,
        {
          onStage: setStreamStage,
          onDelta: acceptStreamChunk,
        },
        shouldFinale,
        nextChapterNum,
        direction,
      );
      onCreditUsed(CHAPTER_TEXT_CREDITS);

      const updatedStory: Story = {
        ...baseStory,
        chapters: [...baseStory.chapters, chapter],
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
      resetStreamState();

      // Cleared only on success, and only for the caller that sent it. A
      // direction that survived into the next chapter would keep steering
      // chapters the reader never aimed it at, with nothing on screen to say
      // so. A failed continuation keeps the text, because retyping it is the
      // reader paying for our error. A run never sends it at all, so a run
      // must never empty it either.
      if (clearDirectionOnSuccess) setNextInstruction("");

      if (settle) {
        setAddingChapter(false);
        setStep("editor");
      }
      return { status: "written", story: updatedStory };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Please try again.";
      setAddingChapter(false);
      // Same rule as the first chapter: pages the reader has already been
      // handed stay on screen, and only a failure before the reveal returns
      // them to the editor.
      if (revealedProseRef.current.trim()) {
        setStreamError(message);
        return { status: "failed", message, keptPartial: true };
      }
      setStep("editor");
      return { status: "failed", message, keptPartial: false };
    }
  }, [acceptStreamChunk, maxChapters, onCreditUsed, resetStreamState]);

  const handleContinueStory = useCallback(async (isFinale = false) => {
    if (!story || addingChapter) return;
    // A run owns the continuation path while it holds it. The button is
    // disabled during one, but the tab-strip chip and this handler are reached
    // from two places, so the guard is here rather than only in the markup.
    if (runActiveRef.current) return;

    // Save current editor state before generating next chapter
    const savedStory = saveEditorToStory() ?? story;

    // Read the direction once, here, rather than inside the stream callbacks.
    // The box stays editable while the chapter streams, and a request that
    // re-read the state later could send text the reader typed *after* they
    // pressed Continue. Empty collapses to `undefined` so the request omits the
    // field entirely — an empty string would still render the reader-direction
    // block in the prompt, telling the model a steer exists when none does.
    const direction = nextInstruction.trim() || undefined;

    const outcome = await continueOnce({
      baseStory: savedStory,
      direction,
      isFinale,
      budget: credits,
      clearDirectionOnSuccess: true,
    });

    if (outcome.status === "blocked") {
      Alert.alert(outcome.title, outcome.message);
      return;
    }
    if (outcome.status === "failed" && !outcome.keptPartial) {
      Alert.alert("Could not continue story", outcome.message);
    }
  }, [story, addingChapter, credits, nextInstruction, continueOnce, saveEditorToStory]);

  // -----------------------------------------------------------------------
  // "Write the rest": the same loop, driven by the program
  // -----------------------------------------------------------------------

  /**
   * What a run would cost, itemised, before anything is spent.
   *
   * `CREDITS_AND_PRICING.md` puts two obligations on this. "Every paid button
   * shows its price" — and a run's price is not one chapter's price, so it has
   * to be added up rather than implied. And "you pay as each chapter is
   * written, so a story you stop halfway costs what it wrote, not what it
   * planned" — which is what makes the *shortfall* case honest rather than a
   * refusal: a balance that covers four of seven chapters buys four chapters,
   * and the writer is told that number before they agree to it.
   *
   * **Why there is no art line, even though §10.2 asks for one.** Per-chapter
   * art is not implemented anywhere: `chapter_art` exists only as an enum value
   * on `generation_operations.kind`, nothing ever reserves it,
   * `reserve_generation_operation` deducts exactly one credit for every kind it
   * accepts, and `continue-story` never reads `illustrate_chapters`. A run with
   * the toggle on is therefore charged exactly what a run with it off is
   * charged. Quoting a second credit per chapter would not merely overstate the
   * bill, it would *refuse work the balance covers*: 4 credits against 4
   * remaining chapters quoted at 2 each offers two chapters and calls the other
   * two unaffordable. So the quote bills what is actually charged — one credit
   * per chapter — and the itemisation says only that. The divergence from §10.2
   * is recorded in `source-of-truth/STORY_GENERATION_FLOW.md` rather than
   * papered over here; when chapter art is really built, the art line and its
   * price come back with it.
   */
  const chaptersWritten = story?.chapters.length ?? 0;
  const runQuote = (() => {
    const remaining = Math.max(0, maxChapters - chaptersWritten);
    const perChapter = CHAPTER_TEXT_CREDITS;
    const textCredits = remaining * CHAPTER_TEXT_CREDITS;
    const total = textCredits;
    // What the balance actually reaches. Floor, never round: a chapter that is
    // 90% paid for is a chapter that fails.
    const affordable = Math.min(remaining, Math.floor(credits / perChapter));
    return { remaining, perChapter, textCredits, total, affordable };
  })();

  /**
   * Whether the run control is offered at all.
   *
   * Three conditions, all from §10.2 and the shape of the editor. From chapter
   * 3 onward, because that is where the section puts it. Only while chapters
   * remain. And only on the last chapter, for the same reason Continue is: an
   * append offered while the writer is back editing chapter 1 of 7 lands
   * somewhere they are not looking.
   */
  const canOfferWriteTheRest = Boolean(
    story
    && activeChapterIndex === chaptersWritten - 1
    && chaptersWritten >= WRITE_THE_REST_MIN_CHAPTERS
    && runQuote.remaining > 0,
  );

  /**
   * Run the loop.
   *
   * `chaptersToWrite` is decided by the confirm sheet, not here, because that
   * is where the balance was quoted and agreed. Passing it in is what keeps
   * "start a run the balance cannot finish" impossible by construction rather
   * than by a check somewhere downstream.
   *
   * The loop is sequential and has no retry. §10.2's promise is that each
   * chapter is its own reservation and its own credit; a retry inside the loop
   * would turn one failure into two charges for one chapter, and the
   * single-chapter path already refunds the failed one. So a failure ends the
   * run, and everything written before it stays written — it is on the server
   * already.
   */
  const startWriteTheRest = useCallback(async (chaptersToWrite: number) => {
    if (!story || addingChapter) return;
    // Synchronous, and first. See the comment on `runActiveRef`.
    if (runActiveRef.current) return;
    if (chaptersToWrite < 1) return;
    runActiveRef.current = true;
    runStopRef.current = false;

    const base = saveEditorToStory() ?? story;
    const target = Math.min(maxChapters, base.chapters.length + chaptersToWrite);

    setRunNotice(null);
    setActiveRun({ target, written: 0, stopping: false });

    let current = base;
    let budget = credits;
    let written = 0;
    let ending: "done" | "stopped" | "halted" = "done";
    let failure: Exclude<ContinueOutcome, { status: "written" }> | null = null;

    while (current.chapters.length < target) {
      // Checked here as well as after each chapter so a Stop pressed during the
      // very first request is honoured the moment that chapter lands.
      if (runStopRef.current) {
        ending = "stopped";
        break;
      }

      const outcome = await continueOnce({
        baseStory: current,
        // Deliberately no `direction`. See the note rendered beside the button:
        // "What happens next?" steers one chapter, and a run has no single
        // chapter to aim it at.
        budget,
        settle: false,
      });

      if (outcome.status !== "written") {
        ending = "halted";
        failure = outcome;
        break;
      }

      current = outcome.story;
      budget -= runQuote.perChapter;
      written += 1;
      setActiveRun((prev) => (prev ? { ...prev, written } : prev));

      // Stop keeps every chapter already written and never discards one
      // mid-flight: the check is *after* the chapter has been persisted and
      // charged, so the worst case is one more chapter than the writer expected
      // and never half of one.
      if (runStopRef.current) {
        ending = "stopped";
        break;
      }
    }

    runActiveRef.current = false;
    runStopRef.current = false;
    setActiveRun(null);

    const kept = written === 1
      ? "1 chapter was written and kept."
      : `${written} chapters were written and kept.`;

    if (ending === "halted" && failure) {
      const reason = failure.message;
      // A failure that reached the reader mid-sentence is already on screen in
      // `StreamingProse` with its own dismiss. Stacking an alert on top of it
      // would make them acknowledge the same thing twice.
      if (failure.status === "failed" && failure.keptPartial) {
        setRunNotice(`The run stopped. ${kept} ${reason}`);
        return;
      }
      setAddingChapter(false);
      setStep("editor");
      setRunNotice(`The run stopped. ${kept} ${reason}`);
      Alert.alert("Write the rest stopped", `${kept}\n\n${reason}`);
      return;
    }

    setAddingChapter(false);
    setStep("editor");
    setRunNotice(
      ending === "stopped"
        ? `Stopped. ${kept} Continue whenever you want the next one.`
        : null,
    );
  }, [
    story,
    addingChapter,
    credits,
    maxChapters,
    runQuote.perChapter,
    continueOnce,
    saveEditorToStory,
  ]);

  /**
   * Stop.
   *
   * It sets a flag and nothing else. Aborting the request in flight would
   * abandon a chapter the server is already writing and has already reserved
   * against — the reader would have paid for prose nobody ever sees, which is
   * the one outcome `CREDITS_AND_PRICING.md` principle 4 exists to prevent. So
   * the in-flight chapter finishes and persists, and the run halts after it.
   * The label says exactly that.
   */
  const handleStopRun = useCallback(() => {
    if (!runActiveRef.current) return;
    runStopRef.current = true;
    setActiveRun((prev) => (prev ? { ...prev, stopping: true } : prev));
  }, []);

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
            coverPollAttemptsRef.current = 0;
            setCover({ coverStatus: "pending", coverRegenCount: 0 });
            setCoverPrompt("");
            setCoverError(null);
          },
        },
      ],
    );
  }, []);

  // -----------------------------------------------------------------------
  // Render: Setup step
  // -----------------------------------------------------------------------

  if (step === "setup") {
    return (
      <>
        <CreateBriefFlow
          credits={credits}
          isAnonymous={isAnonymous}
          draft={draft}
          setDraft={setDraft}
          onGenerate={() => handleGenerate()}
          onBack={onBack}
        />
        <PublicEntityWarningModal
          reason={publicEntityWarning}
          onKeepPrivate={() => {
            setPublicEntityWarning(null);
            // The toggle flips too, so the brief the writer comes back to
            // after generation reads the same as what was written.
            setDraft((previous) => ({ ...previous, visibility: "private" }));
            void handleGenerate({ forcePrivate: true });
          }}
          onChangeIdea={() => setPublicEntityWarning(null)}
        />
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Generating step (loading overlay)
  // -----------------------------------------------------------------------

  /**
   * The run bar: progress, and Stop.
   *
   * Rendered above whichever generating surface is showing — the loader before
   * the first token, the streamed prose after it — rather than inside either,
   * because it belongs to the run and not to the chapter. It is the only place
   * Stop exists, and Stop has to be reachable for the whole run, which is
   * precisely the time this screen is showing one of those two things.
   *
   * "Chapter 5 of 7" counts the chapter being written now: `chaptersWritten`
   * is the story as persisted, so the one in flight is the next number up.
   */
  const runBar = activeRun ? (
    <View style={styles.runBar} testID="write-the-rest-run-bar">
      <View style={styles.runBarBody}>
        <Text style={styles.runBarProgress}>
          Chapter {Math.min(activeRun.target, chaptersWritten + 1)} of{" "}
          {activeRun.target}
        </Text>
        <Text style={styles.runBarNote}>
          {activeRun.stopping
            ? "Stopping when this chapter is finished. Every chapter already written is kept."
            : "One chapter at a time, each its own credit. Stop whenever you like."}
        </Text>
      </View>
      <Pressable
        onPress={handleStopRun}
        disabled={activeRun.stopping}
        accessibilityRole="button"
        accessibilityState={{ disabled: activeRun.stopping }}
        accessibilityLabel={
          activeRun.stopping
            ? "Stopping after this chapter"
            : "Stop writing the rest"
        }
        accessibilityHint="The chapter being written now is finished and kept. Nothing after it is written or charged."
        style={[styles.runStopBtn, activeRun.stopping && styles.runStopBtnBusy]}
        testID="write-the-rest-stop"
      >
        <Text style={styles.runStopBtnText}>
          {activeRun.stopping ? "Stopping..." : "Stop"}
        </Text>
      </Pressable>
    </View>
  ) : null;

  if (step === "generating") {
    // The handoff, and the one line in this screen the streaming rework is
    // about. It used to read `streamedProse.length > 0` — the loader stepped
    // aside for the very first token and the reader watched the rest of the
    // chapter be typed. It now waits for `revealableChapterProse` to say that
    // whole, finished pages exist, and hands over only those.
    //
    // So the reader sees the crafting screen for the whole time the chapter is
    // being *written*, and then lands on page 1 of prose that is already
    // finished, with more of it already written behind them. There is still no
    // artificial minimum: the moment the pages exist, they get them.
    if (revealedProse.length > 0) {
      return (
        <SafeAreaView style={styles.flex}>
          {runBar}
          <StreamingProse
            testID="streaming-prose"
            text={revealedProse}
            stage={streamStage}
            title={addingChapter ? undefined : storyTitle || undefined}
            errorMessage={streamError}
            dismissLabel={addingChapter ? "Back to editor" : "Start over"}
            onDismissError={() => {
              resetStreamState();
              setStreamError(null);
              // A failed continuation still has a story to go back to; a failed
              // first chapter does not, so it returns to the brief the writer
              // filled in rather than to an empty editor.
              setStep(addingChapter ? "editor" : "setup");
              setAddingChapter(false);
            }}
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.flex}>
        {runBar}
        <GeneratingOverlay
          genre={draft.primaryGenre}
          mode={addingChapter ? (story && story.chapters.length + 1 >= maxChapters ? "finale" : "chapter") : "story"}
        />
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
          <Pressable onPress={handleBackToEditor} style={styles.editorBackBtn}>
            <ArrowLeft size={20} color={colors.ink} />
            <Text style={styles.editorBackText}>Back</Text>
          </Pressable>
          <Text style={styles.editorHeaderTitle}>Review</Text>
          <View style={{ width: 80 }} />
        </View>

        <ScrollView contentContainerStyle={styles.reviewScroll}>
          {/* The cover, as it actually is.
            *
            * §10.4: chapter 1's art *is* the cover, and it was generated when
            * chapter 1 was. So this shows the real image when there is one and
            * the free typographic concept card when there is not — and the
            * concept card is labelled CONCEPT rather than dressed up as a
            * preview, because keeping it is a legitimate published look and the
            * writer is entitled to know which of the two they are choosing.
            *
            * The three states below are the three the row can actually be in.
            * A spinner is shown only while the server says work is happening;
            * a cover that failed says so and offers the retry, rather than
            * spinning forever over a job nothing is running. */}
          <View style={styles.reviewCard}>
            {cover.coverImageUrl ? (
              <Image
                source={{ uri: cover.coverImageUrl }}
                style={styles.reviewCoverMini}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel={`Cover for ${storyTitle || "your story"}`}
                testID="review-cover-image"
              />
            ) : (
              <View
                style={[styles.reviewCoverMini, { backgroundColor: gradient[1] }]}
                accessibilityLabel="Concept cover"
                testID="review-concept-cover"
              >
                <Text style={styles.reviewCoverMiniTitle} numberOfLines={2}>
                  {storyTitle || "Untitled"}
                </Text>
                <Text style={styles.reviewCoverConceptTag}>CONCEPT</Text>
              </View>
            )}
            <View style={styles.reviewCardMeta}>
              <Text style={styles.reviewCardTitle}>{storyTitle || "Untitled"}</Text>
              <Text style={styles.reviewCardSubtitle}>
                {genreLabels[genre]} · {totalWords.toLocaleString()} words
              </Text>
              {cover.coverStatus === "generating" && !cover.coverImageUrl && (
                <View style={styles.reviewCoverStatusRow} testID="cover-generating">
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.reviewCoverStatusText}>
                    Painting chapter one&apos;s art
                  </Text>
                </View>
              )}
              {cover.coverStatus === "failed" && !cover.coverImageUrl && (
                <Text style={styles.reviewCoverStatusText} testID="cover-failed">
                  The cover didn&apos;t come through. Your concept card is a real
                  cover — or try again below.
                </Text>
              )}
            </View>
          </View>

          {/* Cover controls. Never a permanently disabled button: the price is
            * stated, the note is sent, and the only thing that turns the
            * control off is a request already in flight.
            *
            * Author-only, per §10.4 — regenerating spends the story owner's
            * credits and replaces the image every reader sees, so it is not a
            * control that belongs to whoever happens to have the screen open.
            * Today that is everyone who can reach this screen; see
            * `viewerIsAuthor` for why it is written down anyway.
            *
            * There is no *Upload your own* here, and it is not an oversight.
            * §10.4 lists it as free and prominent, and its own implementation
            * note records that it does not ship: it needs a storage +
            * signed-URL surface the client cannot invent. A disabled Upload
            * button beside a working Regenerate would be exactly the dead
            * control that section deleted the cover step for. */}
          {viewerIsAuthor && (
          <View style={styles.coverActions}>
            <TextInput
              value={coverPrompt}
              onChangeText={setCoverPrompt}
              maxLength={MAX_COVER_NOTE_CHARS}
              placeholder="Optional. Say what this cover should show."
              placeholderTextColor={colors.tertiary}
              style={styles.coverPromptInput}
              multiline
              accessibilityLabel="Cover note"
              accessibilityHint="Optional. Describe what the regenerated cover should show."
              testID="cover-note-input"
            />
            <Pressable
              onPress={handleRegenerateCover}
              disabled={coverActionBusy || !story}
              accessibilityRole="button"
              accessibilityState={{
                disabled: coverActionBusy,
                busy: coverActionBusy,
              }}
              accessibilityLabel={
                coverBusy
                  ? "Regenerating the cover"
                  : coverGenerating
                    ? "A cover is already being made"
                    : coverRegenCostsCredit
                      ? "Regenerate the cover, 1 credit"
                      : "Regenerate the cover, free"
              }
              style={[
                styles.regenerateBtn,
                coverActionBusy && styles.regenerateBtnBusy,
              ]}
              testID="regenerate-cover-button"
            >
              <RefreshCw size={16} color={colors.accent} />
              <Text style={styles.regenerateBtnText}>
                {coverBusy
                  ? "Regenerating..."
                  : coverGenerating
                    ? "Painting the first one..."
                    : `Regenerate cover · ${coverRegenCostsCredit ? "1 credit" : "free"}`}
              </Text>
            </Pressable>
            {coverError && (
              <Text style={styles.coverErrorText} testID="cover-error">
                {coverError}
              </Text>
            )}
            <Text style={styles.coverHint}>
              {coverRegenCostsCredit
                ? "Your free retry is used. Each new cover costs 1 credit."
                : "Your first new cover is free. After that each one costs 1 credit."}
              {"\n"}Keeping the concept card costs nothing.
            </Text>
          </View>
          )}

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
            {/* The cover is deliberately not on this list any more. It was
              * generated with chapter 1, and promising it again here was the
              * same untruth the removed cover step told. */}
            <Text style={styles.reviewInfoText}>
              {"\u2022"} {cover.coverImageUrl
                ? "Your cover goes out with the story"
                : "Your concept card goes out as the cover"}{"\n"}
              {"\u2022"} Audio narration will be created in two voices{"\n"}
              {"\u2022"} {draft.visibility === "public"
                ? "Your story will be visible to all readers"
                : "Your story stays private until you publish it"}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom actions */}
        <View style={styles.reviewActions}>
          <Pressable onPress={handleBackToEditor} style={styles.reviewSecondaryBtn}>
            <Text style={styles.reviewSecondaryBtnText}>Back to Editor</Text>
          </Pressable>
          <Pressable onPress={handlePublish} style={styles.reviewPublishBtn}>
            <Text style={styles.reviewPublishBtnText}>
              {draft.visibility === "public" ? "Publish" : "Save to library"}
            </Text>
            <Check size={16} color={colors.surface} />
          </Pressable>
        </View>

        <StoryGatedPrivateModal
          reason={gatedPrivateReason}
          onAcknowledge={handleAcknowledgeGatedPrivate}
        />
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
            {draft.visibility === "public" ? "Publishing your story..." : "Saving your story..."}
          </Text>
          <Text style={styles.publishingSubtitle}>
            {/* Not "generating cover image" any more. The cover was made with
              * chapter 1; this step saves the story. */}
            Saving your chapters and starting narration
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
          {/* "Review", not "Next".
            *
            * This has never advanced the chapter — it leaves the editor for the
            * review step — but on a screen whose other job is writing chapter
            * after chapter, a forward chevron labelled "Next" reads as "next
            * chapter", and it sat directly above a chapter strip that until now
            * had an Add button in it. Naming the destination removes the last
            * thing on this screen that looks like a second way to continue the
            * story. */}
          <Pressable
            onPress={handleDoneWriting}
            style={styles.publishHeaderBtn}
            accessibilityRole="button"
            accessibilityLabel="Review your story"
            testID="editor-review-button"
          >
            <Text style={styles.publishHeaderBtnText}>Review</Text>
            <ChevronRight size={14} color={colors.surface} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.editorScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Story info card.
            *
            * The cover thumbnail appears here the moment chapter 1's art lands
            * — §10.4 puts the cover with chapter 1, and a writer who has to
            * reach the review step to find out whether their story has a face
            * has been kept waiting for information that arrived minutes ago.
            * Deliberately a thumbnail in a header the writer is already looking
            * at, and never a modal: this is a reveal, not an interruption to
            * somebody who is reading. */}
          <View style={styles.storyInfoCard}>
            {cover.coverImageUrl ? (
              <Image
                source={{ uri: cover.coverImageUrl }}
                style={styles.editorCoverThumb}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel="Your story's cover"
                testID="editor-cover-thumb"
              />
            ) : cover.coverStatus === "generating" ? (
              /* Still coming, and said so in words. Not a spinner sitting on
               * top of a picture that is not there: a spinner over an empty
               * box is a claim that something is nearly ready, and until the
               * watch answers, this screen does not know that. The line is
               * what the watch is for, and it now keeps running while the
               * writer continues the story rather than stopping the moment
               * they do. */
              <View style={styles.editorCoverStatusRow} testID="editor-cover-pending">
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.editorCoverStatusText}>
                  Painting chapter one&apos;s art. It will appear here.
                </Text>
              </View>
            ) : cover.coverStatus === "failed" ? (
              /* Failed is stated, never spun over. The concept card is a real
               * published look (§10.4), so this is information rather than an
               * error the writer has to clear. */
              <Text style={styles.editorCoverStatusText} testID="editor-cover-failed">
                The cover didn&apos;t come through. Your concept card goes out
                instead, or make another one at the next step.
              </Text>
            ) : null}
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
              {/* No "+ Add" chip here any more.
                *
                * It was a second door onto `handleContinueStory`, sitting at
                * the top of the screen where the reader has no opinion yet
                * about what happens next — so it bought a chapter without ever
                * showing them the "What happens next?" box that steers one.
                * Two controls for one paid action, one of which quietly
                * discards the only input that makes it personal, is the
                * duplication this removal is about: continuation is now
                * reached exactly once, at the end of the chapter, where the
                * direction is asked for first. The tabs stay, because
                * navigating between written chapters is a different act from
                * buying a new one. */}
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

          {/* End of chapter: say what happens next, then Continue.
            *
            * This sits at the foot of the chapter because that is where a
            * reader arrives with an opinion about where the story should go.
            * The tab-strip "+ Add" chip is the same action reached from the
            * top of the screen; both call `handleContinueStory`, so there is
            * one continuation path and one set of guards behind it.
            *
            * Only the last chapter gets it. Offering Continue while the reader
            * is back editing chapter 1 of 3 would append to the end of the
            * story from a position that does not look like the end.
            *
            * The copy below is literal English like the rest of this screen,
            * which has no `useTranslation` yet. Every string here already has
            * its EN/ES/PT key under `editor.whatHappensNext` so the screen-wide
            * i18n pass has nothing left to translate when it happens. */}
          {story
            && activeChapterIndex === story.chapters.length - 1
            && story.chapters.length < maxChapters && (
            <View style={styles.continueBlock}>
              <Text style={styles.continueHeading}>What happens next?</Text>
              <TextInput
                multiline
                value={nextInstruction}
                onChangeText={setNextInstruction}
                maxLength={MAX_NEXT_INSTRUCTION_CHARS}
                placeholder="Optional. Leave this blank and Katha decides."
                placeholderTextColor={colors.tertiary}
                style={styles.continueInput}
                accessibilityLabel="What happens next"
                accessibilityHint="Optional. Leave blank and Katha decides what the next chapter does."
                testID="next-instruction-input"
              />
              {/* The counter appears only in the last stretch before the cap.
                * A permanent countdown reads as a quota on a field most
                * readers should feel free to leave empty; it earns its place
                * once the next sentence is the one that gets truncated. */}
              {nextInstruction.length >= MAX_NEXT_INSTRUCTION_CHARS - 60 && (
                <Text style={styles.continueCounter}>
                  {MAX_NEXT_INSTRUCTION_CHARS - nextInstruction.length} characters left
                </Text>
              )}
              <Pressable
                onPress={() => handleContinueStory(false)}
                disabled={addingChapter}
                accessibilityRole="button"
                accessibilityState={{ disabled: addingChapter, busy: addingChapter }}
                accessibilityLabel={
                  addingChapter
                    ? "Writing the next chapter"
                    : `${continueLabel}, 1 credit`
                }
                style={[
                  styles.continueBtn,
                  addingChapter && styles.continueBtnBusy,
                ]}
                testID="continue-chapter-button"
              >
                <Text style={styles.continueBtnText}>
                  {addingChapter ? "Writing..." : `${continueLabel} · 1 credit`}
                </Text>
              </Pressable>
              <Text style={styles.continueNote}>
                Saying what happens next is free. The credit pays for the chapter.
              </Text>

              {/* Write the rest — the same loop, under program control.
                *
                * §10.2: "It is not a second mode — each chapter is still its
                * own request, its own reservation and its own credit." So it
                * sits under Continue rather than beside it, as the same action
                * repeated rather than a different way of writing.
                *
                * The note about "What happens next?" is not decoration. A
                * single typed direction aimed at one chapter must not silently
                * steer seven, and the alternative — spending it on the run's
                * first chapter only — makes one chapter of a program-driven
                * run behave differently from the rest with nothing on screen
                * to say which. So the run ignores the box, does not consume
                * it, and says so here. The reader's note is still there for
                * the next single Continue. */}
              {canOfferWriteTheRest && (
                <View style={styles.runOfferBlock}>
                  <Pressable
                    onPress={() => setRunConfirmOpen(true)}
                    disabled={addingChapter || activeRun !== null}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: addingChapter || activeRun !== null,
                    }}
                    accessibilityLabel={`Write the rest, ${runQuote.remaining} chapters, ${runQuote.total} credits`}
                    accessibilityHint="Shows what the whole run costs before anything is spent."
                    style={[
                      styles.runOfferBtn,
                      (addingChapter || activeRun !== null)
                        && styles.continueBtnBusy,
                    ]}
                    testID="write-the-rest-button"
                  >
                    <Text style={styles.runOfferBtnText}>
                      Write the rest · {runQuote.total} credits
                    </Text>
                  </Pressable>
                  <Text style={styles.continueNote}>
                    Chapters {chaptersWritten + 1} to {maxChapters}, one at a
                    time. Stop after any of them and you keep what it wrote.
                  </Text>
                  <Text style={styles.continueNote}>
                    Write the rest does not use What happens next? — that steers
                    one chapter. Your note stays here for the next Continue.
                  </Text>
                </View>
              )}

            </View>
          )}

          {/* What the last run did. Said once, here, rather than as an alert:
            * a Stop the writer chose is not an error to acknowledge.
            *
            * Outside the Continue block on purpose. That block hides itself
            * once the plan is full, and a run that wrote its way to the final
            * chapter — the ordinary successful ending, and the one that stops
            * on the last chapter of all — would then have nowhere to say what
            * it did. The notice belongs to the run, not to Continue, so it
            * renders whenever there is one. */}
          {runNotice && (
            <Text style={styles.runNotice} testID="write-the-rest-notice">
              {runNotice}
            </Text>
          )}
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
            accessibilityRole="button"
            accessibilityLabel="Review your story"
            testID="editor-review-button-bottom"
          >
            <Text style={styles.bottomPublishBtnText}>Review</Text>
            <ChevronRight size={16} color={colors.surface} />
          </Pressable>
        </View>

        {/* The itemised confirm.
          *
          * §10.2 requires "an itemised confirm stating text and art
          * separately" *before* a run starts, and this is the only place in
          * the flow that quotes a multi-credit total. Two things it must never
          * do: imply a price the pricing document does not set — the per
          * chapter line comes from `CHAPTER_TEXT_CREDITS`, not from a literal,
          * and there is no art line because nothing charges for chapter art
          * (see `runQuote`) — and start a run the balance cannot finish. A short balance is not a refusal: "you pay as
          * each chapter is written" means it buys what it reaches, and the
          * button then says exactly how many chapters that is. */}
        {runConfirmOpen && story && (
          <View style={styles.runSheetScrim} testID="write-the-rest-confirm">
            <Pressable
              style={styles.runSheetBackdrop}
              onPress={() => setRunConfirmOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close without starting a run"
            />
            <View
              style={styles.runSheet}
              accessibilityViewIsModal
              accessibilityRole="alert"
            >
              <Text style={styles.runSheetTitle}>Write the rest</Text>

              <View style={styles.runSheetRow}>
                <Text style={styles.runSheetLabel}>
                  Chapters {chaptersWritten + 1} to {maxChapters}
                </Text>
                <Text style={styles.runSheetValue}>
                  {runQuote.remaining === 1
                    ? "1 chapter"
                    : `${runQuote.remaining} chapters`}
                </Text>
              </View>
              <View style={styles.runSheetRow}>
                <Text style={styles.runSheetLabel}>
                  Chapter text · {CHAPTER_TEXT_CREDITS} credit each
                </Text>
                <Text style={styles.runSheetValue}>
                  {runQuote.textCredits} credits
                </Text>
              </View>
              <View style={[styles.runSheetRow, styles.runSheetTotalRow]}>
                <Text style={styles.runSheetTotalLabel}>Total</Text>
                <Text
                  style={styles.runSheetTotalValue}
                  testID="write-the-rest-total"
                >
                  {runQuote.total} credits
                </Text>
              </View>

              {credits < runQuote.total && (
                <Text
                  style={styles.runSheetShortfall}
                  testID="write-the-rest-shortfall"
                >
                  {runQuote.affordable > 0
                    ? `You have ${credits} credits and this run needs ${runQuote.total}. It will write ${runQuote.affordable} of the ${runQuote.remaining} chapters and stop there. You keep every chapter it writes.`
                    : `You have ${credits} credits, and one more chapter needs ${runQuote.perChapter}. Nothing has been spent.`}
                </Text>
              )}

              <Text style={styles.runSheetNote}>
                Each chapter is its own request and its own credit, charged as
                it is written. Stop after any of them and the rest costs
                nothing.
              </Text>
              <Text style={styles.runSheetNote}>
                What happens next? steers a single chapter, so a run does not
                use it. Your note is left where it is.
              </Text>

              {runQuote.affordable > 0 && (
                <Pressable
                  onPress={() => {
                    const chapters = runQuote.affordable;
                    setRunConfirmOpen(false);
                    startWriteTheRest(chapters);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Write ${runQuote.affordable} chapters for ${runQuote.affordable * runQuote.perChapter} credits`}
                  style={styles.runSheetConfirmBtn}
                  testID="write-the-rest-confirm-button"
                >
                  <Text style={styles.runSheetConfirmText}>
                    {runQuote.affordable === 1
                      ? "Write 1 chapter"
                      : `Write ${runQuote.affordable} chapters`}
                    {" · "}
                    {runQuote.affordable * runQuote.perChapter} credits
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setRunConfirmOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                style={styles.runSheetCancelBtn}
                testID="write-the-rest-cancel-button"
              >
                <Text style={styles.runSheetCancelText}>Not now</Text>
              </Pressable>
            </View>
          </View>
        )}

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

  // End-of-chapter continuation
  continueBlock: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  continueHeading: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 18,
  },
  continueInput: {
    minHeight: 76,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    textAlignVertical: "top",
  },
  continueCounter: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    textAlign: "right",
  },
  continueBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  continueBtnBusy: {
    opacity: 0.6,
  },
  continueBtnText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 15,
  },
  continueNote: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },

  // "Write the rest" — the run bar, the offer, the confirm.
  //
  // Every colour here is a token. The run bar deliberately uses `surface` on
  // `border` rather than the accent: it is a status strip that sits above prose
  // the reader is reading, and an accent band there competes with the text the
  // whole feature exists to deliver.
  runBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  runBarBody: {
    flex: 1,
    gap: 2,
  },
  runBarProgress: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 14,
  },
  runBarNote: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  runStopBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
  },
  runStopBtnBusy: {
    opacity: 0.6,
  },
  runStopBtnText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 14,
  },
  runOfferBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  runOfferBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  runOfferBtnText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 15,
  },
  // Sits on the scroll surface rather than inside the Continue card, so it
  // carries its own horizontal inset.
  runNotice: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
  },
  runSheetScrim: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  // The dim is its own layer rather than an alpha on the scrim, because
  // `opacity` on the container would take the sheet down with it. Same
  // treatment as `StoryActionsSheet`.
  runSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  runSheet: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  runSheetTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 20,
    marginBottom: spacing.xs,
  },
  runSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  runSheetLabel: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
  },
  runSheetValue: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "600",
  },
  runSheetTotalRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  runSheetTotalLabel: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  runSheetTotalValue: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  runSheetShortfall: {
    fontFamily: fonts.ui,
    // `heart` is the failure/attention colour every other line in this flow
    // uses. A short balance is not an error, but it is the one line here the
    // writer must not skim past.
    color: colors.heart,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  runSheetNote: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
    lineHeight: 18,
  },
  runSheetConfirmBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  runSheetConfirmText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 15,
  },
  runSheetCancelBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  runSheetCancelText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 14,
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

  // Cover controls (review step)
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
  coverErrorText: {
    fontFamily: fonts.ui,
    // `heart` is what every other failure line in the create flow uses
    // (StreamingProse, the portrait error, the credit warning). There is no
    // separate danger token and inventing one here would be design drift.
    color: colors.heart,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  regenerateBtnBusy: {
    opacity: 0.6,
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
    // Larger than the 64x88 it was. This is now the writer's confirmation of a
    // real image rather than a decorative chip beside a title, and at 64 wide a
    // generated cover is unjudgeable. The 3:4 ratio matches the card slot the
    // story will occupy on the shelf.
    width: 84,
    height: 116,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    overflow: "hidden",
  },
  reviewCoverMiniTitle: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 15,
  },
  reviewCoverConceptTag: {
    // The concept card says what it is. §10.4 makes keeping it a legitimate
    // published look, which is only a choice if the writer can tell it apart
    // from a generated cover that has not arrived.
    marginTop: spacing.xs,
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1,
    opacity: 0.75,
  },
  reviewCoverStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reviewCoverStatusText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    flexShrink: 1,
  },
  // The editor's cover row, in the two states where there is no image yet.
  // Sized to sit where the thumbnail sits, so the header does not jump when
  // the picture finally lands.
  editorCoverStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  editorCoverStatusText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginBottom: spacing.sm,
    flexShrink: 1,
  },
  editorCoverThumb: {
    // Small on purpose. This is a reveal inside a header the writer is already
    // looking at, not a hero: chapter 1's art arriving must not push the prose
    // they are editing down the screen.
    width: 44,
    height: 60,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
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
