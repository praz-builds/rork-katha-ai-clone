import { GenerationRequestError } from "@/lib/api";
import { bootstrapUser } from "@/lib/session";
import { postEventStream, StreamTransportError } from "@/lib/stream";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "@/lib/supabase";
import type { Chapter, SavedCharacter, Story, StoryCharacter } from "@/types/domain";

/**
 * Client for `reimagine-chapter`: rewrite one whole chapter from a prompt
 * and/or a set of character replacements, streamed like every other chapter.
 *
 * Kept out of `lib/api.ts` on purpose - that file is being edited on the
 * backend branch at the same time - so the two land without a merge conflict
 * and the orchestrator folds this in afterwards. The transport is the same
 * `expo/fetch` SSE path `continueStoryStreaming` uses, for the same reason
 * (`supabase.functions.invoke()` buffers).
 *
 * Contract coded against (backend branch `fable/backend-created-flow`):
 *
 *   POST /functions/v1/reimagine-chapter
 *   {
 *     story_id, chapter_number, prompt, request_id,
 *     character_replacements: [{
 *       from_name,
 *       to: { saved_character_id } | { name, role?, appearance?, background? },
 *       apply_to_all_chapters
 *     }]
 *   }
 *   events: stage { stage }, delta { text }, done { chapter, model, story_id? }, error { error }
 *
 * `done.story_id` is present when the caller was not the story's author and
 * the server wrote the rewrite into a private copy in their library instead.
 */

export type CharacterReplacementTarget =
  | { savedCharacterId: string; name: string; portraitUrl?: string }
  | { name: string; role?: string; appearance?: string; background?: string; portraitUrl?: string };

export type CharacterReplacement = {
  fromName: string;
  to: CharacterReplacementTarget;
  applyToAllChapters: boolean;
};

export type ReimagineRequest = {
  storyId: string;
  chapterNumber: number;
  prompt: string;
  replacements: CharacterReplacement[];
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
  readonly request: ReimagineRequest;
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

export function replacementTargetIsSaved(
  target: CharacterReplacementTarget,
): target is Extract<CharacterReplacementTarget, { savedCharacterId: string }> {
  return "savedCharacterId" in target;
}

export function replacementFromSaved(
  fromName: string,
  saved: SavedCharacter,
  applyToAllChapters = false,
): CharacterReplacement {
  return {
    fromName,
    to: { savedCharacterId: saved.id, name: saved.name, portraitUrl: saved.portraitUrl },
    applyToAllChapters,
  };
}

// ---------------------------------------------------------------------------
// Character detection
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a name appears in the chapter as a whole word, case-insensitive.
 *
 * Whole-word so "Ana" does not light up for "banana", and the first token of
 * a multi-word name counts on its own: a roster entry "Naina Mistry" is
 * present in a chapter that only ever calls her "Naina".
 */
export function nameAppearsIn(name: string, text: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const candidates = [trimmed, ...trimmed.split(/\s+/).filter((part) => part.length >= 3)];
  return candidates.some((candidate) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text)
  );
}

/**
 * The characters the sheet offers for replacement: the story's persisted
 * roster, kept to those whose name is actually on the page.
 *
 * Nothing is inferred from the prose. A model-invented character with no
 * roster entry is not detectable without another model call, and a guessed
 * name offered for replacement would be worse than an absent one (spec §4).
 */
export function detectChapterCharacters(
  story: Pick<Story, "characters">,
  chapter: Pick<Chapter, "paragraphs">,
): StoryCharacter[] {
  const roster = story.characters ?? [];
  if (roster.length === 0) return [];
  const text = chapter.paragraphs.join("\n\n");
  const seen = new Set<string>();
  return roster.filter((character) => {
    const key = character.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    if (!nameAppearsIn(character.name, text)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function serializeReplacement(replacement: CharacterReplacement) {
  const to = replacement.to;
  return {
    from_name: replacement.fromName,
    to: replacementTargetIsSaved(to)
      ? { saved_character_id: to.savedCharacterId }
      : {
        name: to.name,
        role: to.role,
        appearance: to.appearance,
        background: to.background,
      },
    apply_to_all_chapters: replacement.applyToAllChapters,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapDoneChapter(
  done: Record<string, unknown>,
  request: ReimagineRequest,
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

export function createReimagineRequestId(): string {
  return `reimagine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Rewrite a chapter, reporting prose as it arrives. Resolves with the new
 * chapter once the server has persisted it.
 */
export async function reimagineChapterStreaming(
  request: ReimagineRequest,
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

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new GenerationRequestError("Please sign in to continue.", false);
  }

  let done: Record<string, unknown> | null = null;
  let failure: string | null = null;

  try {
    await postEventStream({
      url: `${SUPABASE_URL}/functions/v1/reimagine-chapter`,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      body: {
        story_id: request.storyId,
        chapter_number: request.chapterNumber,
        prompt: request.prompt.trim(),
        request_id: requestId,
        character_replacements: request.replacements.map(serializeReplacement),
        stream: true,
      },
      onEvent: ({ event, data }) => {
        const payload = asRecord(data);
        if (event === "delta") {
          if (typeof payload.text === "string") handlers.onDelta(payload.text);
        } else if (event === "stage") {
          handlers.onStage?.(String(payload.stage ?? ""));
        } else if (event === "done") {
          done = payload;
        } else if (event === "error") {
          failure = typeof payload.error === "string" ? payload.error : "The rewrite failed.";
        }
      },
    });
  } catch (error) {
    if (error instanceof StreamTransportError) {
      throw new GenerationRequestError(error.message, false);
    }
    throw error;
  }

  if (failure) throw new GenerationRequestError(failure, false);
  if (!done) {
    throw new GenerationRequestError(
      "The response stopped partway through. Please try again.",
      false,
    );
  }
  return mapDoneChapter(done, request);
}

/**
 * The offline walkthrough's rewrite: canned prose that names the replacements
 * so the flow can be walked without a backend. Marked `model: "mock"` like the
 * other local stubs so nothing mistakes it for a real rewrite.
 */
async function localReimagine(
  request: ReimagineRequest,
  handlers: ReimagineHandlers,
): Promise<ReimagineResult> {
  handlers.onStage?.("context");
  const swapped = request.replacements.map((item) => `${item.fromName} became ${item.to.name}`);
  const paragraphs = [
    swapped.length
      ? `The chapter opened again, and this time ${swapped.join(", ")}.`
      : "The chapter opened again, told from a different angle.",
    request.prompt.trim()
      ? `Katha kept one instruction in mind the whole way through: ${request.prompt.trim()}`
      : "Nothing about the plot moved, but every sentence found a new footing.",
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
  request: ReimagineRequest,
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
  const requestId = createReimagineRequestId();

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
