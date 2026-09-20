import { GenerationRequestError, runStreamedCall } from "@/lib/api";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Chapter } from "@/types/domain";

/**
 * Client for `reimagine-chapter`: rewrite one whole chapter from a prompt.
 *
 * THE ENDPOINT IS STILL CALLED `reimagine-chapter`. The product surface in
 * front of it is not: it is the author's **Re-prompt**, and it no longer
 * carries character replacements.
 *
 * Replacements were removed from this client rather than merely hidden in the
 * UI. They were a find-and-replace across the story's prose, which cannot
 * touch a pronoun (`_shared/character-substitution.ts` says so explicitly) or
 * anything a chapter states about who somebody is -- so the one thing they
 * could not do is replace a character. Sending them from a sheet that no
 * longer shows them would leave a payload nothing produces and nothing tests.
 * The server still accepts the field; it simply never arrives.
 *
 * A reader who does not own the story does not reach this client at all.
 * Reimagine takes them to a new story of their own, seeded with this one's
 * premise (`lib/reimagine-seed.ts`) -- no fork, no rewrite, no substitution.
 *
 * The transport is the same `expo/fetch` SSE path `continueStoryStreaming`
 * uses, for the same reason (`supabase.functions.invoke()` buffers).
 *
 *   POST /functions/v1/reimagine-chapter
 *   { story_id, chapter_number, prompt, request_id, stream: true }
 *   events: stage { stage }, delta { text }, done { chapter, model, story_id? }, error { error }
 *
 * `done.story_id` is present when the caller was not the story's author and
 * the server wrote the rewrite into a private copy. Nothing in the app sends
 * that case any more, but the field is still read: a story's ownership is the
 * server's ruling, not the client's guess, and dropping it would silently
 * strand a rewrite in a copy the reader was never pointed at.
 */

export type RepromptRequest = {
  storyId: string;
  chapterNumber: number;
  prompt: string;
};

export type ReimagineResult = {
  chapter: Chapter;
  model: string;
  /** The private copy's id, when the server forked the story for a non-author. */
  storyId: string;
  forked: boolean;
};

export type ReimagineRunStatus = "writing" | "done" | "error";

/**
 * A rewrite in flight.
 *
 * Handed to whoever renders the chapter (the live reader's generation
 * session, once it exists; until then `ReaderScreen` itself) so the sheet can
 * close the moment the request is accepted and the prose can appear page by
 * page wherever the reader is looking. `text` is the prose so far; listeners
 * fire on every change of `text`, `stage` or `status`.
 */
export type ReimagineRun = {
  readonly request: RepromptRequest;
  readonly requestId: string;
  readonly text: string;
  readonly stage: string;
  readonly status: ReimagineRunStatus;
  readonly error: string | null;
  readonly result: ReimagineResult | null;
  /** Resolves with the result, rejects with the failure. */
  readonly promise: Promise<ReimagineResult>;
  subscribe(listener: () => void): () => void;
};

export type ReimagineHandlers = {
  onStage?: (stage: string) => void;
  onDelta: (text: string) => void;
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapDoneChapter(
  done: Record<string, unknown>,
  request: RepromptRequest,
): ReimagineResult {
  const chapter = asRecord(done.chapter);
  const content = typeof chapter.content === "string" ? chapter.content : "";
  if (!content.trim()) {
    throw new GenerationRequestError("The rewrite returned no chapter.", false);
  }
  const forkedStoryId = typeof done.story_id === "string" && done.story_id.trim()
    ? done.story_id
    : request.storyId;
  return {
    chapter: {
      id: typeof chapter.id === "string" ? chapter.id : `chapter-${request.chapterNumber}`,
      storyId: forkedStoryId,
      title: typeof chapter.title === "string" && chapter.title.trim()
        ? chapter.title
        : `Chapter ${request.chapterNumber}`,
      paragraphs: content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean),
      chapterNumber: typeof chapter.chapter_number === "number"
        ? chapter.chapter_number
        : request.chapterNumber,
      firstLine: typeof chapter.first_line === "string" ? chapter.first_line : undefined,
      previouslySummary: typeof chapter.previously_summary === "string"
        ? chapter.previously_summary
        : undefined,
      hookText: typeof chapter.hook_text === "string" ? chapter.hook_text : undefined,
      isPublished: false,
    },
    model: typeof done.model === "string" ? done.model : "unknown",
    storyId: forkedStoryId,
    forked: forkedStoryId !== request.storyId,
  };
}

