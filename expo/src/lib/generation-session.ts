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
  StoryGatedPrivateError,
  type CoverState,
  type StoryGatingReason,
} from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import { clearDraft } from "@/lib/draft-storage";
import { normalizeText, paginateChapter } from "@/lib/paginate";
import type { ReimagineRun } from "@/lib/reimagine-client";
import { CHAPTER_TEXT_CREDITS, STORY_START_CREDITS } from "@/lib/pricing-limits";
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
const REVEAL_PAGE_VIEWPORT = { width: 390, height: 640 };
const REVEAL_PAGE_TYPOGRAPHY = { fontSize: 18, lineHeight: 31 };

/**
 * How many finished pages must exist before the chapter is revealed.
 *
 * The product owner's illustration was "if a chapter is ten pages, they give
 * you the first five" - half the chapter, with the rest arriving behind you.
 * A series chapter is held to 600-900 words by `wordBandFor()` in the backend,
 * call it 3,300 to 5,000 characters, and at the geometry above a page holds
 * about 650 characters. So a chapter is five to eight pages, and "first five
 * of ten" is, in this product's units, three.
 *
 * Three is also the smallest number that keeps the promise for more than an
 * instant: the reader lands on page 1 with two more already written behind
 * it, so they can turn twice before they could possibly outrun the writer.
 *
 * The other half of the rule is "or the chapter is complete, whichever comes
 * first", and it needs no code here: a chapter too short to reach three pages
 * completes, and the completed session carries the server's own chapter.
 */
export const REVEAL_MIN_PAGES = 3;

/**
 * The prose the reader may be shown, given everything received so far.
 *
 * Returns `""` while the chapter is still below the threshold. Once non-empty
 * it only ever grows, and always by whole pages, so a caller can render it
 * directly without tracking whether a reveal has already happened.
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
  /** Null until known. A new story's title arrives only when it completes. */
  readonly storyTitle: string | null;
  readonly chapterTitle: string | null;
  readonly genre: Genre;
  readonly language: string;
  readonly audienceMode: AudienceMode;
  readonly spiceLevel: SpiceLevel;
  readonly plannedChapterCount?: 3 | 7 | 15;
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
  /**
   * Set when the server kept the story private because the idea names a
   * living public figure or a private individual. Populated once the
   * streaming `done` payload carries it; the reader shows the explanation once.
   */
  readonly gatedReason: StoryGatingReason | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
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
 * The one thing this can surface is the entity gate. A story naming a living
 * public figure, or somebody from the writer's own life, is refused publication
 * by `publish-story`, which answers `story_gated_private`. That is not an error
 * to retry, it is a fact about the story, so it lands on the session as
 * `gatedReason` and the writer is told once.
 */
function applyVisibility(record: SessionRecord, storyId: string): void {
  if (record.session.visibility !== "public") return;
  publishStory(storyId, { visibility: "public" })
    .then(() => update(record.session.id, { visibility: "public" }))
    .catch((error: unknown) => {
      if (error instanceof StoryGatedPrivateError) {
        update(record.session.id, {
          gatedReason: error.gatingReason,
          visibility: "private",
        });
        return;
      }
      // Anything else is a transport failure on a call the writer did not
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
      gatedReason: null,
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
        creditsCharged: STORY_START_CREDITS,
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

/** Start writing the next chapter of a story that already exists. */
export function startChapterGeneration(input: StartChapterInput): GenerationSession {
  const now = Date.now();
  pruneFinished(now);
  const id = createGenerationRequestId();
  const { story, nextChapterNumber, isFinale = false, direction } = input;
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
      gatedReason: null,
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
        onDelta: (chunk) => acceptChunk(record, chunk),
      },
      isFinale,
      nextChapterNumber,
      direction,
    ).then(({ chapter }) => {
      settle(record, {
        phase: "complete",
        stage: "done",
        chapterTitle: chapter.title,
        chapter,
        creditsCharged: CHAPTER_TEXT_CREDITS,
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
export function adoptReimagineGeneration(input: {
  run: ReimagineRun;
  story: Story;
  chapterNumber: number;
}): GenerationSession {
  const { run, story, chapterNumber } = input;
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
      gatedReason: null,
      startedAt: now,
      finishedAt: null,
    },
    raw: "",
    requestId: createGenerationRequestId(),
    deferred: defer(),
    // Not restartable in place: the run is already away and retrying it would
    // be a second charge. A failed rewrite is retried from the sheet.
    start: () => {},
    coverTimer: null,
    coverAttempts: 0,
  };
  records.set(id, record);

  let seen = 0;
  const unsubscribe = run.subscribe(() => {
    if (run.stage && run.stage !== record.session.stage) {
      update(id, { stage: run.stage });
    }
    if (run.text.length > seen) {
      const chunk = run.text.slice(seen);
      seen = run.text.length;
      acceptChunk(record, chunk);
    }
  });

  run.promise.then(
    (result) => {
      unsubscribe();
      settle(record, {
        phase: "complete",
        stage: "done",
        chapterTitle: result.chapter.title,
        chapter: result.chapter,
        creditsCharged: CHAPTER_TEXT_CREDITS,
      });
    },
    (error: unknown) => {
      unsubscribe();
      fail(record, error);
    },
  );

  return record.session;
}

/** Run a failed session again, in place. The reader keeps looking at the same session. */
export function retryGeneration(id: string): void {
  const record = records.get(id);
  if (!record || record.session.phase === "writing") return;
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

/** Acknowledge the entity gate, so its explanation is shown once and not again. */
export function acknowledgeGate(id: string): void {
  update(id, { gatedReason: null });
}

export function getGeneration(id: string): GenerationSession | null {
  return records.get(id)?.session ?? null;
}

/**
 * The newest session that belongs to a story, by the server's id or by the
 * session's own id (which is what a provisional story is keyed by).
 */
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

export function useStoryGeneration(storyId: string): GenerationSession | null {
  // Subscribing through the snapshot keeps the lookup in step with every
  // publish; the search itself is cheap because only a handful of sessions
  // ever exist at once.
  useGenerations();
  return findStoryGeneration(storyId);
}

/** Test seam: forget every session. */
export function __resetGenerationSessions(): void {
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
