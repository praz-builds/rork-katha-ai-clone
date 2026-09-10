/**
 * Streamed story generation.
 *
 * The same contract as `generate-story` - same request body, same credit
 * reservation, same persistence, same terminal payload - delivered as
 * Server-Sent Events so the reader sees prose at ~4s instead of nothing for
 * ~27s. See `_shared/story-stream.ts` for the measurements and the design.
 *
 * # Why this is a separate function rather than a flag on `generate-story`
 *
 * A streamed response cannot change its status code once the body has started,
 * so every decision that can reject a request has to happen before the first
 * byte. That is a genuinely different control flow, not a branch: the replay
 * paths, the 402 and the 409 all return ordinary JSON, and only the part after
 * the credit is reserved is a stream. Interleaving both shapes in one handler
 * would make the point of no return invisible.
 *
 * `generate-story` also stays the path for retries and for clients that cannot
 * stream, so it must keep working unchanged.
 *
 * # The event protocol
 *
 * | event   | when                       | payload                          |
 * |---------|----------------------------|----------------------------------|
 * | `meta`  | once, before any prose     | `{ story_id, operation_id }`     |
 * | `stage` | at each real transition    | `{ stage }`                      |
 * | `delta` | per chunk of prose         | `{ text }`                       |
 * | `done`  | once, terminal             | `{ story, chapter, balance, .. }`|
 * | `error` | once, terminal             | `{ error, operation_id, .. }`    |
 *
 * `stage` exists so the crafting loader can show real progress instead of a
 * timed loop. `WRITER_FLOW_REBUILD_PLAN` section 3 is explicit that a bar which
 * is not driven by real transitions is lying to the user, and before this there
 * were no real transitions to drive it with.
 *
 * Exactly one of `done` or `error` is ever sent, and the stream closes after it.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { reportCrudeLexicon } from "../_shared/content-scan.ts";
import { deriveGatingReason } from "../_shared/entity-visibility-gate.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import { buildStoryDonePayload } from "../_shared/generation-done.ts";
import {
  applyRequestedVisibility,
  type VisibilityClient,
} from "../_shared/publish.ts";
import {
  rememberStoryCharacters,
  resolveSavedCharacters,
  type SavedCharacterClient,
} from "../_shared/saved-characters.ts";
import {
  CLASSIFICATION_DEADLINE_MS,
  CLASSIFICATION_NOT_ATTEMPTED,
  type ClassificationOutcome,
  classifyIdea,
  GENERATION_GROUNDING_DEADLINE_MS,
  groundingCardsWithin,
  reportClassificationFailure,
} from "../_shared/grounding-pipeline.ts";
import type { GroundingCard } from "../_shared/grounding-types.ts";
import { claimGroundingFallback } from "../_shared/grounding-rate-limit.ts";
import {
  AllProvidersFailedError,
  generateFastStructuredText,
} from "../_shared/llm.ts";
import {
  errorMessage,
  isStaleReservation,
  readJsonObject,
} from "../_shared/operations.ts";
import { fetchPhraseSeeds } from "../_shared/phrases.ts";
import {
  buildStoryProsePrompt,
  buildUserPrompt,
} from "../_shared/story-prompts.ts";
import {
  buildChapterMetadataPrompt,
  CHAPTER_METADATA_OUTPUT,
  CHAPTER_METADATA_SYSTEM_PROMPT,
  chapterLengthVerdict,
  streamChapterProse,
  StreamCommittedError,
} from "../_shared/story-stream.ts";
import {
  parseStructuredOutput,
  verifyDeliveredMoments,
} from "../_shared/story_text.ts";
import type { ChapterRole } from "../_shared/types.ts";
import { EMPTY_SERIES_STATE, wordBandFor } from "../_shared/types.ts";
import {
  deriveContentRating,
  validateGenerationRequest,
} from "../_shared/validation.ts";

/**
 * The metadata call's budget.
 *
 * It runs after the reader is already reading, so it is off the perceived
 * critical path entirely and can afford a real fallback window. It is still
 * bounded, because the chapter cannot be persisted until it returns.
 */
