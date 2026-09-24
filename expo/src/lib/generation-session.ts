/**
 * The generation session: one chapter being written, held outside React.
 *
 * Generation used to live in `CreateStudioScreen`'s component state, which
 * meant it lived exactly as long as that screen was mounted. The writer could
 * not press back, could not switch tabs, could not open the same story from
 * Library while it was being written, because any of those unmounted the
 * studio and the stream with it - and the credit had already been spent.
 *
 * So the stream, the prose it has delivered, and the rule that decides how
 * much of that prose a person may see all live here, in a module-level store
 * keyed by session. Screens subscribe. `CreateStudioScreen` starts a session
 * and hands the reader over; `ReaderScreen` overlays the chapter being written
 * onto the story it was given; `App` registers the finished story or chapter
 * into app state when the session completes, whoever started it and whether
 * or not that screen still exists.
 *
 * Two rules make "finished" mean something for what the reader is shown:
 *
 * 1. **Only whole paragraphs are settled.** The tail of the stream is always a
 *    half-written sentence, so everything after the last blank line is held
 *    back. A paragraph appears complete or not at all.
 * 2. **Only whole pages are shown.** The last page of the settled text is the
 *    one still filling up, so it is dropped too, and the cut is then pulled
 *    back to the nearest paragraph boundary. The *threshold* is measured in
 *    finished pages, and the *content* handed over is the whole paragraphs
 *    inside them. A page the reader is looking at can therefore never grow
 *    underneath them - the pages behind it can, which is the point.
 *
 * Both are prefix-stable: `paginateChapter` walks forward greedily from
 * character zero, so once page *k* has a boundary, more text arriving after it
 * cannot move that boundary. Page 1 is finished and fixed at the instant it is
 * revealed and stays that way for the rest of the generation.
 */

