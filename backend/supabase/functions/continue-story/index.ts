import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildPreviousChapterWindow,
  summarizeChapterForPrompt,
  trimToEnds,
} from "../_shared/continuation-window.ts";
import {
  chooseDirection,
  type OfferedDirection,
} from "../_shared/direction-choice.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refundAutoChapterRun } from "../_shared/auto-run.ts";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { notifyInBackground } from "../_shared/notify.ts";
import { generateChapterArt, runInBackground } from "../_shared/media.ts";
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
  nameChapterEarly,
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
  type AudienceMode,
  type ChapterLength,
  type CharacterInput,
  DEFAULT_PLANNED_CHAPTER_COUNT,
  type IdentityLens,
  isPlannedChapterCount,
  MAX_PLANNED_CHAPTER_COUNT,
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

    // FOUR READS, ONE ROUND TRIP'S WORTH OF WAITING.
    //
    // These used to run one after another, and nothing downstream of the first
    // decides what the others ask for -- the replay lookup, the story row, the
    // cast and the recent-chapter window are all keyed on ids already in hand.
    // Serially they measured ~290 ms of dead time in front of a reader who has
    // just tapped "next chapter" and is watching a loader; issued together they
    // cost the slowest of them.
    //
    // The DECISION order below is unchanged, deliberately: a replay still
    // answers before ownership, ownership still answers before the chapter
    // window. Only the waiting moved. Reading a row for a caller who turns out
    // not to own the story is harmless -- these are service-role reads whose
    // results are discarded, and the response is byte-identical to what it was.
    const [operationRead, storyRead, castRead, chapterWindowRead] =
      await Promise
        .all([
          serviceClient
            .from("generation_operations")
            .select("id, story_id, status, result_chapter_id, updated_at")
            .eq("user_id", user.id)
            .eq("request_id", requestId)
            .maybeSingle(),
          serviceClient
            .from("stories")
            .select(
              "id, title, genre, primary_genre, audience_mode, identity_lenses, spice_level, topic, author_id, language, story_mode, series_state, previously_summary, where_and_when, moments, beats, story_values, writing_style, avoid, chapter_length, planned_chapter_count, grounding, illustrate_chapters, story_flow, image_style",
            )
            .eq("id", story_id)
            .single(),
          serviceClient
            .from("characters")
            .select("name, description, background, appearance, is_hero")
            .eq("story_id", story_id)
            .order("name", { ascending: true }),
          // Keep prompt context bounded while deriving the next chapter from latest.
          serviceClient
            .from("chapters")
            .select(
              "chapter_number, title, content, chapter_role, previously_summary, hook_type, hook_text",
            )
            .eq("story_id", story_id)
            .order("chapter_number", { ascending: false })
            .limit(4),
        ]);

    const { data: existingOperation, error: existingOperationError } =
      operationRead;
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
    const { data: story, error: storyError } = storyRead;

    if (storyError || !story || story.author_id !== user.id) {
      return respond({ error: "Story not found" }, 404);
    }

    // Character sheets are part of the durable brief. Re-loaded for every
    // continuation so later chapters retain the cast's voice, motivations, and
    // physical detail instead of relying only on recent prose excerpts.
    const { data: castRows, error: castError } = castRead;
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

    /**
     * The direction chips the client had on screen, in the order it ranked
     * them.
     *
     * Sent for BOTH modes and recorded either way. In interactive mode the
     * reader picked one and it arrives as `next_instruction`; in auto mode
     * nobody was asked and the choosing happens below. Recording the offer in
     * both cases is what makes the future "here is the path your story took"
     * surface possible at all -- the options were derived from a story state
     * that has already moved on by the time anyone asks.
     */
    const directionsOffered = parseOfferedDirections(body.directions_offered);

    const { data: chapters, error: chaptersError } = chapterWindowRead;
    if (chaptersError) throw chaptersError;
    if (!chapters?.length) {
      return respond({ error: "Story has no chapter to continue" }, 409);
    }

    const nextChapterNum = chapters[0].chapter_number + 1;

    // The stored plan is a RANGE now, not one of three values.
    //
    // Extension below raises `planned_chapter_count` by one, so 2, 4, 5 and
    // every other number up to the ceiling are live rows. The old read matched
    // against `[3, 7, 15]` and fell back to 3 for anything else, which would
    // tell the author of a 4-chapter story that it is planned for 3 and refuse
    // the chapter they had already paid to plan for.
    const plannedChapterCount: PlannedChapterCount =
      isPlannedChapterCount(story.planned_chapter_count)
        ? story.planned_chapter_count
        : DEFAULT_PLANNED_CHAPTER_COUNT;

    /*
      EXTENSION: growing a finished story one chapter past its plan.

      Reaching the plan is still an ending by default -- an unasked-for
      continuation past it is a credit spent on a story the writer said was
      finished, which is why this stays an explicit opt-in the client has to
      send rather than something inferred from "there is a chapter after this
      one". `extend` is set by exactly one surface: a tap on a direction chip
      at the end of a finished series, by its own author.

      AUTO MODE NEVER SENDS IT. `autoChapterToWriteAhead` stops at the plan and
      must keep stopping there: auto-continue writes chapters with no tap
      behind them, and an auto story that could extend itself would spend a
      reader's whole balance on a story they planned to be three chapters long.

      The raise itself is NOT done here. It is handed to
      `reserve_generation_operation`, which performs it in the same transaction
      as the credit debit and under the same advisory locks -- see the note on
      the RPC call below.
    */
    const extendRequested = body.extend === true;
    let extendToChapter: number | null = null;
    if (nextChapterNum > plannedChapterCount) {
      if (!extendRequested) {
        return respond({
          error:
            `Series limit reached. This story is planned for ${plannedChapterCount} chapters.`,
        }, 400);
      }
      // A standalone has no plan to raise and no chapter two; its ending is
      // Reimagine. Only a series can grow.
      if (story.story_mode !== "series") {
        return respond({
          error: "Only a series can be extended past its planned ending.",
        }, 409);
      }
      if (nextChapterNum > MAX_PLANNED_CHAPTER_COUNT) {
        return respond({
          error:
            `A story tops out at ${MAX_PLANNED_CHAPTER_COUNT} chapters. This one has reached it.`,
        }, 409);
      }
      extendToChapter = nextChapterNum;
    }
    /**
     * The plan this chapter is written against: the raised one when this is an
     * extension, because the prompt must describe the story the reader is
     * getting rather than the one they just outgrew.
     */
    const effectivePlannedCount = extendToChapter ?? plannedChapterCount;

    // Whether this chapter gets its own picture, and therefore what it costs.
    //
    // `source-of-truth/CREDITS_AND_PRICING.md` §1: a chapter after the first is
    // 1 credit, or 2 when it is illustrated. Both credits are taken by the ONE
    // reservation below, under one advisory lock — reserving the art
    // separately would let a balance run out between the two and produce
    // either a chapter whose art nobody paid for or a charge for art against a
    // chapter that was never written.
    //
    // The RPC re-reads `stories.illustrate_chapters` for itself and charges
    // two only if the row agrees, so this flag can lower the price and never
    // raise it.
    const illustrateChapter = story.illustrate_chapters === true;

    const { data: operation, error: reservationError } = await serviceClient
      .rpc(
        "reserve_generation_operation",
        {
          p_user_id: user.id,
          p_request_id: requestId,
          p_story_id: story_id,
          p_chapter_number: nextChapterNum,
          p_kind: "continuation",
          p_illustrate_chapter: illustrateChapter,
          /*
            THE PLAN IS RAISED BY THE RESERVATION, NOT BESIDE IT.

            An `update stories set planned_chapter_count = ...` issued from
            here would be a second statement in its own transaction, and the
            two orderings fail in opposite directions: raise-then-reserve
            leaves a story permanently claiming a chapter nobody paid for when
            the balance is short, and reserve-then-raise takes the credit and
            then, if the update loses to a concurrent write or the function
            dies between the two, refuses the very chapter it just charged for.

            Passing the target chapter into the RPC puts the raise inside the
            same transaction as the debit and behind the same
            `pg_advisory_xact_lock` on the story, so the pair commits together
            or not at all. Null means "not an extension", which is every
            ordinary continuation.
          */
          p_extend_to_chapter: extendToChapter,
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
      // The RPC re-checks the extension under the lock and refuses it there:
      // a second tap that raced this one may have already taken the story to
      // the ceiling, and the row is the authority on that, not the copy this
      // handler read a few milliseconds ago. Nothing was charged.
      if (reservationError?.code === "KTH03") {
        return respond({
          error: "This story cannot be extended any further.",
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
    const previousText = buildPreviousChapterWindow(chapters ?? []);

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
    /*
      AN EXTENSION IS NOT A FINALE, even though it is now the last planned
      chapter.

      `nextChapterNum >= plannedChapterCount` is true of every extension by
      construction -- the plan was just raised to exactly this chapter. Written
      as a finale it would be told to "resolve the promise of the complete arc"
      and to close its threads, which strips the closing hook and empties
      `series_state`. The direction chips at the next chapter end are derived
      from precisely those, so the first extension would also be the last: a
      story that can be grown once and then never again.

      A reader who genuinely wants an ending still gets one by sending
      `is_finale`, which is checked first and unchanged.
    */
    const isFinale = body.is_finale === true ||
      (extendToChapter === null && nextChapterNum >= plannedChapterCount);
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

    /**
     * Auto mode: the model picks the direction, not the client's sort order.
     *
     * `story_flow = 'auto'` means the reader asked not to be interrupted
     * between chapters. The first implementation of that took the
     * highest-ranked chip, which is a client sort and not a choice: the plan
     * beat outranks an open hook every time, so an auto story followed its
     * beat list regardless of what had actually happened in the chapter that
     * just ended. `chooseDirection` reads the ending and picks the direction
     * the chapter has earned.
     *
     * An explicit `next_instruction` always wins. A reader who typed something
     * has been asked and answered, whatever mode the story is in.
     */
    const autoFlow = story.story_flow === "auto";
    const directionChoice = autoFlow && !nextInstruction
      ? await chooseDirection({
        offered: directionsOffered,
        chapterEnding: trimToEnds(chapters[0].content ?? ""),
        chapterTitle: chapters[0].title,
        hookText: chapters[0].hook_text,
      })
      : {
        offered: directionsOffered,
        chosen: nextInstruction || null,
        chosenBy: (nextInstruction ? "reader" : "none") as
          | "reader"
          | "model"
          | "ranking"
          | "none",
      };
    // Whatever was chosen is what the chapter is written from.
    const effectiveInstruction = directionChoice.chosen ?? "";

    const systemPrompt = buildContinuationSystemPrompt({
      primaryGenre,
      audienceMode,
      identityLenses,
      spiceLevel,
      language: storyLanguage,
      mode: chapterMode,
      seriesState,
      chapterLength: (story.chapter_length ?? "standard") as ChapterLength,
      plannedChapterCount: effectivePlannedCount,
    });
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
    // One assembler for both transports, and it lives in `story-prompts.ts`.
    //
    // This was four template literals here, and the seam cost two bugs: the
    // series state was read above, sent to the system prompt, and never passed
    // to `buildUserPrompt`, so the delivered-moments partition saw an empty set
    // on every chapter; and the exclusion, deliberately moved to the tail of
    // the brief, ended up in front of the whole previous-chapters window. Both
    // are now decided in the tested function rather than restated here.
    const { jsonPrompt: userPrompt, prosePrompt: proseUserPrompt } =
      buildContinuationUserPrompt({
        primaryGenre,
        genres,
        audienceMode,
        spiceLevel,
        chapterRole,
        chapterNumber: nextChapterNum,
        chapterLength,
        plannedChapterCount: effectivePlannedCount,
        seed: story.topic ?? "",
        whereAndWhen: story.where_and_when ?? undefined,
        moments,
        beats,
        storyValues,
        writingStyle,
        avoid,
        continuationInstruction: effectiveInstruction || undefined,
        characters,
        seriesState,
        title: story.title,
        previousChapters: `${previousText}${earliestContext}`,
        isFinale,
        // Replayed from chapter one, not re-derived. Re-classifying per chapter
        // would spend two LLM calls on every continuation and still let the
        // name forms drift between chapters, which is the failure the cards
        // exist to prevent. Re-validated on read because a row written by an
        // older build carries an older card shape.
        grounding: validateGroundingCards(story.grounding),
      });

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
      // Both the buffered and streamed continuations land here, so the scan
      // covers each of them exactly once.
      await reportCrudeLexicon(content, {
        feature: "continue_story",
        storyId: story_id,
        userId: observedUserId,
      });
      const wordCount = content.split(/\s+/).length;

      // A finale ends the series, so there is no next chapter to build pressure
      // toward. The prompt asks for this, but the model does not reliably
      // comply, and hook_type is already forced the same way below.
      // Merge field by field: a partial model response must not blank out
      // continuity that earlier chapters established.
      // Which keys the model actually sent decides whether an empty list means
      // "cleared" or "not mentioned".
      const providedKeys = providedSeriesStateKeys(output.raw_series_state);
      // `moments` is the allowlist for `delivered_moments`: the model is asked
      // to echo the brief back, so anything it returns that was never in the
      // brief is a hallucination and must not become stored state that every
      // later chapter reads as fact.
      const nextState = isEmptySeriesState(output.series_state)
        ? seriesState
        : mergeSeriesState(
          seriesState,
          output.series_state,
          providedKeys,
          moments,
        );
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

      /*
        The directions this chapter was offered, and the one it took.

        A follow-up update rather than three more parameters on
        `complete_continuation_generation`. That RPC completes the operation
        and settles the credit in one transaction, and this is metadata for a
        reader-facing surface that does not exist yet: worth recording at the
        only moment it is recordable, not worth a fourth arity change to a
        credit-bearing function. A failure here logs and is dropped -- the
        chapter is written and paid for, and losing the record of which chips
        were on screen must never undo that.
      */
      /*
        RECORDED EITHER WAY, INCLUDING WHEN NOTHING WAS OFFERED.

        This was gated on `chosenBy !== "none"`, which made the surrounding
        comment false: a "Katha decides" chapter -- interactive with no chips
        derivable, or auto with an empty offer -- recorded nothing at all. The
        future chip surface would then have had two indistinguishable cases,
        "this chapter predates the feature" and "this chapter genuinely had no
        directions", with no way to tell them apart and no way to recover the
        difference afterwards.

        Writing the row makes that a KNOWN empty rather than an unknown. The
        `direction_chosen_by` column is nullable precisely so `none` can be
        stored as null and still be a fact.
      */
      if (typeof chapter.id === "string") {
        const { error: directionError } = await serviceClient
          .from("chapters")
          .update({
            directions_offered: directionChoice.offered,
            direction_chosen: directionChoice.chosen,
            // `none` is not one of the three the CHECK allows; it is the
            // absence of a chooser, which the column spells as null.
            direction_chosen_by: directionChoice.chosenBy === "none"
              ? null
              : directionChoice.chosenBy,
          })
          .eq("id", chapter.id);
        if (directionError) {
          console.error(
            "chapter direction record failed:",
            safeErrorMessage(directionError),
          );
        }
      }

      // The chapter's own illustration, off the response's critical path.
      //
      // Chapter 1's art IS the cover and is drawn by `generateStoryMedia`;
      // this is the path for every chapter after it, which until now had none
      // at all — `illustrate_chapters` was stored and read by nobody, so a
      // writer who asked for illustrations got exactly one.
      //
      // Background for the same reason the cover is: an image adds tens of
      // seconds to work the reader is already waiting on, and the chapter is
      // finished and paid for the moment the row above exists. Nothing here
      // can fail the chapter — `generateChapterArt` resolves on every path,
      // logs its own failures, and refunds the art credit if the picture never
      // arrives (decision 39 makes an unillustrated chapter a legitimate look).
      if (illustrateChapter && typeof chapter.id === "string") {
        runInBackground(generateChapterArt({
          storyId: story_id,
          chapterId: chapter.id,
          chapterNumber: nextChapterNum,
          operationId: operation.id,
          userId: user.id,
        }));
      }

      // The continuity the chapter just wrote, handed back with it.
      //
      // The chapter-end screen derives its "what happens next" chips from
      // `series_state.open_hooks` / `promised_payoffs` /
      // `next_chapter_pressure` and the chapter's own `hook_text`. Returning
      // only the chapter row left the client holding the state from BEFORE
      // this chapter, so the chips it offered for chapter 4 were derived from
      // chapter 2. It is written to the stories row by
      // `complete_continuation_generation`; this is the same value, saved a
      // round trip.
      return { chapter, seriesState: persistedState };
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

      /*
        A FAILED CHAPTER OF A PRE-BOUGHT RUN ENDS THE WHOLE RUN, SO THE REST
        OF IT IS GIVEN BACK HERE.

        An auto story buys every chapter its balance affords the moment chapter
        one lands. The client stops the chain at a failure -- `failedAutoChapters`
        bars re-buying it and nothing re-fires without a tap -- so the chapters
        after this one are paid for and will never be written. Left reserved,
        they are credits taken for prose nobody will ever read: the writer's
        balance is short and there is no story to show for it.

        A provider failure at chapter 4 of a 6-chapter run therefore refunds 3:
        this one and the two never attempted. `refund_auto_chapter_run` reaches
        this operation too, but it refunds through the same
        `refund_generation_operation` that just ran, which is idempotent per
        operation -- so the chapter that failed is given back once, not twice.

        It runs for every failure, not only an auto one: on a story with no run
        there is nothing reserved to find and the call is a no-op.
      */
      await refundAutoChapterRun(serviceClient, {
        userId: user.id,
        storyId: story_id,
        fromChapter: nextChapterNum,
        error: errorMessage(error),
      });
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
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              // The reader hung up. `closed` only tracks our own `close()`, so
              // a client that navigates away leaves it false and every later
              // enqueue throws. Latching it turns one throw into a no-op for
              // the rest of the run rather than a throw per event, and the
              // chapter still finishes and persists -- it is already paid for.
              closed = true;
            }
          };
          const startedAt = Date.now();
          try {
            send("meta", {
              story_id,
              operation_id: operation.id,
              chapter_number: nextChapterNum,
            });
            send("stage", { stage: "context" });

            // The chapter is named before it is written, for the same reason a
            // first chapter is (see `generate-story-stream`): the metadata call
            // reads the finished prose, so its chapter title cannot arrive
            // until ~50s in and the reader watches page one fill under a blank
            // heading. Fired in the same tick as the stream, never awaited by
            // it, and null on any failure -- in which case the metadata title
            // is used exactly as before.
            //
            // The story already has a name, so it is passed in and echoed back
            // rather than re-invented; only `chapter_title` is used here.
            const namingPromise = nameChapterEarly({
              seed: story.topic ?? "",
              primaryGenre,
              chapterNumber: nextChapterNum,
              storyTitle: typeof story.title === "string" ? story.title : null,
              previously: chapters[0].previously_summary ??
                story.previously_summary,
              instruction: effectiveInstruction || null,
              characterNames: characters.map((c) => c.name).filter(Boolean),
            });
            namingPromise.then((names) => {
              if (!names?.chapterTitle) return;
              send("title", { chapter_title: names.chapterTitle });
              // Detached on purpose, so it has to swallow its own failures: an
              // unhandled rejection on this runtime can take the isolate down,
              // and with it a chapter the reader has already paid for.
            }).catch((error) => {
              console.error(
                "early chapter title could not be sent:",
                safeErrorMessage(error),
              );
            });

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
                plannedChapterCount: effectivePlannedCount,
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
            // Settled tens of seconds ago (12s deadline against a ~50s
            // chapter), so this never waits. Awaited rather than read from a
            // mutable binding so the title that is PERSISTED is the one the
            // `title` event already put on screen.
            const earlyNames = await namingPromise;
            const output = parseStructuredOutput(
              JSON.stringify({
                ...(JSON.parse(metadata.text) as Record<string, unknown>),
                chapter_body: prose.text,
                ...(earlyNames?.chapterTitle
                  ? { chapter_title: earlyNames.chapterTitle }
                  : {}),
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

            const { chapter, seriesState: nextSeriesState } =
              await persistContinuation(output);
            notifyChapterReady(chapter);
            send("done", {
              chapter,
              story_id,
              // Nested under `story` so this payload has the same shape as a
              // first chapter's (`_shared/generation-done.ts`), rather than a
              // second flat spelling of the same fields.
              story: {
                id: story_id,
                series_state: nextSeriesState,
                beats,
                previously_summary: output.previously_summary ??
                  story.previously_summary,
              },
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

      const { chapter, seriesState: nextSeriesState } =
        await persistContinuation(output);
      notifyChapterReady(chapter);
      return respond({
        chapter,
        story_id,
        story: {
          id: story_id,
          series_state: nextSeriesState,
          beats,
          previously_summary: output.previously_summary ??
            story.previously_summary,
        },
        model: result.model,
      });
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


/**
 * Read the offered directions off the request, bounded.
 *
 * Client-supplied, so it is bounded rather than trusted: it reaches a model
 * prompt in auto mode and a jsonb column in both. The caps mirror what the
 * client can actually put on screen -- three chips, each within the beat
 * length the create contract already enforces -- so a request that respects
 * the UI is never truncated, and one that does not cannot make the choosing
 * prompt or the stored row unbounded.
 */
function parseOfferedDirections(value: unknown): OfferedDirection[] {
  if (!Array.isArray(value)) return [];
  const out: OfferedDirection[] = [];
  for (const entry of value.slice(0, 3)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const prompt = typeof record.prompt === "string"
      ? record.prompt.trim().slice(0, 300)
      : "";
    if (!prompt) continue;
    const id = typeof record.id === "string" && record.id.trim()
      ? record.id.trim().slice(0, 64)
      : `direction-${out.length}`;
    out.push({ id, prompt });
  }
  return out;
}