const METADATA_DEADLINE_MS = 45_000;
const METADATA_MAX_TOKENS = 2_000;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  let observedUserId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return jsonResponse({ error: "Invalid JSON request body" }, 400);
    const input = validateGenerationRequest(body);
    if ("error" in input) {
      return jsonResponse({ error: input.error }, input.status ?? 400);
    }

    const {
      primaryGenre,
      genres,
      audienceMode,
      identityLenses,
      spiceLevel,
      storyMode,
      seed,
      characters: requestedCharacters,
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
      visibility,
    } = input;
    const chapterRole: ChapterRole = storyMode === "series"
      ? "series_opening"
      : "standalone";

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    // A brief may pull a character from the writer's saved library by id.
    // Resolved before the credit is reserved, so the prompt and the cast rows
    // both see the filled-in character; an id that is not theirs is dropped.
    // Narrowed structurally, as `chapters.ts` does: the generated client type
    // is too deep for the compiler to match against a small interface.
    const characterClient = serviceClient as unknown as SavedCharacterClient;
    const characters = await resolveSavedCharacters(
      characterClient,
      user.id,
      requestedCharacters,
    );

    // Same shape as the buffered path, and deliberately identical to it: the
    // long note in `generate-story/index.ts` explains why classification is
    // split from cards, why it now runs on every generation rather than only
    // the unshaped one, why a refused rate-limit claim is a failure rather
    // than an empty verdict, and why the ordering against
    // `begin_story_generation` must not change.
    //
    // The streamed path has one extra reason to want this shape. It is the
    // path a first chapter actually takes, so it is the path the publish
    // toggle rides on, and it is also the one that cannot afford latency in
    // front of the first token - page one is meant to appear ~20s in. A
    // classification that resolves at persist time costs it nothing.
    const classificationPromise: Promise<ClassificationOutcome> =
      claimGroundingFallback({
        user,
        request: req,
        serviceRoleKey,
        client: serviceClient,
      }).then((allowed) =>
        allowed
          ? classifyIdea({
            idea: seed,
            characterNames: characters?.map((c) => c.name).filter(Boolean),
            deadlineMs: CLASSIFICATION_DEADLINE_MS,
          })
          : CLASSIFICATION_NOT_ATTEMPTED
      ).catch(() => CLASSIFICATION_NOT_ATTEMPTED);

    const needsGroundingFallback = grounding.length === 0;
    const groundingFallback = needsGroundingFallback
      ? groundingCardsWithin(
        classificationPromise,
        serviceClient,
        GENERATION_GROUNDING_DEADLINE_MS,
      )
      : Promise.resolve<GroundingCard[]>([]);

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

    if (beginError || !begun) {
      if (beginError?.code === "KTH02") {
        return jsonResponse({ error: "Insufficient credits" }, 402);
      }
      if (beginError?.code === "KTH01") {
        return jsonResponse(
          { error: "Generation is already in progress." },
          409,
        );
      }
      throw beginError ?? new Error("Generation could not be started");
    }

    // A replayed operation has nothing to stream: either the chapter already
    // exists, in which case it is returned whole, or it is in flight or
    // refunded, in which case there is no prose to show. Both are ordinary JSON,
    // and both are why the stream cannot open until this point has passed.
    if (begun.replayed) {
      let status: string = begun.status;
      let resultChapterId: string | null = begun.result_chapter_id;

      // A reservation that nothing ever finished. The buffered handler has
      // reconciled this since it was written; this one did not, and the
      // client only ever calls this one -- `generateStory` in the Expo client
      // has no callers at all. So the three credits a first chapter costs
      // were stranded permanently: the isolate dies mid-stream (wall-clock
      // kill, deploy eviction, the worker torn down after a disconnect), the
      // refund never runs, and every retry of the same request id lands here
      // and is told "Generation is already in progress." forever, because the
      // client deliberately keeps its request id across a transport error.
      // The user's only escape was to start a different story, which left the
      // credits behind.
      //
      // Reconciling here refunds them and lets the same id start again -- and
      // a first chapter is the most expensive thing anyone buys, so it is the
      // worst place in the product to have been silently keeping the money.
      if (status === "reserved" && isStaleReservation(begun.updated_at)) {
        const { data: reconciliation, error: reconciliationError } =
          await serviceClient.rpc("refund_generation_operation", {
            p_operation_id: begun.operation_id,
            p_user_id: user.id,
            p_error: "Stale generation reservation reconciled on retry",
          });
        // A failed reconciliation must not read as "in progress": that is the
        // message that taught the user to stop retrying. 503 is the honest
        // answer, and it is the one the client retries.
        if (reconciliationError || !reconciliation) {
          return jsonResponse({
            error: "Generation recovery is pending retry.",
            operation_id: begun.operation_id,
            story_id: begun.story_id,
          }, 503);
        }
        status = reconciliation.status;
        if (reconciliation.result_chapter_id) {
          resultChapterId = reconciliation.result_chapter_id;
        }
      }

      if (status !== "completed" || !resultChapterId) {
        return jsonResponse({
          error: status === "refunded"
            ? "The previous generation failed. Start a new request."
            : "Generation is already in progress.",
          story_id: begun.story_id,
          status,
        }, 409);
      }
      const [storyResult, chapterResult] = await Promise.all([
        serviceClient.from("stories").select("*").eq("id", begun.story_id)
          .single(),
        serviceClient.from("chapters").select("*").eq(
          "id",
          resultChapterId,
        ).single(),
      ]);
      if (storyResult.error || chapterResult.error) {
        throw storyResult.error ?? chapterResult.error;
      }
      return jsonResponse({
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

    // --- Past this line the credit is reserved and the response is a stream. ---

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
        const close = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };

        try {
          send("meta", {
            story_id: story.id,
            operation_id: operation.id,
            balance: operation.balance,
          });
          send("stage", { stage: "context" });

          // The cast insert is off the critical path for the same reason it is
          // in `generate-story`: the prompt is built from the request body, not
          // from these rows, and only the background media task needs them. Its
          // rejection is folded into a value so it cannot surface as an
          // unhandled rejection and take the isolate down mid-stream.
          const charactersSettled: PromiseLike<{ error: unknown }> =
            characters?.length
              ? serviceClient.from("characters").insert(
                characters.map((c) => ({
                  story_id: story.id,
                  name: c.name,
                  description: c.description,
                  background: c.background,
                  appearance: c.appearance,
                  // A portrait the writer generated on the brief screen, and
                  // paid for. Dropping it here silently discards that work and
                  // the cast is re-rendered from scratch by the media task.
                  // `generate-story` carries it; this path is newer and did not,
                  // which is the kind of gap two parallel write paths produce.
                  portrait_url: c.portraitUrl,
                  is_hero: c.isHero ?? false,
                  saved_character_id: c.savedCharacterId ?? null,
                })),
              ).then(
                (r) => ({ error: r.error as unknown }),
                (error: unknown) => ({ error }),
              )
              : Promise.resolve({ error: null });

          const promptParams = {
            primaryGenre,
            audienceMode,
            identityLenses,
            spiceLevel,
            storyMode,
            chapterRole,
            language,
            chapterLength,
            plannedChapterCount,
          };
          // Cards only. The classification behind them is read after the
          // chapter is persisted, where the wait is free - see the note where
          // `classificationPromise` is created.
          const fallbackCards = await groundingFallback;
          const resolvedGrounding = fallbackCards.length
            ? fallbackCards
            : grounding;

          // The reader's saved phrases seed their next story. Best-effort: an
          // empty list renders the prompt byte-identically, so a lookup failure
          // costs the language layer and never the paid generation.
          const savedPhrases = await fetchPhraseSeeds(
            serviceClient,
            user.id,
            language,
          );

          const systemPrompt = buildStoryProsePrompt(promptParams);
          const userPrompt = buildUserPrompt({
            ...promptParams,
            genres,
            seed,
            characters,
            whereAndWhen,
            moments,
            beats,
            chapterNumber: 1,
            storyValues,
            writingStyle,
            avoid,
            savedPhrases,
            grounding: resolvedGrounding,
          });

          const band = wordBandFor(storyMode, audienceMode, chapterLength);
          let firstTokenAt = 0;
          const startedAt = Date.now();

          const prose = await streamChapterProse({
            systemPrompt,
            userPrompt,
            wordBand: band,
            onCommit: () => {
              firstTokenAt = Date.now() - startedAt;
              send("stage", { stage: "writing" });
            },
            onDelta: (text) => send("delta", { text }),
          });

          send("stage", { stage: "shaping" });

          const { error: characterError } = await charactersSettled;
          if (characterError) throw characterError;

          // The metadata call. Structured, not streamed, and deliberately after
          // the prose rather than around it: `series_state` is what makes a
          // series continuable, and recovering it from a partially-arrived JSON
          // object is exactly the fragility this split exists to avoid.
          const metadata = await generateFastStructuredText(
            CHAPTER_METADATA_SYSTEM_PROMPT,
            buildChapterMetadataPrompt({
              prose: prose.text,
              storyMode,
              seed,
            }),
            CHAPTER_METADATA_OUTPUT,
            METADATA_MAX_TOKENS,
            METADATA_DEADLINE_MS,
          );
          // Reuse the same parser the non-streamed path uses, so a field that
          // is missing or malformed degrades identically on both.
          const output = parseStructuredOutput(
            JSON.stringify({
              ...(JSON.parse(metadata.text) as Record<string, unknown>),
              chapter_body: prose.text,
            }),
            "Untitled Story",
          );

          // Chapter 1 opens the delivered set, so this is where an invented
          // entry would enter it. Only moments the brief actually asked for
          // survive into stored state.
          output.series_state = verifyDeliveredMoments(
            output.series_state,
            moments,
          );
          // The reader has already been shown this prose, so the scan can only
          // report - see the module comment in content-scan.ts.
          await reportCrudeLexicon(prose.text, {
            feature: "generate_story_stream",
            storyId: story.id,
            userId: observedUserId,
          });
          const verdict = chapterLengthVerdict(prose.text, band);
          if (!verdict.usable) {
            // Not a failure: the reader has already read this chapter, so
            // discarding it would take away something they were shown and
            // charged for. It is recorded instead, because a model that
            // consistently misses its band changes reading-time estimates and
            // narration cost, and that has to be visible to be fixed.
            await logError({
              bucket: "generation.story",
              severity: "medium",
              source: "runtime",
              errorCode: "streamed_chapter_outside_band",
              error: new Error(
                `Streamed chapter ran ${verdict.words} words against a ${band.min}-${band.max} band`,
              ),
              context: {
                story_id: story.id,
                operation_id: operation.id,
                words: verdict.words,
                band_min: band.min,
                band_max: band.max,
                truncated: prose.truncated,
                model: prose.model,
              },
              userId: user.id,
            });
          }

          const contentRating = deriveContentRating(audienceMode, spiceLevel);
          const { data: chapter, error: completionError } = await serviceClient
            .rpc("complete_story_generation", {
              p_operation_id: operation.id,
              p_story_id: story.id,
              p_author_id: user.id,
              p_title: output.title,
              p_content: prose.text,
              p_word_count: verdict.words,
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
              p_hook_text: storyMode === "series"
                ? output.hook_text || null
                : null,
            });
          if (completionError || !chapter) {
            throw completionError ?? new Error("Story persistence failed");
          }

          // The classification, read at the one moment waiting for it is free:
          // the chapter is written and on disk, and this started before the
          // opening RPC. Same trade as the buffered path.
          const classification = await classificationPromise;
          const gateReason = classification.status === "ok"
            ? deriveGatingReason(classification.entities)
            : null;
          const resolvedEntities = classification.status === "ok"
            ? classification.entities
            : groundingEntities;
          if (classification.status !== "ok") {
            await reportClassificationFailure({
              outcome: classification,
              feature: "entity_gate",
              storyId: story.id,
              userId: user.id,
            });
          }

          // Same rationale as the buffered path: outside the credit
          // transaction, because a card that fails to store must not roll back
          // a chapter the reader is already looking at. Unconditional, because
          // `entity_classification_status` is a fact about every story and an
          // unwritten row is not one of its values.
          {
            const { error: groundingError } = await serviceClient
              .from("stories")
              .update({
                grounding: resolvedGrounding,
                grounding_entities: resolvedEntities,
                entity_gate_reason: gateReason,
                entity_classification_status: classification.status === "ok"
                  ? "ok"
                  : "unavailable",
              })
              .eq("id", story.id);
            if (groundingError) {
              console.error(
                "generate-story-stream grounding persist failed:",
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

          // The visibility toggle is the publish button. Applied after the
          // grounding write above so the gate reason is on the row before the
          // 00050 CHECK is asked to admit `is_public = true`; the outcome
          // travels in `done` so the client can say why a public request
          // stayed private without a second call.
          const visibilityOutcome = await applyRequestedVisibility(
            serviceClient as unknown as VisibilityClient,
            {
              storyId: story.id,
              requested: visibility,
              isAnonymous: user.is_anonymous === true,
              classificationAvailable: classification.status === "ok",
              gateReason,
            },
          );

          // The cast joins the writer's saved characters. Best-effort, after
          // the chapter is persisted and paid for.
          await rememberStoryCharacters(characterClient, user.id, story.id);

          send("stage", { stage: "art" });

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
            console.error(
              "generate-story-stream media scheduling failed:",
              safeErrorMessage(mediaError),
            );
            coverStatus = "failed";
            await serviceClient.from("stories").update({
              cover_status: "failed",
            }).eq("id", story.id);
          }

          // One builder for both transports - see `generation-done.ts` for
          // the schema tie that keeps `beats`, `themes` and `series_state`
          // from silently dropping out of this payload again.
          send(
            "done",
            buildStoryDonePayload({
              story,
              chapter,
              output,
              storyMode,
              primaryGenre,
              contentRating,
              coverStatus,
              words: verdict.words,
              beats,
              balance: operation.balance,
              model: prose.model,
              timings: {
                first_token: firstTokenAt,
                total: Date.now() - startedAt,
              },
              visibility: visibilityOutcome,
            }),
          );
        } catch (error) {
          // Every failure past the reservation refunds, exactly as the
          // non-streamed path does. The difference is what the user is left
          // holding: if prose already reached them it stays on screen, because
          // erasing text someone has read is worse than leaving it there
          // unfinished.
          const committed = error instanceof StreamCommittedError;
          console.error(
            "generate-story-stream failed:",
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

          await Promise.allSettled([
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
                  streamed: true,
                },
                userId: user.id,
              })]
              : []),
            logError({
              bucket: "generation.story",
              severity: "high",
              source: "runtime",
              errorCode: committed
                ? "stream_failed_after_commit"
                : "stream_failed_before_commit",
              error,
              context: {
                operation_id: operation.id,
                story_id: story.id,
                story_mode: storyMode,
                primary_genre: primaryGenre,
              },
              userId: user.id,
            }),
          ]);

          send("error", {
            error: refundError
              ? "Story generation failed. Refund is pending retry."
              : refund?.refunded
              ? "Story generation failed. Credit refunded."
              : "Story generation failed.",
            operation_id: operation.id,
            story_id: story.id,
            // The client needs this to decide whether to clear the prose it has
            // already rendered. It must not: partial is better than blank.
            partial_prose_shown: committed,
            refunded: Boolean(refund?.refunded),
          });
        } finally {
          close();
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
        // Without this a proxy may buffer the whole body and hand it over at
        // the end, which produces exactly the latency this function exists to
        // remove, and produces it invisibly.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("generate-story-stream error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.story",
      severity: "high",
      source: "runtime",
      errorCode: "unhandled",
      error,
      context: { streamed: true },
      userId: observedUserId,
    });
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