import { useSyncExternalStore } from "react";
import {
  continueStoryStreaming,
  createGenerationRequestId,
  fetchCoverState,
  generateStoryStreaming,
  GenerationRequestError,
  publishStory,
  type CoverState,
} from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import { clearDraft } from "@/lib/draft-storage";
import { isOwnStory } from "@/lib/ownership";
import { normalizeText } from "@/lib/paginate";
import { startReimagine, type RepromptRequest, type ReimagineRun } from "@/lib/reimagine-client";
import {
  CHAPTER_ART_CREDITS,
  CHAPTER_TEXT_CREDITS,
  STORY_START_CREDITS,
} from "@/lib/pricing-limits";
import { MAX_PLANNED_CHAPTER_COUNT } from "@/types/domain";
import type {
  AudienceMode,
  Chapter,
  CreateDraft,
  Genre,
  SpiceLevel,
  Story,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// The reveal rule
// ---------------------------------------------------------------------------

/**
 * A nominal phone page, deliberately not the real device viewport.
 *
 * The threshold is a claim about the chapter ("five of its ten pages exist"),
 * not about the handset, and measuring the real window would make the same
 * chapter reveal at a different point on a tablet than on a phone - and,
 * worse, reveal at a different point depending on whether the keyboard
 * happened to be up. 390x640 is the reference geometry this app is designed
 * against (`expo/CLAUDE.md`: 390x844) minus the chrome above and below the
 * prose. The typography is the reader's default, so a "page" here is the same
 * quantity of words the reader will actually get on a page.
 */
/**
 * The prose the reader may be shown, given everything received so far.
 *
 * TWO RULES, AND ONLY ONE OF THEM LIVES HERE.
 *
 * 1. Never mid-sentence. Everything after the last blank line is a paragraph
 *    still being written, so it is withheld. That is what stops the reveal
 *    from ever looking like a typewriter, and it is this function's whole
 *    job.
 *
 * 2. Never reflow a page the reader is looking at. That used to live here too,
 *    as `REVEAL_MIN_PAGES = 3`: the chapter stayed hidden until three
 *    NOMINAL pages had settled, measured against a guessed 390x640 viewport.
 *    It has moved to the reader, which is the only place that knows the real
 *    page geometry, and which now simply declines to draw the one page that
 *    can still grow.
 *
 * WHY THAT MATTERS. The guessed page held ~720 characters; the reader's real
 * first page holds ~324, because the chapter opener takes the top of it. So
 * the old rule withheld roughly 460 words to fill a page that shows 60 --
 * about seven times more than it needed -- and that wait, 16 to 29 seconds
 * after the first token, was the largest single component of the time before
 * anybody saw a word. It also did not actually deliver rule 2: the last page
 * absorbs a trailing remainder, so the page at the end of the revealed text
 * mutated as the chapter grew, three-page threshold or not.
 *
 * Returns whole settled paragraphs, and only ever grows.
 */
export function revealableChapterProse(raw: string): string {
  // Everything after the last blank line is a paragraph still being written.
  const lastBreak = raw.lastIndexOf("\n\n");
  if (lastBreak < 0) return "";
  return normalizeText(raw.slice(0, lastBreak));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type GenerationPhase = "writing" | "complete" | "error";

/**
 * What the reader is told when a generation stops after it had already been
 * handed pages.
 *
 * Every generation path in the backend refunds the credit before it answers, so
 * the one thing a writer actually wants to know at that moment is already
 * settled. The server's own message is a technical one - the right thing to log
 * and the wrong thing to put under half a chapter somebody is still reading.
 * This is the sentence the live reader shows instead, exported once so the
 * reader and its test cannot drift from each other.
 */
export const REFUND_NOTICE = "Katha stopped early. Your credit is back.";

/**
 * A `title` event as a session patch, dropping whatever it did not carry.
 *
 * The server names a chapter before it writes it, but a naming call that fails
 * simply omits the field, and a continuation is never sent a story title at
 * all. Spreading an absent name in as `undefined` would blank a title the
 * session already has -- a story would lose its own name when its fourth
 * chapter started. Only what actually arrived is applied.
 */
export function namePatch(
  names: { title?: string; chapterTitle?: string },
): Partial<GenerationSession> {
  const patch: { storyTitle?: string; chapterTitle?: string } = {};
  if (names.title?.trim()) patch.storyTitle = names.title.trim();
  if (names.chapterTitle?.trim()) patch.chapterTitle = names.chapterTitle.trim();
  return patch;
}

export type GenerationSession = {
  /**
   * Stable for the life of the session, across retries. A story session's
   * provisional `Story` carries this as its id until the server's own id
   * replaces it on completion, so a screen showing the story being written
   * keeps pointing at the same thing while the request id underneath changes.
   */
  readonly id: string;
  readonly kind: "story" | "chapter";
  /** The server's story id: known from the start for a chapter, from `meta` for a story. */
  readonly storyId: string | null;
  readonly chapterNumber: number;
  readonly standalone: boolean;
  /**
   * Null until known. The server names a chapter before it writes it, so both
   * of these normally arrive on the `title` event a few seconds in, ahead of
   * the first paragraph; a naming call that failed leaves them null until the
   * session completes, which is where they used to come from always.
   */
  readonly storyTitle: string | null;
  readonly chapterTitle: string | null;
  readonly genre: Genre;
  readonly language: string;
  readonly audienceMode: AudienceMode;
  readonly spiceLevel: SpiceLevel;
  /** The story's stored plan: 1..15, or absent. Not one of a fixed set. */
  readonly plannedChapterCount?: number;
  /**
   * What the brief asked for. A story session carries it because the client
   * still has to state it out loud after the chapter lands - see
   * `applyVisibility`.
   */
  readonly visibility: "private" | "public";
  readonly phase: GenerationPhase;
  /** The server's last reported pipeline stage: context, writing, shaping, art. */
  readonly stage: string;
  /** Whole paragraphs, whole pages, never the sentence being typed. */
  readonly revealedProse: string;
  readonly error: string | null;
  /** What this session charged, known on completion. */
  readonly creditsCharged: number;
  /** A completed story session's story. */
  readonly story: Story | null;
  /** The completed chapter: chapter one of a story session, or the continuation. */
  readonly chapter: Chapter | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /**
   * True for a Re-prompt: the chapter already on screen is being written
   * again. The reader covers it with the crafting screen until the first
   * settled page of the new version exists, where a continuation instead
   * opens straight onto its own (empty) opener.
   */
  readonly rewrite?: boolean;
};

export type StartStoryInput = {
  draft: CreateDraft;
  /** A title known before the server names the story (an onboarding blueprint). */
  provisionalTitle?: string | null;
};

export type StartChapterInput = {
  story: Story;
  nextChapterNumber: number;
  isFinale?: boolean;
  /** Trimmed by the caller; `undefined` means Katha decides. */
  direction?: string;
  /**
   * Every direction that was on the table, in ranked order.
   *
   * Sent whether or not one of them was picked here. In auto mode the SERVER
   * chooses among them -- the client's own ranking is a sort, not a choice --
   * and in both modes the offer is recorded against the chapter so the paths
   * that existed can be shown later. They cannot be reconstructed afterwards:
   * they were derived from a story state that has already moved on.
   */
  directionsOffered?: readonly { id: string; prompt: string }[];
  /**
   * Grow the story one chapter past its planned ending, and pay for it.
   *
   * Set only by a tap on a direction chip at the end of a story that has
   * reached its plan. `startAutoChapterAhead` never sets it and must never
   * learn how: auto-continue writes chapters with nobody watching, and a story
   * that could extend itself would spend a reader's balance on chapters they
   * never planned and never asked for.
   */
  extend?: boolean;
};

type Deferred = {
  promise: Promise<GenerationSession>;
  resolve: (session: GenerationSession) => void;
};

type SessionRecord = {
  session: GenerationSession;
  /** Everything received from the server so far, raw, mid-word tail and all. */
  raw: string;
  requestId: string;
  deferred: Deferred;
  start: () => void;
  /** The pending cover poll, so it can be cancelled rather than leaked. */
  coverTimer: ReturnType<typeof setTimeout> | null;
  /** How many times the cover has been asked about on this session. */
  coverAttempts: number;
};

const records = new Map<string, SessionRecord>();
const listeners = new Set<() => void>();
let snapshot: readonly GenerationSession[] = [];

/** Finished sessions older than this are forgotten when a new one starts. */
const RETENTION_MS = 30 * 60 * 1000;

function defer(): Deferred {
  let resolve: (session: GenerationSession) => void = () => {};
  const promise = new Promise<GenerationSession>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function publish(): void {
  snapshot = Array.from(records.values(), (record) => record.session);
  listeners.forEach((listener) => listener());
}

function update(id: string, patch: Partial<GenerationSession>): void {
  const record = records.get(id);
  if (!record) return;
  record.session = { ...record.session, ...patch };
  publish();
}

/**
 * Chapters an auto write-ahead has already tried and failed, by `story:number`.
 *
 * SEPARATE FROM `records` BECAUSE `records` IS SWEPT. `pruneFinished` drops any
 * session finished more than `RETENTION_MS` ago, and `hasGenerationForChapter`
 * -- the only thing standing between the auto chain and re-buying a chapter --
 * reads `records`. So a failed chapter became eligible again the moment its
 * session aged out: the writer starts something else, comes back half an hour
 * later, and the effect in `App` fires a fresh paid request for the chapter
 * that already failed, with no tap and nothing on screen having asked.
 *
 * "Retrying is a decision, and there is a button for it" is the rule the auto
 * path documents; this is what makes it true past thirty minutes. It is
 * deliberately not persisted: a new app session has no in-flight state to
 * protect and the reader can retry from the chapter end, which is a tap.
 */
const failedAutoChapters = new Set<string>();

function autoChapterKey(storyId: string, chapterNumber: number): string {
  return `${storyId}:${chapterNumber}`;
}

/**
 * Chapters whose pre-bought run the server has unwound, by story id.
 *
 * Holds the last chapter still paid for, so the write-ahead stops where the
 * server now says the run stops rather than where the client last heard it
 * did. Module state, like `failedAutoChapters`, and swept by the same reset:
 * a new app session re-reads the row from the shelf and does not need it.
 */
const loweredAutoRuns = new Map<string, number>();

/** The run ceiling the client should now believe, if the server lowered it. */
export function loweredAutoRunFor(storyId: string): number | undefined {
  return loweredAutoRuns.get(storyId);
}

/** Record that a failure unwound the run from `chapterNumber` onward. */
export function lowerAutoRunOnFailure(
  storyId: string,
  chapterNumber: number,
): void {
  const next = chapterNumber - 1;
  const held = loweredAutoRuns.get(storyId);
  // Monotonic downward: two failures in one story must not raise it back.
  if (held === undefined || next < held) loweredAutoRuns.set(storyId, next);
}

/** Remember a failed chapter for longer than its session survives. */
export function markAutoChapterFailed(
  storyId: string,
  chapterNumber: number,
): void {
  failedAutoChapters.add(autoChapterKey(storyId, chapterNumber));
}

/** Forget it, so a deliberate retry is allowed to run. */
export function clearAutoChapterFailure(
  storyId: string,
  chapterNumber: number,
): void {
  failedAutoChapters.delete(autoChapterKey(storyId, chapterNumber));
}

function pruneFinished(now: number): void {
  for (const [id, record] of records) {
    const { finishedAt } = record.session;
    if (finishedAt !== null && now - finishedAt > RETENTION_MS) {
      stopCoverPoll(record);
      records.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// The cover, after the prose
// ---------------------------------------------------------------------------

/**
 * A story's cover is painted AFTER its chapter is answered, on a background
 * task the client never sees finish. The row goes `generating` -> `ready`
 * tens of seconds later, and nothing pushes that transition down to the app.
 *
 * So the client has to ask. It used to: `CreateStudioScreen` ran a poll loop,
 * and when generation moved out of that screen into this store the loop was
 * not moved with it. The result was a cover that existed in the bucket, served
 * over HTTP 200, and was invisible in the app until a full reload refetched
 * the row - a freshly written story showed its genre-gradient placeholder
 * forever, in the feed, on the story page and in the library at once.
 *
 * The poll lives here rather than in a screen for the same reason the stream
 * does: it must outlive whichever screen happened to start it, and its answer
 * has to reach every subscriber at once. Writing the state back onto the
 * session's `story` is what does that - `App` upserts the session's story into
 * `generatedStories` on every publish, so one `update()` here repaints the
 * Home rail, the story page and the library together.
 *
 * NOTHING VISIBLE CHANGES WHILE IT RUNS. There is no spinner and no "Painting"
 * copy anywhere: the placeholder rule is the genre gradient and silence, and
 * the art fades in over `motion.base` when the URL lands.
 */

/** Wait before the first ask. The art is never ready the instant the prose is. */
export const COVER_POLL_FIRST_DELAY_MS = 4000;
/** Each wait is this much longer than the last. */
const COVER_POLL_BACKOFF = 1.45;
/** However long the backoff runs, never wait longer than this between asks. */
const COVER_POLL_MAX_DELAY_MS = 20000;
/**
 * How many times to ask before giving up.
 *
 * Twelve asks under the backoff above spans a little over two minutes, which
 * comfortably covers a cover that is merely slow. A cover that has not landed
 * by then is not landing on this app session, and the honest thing is to stop:
 * the placeholder is a finished design, not a failure state, and the row is
 * re-read from the database on the next launch anyway.
 */
export const COVER_POLL_MAX_ATTEMPTS = 12;

/** A cover that has settled, either way, is nothing left to ask about. */
function coverIsSettled(status: CoverState["coverStatus"] | undefined): boolean {
  return status === "ready" || status === "failed";
}

function stopCoverPoll(record: SessionRecord): void {
  if (record.coverTimer === null) return;
  clearTimeout(record.coverTimer);
  record.coverTimer = null;
}

/** Put a fetched cover state onto the session's story, if it changed anything. */
function applyCoverState(record: SessionRecord, state: CoverState): void {
  const { story } = record.session;
  if (!story) return;
  const coverImageUrl = state.coverImageUrl ?? story.coverImageUrl;
  if (
    story.coverStatus === state.coverStatus
    && story.coverImageUrl === coverImageUrl
  ) {
    return;
  }
  update(record.session.id, {
    story: {
      ...story,
      coverImageUrl,
      coverStatus: state.coverStatus,
      coverRegenCount: state.coverRegenCount,
    },
  });
}

/**
 * Ask about this story's cover until it settles, the attempts run out, or the
 * session is forgotten. Safe to call twice: the second call cancels the first.
 */
function startCoverPoll(record: SessionRecord, storyId: string): void {
  stopCoverPoll(record);
  // Offline there is nobody to ask - `fetchCoverState` answers `null` for
  // every call - so scheduling a dozen timers would only be a way to keep a
  // test runner awake.
  if (!isSupabaseConfigured) return;
  if (coverIsSettled(record.session.story?.coverStatus)) return;
  record.coverAttempts = 0;

  const schedule = () => {
    if (record.coverAttempts >= COVER_POLL_MAX_ATTEMPTS) return;
    const delay = Math.min(
      COVER_POLL_MAX_DELAY_MS,
      Math.round(
        COVER_POLL_FIRST_DELAY_MS * COVER_POLL_BACKOFF ** record.coverAttempts,
      ),
    );
    record.coverTimer = setTimeout(ask, delay);
  };

  const ask = () => {
    record.coverTimer = null;
    record.coverAttempts += 1;
    void fetchCoverState(storyId)
      .then((state) => {
        // Dismissed, pruned or restarted while the request was in flight.
        if (records.get(record.session.id) !== record) return;
        if (state) applyCoverState(record, state);
        if (state && coverIsSettled(state.coverStatus)) return;
        schedule();
      })
      // A null answer and a thrown one mean the same thing here - this ask
      // learned nothing - and neither is worth surfacing to the writer, who
      // did not request a cover status and is looking at a finished story.
      .catch(() => {
        if (records.get(record.session.id) !== record) return;
        schedule();
      });
  };

  schedule();
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Please try again.";
}

/**
 * Take one chunk off the wire and decide whether it changed what is visible.
 *
 * The length comparison is what keeps this cheap: `revealableChapterProse`
 * re-paginates, but the result only changes when a whole new page has settled,
 * so subscribers re-render a handful of times per chapter instead of once per
 * token.
 */
function acceptChunk(record: SessionRecord, chunk: string): void {
  record.raw += chunk;
  const next = revealableChapterProse(record.raw);
  if (next.length === record.session.revealedProse.length) return;
  update(record.session.id, { revealedProse: next });
}

function beginRun(record: SessionRecord): void {
  // A retry throws away the story the last run produced, so the poll that was
  // watching that story's cover has nothing left to write onto.
  stopCoverPoll(record);
  record.raw = "";
  record.deferred = defer();
  update(record.session.id, {
    phase: "writing",
    stage: "context",
    revealedProse: "",
    error: null,
    finishedAt: null,
  });
}

function settle(record: SessionRecord, patch: Partial<GenerationSession>): void {
  update(record.session.id, { ...patch, finishedAt: Date.now() });
  record.deferred.resolve(record.session);
}

/**
 * Say the story's visibility out loud, after the chapter exists.
 *
 * Publishing used to be a screen: the writer finished generating, landed in an
 * editor, pressed Done, reviewed a cover and pressed Publish, and only then did
 * `publish-story` hear the word "public". The review step is gone, so the
 * toggle in the brief is the whole decision - which means the call it used to
 * trigger happens here, unattended, the moment the chapter is written.
 *
 * It runs AFTER `settle` and never blocks it: the reader is already looking at
 * their finished chapter, and making the chrome wait on a second round trip
 * would charge them for a call they did not ask for. A private story skips it
 * entirely - private is what the row already is.
 *
 * There is no content refusal to surface here any more. Until 2026-09-18 a
 * story naming a real person came back "kept private" and the writer was
 * shown why; that entity gate was removed (migration 00091), so the writer's
 * toggle is honoured and a failure below is only ever transport.
 */
function applyVisibility(record: SessionRecord, storyId: string): void {
  if (record.session.visibility !== "public") return;
  publishStory(storyId, { visibility: "public" })
    .then(() => update(record.session.id, { visibility: "public" }))
    .catch((error: unknown) => {
      // A failure is a transport failure on a call the writer did not
      // initiate. The story exists and is theirs; it is simply still private.
      console.warn("Could not make the story public:", error);
    });
}

function fail(record: SessionRecord, error: unknown): void {
  // A failure that reset the reservation must not be retried under the same
  // id: the server would answer the replay with the failure it already gave.
  if (error instanceof GenerationRequestError && error.resetRequestId) {
    record.requestId = createGenerationRequestId();
  }
  // A chapter that failed is remembered past its session's lifetime, so the
  // auto write-ahead cannot quietly buy it again once `pruneFinished` has swept
  // the record. `retryGeneration` clears it, because a retry is a decision.
  const { kind, storyId, chapterNumber } = record.session;
  if (kind === "chapter" && storyId) {
    markAutoChapterFailed(storyId, chapterNumber);
    /*
      THE SERVER JUST UNWOUND THE REST OF THE RUN; SAY SO LOCALLY.

      `refundAutoChapterRun` refunds every still-reserved chapter from the
      failed one onward and lowers `stories.auto_run_through_chapter` to
      `chapter - 1`. The continuation's response carries neither the new value
      nor what it refunded, and nothing else re-reads the row until a shelf
      fetch -- so a client that kept believing in the old run would go on
      treating those chapters as prepaid and write them with no balance check
      at all, against a run that no longer exists.

      Mirrored here rather than waited for, because the wait is unbounded: the
      reader may never leave the story, and the next thing they do is reach the
      end of a chapter.
    */
    lowerAutoRunOnFailure(storyId, chapterNumber);
  }
  settle(record, { phase: "error", error: failureMessage(error) });
}

/**
 * Start writing a story. Returns the session synchronously; the stream runs
 * in the background and every screen that subscribes sees it progress.
 */
export function startStoryGeneration(input: StartStoryInput): GenerationSession {
  const now = Date.now();
  pruneFinished(now);
  const id = createGenerationRequestId();
  const { draft } = input;
  const record: SessionRecord = {
    session: {
      id,
      kind: "story",
      storyId: null,
      chapterNumber: 1,
      standalone: draft.isSeries === false,
      storyTitle: input.provisionalTitle?.trim() || null,
      chapterTitle: null,
      genre: draft.primaryGenre,
      language: draft.language,
      audienceMode: draft.audienceMode,
      spiceLevel: draft.spiceLevel,
      plannedChapterCount: draft.plannedChapterCount,
      visibility: draft.visibility === "public" ? "public" : "private",
      phase: "writing",
      stage: "context",
      revealedProse: "",
      error: null,
      creditsCharged: 0,
      story: null,
      chapter: null,
      startedAt: now,
      finishedAt: null,
    },
    raw: "",
    requestId: createGenerationRequestId(),
    deferred: defer(),
    start: () => {},
    coverTimer: null,
    coverAttempts: 0,
  };
  record.start = () => {
    beginRun(record);
    generateStoryStreaming(draft, record.requestId, {
      onMeta: ({ storyId }) => {
        if (storyId) update(id, { storyId });
      },
      onStage: (stage) => update(id, { stage }),
      onTitle: (names) => update(id, namePatch(names)),
      onDelta: (chunk) => acceptChunk(record, chunk),
    }).then((story) => {
      // The brief is spent. Clearing it here rather than in the studio means
      // it is cleared whether or not the studio is still on screen.
      void clearDraft();
      const chapter = story.chapters[0] ?? null;
      settle(record, {
        phase: "complete",
        stage: "done",
        storyId: story.id,
        storyTitle: story.title,
        chapterTitle: chapter?.title ?? null,
        story,
        chapter,
        creditsCharged: storyStartCost(story),
      });
      applyVisibility(record, story.id);
      // The chapter is persisted; the art is not. Start asking.
      startCoverPoll(record, story.id);
    }).catch((error) => fail(record, error));
  };
  records.set(id, record);
  record.start();
  return record.session;
}

/**
 * What one continuation of this story actually costs.
 *
 * Since migration 00077 a chapter is one credit for its text and a second for
 * its art when the story illustrates its chapters. Every caller that quoted a
 * flat `CHAPTER_TEXT_CREDITS` was therefore under-reporting by one per chapter
 * for illustrated stories, and the client's running balance drifted upward:
 * `App` derives the balance by subtracting `creditsCharged`, and nothing in the
 * `done` payload re-syncs it. On an illustrated auto story the drift is one
 * credit per chapter, so the write-ahead's balance gate -- which documents
 * itself as exact rather than optimistic -- eventually passed on a balance the
 * server did not have and fired a request it had been built never to fire.
 *
 * KNOWN RESIDUAL DRIFT, IN THE SAFE DIRECTION. This charges what was RESERVED.
 * If the background art then fails, the server refunds one credit
 * (`refund_story_media_component('chapter_art')`) and the client never hears
 * about it -- the balance stays one too low until the next `bootstrapUser`.
 *
 * Left deliberately, because the two directions are not equally bad. Too LOW
 * only makes the app more conservative than it needs to be: the write-ahead
 * stops a chapter early, the paywall appears early, the finish card hides. Too
 * HIGH sends a request the server refuses and hangs a failure off the end of a
 * story someone was enjoying -- the bug this comment opens with. The real fix
 * is for the continuation's `done` payload to carry the authoritative balance,
 * which the RPC already computes, so the client stops deriving a number it can
 * only ever approximate. That is a server change and not this commit's.
 */
function chapterCost(story: Pick<Story, "illustrateChapters">): number {
  return CHAPTER_TEXT_CREDITS +
    (story.illustrateChapters ? CHAPTER_ART_CREDITS : 0);
}

/**
 * What a finished story start actually took: the start credit, plus the whole
 * auto run bought with it.
 *
 * `App` derives the running balance by subtracting `creditsCharged`, so a
 * start that reported only `STORY_START_CREDITS` would leave the app believing
 * the writer still holds every credit the run just spent -- up to fourteen
 * chapters' worth, on the one screen where they are deciding whether to write
 * another story. Too high is the dangerous direction: it is what sends a
 * request the server refuses.
 *
 * Derived rather than sent, because it is derivable exactly: the run bought
 * chapters two through `autoRunThroughChapter` at the same per-chapter price
 * `chapterCost` already knows, which is the arithmetic
 * `reserve_auto_chapter_run` performed. A story with no run contributes
 * nothing, which is every interactive story.
 */
function storyStartCost(story: Story): number {
  const paidThrough = story.autoRunThroughChapter;
  const runChapters = typeof paidThrough === "number"
    ? Math.max(0, paidThrough - 1)
    : 0;
  return STORY_START_CREDITS + runChapters * chapterCost(story);
}

/**
 * What THIS chapter takes off the balance now, which for a pre-bought chapter
 * is nothing.
 *
 * An auto run's chapters were paid for when the story started, and
 * `reserve_generation_operation` claims the reservation rather than making a
 * second one. Reporting the price again here would subtract it twice from the
 * app's running balance and walk the displayed number down to zero over a run
 * the writer paid for once.
 */
export function chapterChargeNow(
  story: Story,
  chapterNumber: number,
): number {
  /*
    A REFUNDED RUN IS NOT A PAID ONE, and the story row on this client still
    says it is. When a chapter fails the server refunds the rest of the run and
    lowers `auto_run_through_chapter`; the retry of that chapter is then charged
    normally. Reading only the stale row, the retry reported zero and the app's
    balance drifted UP by a credit that had really been spent -- the direction
    that eventually fires a request the server refuses.

    `loweredAutoRunFor` is what this client learned when the failure happened,
    so the lower of the two is the run that is actually still paid for.
  */
  const stored = story.autoRunThroughChapter;
  const lowered = loweredAutoRunFor(story.id);
  const paidThrough = typeof stored === "number"
    ? (lowered === undefined ? stored : Math.min(stored, lowered))
    : lowered;
  if (typeof paidThrough === "number" && chapterNumber <= paidThrough) return 0;
  return chapterCost(story);
}

/** Start writing the next chapter of a story that already exists. */
export function startChapterGeneration(input: StartChapterInput): GenerationSession {
  const now = Date.now();
  pruneFinished(now);
  const id = createGenerationRequestId();
  const {
    story,
    nextChapterNumber,
    isFinale = false,
    direction,
    directionsOffered,
    extend = false,
  } = input;
  const record: SessionRecord = {
    session: {
      id,
      kind: "chapter",
      storyId: story.id,
      chapterNumber: nextChapterNumber,
      standalone: story.storyMode === "standalone",
      storyTitle: story.title,
      chapterTitle: null,
      genre: story.genre,
      language: story.language,
      audienceMode: story.audienceMode ?? "adult",
      spiceLevel: story.spiceLevel ?? "sweet",
      plannedChapterCount: story.plannedChapterCount,
      // A continuation never re-decides visibility; it inherits what the story
      // already is, and `applyVisibility` is not called for it at all.
      visibility: story.visibility === "public" ? "public" : "private",
      phase: "writing",
      stage: "context",
      revealedProse: "",
      error: null,
      creditsCharged: 0,
      story: null,
      chapter: null,
      startedAt: now,
      finishedAt: null,
    },
    raw: "",
    requestId: createGenerationRequestId(),
    deferred: defer(),
    start: () => {},
    coverTimer: null,
    coverAttempts: 0,
  };
  record.start = () => {
    beginRun(record);
    continueStoryStreaming(
      story.id,
      record.requestId,
      {
        onStage: (stage) => update(id, { stage }),
        onTitle: (names) => update(id, namePatch(names)),
        onDelta: (chunk) => acceptChunk(record, chunk),
      },
      isFinale,
      nextChapterNumber,
      direction,
      directionsOffered,
      extend,
    ).then(({ chapter }) => {
      settle(record, {
        phase: "complete",
        stage: "done",
        chapterTitle: chapter.title,
        chapter,
        creditsCharged: chapterChargeNow(story, nextChapterNumber),
      });
    }).catch((error) => fail(record, error));
  };
  records.set(id, record);
  record.start();
  return record.session;
}

/**
 * Adopt a Reimagine rewrite into the live reader, so it reveals like any other
 * chapter.
 *
 * The product rule is that every chapter behaves the same way -- a first
 * chapter, a continuation and a rewrite all appear page by page as they settle.
 * A rewrite arrives on its own run object rather than through
 * `continueStoryStreaming`, so without this it would have to be waited out
 * behind a cover, which is the one presentation the rule exists to prevent.
 *
 * The run reports its prose CUMULATIVELY (`run.text` is everything so far)
 * while `acceptChunk` expects the delta, so the difference is taken here. That
 * is also why this cannot simply forward `onDelta`: a listener fires on stage
 * and status changes too, and re-adding the whole buffer on a stage change
 * would duplicate the chapter.
 *
 * The session is keyed to the chapter being rewritten, not to a new one, so
 * the reader stays where it is and the pages are replaced underneath it.
 */
/**
 * The private copy a reader's rewrite landed in, as the app should hold it.
 *
 * The server forked the whole story and rewrote one chapter of the copy; the
 * client already has the source in full, so the copy is the source with the
 * new identity, the rewritten chapter swapped in, and the counters that belong
 * to the ORIGINAL left behind -- a copy nobody has read has no reads, and it
 * is private whatever the story it came from was.
 */
export function forkOf(
  source: Story,
  forkId: string,
  rewritten: Chapter,
): Story {
  const at = source.chapters.findIndex(
    (item) => item.chapterNumber === rewritten.chapterNumber,
  );
  const chapters = at < 0
    ? [...source.chapters, rewritten]
    : source.chapters.map((item, index) => (index === at ? rewritten : item));
  return {
    ...source,
    id: forkId,
    forkedFromStoryId: source.id,
    visibility: "private",
    chapters,
    likes: 0,
    bookmarks: 0,
    views: 0,
    isFeatured: false,
    isPublic: false,
    viewerHasLiked: false,
    viewerHasBookmarked: false,
  };
}

export function adoptReimagineGeneration(input: {
  run: ReimagineRun;
  story: Story;
  /**
   * Defaults to the chapter the run was asked to rewrite. Hosts should not
   * pass their own: App once passed the chapter the reader was OPENED at,
   * so re-prompting chapter 3 blanked chapter 1.
   */
  chapterNumber?: number;
  /** How a retry starts a fresh run. Injected by tests; `startReimagine` otherwise. */
  restart?: (request: RepromptRequest) => ReimagineRun;
}): GenerationSession {
  const { run, story, restart = startReimagine } = input;
  const chapterNumber = input.chapterNumber ?? run.request.chapterNumber;
  const now = Date.now();
  pruneFinished(now);
  const id = createGenerationRequestId();
  const record: SessionRecord = {
    session: {
      id,
      kind: "chapter",
      storyId: story.id,
      chapterNumber,
      standalone: story.storyMode === "standalone",
      storyTitle: story.title,
      chapterTitle: null,
      genre: story.genre,
      language: story.language,
      audienceMode: story.audienceMode ?? "adult",
      spiceLevel: story.spiceLevel ?? "sweet",
      plannedChapterCount: story.plannedChapterCount,
      // A rewrite never re-decides visibility, exactly like a continuation.
      visibility: story.visibility === "public" ? "public" : "private",
      phase: "writing",
      stage: "context",
      revealedProse: "",
      error: null,
      creditsCharged: 0,
      story: null,
      chapter: null,
      startedAt: now,
      finishedAt: null,
      rewrite: true,
    },
    raw: "",
    requestId: createGenerationRequestId(),
    deferred: defer(),
    // Replaced below, once `follow` exists.
    start: () => {},
    coverTimer: null,
    coverAttempts: 0,
  };
  records.set(id, record);
  // Published now, not on the run's first event. Nothing else here publishes
  // until prose or a stage change arrives, so the session was invisible to
  // every subscriber for the first seconds of the rewrite: the reader went on
  // showing the old chapter with no loader, then dropped to a blank page.
  publish();

  /*
    A retry is a NEW run, not a replay. `startReimagine` mints a fresh request
    id, and the server refunded the failed operation, so this is one charge
    for one rewrite -- the same as re-submitting the sheet. It used to be a
    no-op (`start: () => {}`), and because a host takes the run before the
    reader wires its own failure branch, a failed rewrite left the reader on
    an empty chapter with a Retry that did nothing and no way back to the sheet.
  */
  let current = run;
  const follow = (active: ReimagineRun) => {
    current = active;
    let seen = 0;
    const unsubscribe = active.subscribe(() => {
      if (current !== active) return;
      if (active.stage && active.stage !== record.session.stage) {
        update(id, { stage: active.stage });
      }
      if (active.text.length > seen) {
        const chunk = active.text.slice(seen);
        seen = active.text.length;
        acceptChunk(record, chunk);
      }
    });

    active.promise.then(
      (result) => {
        unsubscribe();
        if (current !== active) return;
        settle(record, {
          phase: "complete",
          stage: "done",
          chapterTitle: result.chapter.title,
          chapter: result.chapter,
          creditsCharged: CHAPTER_TEXT_CREDITS,
          // A READER WHO IS NOT THE AUTHOR GETS A PRIVATE COPY, AND THE SESSION
          // HAS TO SAY SO. The server writes the rewrite into a fork and returns
          // its id; the session was keyed to the SOURCE story, so app state
          // looked for the rewritten chapter on a story that does not have it,
          // found chapter 3 already there, and dropped the result on the floor.
          // The copy the reader now owns was invisible: not in their library,
          // never opened, and charged for.
          storyId: result.storyId,
          story: result.forked && result.storyId !== story.id
            ? forkOf(story, result.storyId, result.chapter)
            : null,
        });
      },
      (error: unknown) => {
        unsubscribe();
        if (current !== active) return;
        fail(record, error);
      },
    );
  };
  record.start = () => {
    beginRun(record);
    follow(restart(current.request));
  };
  follow(run);

  return record.session;
}

/** Run a failed session again, in place. The reader keeps looking at the same session. */
export function retryGeneration(id: string): void {
  const record = records.get(id);
  if (!record || record.session.phase === "writing") return;
  // A retry is the decision the durable failure guard was holding out for, so
  // it is lifted here. Without this the retry would run once and the chapter
  // would stay permanently barred from the auto chain for the session.
  const { kind, storyId, chapterNumber } = record.session;
  if (kind === "chapter" && storyId) {
    clearAutoChapterFailure(storyId, chapterNumber);
  }
  record.start();
}

/** Forget a session. Used when the reader leaves a failed generation behind. */
export function dismissGeneration(id: string): void {
  const record = records.get(id);
  if (!record) return;
  stopCoverPoll(record);
  records.delete(id);
  publish();
}

export function getGeneration(id: string): GenerationSession | null {
  return records.get(id)?.session ?? null;
}

/**
 * The newest session that belongs to a story, by the server's id or by the
 * session's own id (which is what a provisional story is keyed by).
 */
/**
 * Has this story's chapter N already been asked for, in any state?
 *
 * Exists for auto-continue, and it exists because a `useRef` could not do the
 * job. The chapter-end module is mounted only while the reader is physically on
 * the last page, so leaving that page and coming back is an unmount and a
 * remount and a brand-new ref -- and in auto mode the effect behind that ref
 * SPENDS A CREDIT. A reader who opened the chapter list, went back to chapter
 * N and paged to its end fired a second request for chapter N+1 with a fresh
 * request id, which the server correctly refused as a duplicate reservation
 * (KTH01/409) and which the client then followed as the newest session for the
 * story -- showing a failure tail and a Retry button over a chapter that was
 * being written successfully the whole time.
 *
 * Every phase counts, `error` included. A failed attempt must not silently
 * re-fire on the next remount either; retrying is a decision, and there is a
 * button for it.
 *
 * Records are pruned on a timer, so this is a guard against the tight loop it
 * describes, not a permanent ledger. The durable guard is the server's own
 * reservation.
 */
export function hasGenerationForChapter(
  storyId: string,
  chapterNumber: number,
): boolean {
  for (const record of records.values()) {
    const { session } = record;
    if (session.kind !== "chapter") continue;
    if (session.storyId !== storyId) continue;
    if (session.chapterNumber === chapterNumber) return true;
  }
  return false;
}

/**
 * The newest session writing this story's chapter N, whoever started it.
 *
 * Differs from {@link hasGenerationForChapter} in the two ways the auto-ahead
 * path needs. It returns the session rather than a boolean, so a caller can
 * tell "being written" from "failed" -- copy that says a chapter is on its way
 * over a request that was refused is the exact lie this feature must not tell.
 * And it counts a STORY session too: chapter one is written by one, so a lookup
 * that filtered them out would report the opening chapter as unwritten while it
 * was streaming. A story session is matched on its own id as well, because that
 * is what its provisional `Story` is keyed by until the server's id lands.
 */
export function generationForChapter(
  storyId: string,
  chapterNumber: number,
): GenerationSession | null {
  let found: GenerationSession | null = null;
  for (const record of records.values()) {
    const { session } = record;
    if (session.chapterNumber !== chapterNumber) continue;
    if (session.storyId !== storyId && session.id !== storyId) continue;
    if (!found || session.startedAt >= found.startedAt) found = session;
  }
  return found;
}

/** Is anything at all being written into this story right now? */
function storyIsBeingWritten(storyId: string): boolean {
  for (const record of records.values()) {
    const { session } = record;
    if (session.phase !== "writing") continue;
    if (session.storyId === storyId || session.id === storyId) return true;
  }
  return false;
}

/**
 * What `continue-story` falls back to when a story has no usable
 * `planned_chapter_count`. Kept in step with the backend deliberately: the
 * server resolves an unrecognised count to 3 and refuses anything past it, so a
 * client that assumes more offers -- and in auto mode silently BUYS -- a chapter
 * the backend has already decided against.
 */
export const DEFAULT_PLANNED_CHAPTER_COUNT = 3;

/**
 * The plan this story actually runs to.
 *
 * A RANGE CHECK, not a membership test. Extending a finished story raises the
 * stored plan by one, so 2, 4 and 9 are ordinary values; the old version
 * matched `3 | 7 | 15` and resolved everything else to 3, which would have
 * told the author of a four-chapter story that it was complete at three and
 * refused them the chapter they had already paid for.
 */
export function plannedChapterCountOf(
  story: Pick<Story, "plannedChapterCount">,
): number {
  const planned = story.plannedChapterCount;
  return typeof planned === "number" && Number.isInteger(planned) &&
      planned >= 1 && planned <= MAX_PLANNED_CHAPTER_COUNT
    ? planned
    : DEFAULT_PLANNED_CHAPTER_COUNT;
}

/**
 * Can this story be grown past its planned ending by the person reading it?
 *
 * Three conditions, and all three are load-bearing. It must be a SERIES -- a
 * standalone has no plan to raise and no chapter two, and its ending is a
 * rewrite. It must be below the CEILING, which is the same 15 the SQL check
 * enforces, because offering a chapter the server will refuse is the client
 * promising something the backend has already decided against. And the viewer
 * must OWN it: extending spends the viewer's credits on someone else's story.
 *
 * Deliberately says nothing about whether the story has reached its plan yet.
 * A story mid-plan simply has an ordinary next chapter; this answers what
 * happens when it runs out.
 */
export function canExtend(story: Story): boolean {
  if (story.storyMode !== "series") return false;
  if (!isOwnStory(story)) return false;
  return plannedChapterCountOf(story) < MAX_PLANNED_CHAPTER_COUNT;
}

// ---------------------------------------------------------------------------
// Auto-continue, written ahead of the reader
// ---------------------------------------------------------------------------

/**
 * The chapter to start now so the reader never waits for it, or null.
 *
 * WHAT THIS IS FOR. A continuation's first token lands 7.0-7.9 seconds after
 * the request -- roughly twice chapter one's 4.0s, because the prompt carries
 * the previous chapters verbatim, and chapter five carries four of them. In
 * auto mode nobody is being asked anything, so every second of that used to be
 * spent standing on the last page of chapter N reading "Chapter N+1 is being
 * written". Started the moment chapter N is persisted instead, the same wait
 * runs underneath a chapter the reader still has in front of them.
 *
 * INTERACTIVE MODE NEVER REACHES HERE, and that is the first line of the
 * function rather than an afterthought. There is nothing to speculate on before
 * the reader has picked a direction, and a guess would spend a credit on a
 * chapter they did not choose.
 *
 * `storyFlow` is read off the story ROW, not off the brief that created it: the
 * brief is a different session, and the server clamps a mode it does not
 * recognise to `interactive`.
 */
export function autoChapterToWriteAhead(
  story: Story,
  credits: number,
): number | null {
  if (story.storyFlow !== "auto") return null;
  /*
    `story_flow` rides on the story row, and public reads select it. Without
    this gate every reader who opened somebody else's public auto story would
    fire `continue-story` against a story they do not own -- with no tap, and
    charged to them. Nothing but which columns one edge function happens to
    select stands between that and production.
  */
  if (!isOwnStory(story)) return null;
  // A standalone has no chapter two. Its ending is Reimagine, not more prose.
  if (story.storyMode === "standalone") return null;

  const latest = story.chapters.reduce(
    (max, chapter) => Math.max(max, chapter.chapterNumber),
    0,
  );
  // Nothing persisted yet: there is no chapter to continue FROM, and the
  // prompt for chapter two is the text of chapter one.
  if (latest === 0) return null;

  const next = latest + 1;

  /*
    THE CHAIN RUNS TO THE PLAN OR TO THE RUN, WHICHEVER STOPS IT FIRST.

    Auto mode means the reader asked not to be interrupted, and a lookahead
    that stops one chapter ahead still leaves them waiting at every chapter
    after the first. So chapter N+1 landing starts N+2, and the story writes
    itself forward until the plan ends or the paid-for chapters do.

    WHAT CHANGED, AND WHY IT IS NOT THE BALANCE ANY MORE. This used to check
    the live balance before each chapter, which made the mode's promise
    conditional on nothing else spending a credit in the meantime -- audio, a
    portrait, a second device -- and let an auto story stop halfway through
    with no tap behind the stopping either. Since migration 00087 the whole run
    is bought at once when chapter one lands: `reserve_auto_chapter_run` works
    out how many of the remaining planned chapters the balance affords,
    reserves all of them in one transaction, and writes the last of them onto
    the story row. The chain now runs to that number.

    The consequence, stated plainly because it is the reason the alternative
    was considered: a fifteen-chapter auto story can consume the whole
    remaining balance while the reader is still inside chapter one, and now it
    does so at the START rather than a chapter at a time. That is what was
    asked for. What makes it defensible is that it only ever happens for
    `auto`, which is opt-in and never the default, that the reader is told the
    balance the run left them in the same response, and that a run which stops
    early hands the unused remainder back (`refund_auto_chapter_run`).
  */

  /*
    THE PLANNED ENDING IS AN ENDING, AND AUTO MODE NEVER EXTENDS PAST IT.

    A reader at a finished story's end can now grow it a chapter at a time by
    tapping a direction chip, which raises `planned_chapter_count` and charges
    for the chapter. This path must never do that, and the rule is not a
    performance or a correctness one -- it is money. Auto-continue fires with
    nobody watching and no tap behind it, so a story that could extend itself
    would walk a reader's balance to zero on chapters past the plan they
    actually chose, and the first they would know of it is the number.

    So the chain stops here, exactly as it always has, and the reader extends
    by hand like anyone else. `startAutoChapterAhead` correspondingly never
    passes `extend`, and `continue-story` refuses an over-plan chapter that
    does not carry it.
  */
  if (next > plannedChapterCountOf(story)) return null;

  /*
    ONE CHAPTER AT A TIME, AND ONE REQUEST PER CHAPTER.

    The in-flight check is what sequences the whole feature: chapter N+1 may
    only start once chapter N has finished streaming and been persisted,
    because `continue-story` numbers the new chapter from what is stored and
    two concurrent runs would both claim the same number.

    `hasGenerationForChapter` is then the once-per-chapter guard, and it counts
    every phase including `error`. A duplicate request reserves the same
    chapter, is refused 409 (KTH01), and then becomes the newest session the
    reader follows -- showing a failure tail over a chapter that was being
    written successfully the whole time. A failed attempt does not silently
    re-fire either; retrying is a decision, and there is a button for it.
  */
  if (storyIsBeingWritten(story.id)) return null;
  if (hasGenerationForChapter(story.id, next)) return null;
  // Survives `pruneFinished`, which `hasGenerationForChapter` does not. See
  // `failedAutoChapters`: without this, a chapter that failed became eligible
  // to be bought again the moment its session aged out of the store.
  if (failedAutoChapters.has(autoChapterKey(story.id, next))) return null;

  /*
    A reader who cannot pay for this must never be put in front of copy saying
    their next chapter is on its way. The server answers 402 and refunds
    nothing because nothing was charged, but the client would already have said
    "Chapter N+1 is being written" -- and there is no tap here for them to
    regret, so the lie is entirely ours.

    THE PRE-BOUGHT RUN IS WHAT ANSWERS THAT NOW, and it answers it exactly:
    `autoRunThroughChapter` is the last chapter the server has already taken
    the credits for, so a chapter at or below it cannot be refused for money.
    A chapter past it has not been bought, and the chain stops rather than
    firing a request that would charge for a chapter nobody asked for -- auto
    mode buys once, at the start, and never again behind the reader's back.

    THE FALLBACK IS FOR STORIES OLDER THAN RUNS. `autoRunThroughChapter` is
    undefined on every story written before migration 00087, and on any row
    read from a surface whose column list predates it. Those stories keep the
    behaviour they were written under: the live balance, checked against the
    price of the chapter THIS ACTUALLY IS -- one credit for its text and a
    second when the story illustrates its chapters (00077). Checking the text
    credit alone would let the chain fire its last chapter with exactly one
    credit in hand, take a 402 for a two-credit reservation, and hang a failure
    off the end of a story the reader was enjoying.

    The balance the app holds can be stale either way, which is why
    `ChapterEnd` also reads the session's phase rather than its existence: a
    402 that gets through still renders as a failure and a retry, never as
    progress.
  */
  /*
    THE RUN IS A HARD STOP, NOT A CEILING WITH A FALLBACK.

    "Generate that many, then stop" is the product decision, so a chapter past
    the run is not written even when the balance would cover it. An auto story
    that has spent its run is finished until the reader asks for more.

    An earlier revision of this made the run a ceiling and fell back to the
    balance past it. That was wrong twice: it contradicted the decision, and it
    did not fix the problem it was written for -- a client holding a STALE run
    still believes the stale chapters are prepaid, so a balance check behind
    them never runs. The stale value is fixed where it is set (see
    `lowerAutoRunOnFailure`), not by second-guessing it here.
  */
  const lowered = loweredAutoRunFor(story.id);
  const stored = story.autoRunThroughChapter;
  // The lower of the two: a run the server has unwound is smaller than the one
  // the story row still carries on this client.
  const paidThrough = typeof stored === "number"
    ? (lowered === undefined ? stored : Math.min(stored, lowered))
    : lowered;
  if (typeof paidThrough === "number") {
    if (next > paidThrough) return null;
  } else if (credits < chapterCost(story)) {
    return null;
  }

  return next;
}

export type WriteAheadInput = {
  story: Story;
  /** The viewer's balance, as this client last knew it. */
  credits: number;
  /**
   * The directions to OFFER, resolved only if a chapter is actually going to
   * be written.
   *
   * A thunk because this runs again on every chunk the currently-streaming
   * chapter publishes, so deriving eagerly would be a few hundred wasted
   * passes per chapter.
   *
   * It returns the whole ranked list, not a winner. Auto mode's choice is the
   * SERVER's: `chooseDirection` reads how the last chapter actually ended and
   * picks the direction it earned, which a client-side sort cannot do -- the
   * plan beat outranks an open hook whatever the chapter just did. An empty
   * list is "Katha decides", the same thing the surprise-me path sends.
   */
  resolveDirections?: () => readonly { id: string; prompt: string }[];
};

/** Start the write-ahead chapter if {@link autoChapterToWriteAhead} allows one. */
export function startAutoChapterAhead(
  input: WriteAheadInput,
): GenerationSession | null {
  const { story, credits, resolveDirections } = input;
  const next = autoChapterToWriteAhead(story, credits);
  if (next === null) return null;
  return startChapterGeneration({
    story,
    nextChapterNumber: next,
    isFinale: next >= plannedChapterCountOf(story),
    // No `direction`: in auto mode the server chooses among the offer. Sending
    // one here would be the client deciding and the model rubber-stamping.
    directionsOffered: resolveDirections?.(),
  });
}

export function findStoryGeneration(storyId: string): GenerationSession | null {
  let found: GenerationSession | null = null;
  for (const record of records.values()) {
    const { session } = record;
    if (session.storyId !== storyId && session.id !== storyId) continue;
    if (!found || session.startedAt >= found.startedAt) found = session;
  }
  return found;
}

/**
 * The newest session of all, whatever its phase.
 *
 * This is how the Create studio finds its way back to a generation it started
 * before the writer switched tabs. The studio unmounts when they leave, so it
 * cannot hold the session id in state; on the way back it asks here, and the
 * live reader reopens on exactly the pages the writer left.
 */
export function latestGeneration(): GenerationSession | null {
  let found: GenerationSession | null = null;
  for (const record of records.values()) {
    if (!found || record.session.startedAt >= found.startedAt) {
      found = record.session;
    }
  }
  return found;
}

/** Resolves when the session leaves `writing`, with the session as it settled. */
export function waitForGeneration(id: string): Promise<GenerationSession> {
  const record = records.get(id);
  if (!record) return Promise.reject(new Error("No such generation session"));
  return record.deferred.promise;
}

export function subscribeGenerations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGenerationsSnapshot(): readonly GenerationSession[] {
  return snapshot;
}

export function useGenerations(): readonly GenerationSession[] {
  return useSyncExternalStore(
    subscribeGenerations,
    getGenerationsSnapshot,
    getGenerationsSnapshot,
  );
}

export function useGeneration(id: string | null): GenerationSession | null {
  const sessions = useGenerations();
  if (!id) return null;
  return sessions.find((session) => session.id === id) ?? null;
}

/**
 * The session writing one chapter, re-read on every publish.
 *
 * The chapter end asks this rather than calling `generationForChapter` in
 * render, because the answer CHANGES underneath a mounted component: a chapter
 * written ahead of the reader can fail while they are still three pages from
 * the end of the one before it, and a surface that read the store once would go
 * on saying it was being written.
 */
export function useChapterGeneration(
  storyId: string,
  chapterNumber: number,
): GenerationSession | null {
  useGenerations();
  return generationForChapter(storyId, chapterNumber);
}

export function useStoryGeneration(storyId: string): GenerationSession | null {
  // Subscribing through the snapshot keeps the lookup in step with every
  // publish; the search itself is cheap because only a handful of sessions
  // ever exist at once.
  useGenerations();
  return findStoryGeneration(storyId);
}

/** Test seam: forget every session. */
export function __resetGenerationSessions(): void {
  failedAutoChapters.clear();
  loweredAutoRuns.clear();
  for (const record of records.values()) stopCoverPoll(record);
  records.clear();
  publish();
}

// ---------------------------------------------------------------------------
// What a session looks like as story data
// ---------------------------------------------------------------------------

export function splitProseParagraphs(prose: string): string[] {
  return prose ? prose.split("\n\n") : [];
}

/**
 * The chapter a session is writing, as the reader can show it right now.
 *
 * The id is namespaced so nothing persistent - a phrase save, a comment - is
 * ever keyed against a chapter the server has not yet named.
 */
export function liveChapterFor(session: GenerationSession): Chapter {
  const completed = session.chapter;
  if (session.phase === "complete" && completed) return completed;
  return {
    id: `live:${session.id}`,
    storyId: session.storyId ?? session.id,
    title: session.chapterTitle ?? "",
    paragraphs: splitProseParagraphs(session.revealedProse),
    chapterNumber: session.chapterNumber,
    chapterRole: session.standalone
      ? "standalone"
      : session.chapterNumber === 1
      ? "series_opening"
      : "mid_series",
    isPublished: false,
  };
}

/**
 * A story session as a `Story`, before the server has finished writing it.
 *
 * Its id is the SESSION id, not the server's story id, and stays that way
 * until completion: the screen showing this story keeps pointing at the same
 * thing across a retry, and `App` swaps in the real story - real id and all -
 * the moment the session completes.
 */
export function provisionalStory(session: GenerationSession): Story | null {
  if (session.kind !== "story") return null;
  return {
    id: session.id,
    title: session.storyTitle ?? "",
    authorId: "me",
    genre: session.genre,
    primaryGenre: session.genre,
    storyMode: session.standalone ? "standalone" : "series",
    plannedChapterCount: session.plannedChapterCount,
    audienceMode: session.audienceMode,
    spiceLevel: session.spiceLevel,
    synopsis: "",
    chapters: [liveChapterFor(session)],
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: 0,
    isFeatured: false,
    language: session.language,
    visibility: session.visibility,
    coverStatus: "generating",
  };
}
