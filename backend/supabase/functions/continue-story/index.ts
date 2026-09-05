import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { notifyInBackground } from "../_shared/notify.ts";
import { runInBackground } from "../_shared/media.ts";
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
  StreamCommittedError,
  streamChapterProse,
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
  buildUserPrompt,
  formatSeriesStateBlock,
  userField,
} from "../_shared/story-prompts.ts";
import {
  isEmptySeriesState,
  mergeSeriesState,
  parseSeriesState,
  parseStructuredOutput,
  providedSeriesStateKeys,
} from "../_shared/story_text.ts";
import {
  type AudienceMode,
  type ChapterLength,
  type CharacterInput,
  type IdentityLens,
  type PlannedChapterCount,
  type SpiceLevel,
  wordBandFor,
} from "../_shared/types.ts";

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);
    const story_id = parseUuid(body.story_id);
    if (!story_id) return respond({ error: "Invalid story_id" }, 400);
    observedStoryId = story_id;
    const request_id = body.request_id;
    const requestId = parseRequestId(request_id);
    if (!requestId) return respond({ error: "Invalid request_id" }, 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existingOperation, error: existingOperationError } =
      await serviceClient
        .from("generation_operations")
        .select("id, story_id, status, result_chapter_id, updated_at")
        .eq("user_id", user.id)
        .eq("request_id", requestId)
        .maybeSingle();
    if (existingOperationError) throw existingOperationError;
    if (existingOperation) {
      if (existingOperation.story_id !== story_id) {
        return respond(
          { error: "request_id belongs to another story" },
          409,
        );
      }
      if (
        existingOperation.status === "reserved" &&
        isStaleReservation(existingOperation.updated_at)
      ) {
        const { data: reconciliation, error: reconciliationError } =
          await serviceClient.rpc("refund_generation_operation", {
            p_operation_id: existingOperation.id,
            p_user_id: user.id,
            p_error: "Stale continuation reservation reconciled on retry",
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
        return respond({ chapter, replayed: true });
      }
      return respond({
        error: existingOperation.status === "refunded"
          ? "The previous generation failed. Start a new request."
          : "Generation is already in progress.",
        status: existingOperation.status,
      }, 409);
    }

    // Verify story ownership
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .select(
        "id, title, genre, primary_genre, audience_mode, identity_lenses, spice_level, topic, author_id, language, story_mode, series_state, previously_summary, where_and_when, moments, beats, story_values, writing_style, avoid, chapter_length, planned_chapter_count",
      )
      .eq("id", story_id)
      .single();

    if (storyError || !story || story.author_id !== user.id) {
      return respond({ error: "Story not found" }, 404);
    }

    // Character sheets are part of the durable brief. Re-load them for every
    // continuation so later chapters retain the cast's voice, motivations, and
    // physical detail instead of relying only on recent prose excerpts.
    const { data: castRows, error: castError } = await serviceClient
      .from("characters")
      .select("name, description, background, appearance, is_hero")
      .eq("story_id", story_id)
      .order("name", { ascending: true });
    if (castError) throw castError;
    const characters: CharacterInput[] = (castRows ?? []).map((character) => ({
      name: character.name,
      description: character.description ?? undefined,
      background: character.background ?? undefined,
      appearance: character.appearance ?? undefined,
      isHero: character.is_hero === true,
    }));

    const nextInstruction = typeof body.next_instruction === "string"
      ? body.next_instruction.trim()
      : "";
    if (nextInstruction.length > 300) {
      return respond(
        { error: "next_instruction must be 300 characters or fewer" },
        400,
      );
    }

    // Keep prompt context bounded while deriving the next chapter from latest.
    const { data: chapters, error: chaptersError } = await serviceClient
      .from("chapters")
      .select(
        "chapter_number, title, content, chapter_role, previously_summary, hook_type, hook_text",
      )
      .eq("story_id", story_id)
      .order("chapter_number", { ascending: false })
      .limit(4);
    if (chaptersError) throw chaptersError;
    if (!chapters?.length) {
      return respond({ error: "Story has no chapter to continue" }, 409);
    }

    const nextChapterNum = chapters[0].chapter_number + 1;

    const plannedChapterCount =
      ([3, 7, 15].includes(story.planned_chapter_count)
        ? story.planned_chapter_count
        : 3) as PlannedChapterCount;
    if (nextChapterNum > plannedChapterCount) {
      return respond({
        error:
          `Series limit reached. This story is planned for ${plannedChapterCount} chapters.`,
      }, 400);
    }

    const { data: operation, error: reservationError } = await serviceClient
      .rpc(
        "reserve_generation_operation",
        {
          p_user_id: user.id,
          p_request_id: requestId,
          p_story_id: story_id,
          p_chapter_number: nextChapterNum,
          p_kind: "continuation",
        },
      );
    if (reservationError || !operation) {
      if (reservationError?.code === "KTH02") {
        return respond({ error: "Insufficient credits" }, 402);
      }
      if (reservationError?.code === "KTH01") {
        return respond({
          error: "This chapter generation is already in progress",
        }, 409);
      }
      throw reservationError ?? new Error("Generation reservation failed");
    }
    if (operation.replayed) {
      return respond({
        error: operation.status === "completed"
          ? "Generation already completed; retry with the same request ID."
          : "Generation is already in progress.",
        status: operation.status,
      }, 409);
    }
    observedOperationId = operation.id;

    // Build continuation prompt
    const previousText = chapters
      ?.toReversed()
      ?.map((c) => `Chapter ${c.chapter_number}: ${c.content}`)
      .join("\n\n");

    const primaryGenre: string = story.primary_genre ??
      (Array.isArray(story.genre)
        ? story.genre[0] ?? "contemporary"
        : (story.genre ?? "contemporary"));
    const genres = Array.isArray(story.genre)
      ? story.genre.filter((genre): genre is string =>
        typeof genre === "string"
      )
      : [primaryGenre];
    const storyLanguage = typeof story.language === "string"
      ? story.language
      : undefined;
    const audienceMode = (story.audience_mode ?? "adult") as AudienceMode;
    const identityLenses = (Array.isArray(story.identity_lenses)
      ? story.identity_lenses
      : []) as IdentityLens[];
    const rawSpice = story.spice_level ?? "sweet";
    const spiceLevel =
      (rawSpice === "explicit" ? "steamy" : rawSpice) as SpiceLevel;
    const isFinale = body.is_finale === true ||
      nextChapterNum >= plannedChapterCount;
    const chapterMode = isFinale ? "finale" : "chapter";
    const chapterRole = isFinale ? "finale" : "mid_series";
    const seriesState = parseSeriesState(story.series_state);

    let earliestContext = "";
    if (
      isFinale && !chapters.some((c) =>
        c.chapter_number === 1
      )
    ) {
      const { data: firstChapter, error: firstChapterError } =
        await serviceClient
          .from("chapters")
          .select(
            "chapter_number, title, content, previously_summary, hook_type, hook_text",
          )
          .eq("story_id", story_id)
          .eq("chapter_number", 1)
          .maybeSingle();
      if (firstChapterError) {
        console.error(
          "chapter 1 context fetch failed",
          safeErrorMessage(firstChapterError),
        );
      } else if (firstChapter) {
        earliestContext = `\n\nChapter 1 callback context:\n${
          summarizeChapterForPrompt(firstChapter)
        }`;
      }
    }

    const systemPrompt = buildContinuationSystemPrompt({
      primaryGenre,
      audienceMode,
      identityLenses,
      spiceLevel,
      language: storyLanguage,
      mode: chapterMode,
      seriesState,
      chapterLength: (story.chapter_length ?? "standard") as ChapterLength,
      plannedChapterCount,
    });
    const finaleNote = isFinale
      ? " This is the FINAL chapter. Bring the story to a satisfying close."
      : "";
    // The world layer travels with every chapter, not just the first. Without
    // it a chapter-7 continuation has only the prose window above to infer the
    // setting from, and a series drifts out of its own world by degrees.
    const storyValues = Array.isArray(story.story_values)
      ? story.story_values
      : [];
    const moments = Array.isArray(story.moments) ? story.moments : [];
    // The plan the writer approved on the blueprint screen. A story created
    // before the plan existed has none, and pacing falls back to the model.
    const beats = Array.isArray(story.beats) ? story.beats : [];
    const writingStyle = typeof story.writing_style === "string"
      ? story.writing_style
      : undefined;
    const avoid = typeof story.avoid === "string" ? story.avoid : undefined;
    const chapterLength = (story.chapter_length ?? "standard") as ChapterLength;
    const briefPrompt = buildUserPrompt({
      primaryGenre,
      genres,
      audienceMode,
      spiceLevel,
      storyMode: "series",
      chapterRole,
      seed: story.topic ?? "",
      whereAndWhen: story.where_and_when ?? undefined,
      moments,
      beats,
      chapterNumber: nextChapterNum,
      storyValues,
      writingStyle,
      avoid,
      continuationInstruction: nextInstruction || undefined,
      chapterLength,
      plannedChapterCount,
      characters,
    });
    // Everything above the closing instruction is shared by the two transports.
    // Only the last line differs, because only the last line is about shape.
    const continuationBody =
      `Continue this story with Chapter ${nextChapterNum}.${finaleNote}\n\n${
        userField("story-title", story.title)
      }\n${briefPrompt}\n${formatSeriesStateBlock(seriesState)}\n\n${
        userField("previous-chapters", `${previousText}${earliestContext}`)
      }`;
    const userPrompt =
      `${continuationBody}\n\nRespond with a JSON object only. No markdown fences. Follow the output schema from your instructions.`;
    const proseUserPrompt =
      `${continuationBody}\n\nRespond with the chapter text only. No title, no heading, no commentary, no JSON.`;

    // Persisting a finished continuation is identical whether the prose
    // arrived in one response or in a thousand chunks, so both paths call this.
    // The continuity merge below is the part that must not be duplicated: it
    // decides what an absent field means, and two copies would drift.
    const persistContinuation = async (
      output: ReturnType<typeof parseStructuredOutput>,
    ) => {
      const chapterTitle = output.chapter_title || output.title;
      const content = output.chapter_body;
      if (!content) throw new Error("Generation returned no chapter content");
      const wordCount = content.split(/\s+/).length;

      // A finale ends the series, so there is no next chapter to build pressure
      // toward. The prompt asks for this, but the model does not reliably
      // comply, and hook_type is already forced the same way below.
      // Merge field by field: a partial model response must not blank out
      // continuity that earlier chapters established.
      // Which keys the model actually sent decides whether an empty list means
      // "cleared" or "not mentioned".
      const providedKeys = providedSeriesStateKeys(output.raw_series_state);
      const nextState = isEmptySeriesState(output.series_state)
        ? seriesState
        : mergeSeriesState(seriesState, output.series_state, providedKeys);
      // A mid-series chapter must leave its ending hook in open_hooks so later
      // chapters can pay it off. The model sometimes writes a real hook_text
      // and hook_type but forgets to record it in the state. The chapter itself
      // is sound, so refunding it would discard good work for a bookkeeping
      // miss - record the hook instead.
      const withHook = (state: typeof nextState) => {
        const hook = (output.hook_text ?? "").trim();
        if (!hook || state.open_hooks.includes(hook)) return state;
        return {
          ...state,
          open_hooks: [...state.open_hooks, hook].slice(-12),
        };
      };

      const persistedState = isFinale
        ? { ...nextState, next_chapter_pressure: "" }
        : withHook(nextState);

      const { data: chapter, error: chapterError } = await serviceClient.rpc(
        "complete_continuation_generation",
        {
          p_operation_id: operation.id,
          p_user_id: user.id,
          p_title: chapterTitle,
          p_content: content,
          p_word_count: wordCount,
          p_chapter_role: chapterRole,
          p_first_line: output.first_line || null,
          p_previously_summary: output.previously_summary || null,
          p_series_state: persistedState,
          p_hook_type: isFinale ? "none" : output.hook_type,
          p_hook_text: isFinale ? null : output.hook_text || null,
        },
      );
      if (chapterError || !chapter) {
        throw chapterError ?? new Error("Chapter persistence failed");
      }

      return chapter;
    };

    // Telling the reader their chapter is written.
    //
    // Opt-in per request, because the notify screen is a soft pre-prompt and a
    // reader who is still watching the chapter stream does not need a push. It
    // can never fail the generation: the chapter is already persisted and paid
    // for by the time this runs.
    const notifyChapterReady = (chapter: Record<string, unknown> | null) => {
      if (body.notify_on_ready !== true || !chapter) return;
      runInBackground(notifyInBackground({
        userId: user.id,
        kind: "chapter_ready",
        storyId: story_id,
        title: typeof story.title === "string" ? story.title : "Your story",
        chapterNumber: nextChapterNum,
      }));
    };

    // One refund path for both transports. A failure after the credit is
    // reserved must refund and must be recorded the same way regardless of how
    // the prose was being delivered when it happened.
    const refundContinuation = async (error: unknown) => {
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
              story_id,
              chapter_number: nextChapterNum,
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
            story_id,
            chapter_number: nextChapterNum,
            chapter_role: chapterRole,
            primary_genre: primaryGenre,
          },
          userId: user.id,
        }),
      ];
      await Promise.allSettled(telemetry);
      return { refund, refundError };
    };

    // --- The streamed transport. ---
    //
    // This is a branch rather than a second function because every decision
    // that can reject this request - auth, ownership, the chapter cap, the
    // credit reservation - has already been made above. Only the delivery of
    // the model's answer differs, so only that is duplicated, and the
    // persistence and refund closures are shared with the buffered path.
    //
    // Opted into per request. An older client that does not ask keeps the
    // buffered response byte for byte.
    if (body.stream === true) {
      const band = wordBandFor("series", audienceMode, chapterLength);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          };
          const startedAt = Date.now();
          try {
            send("meta", {
              story_id,
              operation_id: operation.id,
              chapter_number: nextChapterNum,
            });
            send("stage", { stage: "context" });

            const prose = await streamChapterProse({
              systemPrompt: buildContinuationSystemPrompt({
                primaryGenre,
                audienceMode,
                identityLenses,
                spiceLevel,
                language: storyLanguage,
                mode: chapterMode,
                seriesState,
                chapterLength,
                plannedChapterCount,
                output: "prose",
              }),
              userPrompt: proseUserPrompt,
              wordBand: band,
              onCommit: () => send("stage", { stage: "writing" }),
              onDelta: (text) => send("delta", { text }),
            });

            send("stage", { stage: "shaping" });

            // The structured half, recovered after the prose rather than
            // around it. `series_state` is what lets chapter n+1 exist, so it
            // stays behind a strict schema instead of a partial-JSON parser.
            const metadata = await generateFastStructuredText(
              CHAPTER_METADATA_SYSTEM_PROMPT,
              buildChapterMetadataPrompt({
                prose: prose.text,
                storyMode: "series",
                seed: story.topic ?? "",
              }),
              CHAPTER_METADATA_OUTPUT,
              2_000,
              45_000,
            );
            const output = parseStructuredOutput(
              JSON.stringify({
                ...(JSON.parse(metadata.text) as Record<string, unknown>),
                chapter_body: prose.text,
              }),
              `Chapter ${nextChapterNum}`,
            );

            const verdict = chapterLengthVerdict(prose.text, band);
            if (!verdict.usable) {
              // Recorded, not refused. The reader has already read it, and
              // taking it back is worse than a chapter that ran long. See the
              // open item in STORY_GENERATION_FLOW section 10.6.
              await logError({
                bucket: "generation.story",
                severity: "medium",
                source: "runtime",
                errorCode: "streamed_chapter_outside_band",
                error: new Error(
                  `Streamed continuation ran ${verdict.words} words against a ${band.min}-${band.max} band`,
                ),
                context: {
                  story_id,
                  operation_id: operation.id,
                  chapter_number: nextChapterNum,
                  words: verdict.words,
                  band_min: band.min,
                  band_max: band.max,
                  model: prose.model,
                },
                userId: user.id,
              });
            }

            const chapter = await persistContinuation(output);
            notifyChapterReady(chapter);
            send("done", {
              chapter,
              model: prose.model,
              timings: { total: Date.now() - startedAt },
            });
          } catch (error) {
            const committed = error instanceof StreamCommittedError;
            console.error(
              "continue-story stream failed:",
              safeErrorMessage(error),
            );
            const { refund, refundError } = await refundContinuation(error);
            send("error", {
              error: refundError
                ? "Generation failed. Refund is pending retry."
                : refund?.refunded
                ? "Generation failed. Credit refunded."
                : "Generation failed.",
              operation_id: operation.id,
              // Whatever reached the reader stays on screen. Blanking prose
              // somebody has read is the worse of the two bad outcomes.
              partial_prose_shown: committed,
              refunded: Boolean(refund?.refunded),
            });
          } finally {
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        },
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
      // A continuation is always a series chapter, so it uses the chapter band
      // regardless of audience.
      const result = await generateStoryText(
        systemPrompt,
        userPrompt,
        wordBandFor("series", audienceMode, chapterLength),
      );
      const output = parseStructuredOutput(
        result.text,
        `Chapter ${nextChapterNum}`,
      );
      // A continuation that falls back to the text parser has no hook_type and
      // no series_state - the placeholders would persist a chapter that ends
      // nowhere and freezes continuity for the rest of the series, while still
      // charging a credit. Fail so the refund path runs and the reader can
      // retry, rather than saving a hollow chapter.
      if (output.structured === false) {
        throw new Error(
          "Continuation returned unparseable structured output; refusing to persist a chapter without hook or series state",
        );
      }

      const chapter = await persistContinuation(output);
      notifyChapterReady(chapter);
      return respond({ chapter, model: result.model });
    } catch (error) {
      console.error(
        "continue-story post-deduction error:",
        safeErrorMessage(error),
      );
      const { refund, refundError } = await refundContinuation(error);
      if (refundError) {
        console.error(
          "continue-story refund pending:",
          safeErrorMessage(refundError),
        );
        return respond({
          error: "Generation failed. Refund is pending retry.",
          operation_id: operation.id,
        }, 503);
      }
      return respond(
        {
          error: refund?.refunded
            ? "Generation failed. Credit refunded."
            : "Generation completed; retry with the same request ID.",
          operation_id: operation.id,
          status: refund?.status,
        },
        500,
      );
    }
  } catch (error) {
    console.error("continue-story error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.story",
      severity: "high",
      source: "runtime",
      errorCode: "unhandled",
      error,
      context: {
        story_id: observedStoryId,
        operation_id: observedOperationId,
      },
      userId: observedUserId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
});

/** Return a JSON response with the shared CORS headers. */
function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function summarizeChapterForPrompt(chapter: {
  chapter_number: number;
  title?: string | null;
  content?: string | null;
  previously_summary?: string | null;
  hook_type?: string | null;
  hook_text?: string | null;
}): string {
  const summary = chapter.previously_summary?.trim();
  const body = chapter.content?.trim() ?? "";
  const excerpt = body.length > 1200 ? `${body.slice(0, 1200)}...` : body;
  const hook = chapter.hook_text?.trim()
    ? `\nOpening hook: ${chapter.hook_type ?? "unknown"} - ${chapter.hook_text}`
    : "";
  return `Chapter ${chapter.chapter_number}: ${chapter.title ?? "Untitled"}\n${
    summary || excerpt
  }${hook}`;
}
