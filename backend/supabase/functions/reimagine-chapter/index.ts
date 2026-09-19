/**
 * Rewrite one chapter, optionally recasting it.
 *
 * Product decision, 2026-09-09: "Reimagine" is a chapter-level operation, not a
 * story-level one. The reader picks a chapter, optionally swaps characters for
 * saved ones or brand-new ones, types what should change, and pays exactly what
 * a continuation costs - one credit - to have that chapter written again.
 *
 * Three things make this different from `continue-story`, and they are the only
 * three:
 *
 * 1. **A non-author gets a copy first.** Reimagining somebody else's chapter
 *    must not touch their story, so `fork_story` (migration 00057) copies the
 *    story, its chapters and its cast into a private story owned by the caller
 *    and the rewrite happens there. The fork is looked up before it is created,
 *    keyed on (source story, caller), so a reader who reimagines three chapters
 *    ends up with one copy rather than three.
 *
 * 2. **The chapter already exists.** `complete_reimagine_generation` UPDATEs the
 *    row instead of inserting one, drops the narration that read the old prose,
 *    and only rewrites continuity when the chapter being rewritten is the last
 *    one - a chapter in the middle of a series does not get to overwrite the
 *    state that later chapters were written from.
 *
 * 3. **A replacement can outlive this chapter.** `apply_to_all_chapters` does
 *    NOT regenerate the other chapters; it renames the character in them
 *    (`_shared/character-substitution.ts`: whole-word, case-preserving, first
 *    name for full name, never a pronoun). Regenerating every chapter would
 *    cost a credit each and rewrite prose the reader chose to keep.
 *
 * Everything else - the credit reservation, the replay-by-request-id contract,
 * the refund on failure, the prompt layers, the word band, the schema-
 * constrained JSON output - is deliberately identical to `continue-story`,
 * because the client renders both with the same reader.
 *
 * **Both transports, opted into per request**, exactly as `continue-story`
 * does it. `stream: true` returns `text/event-stream` with the same events the
 * reader already renders (`meta` / `stage` / `delta` / `done` / `error`);
 * anything else gets one JSON response. Incremental delivery is what lets the
 * reader open on page 1 about 20s in rather than after a whole 55-80s
 * generation, and it is also what keeps a chapter clear of the Supabase
 * gateway's 150s request idle timeout (`EDGE_REQUEST_IDLE_TIMEOUT_MS` in
 * `_shared/llm.ts`), which the blocking path has to live under.
 *
 * ## Request
 *
 * ```jsonc
 * {
 *   "story_id": "uuid",              // the story as the caller sees it
 *   "chapter_number": 3,             // 1-based
 *   "request_id": "client-uuid",     // idempotency key, as everywhere else
 *   "prompt": "make the ending colder",   // optional, <= 500 chars
 *   "character_replacements": [
 *     {
 *       "from_name": "Maya",
 *       "to": { "saved_character_id": "uuid" },
 *       // or: { "name": "Priya", "role": "...", "appearance": "...", "background": "..." }
 *       "apply_to_all_chapters": true
 *     }
 *   ]
 * }
 * ```
 *
 * At least one of `prompt` and `character_replacements` must be present: a
 * rewrite with no instruction is a credit spent on a coin toss.
 *
 * ## Response
 *
 * With `stream: true`, `text/event-stream`; the `done` event's data is the
 * object below. Otherwise that same object as one JSON response.
 *
 * ```jsonc
 * {
 *   "chapter": { ... },                 // the rewritten chapters row
 *   "story_id": "uuid",                 // the story written to: the fork, when one was made
 *   "forked_from_story_id": "uuid|null",
 *   "balance": 7,
 *   "model": "meta/muse-spark-1.3",
 *   "timings": { "total": 61234 },
 *   "renamed": { "chapters": 2, "roster": 1 }   // what apply_to_all_chapters touched
 * }
 * ```
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { sseStream } from "../_shared/sse.ts";
import { reportCrudeLexicon } from "../_shared/content-scan.ts";
import { validateGroundingCards } from "../_shared/grounding-card.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  AllProvidersFailedError,
  generateFastStructuredText,
  generateStoryText,
} from "../_shared/llm.ts";
import {
  buildChapterMetadataPrompt,
  CHAPTER_METADATA_OUTPUT,
  CHAPTER_METADATA_SYSTEM_PROMPT,
  chapterLengthVerdict,
  chapterOutputFromStreamedMetadata,
  streamChapterProse,
  StreamCommittedError,
} from "../_shared/story-stream.ts";
import {
  errorMessage,
  isStaleReservation,
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";
import {
  buildContinuationSystemPrompt,
  buildContinuationUserPrompt,
} from "../_shared/story-prompts.ts";
import {
  isEmptySeriesState,
  mergeSeriesState,
  parseSeriesState,
  parseStructuredOutput,
  providedSeriesStateKeys,
} from "../_shared/story_text.ts";
import {
  substituteCharacters,
  substituteCharactersInJson,
} from "../_shared/character-substitution.ts";
import {
  applyReplacementsToCast,
  MAX_PROMPT_LENGTH,
  parseReplacements,
  renamesFor,
  type ResolvedReplacement,
} from "../_shared/reimagine.ts";
import {
  type AudienceMode,
  CHAPTER_ROLES,
  type ChapterLength,
  type ChapterRole,
  type CharacterInput,
  DEFAULT_PLANNED_CHAPTER_COUNT,
  type IdentityLens,
  isPlannedChapterCount,
  type PlannedChapterCount,
  type SpiceLevel,
  type StoryMode,
  wordBandFor,
} from "../_shared/types.ts";

/** Prose windows are bounded the same way a continuation's are. */
const CONTEXT_CHAPTERS = 3;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);
  let observedUserId: string | null = null;
  let observedStoryId: string | null = null;
  let observedOperationId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const requestedStoryId = parseUuid(body.story_id);
    if (!requestedStoryId) return respond({ error: "Invalid story_id" }, 400);
    observedStoryId = requestedStoryId;

    const requestId = parseRequestId(body.request_id);
    if (!requestId) return respond({ error: "Invalid request_id" }, 400);

    const chapterNumber = body.chapter_number;
    if (
      typeof chapterNumber !== "number" ||
      !Number.isInteger(chapterNumber) ||
      chapterNumber < 1 ||
      chapterNumber > 200
    ) {
      return respond(
        { error: "chapter_number must be a positive integer" },
        400,
      );
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return respond(
        { error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` },
        400,
      );
    }

    const parsed = parseReplacements(body.character_replacements);
    if ("error" in parsed) return respond({ error: parsed.error }, 400);
    const rawReplacements = parsed.replacements;

    if (!prompt && rawReplacements.length === 0) {
      return respond(
        {
          error:
            "Tell Katha what to change, or replace a character. A rewrite needs one of the two.",
          code: "nothing_to_change",
        },
        400,
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Replay, before anything is forked or reserved. ---
    //
    // Identical to continue-story's, with one difference: the operation's
    // story_id is the story that was WRITTEN to, which for a non-author is the
    // fork rather than the story in the request. Comparing them directly would
    // reject every retry of a forked reimagine.
    const { data: existingOperation, error: existingOperationError } =
      await serviceClient
        .from("generation_operations")
        .select("id, story_id, status, result_chapter_id, updated_at")
        .eq("user_id", user.id)
        .eq("request_id", requestId)
        .maybeSingle();
    if (existingOperationError) throw existingOperationError;
    if (existingOperation) {
      const sameStory = existingOperation.story_id === requestedStoryId ||
        await isForkOf(
          serviceClient,
          existingOperation.story_id,
          requestedStoryId,
          user.id,
        );
      if (!sameStory) {
        return respond({ error: "request_id belongs to another story" }, 409);
      }
      if (
        existingOperation.status === "reserved" &&
        isStaleReservation(existingOperation.updated_at)
      ) {
        const { data: reconciliation, error: reconciliationError } =
          await serviceClient.rpc("refund_generation_operation", {
            p_operation_id: existingOperation.id,
            p_user_id: user.id,
            p_error: "Stale reimagine reservation reconciled on retry",
          });
        if (reconciliationError || !reconciliation) {
          return respond({
            error: "Generation recovery is pending retry.",
            operation_id: existingOperation.id,
          }, 503);
        }
        existingOperation.status = reconciliation.status;
        if (reconciliation.result_chapter_id) {
          existingOperation.result_chapter_id =
            reconciliation.result_chapter_id;
        }
      }
      if (existingOperation.status === "completed") {
        if (!existingOperation.result_chapter_id) {
          throw new Error("Completed operation has no chapter");
        }
        const { data: chapter, error: chapterError } = await serviceClient
          .from("chapters")
          .select("*")
          .eq("id", existingOperation.result_chapter_id)
          .single();
        if (chapterError) throw chapterError;
        return respond({
          chapter,
          story_id: existingOperation.story_id,
          replayed: true,
        });
      }
      return respond({
        error: existingOperation.status === "refunded"
          ? "The previous rewrite failed. Start a new request."
          : "This chapter is already being rewritten.",
        code: existingOperation.status === "reserved"
          ? "chapter_generating"
          : "operation_refunded",
        status: existingOperation.status,
      }, 409);
    }

    const STORY_COLUMNS =
      "id, title, genre, primary_genre, audience_mode, identity_lenses, spice_level, topic, author_id, language, story_mode, series_state, previously_summary, where_and_when, moments, beats, story_values, writing_style, avoid, chapter_length, planned_chapter_count, grounding, status, is_public, is_curated, forked_from_story_id";

    const { data: sourceStory, error: sourceStoryError } = await serviceClient
      .from("stories")
      .select(STORY_COLUMNS)
      .eq("id", requestedStoryId)
      .single();
    if (sourceStoryError || !sourceStory) {
      return respond({ error: "Story not found" }, 404);
    }

    // A story the caller can neither own nor read is not forkable, and saying
    // "not found" is the same answer the reader would have got opening it.
    const isAuthor = sourceStory.author_id === user.id;
    if (
      !isAuthor && !(sourceStory.is_public === true) &&
      !(sourceStory.is_curated === true)
    ) {
      return respond({ error: "Story not found" }, 404);
    }

    // --- Fork, for a reader who is not the author. ---
    //
    // Looked up before it is created. A reader who reimagines chapter 3 and
    // then chapter 5 should be working in one copy of the story, not two, and
    // a retry of the same request must never mint a second story.
    let story = sourceStory as Record<string, unknown>;
    let storyId = requestedStoryId;
    let forkedFromStoryId: string | null = null;
    if (!isAuthor) {
      const readExistingFork = async () => {
        const { data, error } = await serviceClient
          .from("stories")
          .select(STORY_COLUMNS)
          .eq("forked_from_story_id", requestedStoryId)
          .eq("author_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data as Record<string, unknown> | null;
      };

      let fork = await readExistingFork();
      if (!fork) {
        const { data: newStoryId, error: forkError } = await serviceClient.rpc(
          "fork_story",
          {
            p_source_story_id: requestedStoryId,
            p_new_author_id: user.id,
          },
        );
        if (forkError || !newStoryId) {
          // A concurrent request from the same reader won the race and made
          // the copy first. `stories_fork_owner_key` (migration 00062) is what
          // turns that from two private copies into this one refusal, and the
          // winner's story is exactly what this request would have found had
          // it read a moment later -- so read it, rather than telling a reader
          // whose fork demonstrably exists that it could not be made.
          if ((forkError as { code?: string } | null)?.code === "23505") {
            fork = await readExistingFork();
          }
          if (!fork) {
            console.error("fork_story failed:", safeErrorMessage(forkError));
            return respond({
              error: "This story cannot be copied to your library yet.",
              code: "fork_failed",
            }, 409);
          }
        } else {
          const { data: forked, error: forkedReadError } = await serviceClient
            .from("stories")
            .select(STORY_COLUMNS)
            .eq("id", newStoryId)
            .single();
          if (forkedReadError || !forked) throw forkedReadError;
          fork = forked as Record<string, unknown>;
        }
      }
      story = fork;
      storyId = fork.id as string;
      forkedFromStoryId = requestedStoryId;
      observedStoryId = storyId;
    }

    // A story still being written has no finished chapter to rewrite, and the
    // reservation below would race the generation that is already holding it.
    if (story.status !== "complete") {
      return respond({
        error: "This chapter is still being written.",
        code: "chapter_generating",
      }, 409);
    }

    const { data: targetChapter, error: targetChapterError } =
      await serviceClient
        .from("chapters")
        .select(
          "id, chapter_number, title, content, chapter_role, previously_summary, hook_type, hook_text",
        )
        .eq("story_id", storyId)
        .eq("chapter_number", chapterNumber)
        .maybeSingle();
    if (targetChapterError) throw targetChapterError;
    if (!targetChapter) {
      return respond({ error: "Chapter not found" }, 404);
    }

    // The explicit form of the KTH01 the reservation would raise anyway. It is
    // checked here so the caller gets `chapter_generating` rather than a
    // generic conflict, and so no credit is touched on the way to finding out.
    const { data: inFlight, error: inFlightError } = await serviceClient
      .from("generation_operations")
      .select("id")
      .eq("story_id", storyId)
      .eq("chapter_number", chapterNumber)
      .eq("status", "reserved")
      .limit(1)
      .maybeSingle();
    if (inFlightError) throw inFlightError;
    if (inFlight) {
      return respond({
        error: "This chapter is still being written.",
        code: "chapter_generating",
      }, 409);
    }

    // --- Resolve the replacements against the caller's saved characters. ---
    const savedIds = rawReplacements
      .map((r) => r.savedCharacterId)
      .filter((id): id is string => Boolean(id));
    let savedById = new Map<string, Record<string, unknown>>();
    if (savedIds.length) {
      const { data: savedRows, error: savedError } = await serviceClient
        .from("user_characters")
        .select("id, name, description, background, appearance, portrait_url")
        .eq("owner_id", user.id)
        .in("id", savedIds);
      if (savedError) throw savedError;
      savedById = new Map(
        (savedRows ?? []).map((
          row: Record<string, unknown>,
        ) => [row.id as string, row]),
      );
    }
    const replacements: ResolvedReplacement[] = [];
    for (const raw of rawReplacements) {
      if (raw.savedCharacterId) {
        const saved = savedById.get(raw.savedCharacterId);
        if (!saved) {
          // Someone else's row, or one that has since been deleted. Refusing is
          // right: silently rewriting the chapter without the swap the reader
          // asked for would spend their credit on the wrong chapter.
          return respond({
            error: "That saved character is no longer available.",
            code: "saved_character_missing",
          }, 404);
        }
        replacements.push({
          fromName: raw.fromName,
          applyToAllChapters: raw.applyToAllChapters,
          to: {
            name: String(saved.name ?? "").trim(),
            description: (saved.description as string | null) ?? undefined,
            background: (saved.background as string | null) ?? undefined,
            appearance: (saved.appearance as string | null) ?? undefined,
            portraitUrl: (saved.portrait_url as string | null) ?? undefined,
            savedCharacterId: raw.savedCharacterId,
          },
        });
        continue;
      }
      replacements.push({
        fromName: raw.fromName,
        applyToAllChapters: raw.applyToAllChapters,
        to: raw.character!,
      });
    }

    // --- The brief, reloaded exactly as a continuation reloads it. ---
    const { data: castRows, error: castError } = await serviceClient
      .from("characters")
      .select("id, name, description, background, appearance, is_hero")
      .eq("story_id", storyId)
      .order("name", { ascending: true });
    if (castError) throw castError;
    const cast: CharacterInput[] = (castRows ?? []).map((character) => ({
      name: character.name,
      description: character.description ?? undefined,
      background: character.background ?? undefined,
      appearance: character.appearance ?? undefined,
      isHero: character.is_hero === true,
    }));
    const characters = applyReplacementsToCast(cast, replacements);

    // Only the chapters BEFORE this one are context. Feeding the model the
    // chapters that follow would have it write toward events the rewrite is
    // meant to be free to change.
    const { data: previousChapters, error: previousError } = await serviceClient
      .from("chapters")
      .select("chapter_number, title, content")
      .eq("story_id", storyId)
      .lt("chapter_number", chapterNumber)
      .order("chapter_number", { ascending: false })
      .limit(CONTEXT_CHAPTERS);
    if (previousError) throw previousError;

    const storyMode = (story.story_mode ?? "standalone") as StoryMode;
    const primaryGenre: string = (story.primary_genre as string) ??
      (Array.isArray(story.genre)
        ? (story.genre as string[])[0] ?? "contemporary"
        : ((story.genre as string) ?? "contemporary"));
    const genres = Array.isArray(story.genre)
      ? (story.genre as unknown[]).filter((g): g is string =>
        typeof g === "string"
      )
      : [primaryGenre];
    const storyLanguage = typeof story.language === "string"
      ? story.language
      : undefined;
    const audienceMode = (story.audience_mode ?? "adult") as AudienceMode;
    const identityLenses = (Array.isArray(story.identity_lenses)
      ? story.identity_lenses
      : []) as IdentityLens[];
    const rawSpice = (story.spice_level ?? "sweet") as string;
    const spiceLevel =
      (rawSpice === "explicit" ? "steamy" : rawSpice) as SpiceLevel;
    const chapterLength = (story.chapter_length ?? "standard") as ChapterLength;
    // A range, not the four values the picker offers: a story extended past
    // its plan stores 2, 4, 9 and so on. Matching against a fixed set here
    // would rewrite a chapter of a 4-chapter story against a 3-chapter plan.
    const plannedChapterCount: PlannedChapterCount =
      isPlannedChapterCount(story.planned_chapter_count)
        ? story.planned_chapter_count
        : DEFAULT_PLANNED_CHAPTER_COUNT;
    const chapterRole: ChapterRole =
      CHAPTER_ROLES.has(targetChapter.chapter_role as string)
        ? targetChapter.chapter_role as ChapterRole
        : (storyMode === "series" ? "mid_series" : "standalone");
    const isFinale = chapterRole === "finale";
    // The state as it was BEFORE this chapter, so a rewrite is not asked to
    // honour the hooks the version it is replacing happened to open. The story
    // row carries the latest state; for the last chapter that state came from
    // the chapter being replaced, which is why it is merged, not trusted.
    const seriesState = parseSeriesState(story.series_state);
    const moments = Array.isArray(story.moments)
      ? story.moments as string[]
      : [];
    const beats = Array.isArray(story.beats) ? story.beats as string[] : [];
    const storyValues = Array.isArray(story.story_values)
      ? story.story_values as string[]
      : [];
    const writingStyle = typeof story.writing_style === "string"
      ? story.writing_style
      : undefined;
    const avoid = typeof story.avoid === "string" ? story.avoid : undefined;

    const previousText = (previousChapters ?? [])
      .toReversed()
      .map((c) =>
        `Chapter ${c.chapter_number}: ${c.content}`
      )
      .join("\n\n");

    // What the reimagine actually asks for, in the slot a continuation uses for
    // "what happens next". The old prose is included so the model rewrites this
    // chapter rather than inventing an unrelated one, and the renames are
    // stated in words because the prose window still uses the old names.
    const renameLines = replacements
      .map((r) => `- "${r.fromName}" is now "${r.to.name}".`)
      .join("\n");
    const reimagineInstruction = [
      "Rewrite this chapter. It already exists; this is a replacement for it, covering the same place in the story.",
      renameLines
        ? `Recast it with these replacements, and use only the new names:\n${renameLines}`
        : "",
      prompt ? `What the reader asked for: ${prompt}` : "",
      "Keep the chapter's role in the story. Do not summarise the old version; write the chapter.",
    ].filter(Boolean).join("\n\n");

    const previousWithTarget = [
      previousText,
      `The chapter you are replacing (Chapter ${chapterNumber}: ${
        targetChapter.title ?? "Untitled"
      }):\n${targetChapter.content ?? ""}`,
    ].filter(Boolean).join("\n\n");

    const { jsonPrompt, prosePrompt } = buildContinuationUserPrompt({
      primaryGenre,
      genres,
      audienceMode,
      spiceLevel,
      chapterRole,
      chapterNumber,
      chapterLength,
      plannedChapterCount,
      seed: (story.topic as string) ?? "",
      whereAndWhen: (story.where_and_when as string) ?? undefined,
      moments,
      beats,
      storyValues,
      writingStyle,
      avoid,
      continuationInstruction: reimagineInstruction,
      characters,
      seriesState,
      title: story.title as string,
      previousChapters: previousWithTarget,
      isFinale,
      grounding: validateGroundingCards(story.grounding),
    });

    // Everything above the output contract is shared by the two transports, so
    // a change to the reimagine rules reaches both by construction.
    const systemPromptFor = (output: "json" | "prose") =>
      buildContinuationSystemPrompt({
        primaryGenre,
        audienceMode,
        identityLenses,
        spiceLevel,
        language: storyLanguage,
        mode: isFinale ? "finale" : "chapter",
        seriesState,
        chapterLength,
        plannedChapterCount,
        output,
      });

    // --- Reserve the credit. Everything above can still say no for free. ---
    const { data: operation, error: reservationError } = await serviceClient
      .rpc(
        "reserve_generation_operation",
        {
          p_user_id: user.id,
          p_request_id: requestId,
          p_story_id: storyId,
          p_chapter_number: chapterNumber,
          p_kind: "reimagine",
        },
      );
    if (reservationError || !operation) {
      if (reservationError?.code === "KTH02") {
        return respond({ error: "Insufficient credits" }, 402);
      }
      if (reservationError?.code === "KTH01") {
        return respond({
          error: "This chapter is still being written.",
          code: "chapter_generating",
        }, 409);
      }
      throw reservationError ?? new Error("Generation reservation failed");
    }
    if (operation.replayed) {
      return respond({
        error: operation.status === "completed"
          ? "Rewrite already completed; retry with the same request ID."
          : "This chapter is already being rewritten.",
        code: "chapter_generating",
        status: operation.status,
      }, 409);
    }
    observedOperationId = operation.id;

    const band = wordBandFor(storyMode, audienceMode, chapterLength);
    const startedAt = Date.now();

    /** Persist the rewritten chapter. Mirrors continue-story's closure. */
    const persistReimagine = async (
      output: ReturnType<typeof parseStructuredOutput>,
    ) => {
      const content = output.chapter_body;
      if (!content) throw new Error("Generation returned no chapter content");
      await reportCrudeLexicon(content, {
        feature: "reimagine_chapter",
        storyId,
        userId: observedUserId,
      });
      const wordCount = content.split(/\s+/).filter(Boolean).length;

      const providedKeys = providedSeriesStateKeys(output.raw_series_state);
      const nextState = isEmptySeriesState(output.series_state)
        ? seriesState
        : mergeSeriesState(
          seriesState,
          output.series_state,
          providedKeys,
          moments,
        );

      const { data: chapter, error: chapterError } = await serviceClient.rpc(
        "complete_reimagine_generation",
        {
          p_operation_id: operation.id,
          p_user_id: user.id,
          p_title: output.chapter_title || output.title || targetChapter.title,
          p_content: content,
          p_word_count: wordCount,
          p_first_line: output.first_line || null,
          p_previously_summary: output.previously_summary || null,
          p_series_state: nextState,
          p_hook_type: isFinale ? "none" : output.hook_type,
          p_hook_text: isFinale ? null : output.hook_text || null,
        },
      );
      if (chapterError || !chapter) {
        throw chapterError ?? new Error("Chapter persistence failed");
      }
      return chapter as Record<string, unknown>;
    };

    /**
     * Carry the "apply to all chapters" renames across the rest of the story.
     *
     * Runs AFTER the chapter is persisted and never fails the request: the
     * chapter the reader paid for is already written, and losing it because a
     * rename could not be propagated would be the worse trade. What it did is
     * reported in the `done` payload so the client can say so.
     */
    const applyAcrossChapters = async (): Promise<
      { chapters: number; roster: number }
    > => {
      const renames = renamesFor(replacements, "all");
      if (renames.length === 0) return { chapters: 0, roster: 0 };
      let changedChapters = 0;
      let changedRoster = 0;
      try {
        const { data: others, error: othersError } = await serviceClient
          .from("chapters")
          .select("id, content, previously_summary, first_line, title")
          .eq("story_id", storyId)
          .neq("chapter_number", chapterNumber);
        if (othersError) throw othersError;
        for (const other of others ?? []) {
          const next = {
            content: substituteCharacters(
              (other.content as string) ?? "",
              renames,
            ),
            title: substituteCharacters((other.title as string) ?? "", renames),
            previously_summary: other.previously_summary
              ? substituteCharacters(
                other.previously_summary as string,
                renames,
              )
              : other.previously_summary,
            first_line: other.first_line
              ? substituteCharacters(other.first_line as string, renames)
              : other.first_line,
          };
          const unchanged = next.content === other.content &&
            next.title === other.title &&
            next.previously_summary === other.previously_summary &&
            next.first_line === other.first_line;
          if (unchanged) continue;
          const { error: writeError } = await serviceClient
            .from("chapters")
            .update(next)
            .eq("id", other.id);
          if (writeError) throw writeError;
          changedChapters += 1;
        }

        // The roster and the continuity state are what every LATER chapter is
        // written from. Without this the rename would hold in the prose and
        // then be undone by the next continuation.
        for (const replacement of replacements) {
          if (!replacement.applyToAllChapters) continue;
          const match = (castRows ?? []).find((row) =>
            String(row.name ?? "").trim().toLowerCase() ===
              replacement.fromName.toLowerCase()
          );
          if (!match) continue;
          const { error: rosterError } = await serviceClient
            .from("characters")
            .update({
              name: replacement.to.name,
              description: replacement.to.description ?? match.description,
              background: replacement.to.background ?? match.background,
              appearance: replacement.to.appearance ?? match.appearance,
              saved_character_id: replacement.to.savedCharacterId ?? null,
            })
            .eq("id", match.id);
          if (rosterError) throw rosterError;
          changedRoster += 1;
        }

        const { data: storyRow, error: storyReadError } = await serviceClient
          .from("stories")
          .select("series_state, previously_summary")
          .eq("id", storyId)
          .single();
        if (storyReadError) throw storyReadError;
        const { error: storyWriteError } = await serviceClient
          .from("stories")
          .update({
            series_state: substituteCharactersInJson(
              storyRow.series_state ?? {},
              renames,
            ),
            previously_summary: storyRow.previously_summary
              ? substituteCharacters(
                storyRow.previously_summary as string,
                renames,
              )
              : storyRow.previously_summary,
          })
          .eq("id", storyId);
        if (storyWriteError) throw storyWriteError;
      } catch (error) {
        console.error(
          "reimagine cross-chapter rename failed:",
          safeErrorMessage(error),
        );
        await logError({
          bucket: "generation.story",
          severity: "medium",
          source: "runtime",
          errorCode: "reimagine_rename_failed",
          error,
          context: {
            story_id: storyId,
            operation_id: operation.id,
            chapter_number: chapterNumber,
            renames: renames.length,
          },
          userId: user.id,
        });
      }
      return { chapters: changedChapters, roster: changedRoster };
    };

    /** One refund path, as in continue-story. */
    const refundReimagine = async (error: unknown) => {
      const { data: refund, error: refundError } = await serviceClient.rpc(
        "refund_generation_operation",
        {
          p_operation_id: operation.id,
          p_user_id: user.id,
          p_error: errorMessage(error),
        },
      );
      const telemetry = [
        ...(error instanceof AllProvidersFailedError
          ? [logError({
            bucket: "llm.provider",
            severity: "critical",
            source: "runtime",
            errorCode: "all_providers_failed",
            error,
            context: {
              ...error.toContext(),
              operation_id: operation.id,
              story_id: storyId,
              chapter_number: chapterNumber,
              chapter_role: chapterRole,
              primary_genre: primaryGenre,
            },
            userId: user.id,
          })]
          : []),
        logError({
          bucket: "generation.story",
          severity: "high",
          source: "runtime",
          errorCode: "post_deduction_failed",
          error,
          context: {
            operation_id: operation.id,
            story_id: storyId,
            chapter_number: chapterNumber,
            chapter_role: chapterRole,
            primary_genre: primaryGenre,
            kind: "reimagine",
          },
          userId: user.id,
        }),
      ];
      await Promise.allSettled(telemetry);
      return { refund, refundError };
    };

    // --- The streamed transport. ---
    //
    // A branch rather than a second function, for the same reason it is one in
    // `continue-story`: every decision that can reject this request - auth,
    // the fork, the chapter, the in-flight check, the credit reservation - has
    // already been made above. Only the delivery of the model's answer
    // differs, so only that is duplicated, and `persistReimagine`,
    // `applyAcrossChapters` and `refundReimagine` are shared with the buffered
    // path below.
    if (body.stream === true) {
      // `sseStream` owns the framing, the ~15s keep-alive comment and the close
      // on every exit path (`_shared/sse.ts`). The keep-alive is what lets the
      // client tell a dead connection from a slow metadata call, and a reader
      // who hangs up does not stop this run: the replay of its request id is
      // how they get the finished chapter back.
      const stream = sseStream(async ({ send }) => {
        try {
          // `story_id` rides on the first event, not only the last: a reader
          // who is not the author needs to know which story they are reading
          // before the prose arrives, because it is no longer the one they
          // opened.
          send("meta", {
            story_id: storyId,
            forked_from_story_id: forkedFromStoryId,
            operation_id: operation.id,
            chapter_number: chapterNumber,
            chapter_id: targetChapter.id,
            balance: operation.balance,
          });
          send("stage", { stage: "context" });

          const prose = await streamChapterProse({
            systemPrompt: systemPromptFor("prose"),
            userPrompt: prosePrompt,
            wordBand: band,
            onCommit: () => send("stage", { stage: "writing" }),
            onDelta: (text) => send("delta", { text }),
          });

          send("stage", { stage: "shaping" });

          // The structured half, recovered after the prose rather than
          // around it: `series_state` and the hook are what the chapter-end
          // screen and the next continuation read, so they stay behind a
          // strict schema instead of a partial-JSON parser.
          const metadata = await generateFastStructuredText(
            CHAPTER_METADATA_SYSTEM_PROMPT,
            buildChapterMetadataPrompt({
              prose: prose.text,
              storyMode,
              seed: (story.topic as string) ?? "",
            }),
            CHAPTER_METADATA_OUTPUT,
            2_000,
            45_000,
          );
          // For a series, refuses metadata with no series state or hook, as
          // the buffered path below refuses `structured === false`: a rewrite
          // persisted without them wipes continuity for every later chapter.
          // The throw lands in the catch below, which refunds, and the OLD
          // chapter is untouched because nothing has been written yet. A
          // standalone story has no later chapter to hand state to, so its
          // rewrite keeps the lenient merge rather than being refunded over
          // fields nothing reads.
          const output = chapterOutputFromStreamedMetadata({
            metadataText: metadata.text,
            prose: prose.text,
            fallbackTitle: `Chapter ${chapterNumber}`,
            requireContinuity: storyMode === "series",
          });

          const verdict = chapterLengthVerdict(prose.text, band);
          if (!verdict.usable) {
            // Recorded, not refused. The reader has already read it, and
            // taking it back is worse than a chapter that ran long. Same
            // rule as the streamed continuation.
            await logError({
              bucket: "generation.story",
              severity: "medium",
              source: "runtime",
              errorCode: "streamed_chapter_outside_band",
              error: new Error(
                `Reimagined chapter ran ${verdict.words} words against a ${band.min}-${band.max} band`,
              ),
              context: {
                story_id: storyId,
                operation_id: operation.id,
                chapter_number: chapterNumber,
                words: verdict.words,
                band_min: band.min,
                band_max: band.max,
                model: prose.model,
                kind: "reimagine",
              },
              userId: user.id,
            });
          }

          const chapter = await persistReimagine(output);
          const renamed = await applyAcrossChapters();

          send("done", {
            chapter,
            story_id: storyId,
            forked_from_story_id: forkedFromStoryId,
            balance: operation.balance,
            model: prose.model,
            timings: { total: Date.now() - startedAt },
            renamed,
          });
        } catch (error) {
          const committed = error instanceof StreamCommittedError;
          console.error(
            "reimagine-chapter stream failed:",
            safeErrorMessage(error),
          );
          const { refund, refundError } = await refundReimagine(error);
          send("error", {
            error: refundError
              ? "The rewrite failed. Refund is pending retry."
              : refund?.refunded
              ? "The rewrite failed. Credit refunded."
              : "The rewrite failed.",
            operation_id: operation.id,
            story_id: storyId,
            // Whatever reached the reader stays on screen. Blanking prose
            // somebody has read is the worse of the two bad outcomes - but
            // the OLD chapter is untouched either way, because nothing is
            // persisted until the rewrite is whole.
            partial_prose_shown: committed,
            refunded: Boolean(refund?.refunded),
          });
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...corsHeadersFor(req),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // Without this a proxy may buffer the body and hand it over whole,
          // reintroducing the latency this exists to remove, invisibly.
          "X-Accel-Buffering": "no",
        },
      });
    }

    try {
      const result = await generateStoryText(
        systemPromptFor("json"),
        jsonPrompt,
        band,
      );
      const output = parseStructuredOutput(
        result.text,
        `Chapter ${chapterNumber}`,
      );
      // Same rule as a continuation: a rewrite that falls back to the plain
      // text parser has no hook and no series state, and persisting it would
      // freeze continuity for every chapter after it while still charging a
      // credit. Fail, refund, let the reader retry.
      if (output.structured === false) {
        throw new Error(
          "Reimagine returned unparseable structured output; refusing to persist a chapter without hook or series state",
        );
      }

      const verdict = chapterLengthVerdict(output.chapter_body, band);
      if (!verdict.usable) {
        // Recorded, not refused. `generateStoryText` already rejects an
        // out-of-band generation inside the provider chain and falls through
        // to the next provider; anything that reaches here has survived that,
        // so refusing it a second time would only spend the credit for
        // nothing. See the open item in STORY_GENERATION_FLOW section 10.6.
        await logError({
          bucket: "generation.story",
          severity: "medium",
          source: "runtime",
          errorCode: "chapter_outside_band",
          error: new Error(
            `Reimagined chapter ran ${verdict.words} words against a ${band.min}-${band.max} band`,
          ),
          context: {
            story_id: storyId,
            operation_id: operation.id,
            chapter_number: chapterNumber,
            words: verdict.words,
            band_min: band.min,
            band_max: band.max,
            model: result.model,
            kind: "reimagine",
          },
          userId: user.id,
        });
      }

      const chapter = await persistReimagine(output);
      const renamed = await applyAcrossChapters();

      return respond({
        chapter,
        story_id: storyId,
        forked_from_story_id: forkedFromStoryId,
        balance: operation.balance,
        model: result.model,
        timings: { total: Date.now() - startedAt },
        renamed,
      });
    } catch (error) {
      console.error(
        "reimagine-chapter post-deduction error:",
        safeErrorMessage(error),
      );
      const { refund, refundError } = await refundReimagine(error);
      if (refundError) {
        return respond({
          error: "The rewrite failed. Refund is pending retry.",
          operation_id: operation.id,
          story_id: storyId,
        }, 503);
      }
      return respond({
        error: refund?.refunded
          ? "The rewrite failed. Credit refunded."
          : "The rewrite completed; retry with the same request ID.",
        operation_id: operation.id,
        story_id: storyId,
        status: refund?.status,
      }, 500);
    }
  } catch (error) {
    console.error("reimagine-chapter error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.story",
      severity: "high",
      source: "runtime",
      errorCode: "unhandled",
      error,
      context: {
        story_id: observedStoryId,
        operation_id: observedOperationId,
        kind: "reimagine",
      },
      userId: observedUserId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
});

/**
 * Is `candidate` the caller's own fork of `source`?
 *
 * `client` is deliberately untyped. The Supabase builder's generics recurse
 * once a chain of `.eq()` calls is described structurally, and TypeScript gives
 * up with TS2589; the query itself is three equality filters and a
 * `maybeSingle`, which is not worth a type gymnastics exercise.
 */
// deno-lint-ignore no-explicit-any
async function isForkOf(
  client: any,
  candidate: string | null,
  source: string,
  userId: string,
): Promise<boolean> {
  if (!candidate) return false;
  const { data } = await client
    .from("stories")
    .select("id")
    .eq("id", candidate)
    .eq("forked_from_story_id", source)
    .eq("author_id", userId)
    .maybeSingle();
  return Boolean(data);
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
