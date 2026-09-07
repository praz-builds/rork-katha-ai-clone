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
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  GENERATION_GROUNDING_DEADLINE_MS,
  resolveGrounding,
} from "../_shared/grounding-pipeline.ts";
import {
  AllProvidersFailedError,
  generateFastStructuredText,
} from "../_shared/llm.ts";
import { errorMessage, readJsonObject } from "../_shared/operations.ts";
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
    const chapterRole: ChapterRole = storyMode === "series"
      ? "series_opening"
      : "standalone";

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Same fallback as the buffered path, started before the opening round
    // trip so it overlaps it. See the long note in `generate-story/index.ts`
    // for why the Create studio needs this and the shaped path does not.
    const groundingFallback = grounding.length || groundingEntities.length
      ? Promise.resolve(null)
      : resolveGrounding({
        idea: seed,
        characterNames: characters?.map((c) => c.name).filter(Boolean),
        cache: serviceClient,
        deadlineMs: GENERATION_GROUNDING_DEADLINE_MS,
      }).catch(() => null);

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
      if (begun.status !== "completed" || !begun.result_chapter_id) {
        return jsonResponse({
          error: begun.status === "refunded"
            ? "The previous generation failed. Start a new request."
            : "Generation is already in progress.",
          story_id: begun.story_id,
          status: begun.status,
        }, 409);
      }
      const [storyResult, chapterResult] = await Promise.all([
        serviceClient.from("stories").select("*").eq("id", begun.story_id)
          .single(),
        serviceClient.from("chapters").select("*").eq(
          "id",
          begun.result_chapter_id,
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
          const fallback = await groundingFallback;
          const resolvedGrounding = fallback?.cards.length
            ? fallback.cards
            : grounding;
          const resolvedEntities = fallback?.entities.length
            ? fallback.entities
            : groundingEntities;

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

          // Same rationale as the buffered path: outside the credit
          // transaction, because a card that fails to store must not roll back
          // a chapter the reader is already looking at.
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

          send("done", {
            story: {
              ...story,
              cover_status: coverStatus,
              title: output.title,
              word_count: verdict.words,
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
            model: prose.model,
            timings: {
              first_token: firstTokenAt,
              total: Date.now() - startedAt,
            },
          });
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
