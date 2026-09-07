import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reportCrudeLexicon } from "../_shared/content-scan.ts";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  GENERATION_GROUNDING_DEADLINE_MS,
  resolveGrounding,
} from "../_shared/grounding-pipeline.ts";
import { AllProvidersFailedError, generateStoryText } from "../_shared/llm.ts";
import {
  errorMessage,
  isStaleReservation,
  readJsonObject,
} from "../_shared/operations.ts";
import {
  buildStorySystemPrompt,
  buildUserPrompt,
} from "../_shared/story-prompts.ts";
import {
  parseStructuredOutput,
  verifyDeliveredMoments,
} from "../_shared/story_text.ts";
import { EMPTY_SERIES_STATE, wordBandFor } from "../_shared/types.ts";
import {
  deriveContentRating,
  validateGenerationRequest,
} from "../_shared/validation.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);
  // Stage timings, in milliseconds from the first line of the handler.
  //
  // Latency here is not guessable: the isolate runs in-region with the
  // database, so a DB round trip is single-digit milliseconds while the LLM
  // call is tens of seconds, and optimising the wrong one is the default
  // mistake. This measures instead. It is a handful of `Date.now()` calls and
  // ships in the response, so a slow generation can be explained from the
  // client's own payload rather than from a log the user cannot see.
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const mark = (name: string) => {
    marks[name] = Date.now() - t0;
  };

  let observedUserId: string | null = null;
  let observedStoryId: string | null = null;
  let observedOperationId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respond({ error: "Unauthorized" }, 401);
    }

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
    mark("auth");
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);
    const input = validateGenerationRequest(body);
    if ("error" in input) {
      return respond({ error: input.error }, input.status ?? 400);
    }
    const {
      primaryGenre,
      genres,
      audienceMode,
      identityLenses,
      spiceLevel,
      storyMode,
      seed,
      characters,
      requestId,
      language,
      whereAndWhen,
      moments,
      beats,
      storyValues,
      writingStyle,
      avoid,
      chapterLength,
      plannedChapterCount,
      illustrateChapters,
      notifyOnReady,
      grounding,
      groundingEntities,
    } = input;
    const chapterRole = storyMode === "series"
      ? "series_opening"
      : "standalone";

    // Use service role client for credit operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The grounding fallback, started here so it overlaps the opening round
    // trip rather than adding to it.
    //
    // Grounding is normally resolved during shaping, which is free and which
    // the writer spends editing chips. Only onboarding calls that endpoint
    // today: a story started in the Create studio arrives with no cards, and
    // without this it would silently lose grounding entirely - the Shivaji
    // case would be wrong for exactly the writers most likely to ask for it.
    //
    // It runs concurrently with `begin_story_generation`, which is 1.4-2.2s of
    // measured round trip, so most of the classification is spent against time
    // the request was already going to wait. It is skipped whenever the client
    // supplied cards, which is the shaped path and the common one.
    //
    // `deadlineMs` is deliberately tighter than the shaping call's. Here the
    // writer is watching a paid generation, not editing chips, and an ungrounded
    // story is a far better outcome than a slow one.
    const groundingFallback = grounding.length || groundingEntities.length
      ? Promise.resolve(null)
      : resolveGrounding({
        idea: seed,
        characterNames: characters?.map((c) => c.name).filter(Boolean),
        cache: serviceClient,
        deadlineMs: GENERATION_GROUNDING_DEADLINE_MS,
      }).catch(() => null);

    // One call opens the generation: idempotency check, story row, credit
    // reservation. It was three sequential round trips, measured at 1.4-2.2s
    // before the model was asked for a word - roughly 11% of an 18-second
    // generation. It is also the correctness fix: the story insert and the
    // deduction now share a transaction, so an insufficient-credit request
    // leaves no orphaned `generating` story behind for a best-effort delete
    // that could itself fail.
    const { data: begun, error: beginError } = await serviceClient.rpc(
      "begin_story_generation",
      {
        p_user_id: user.id,
        p_request_id: requestId,
        p_title: "Generating...",
        p_primary_genre: primaryGenre,
        p_genres: genres,
        p_audience_mode: audienceMode,
        p_identity_lenses: identityLenses,
        p_spice_level: spiceLevel,
        p_story_mode: storyMode,
        p_topic: seed,
        p_language: language ?? "English",
        p_where_and_when: whereAndWhen ?? null,
        p_chapter_length: chapterLength,
        p_planned_chapter_count: plannedChapterCount,
        p_moments: moments,
        p_story_values: storyValues,
        p_writing_style: writingStyle ?? null,
        p_avoid: avoid ?? null,
        p_illustrate_chapters: illustrateChapters,
        p_beats: beats,
      },
    );
    mark("begin");

    if (beginError || !begun) {
      if (beginError?.code === "KTH02") {
        return respond({ error: "Insufficient credits" }, 402);
      }
      if (beginError?.code === "KTH01") {
        return respond({ error: "Generation is already in progress." }, 409);
      }
      throw beginError ?? new Error("Generation could not be started");
    }

    // --- The replay paths. Rare, and deliberately kept off the hot one. ---
    if (begun.replayed) {
      let status: string = begun.status;
      let resultChapterId: string | null = begun.result_chapter_id;

      if (status === "reserved" && isStaleReservation(begun.updated_at)) {
        const { data: reconciliation, error: reconciliationError } =
          await serviceClient.rpc("refund_generation_operation", {
            p_operation_id: begun.operation_id,
            p_user_id: user.id,
            p_error: "Stale generation reservation reconciled on retry",
          });
        if (reconciliationError || !reconciliation) {
          return respond({
            error: "Generation recovery is pending retry.",
            operation_id: begun.operation_id,
          }, 503);
        }
        status = reconciliation.status;
        if (reconciliation.result_chapter_id) {
          resultChapterId = reconciliation.result_chapter_id;
        }
      }

      if (status !== "completed") {
        return respond({
          error: status === "refunded"
            ? "The previous generation failed. Start a new request."
            : "Generation is already in progress.",
          story_id: begun.story_id,
          status,
        }, 409);
      }
      if (!resultChapterId) {
        throw new Error("Completed operation has no chapter");
      }
      const [storyResult, chapterResult] = await Promise.all([
        serviceClient.from("stories").select("*").eq("id", begun.story_id)
          .single(),
        serviceClient.from("chapters").select("*").eq("id", resultChapterId)
          .single(),
      ]);
      if (storyResult.error || chapterResult.error) {
        throw storyResult.error ?? chapterResult.error;
      }
      return respond({
        story: storyResult.data,
        chapter: chapterResult.data,
        replayed: true,
      });
    }

    const story = begun.story;
    const operation = {
      id: begun.operation_id as string,
      balance: begun.balance as number,
    };
    observedStoryId = story.id;
    observedOperationId = operation.id;

    try {
      // Persisting the cast is not on the critical path.
      //
      // The prompt is built from the request body, not from these rows, so
      // nothing between here and the model needs them - only the background
      // media task does, and that starts tens of seconds later. Awaiting the
      // insert before firing the LLM request put a full round trip in front of
      // every generation for no reason. It is awaited after the model answers,
      // so a failure still fails the generation and still refunds the credit.
      const charactersSettled: PromiseLike<{ error: unknown }> = characters
          ?.length
        ? serviceClient
          .from("characters")
          .insert(
            characters.map((c) => ({
              story_id: story.id,
              name: c.name,
              description: c.description,
              background: c.background,
              appearance: c.appearance,
              portrait_url: c.portraitUrl,
              is_hero: c.isHero ?? false,
            })),
          )
          // A rejection nothing is awaiting yet surfaces as an unhandled
          // promise rejection, which can take the isolate down before the
          // model has even answered. Fold it into the value instead.
          .then((r) => ({ error: r.error as unknown }), (error: unknown) => ({
            error,
          }))
        : Promise.resolve({ error: null });

      // Awaited only now, so the fallback has had the whole opening round trip
      // to finish. A null here is every failure mode collapsed into one: no
      // entity, a dead provider, or a blown deadline all mean an ungrounded
      // prompt, which is what every story had before this existed.
      const fallback = await groundingFallback;
      const resolvedGrounding = fallback?.cards.length
        ? fallback.cards
        : grounding;
      const resolvedEntities = fallback?.entities.length
        ? fallback.entities
        : groundingEntities;

      const systemPrompt = buildStorySystemPrompt({
        primaryGenre,
        audienceMode,
        identityLenses,
        spiceLevel,
        storyMode,
        chapterRole,
        language,
        chapterLength,
        plannedChapterCount,
      });
      const userPrompt = buildUserPrompt({
        primaryGenre,
        genres,
        audienceMode,
        spiceLevel,
        storyMode,
        chapterRole,
        seed,
        characters,
        language,
        whereAndWhen,
        moments,
        beats,
        // Chapter one always opens the plan, so the beat and the chapter agree
        // without the caller having to say which is which.
        chapterNumber: 1,
        storyValues,
        writingStyle,
        avoid,
        chapterLength,
        plannedChapterCount,
        grounding: resolvedGrounding,
      });
      mark("grounding");
      mark("prompt_built");
      const result = await generateStoryText(
        systemPrompt,
        userPrompt,
        wordBandFor(storyMode, audienceMode, chapterLength),
      );
      mark("llm");

      const { error: characterError } = await charactersSettled;
      if (characterError) throw characterError;
      mark("characters");

      const output = parseStructuredOutput(result.text, "Untitled Story");
      if (!output.chapter_body) {
        throw new Error("Generation returned no story content");
      }
      // A series opening whose structured parse failed has no hook and no
      // series_state - the text fallback only supplies placeholders. Persisting
      // it starts a series that cannot be continued, so fail and let the refund
      // path run. Standalone stories need neither, so they keep the fallback.
      if (storyMode === "series" && output.structured === false) {
        throw new Error(
          "Series opening returned unparseable structured output; refusing to start a series without hook or series state",
        );
      }
      // Chapter 1 opens the delivered set, so this is where an invented
      // entry would enter it. Only moments the brief actually asked for
      // survive into stored state.
      output.series_state = verifyDeliveredMoments(
        output.series_state,
        moments,
      );
      const wordCount = output.chapter_body.split(/\s+/).length;
      // Report-only, and free unless it fires: the scan itself is synchronous
      // and awaits nothing when the prose is clean, which is the case this
      // path is optimised for.
      await reportCrudeLexicon(output.chapter_body, {
        feature: "generate_story",
        storyId: story.id,
        userId: user.id,
      });
      const contentRating = deriveContentRating(audienceMode, spiceLevel);

      const { data: chapter, error: completionError } = await serviceClient.rpc(
        "complete_story_generation",
        {
          p_operation_id: operation.id,
          p_story_id: story.id,
          p_author_id: user.id,
          p_title: output.title,
          p_content: output.chapter_body,
          p_word_count: wordCount,
          p_themes: output.themes,
          p_first_line: output.first_line || null,
          p_previously_summary: output.previously_summary || null,
          p_content_rating: contentRating,
          p_chapter_title: output.chapter_title || "Chapter 1",
          p_story_mode: storyMode,
          p_chapter_role: chapterRole,
          p_series_state: storyMode === "series"
            ? output.series_state ?? EMPTY_SERIES_STATE
            : EMPTY_SERIES_STATE,
          p_hook_type: storyMode === "series" ? output.hook_type : "none",
          p_hook_text: storyMode === "series" ? output.hook_text || null : null,
        },
      );
      if (completionError || !chapter) {
        throw completionError ?? new Error("Story persistence failed");
      }
      mark("persist");

      // Grounding is recorded after the story exists, not inside
      // `complete_story_generation`.
      //
      // Two reasons. It is not part of the credit transaction - a card that
      // fails to persist must not roll back a chapter the writer has paid for
      // and is about to read - and it is what `continue-story` reads to keep
      // chapter seven calling an entity what chapter one called it, which is a
      // read that happens minutes later, not on this response.
      //
      // Both columns are outside the owner-update grant, so this runs on the
      // service client. A failure here costs later chapters their grounding
      // and nothing else, which is why it is logged rather than thrown.
      if (resolvedGrounding.length || resolvedEntities.length) {
        const { error: groundingError } = await serviceClient
          .from("stories")
          .update({
            grounding: resolvedGrounding,
            grounding_entities: resolvedEntities,
          })
          .eq("id", story.id);
        if (groundingError) {
          console.error(
            "generate-story grounding persist failed:",
            safeErrorMessage(groundingError),
          );
          await logError({
            bucket: "generation.story",
            severity: "low",
            source: "runtime",
            errorCode: "grounding_persist_failed",
            error: groundingError,
            context: { feature: "grounding", story_id: story.id },
            userId: user.id,
          });
        }
      }

      // Chapter 1's art is the story's cover (section 10.4, decisions 38 and
      // 40), and the cast's portraits are generated once, now, because
      // Interactive mode has no later moment when the whole cast is known
      // (decision 20).
      //
      // Both run after the response. The user has paid for text and has it;
      // making them wait out four image requests before reading a word would
      // be the wrong trade, and the concept card gives the story a face
      // meanwhile. Nothing below can fail the request - see `media.ts`.
      //
      // Imported here rather than at the top of the file: `media.ts` pulls in
      // `image.ts` and the cover-prompt tables, none of which the text path
      // touches, so parsing them on a cold isolate delayed the response by work
      // not needed until this line. By now the chapter is already persisted.
      //
      // The import itself is inside the guard, not only what it returns.
      // `await import()` rejects when module resolution or a remote dependency
      // fetch fails on a cold isolate, and `media.ts` pulls in `image.ts` and
      // the cover-prompt tables - the widest dependency graph in this handler.
      // Unguarded, that rejection reaches the outer catch *after* the chapter
      // is persisted, and the user loses a generation whose text succeeded.
      // What the response tells the client about the cover has to match what
      // was persisted. Claiming 'generating' after scheduling failed would put
      // the reader on a spinner for work that will never start.
      let coverStatus: "generating" | "failed" = "generating";
      try {
        const media = await import("../_shared/media.ts");
        media.runInBackground(media.generateStoryMedia({
          storyId: story.id,
          operationId: operation.id,
          userId: user.id,
          genre: primaryGenre,
          title: output.title,
          themes: output.themes,
          whereAndWhen,
          avoid,
          notifyOnReady,
        }));
      } catch (mediaError) {
        // A story without art is a worse story, not a failed one — but the row
        // must not be left saying 'pending'. The response has already told the
        // client 'generating', and 'pending' means "not attempted yet", so a
        // client that re-fetched would wait for work that will never start.
        // 'failed' is the truth, and it renders the concept card as final,
        // which decision 39 already treats as a legitimate published look.
        console.error(
          "generate-story media scheduling failed:",
          safeErrorMessage(mediaError),
        );
        coverStatus = "failed";
        await serviceClient
          .from("stories")
          .update({ cover_status: "failed" })
          .eq("id", story.id);
        await Promise.all(
          (["cast", "cover"] as const).map(async (component) => {
            const { error: refundError } = await serviceClient.rpc(
              "refund_story_media_component",
              {
                p_operation_id: operation.id,
                p_user_id: user.id,
                p_component: component,
              },
            );
            if (refundError) {
              await logError({
                bucket: "credits",
                severity: "high",
                source: "runtime",
                errorCode: "story_media_refund_failed",
                error: refundError,
                context: {
                  story_id: story.id,
                  operation_id: operation.id,
                  component,
                },
                userId: user.id,
              });
            }
          }),
        );
      }

      return respond({
        story: {
          ...story,
          // 'generating': in flight on a background task, so the client shows
          // the concept card until it reads 'ready'. 'failed' when scheduling
          // itself did not happen — the concept card is then final.
          cover_status: coverStatus,
          title: output.title,
          word_count: wordCount,
          status: "complete",
          primary_genre: primaryGenre,
          story_mode: storyMode,
          series_state: storyMode === "series"
            ? output.series_state ?? EMPTY_SERIES_STATE
            : EMPTY_SERIES_STATE,
          first_line: output.first_line,
          previously_summary: output.previously_summary,
          content_rating: contentRating,
        },
        chapter,
        balance: operation.balance,
        model: result.model,
        // Cumulative milliseconds from the start of the handler. `llm` minus
        // `prompt_built` is the provider chain; everything else is ours.
        timings: { ...marks, total: Date.now() - t0 },
      });
    } catch (error) {
      console.error(
        "generate-story post-deduction error:",
        safeErrorMessage(error),
      );
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
              story_id: story.id,
              story_mode: storyMode,
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
            story_id: story.id,
            story_mode: storyMode,
            primary_genre: primaryGenre,
          },
          userId: user.id,
        }),
      ];
      await Promise.allSettled(telemetry);

      if (refundError) {
        console.error(
          "generate-story refund pending:",
          safeErrorMessage(refundError),
        );
        return respond({
          error: "Story generation failed. Refund is pending retry.",
          operation_id: operation.id,
        }, 503);
      }
      return respond(
        {
          error: refund?.refunded
            ? "Story generation failed. Credit refunded."
            : "Story generation completed; retry with the same request ID.",
          operation_id: operation.id,
          status: refund?.status,
        },
        500,
      );
    }
  } catch (error) {
    console.error("generate-story error:", safeErrorMessage(error));
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