export function createRepromptRequestId(): string {
  return `reimagine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Rewrite a chapter, reporting prose as it arrives. Resolves with the new
 * chapter once the server has persisted it.
 */
export async function reimagineChapterStreaming(
  request: RepromptRequest,
  requestId: string,
  handlers: ReimagineHandlers,
): Promise<ReimagineResult> {
  if (!isSupabaseConfigured) {
    return await localReimagine(request, handlers);
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  // The shared streamed-call path, not a copy of it: the stall watchdog and
  // the replay-by-request-id recovery live there, and a rewrite is the call a
  // reader watches most closely. This file used to carry its own copy of the
  // loop, which is how it came to have neither.
  const done = await runStreamedCall({
    fn: "reimagine-chapter",
    body: {
      story_id: request.storyId,
      chapter_number: request.chapterNumber,
      prompt: request.prompt.trim(),
      request_id: requestId,
      stream: true,
    },
    onEvent: (event, payload) => {
      if (event === "delta") {
        if (typeof payload.text === "string") handlers.onDelta(payload.text);
      } else if (event === "stage") {
        handlers.onStage?.(String(payload.stage ?? ""));
      }
    },
  });
  return mapDoneChapter(done, request);
}

/**
 * The offline walkthrough's rewrite: canned prose that echoes the instruction
 * so the flow can be walked without a backend. Marked `model: "mock"` like the
 * other local stubs so nothing mistakes it for a real rewrite.
 */
async function localReimagine(
  request: RepromptRequest,
  handlers: ReimagineHandlers,
): Promise<ReimagineResult> {
  handlers.onStage?.("context");
  const paragraphs = [
    "The chapter opened again, told from a different angle.",
    `Katha kept one instruction in mind the whole way through: ${request.prompt.trim()}`,
    "By the last line the scene had settled into its new shape, the same story wearing different clothes.",
  ];
  for (const paragraph of paragraphs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    handlers.onDelta(`${paragraph}\n\n`);
  }
  return {
    chapter: {
      id: `chapter-${request.chapterNumber}-reimagined-${Date.now()}`,
      storyId: request.storyId,
      title: `Chapter ${request.chapterNumber}`,
      paragraphs,
      chapterNumber: request.chapterNumber,
      isPublished: false,
    },
    model: "mock",
    storyId: request.storyId,
    forked: false,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Start a rewrite and return it as a subscribable run.
 *
 * The sheet calls this and hands the run to the reader, which is what lets
 * the sheet close immediately: the reader draws `run.text` as it grows and
 * swaps the chapter in on `done`. Errors are held on the run (`status`,
 * `error`) rather than thrown from here, so an unobserved failure never
 * becomes an unhandled rejection; `promise` still rejects for a caller that
 * awaits it.
 */
export function startReimagine(
  request: RepromptRequest,
  transport: typeof reimagineChapterStreaming = reimagineChapterStreaming,
): ReimagineRun {
  const listeners = new Set<() => void>();
  const state = {
    text: "",
    stage: "",
    status: "writing" as ReimagineRunStatus,
    error: null as string | null,
    result: null as ReimagineResult | null,
  };
  const notify = () => listeners.forEach((listener) => listener());
  const requestId = createRepromptRequestId();

  const promise = transport(request, requestId, {
    onStage: (stage) => {
      state.stage = stage;
      notify();
    },
    onDelta: (text) => {
      state.text += text;
      notify();
    },
  }).then(
    (result) => {
      state.result = result;
      state.status = "done";
      notify();
      return result;
    },
    (error: unknown) => {
      state.error = error instanceof Error ? error.message : "The rewrite failed.";
      state.status = "error";
      notify();
      throw error;
    },
  );
  // A run nobody awaits must not surface as an unhandled rejection; the
  // status and error fields carry the failure to whoever is subscribed.
  promise.catch(() => {});

  return {
    request,
    requestId,
    get text() {
      return state.text;
    },
    get stage() {
      return state.stage;
    },
    get status() {
      return state.status;
    },
    get error() {
      return state.error;
    },
    get result() {
      return state.result;
    },
    promise,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
