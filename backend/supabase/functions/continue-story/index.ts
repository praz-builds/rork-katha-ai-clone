import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { generateStoryText } from "../_shared/llm.ts";
import {
  errorMessage,
  isStaleReservation,
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";
import {
  buildContinuationSystemPrompt,
  formatSeriesStateBlock,
  MAX_SERIES_CHAPTERS,
} from "../_shared/story-prompts.ts";
import {
  isEmptySeriesState,
  parseSeriesState,
  parseStructuredOutput,
} from "../_shared/story_text.ts";
import {
  type AudienceMode,
  type IdentityLens,
  type SpiceLevel,
  type TropeModule,
} from "../_shared/types.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

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

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);
    const story_id = parseUuid(body.story_id);
    if (!story_id) return respond({ error: "Invalid story_id" }, 400);
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
        "id, title, genre, primary_genre, audience_mode, identity_lenses, trope_modules, spice_level, topic, author_id, language, story_mode, series_state, previously_summary",
      )
      .eq("id", story_id)
      .single();

    if (storyError || !story || story.author_id !== user.id) {
      return respond({ error: "Story not found" }, 404);
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

    if (nextChapterNum > MAX_SERIES_CHAPTERS) {
      return respond({
        error:
          `Series limit reached. Stories can have at most ${MAX_SERIES_CHAPTERS} chapters.`,
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

    // Build continuation prompt
    const previousText = chapters
      ?.toReversed()
      ?.map((c) => `Chapter ${c.chapter_number}: ${c.content}`)
      .join("\n\n");

    const primaryGenre: string = story.primary_genre ??
      (Array.isArray(story.genre)
        ? story.genre[0] ?? "contemporary"
        : (story.genre ?? "contemporary"));
    const storyLanguage = typeof story.language === "string"
      ? story.language
      : undefined;
    const audienceMode = (story.audience_mode ?? "adult") as AudienceMode;
    const identityLenses = (Array.isArray(story.identity_lenses)
      ? story.identity_lenses
      : []) as IdentityLens[];
    const tropeModules = (Array.isArray(story.trope_modules)
      ? story.trope_modules
      : []) as TropeModule[];
    const rawSpice = story.spice_level ?? "sweet";
    const spiceLevel =
      (rawSpice === "explicit" ? "steamy" : rawSpice) as SpiceLevel;
    const isFinale = body.is_finale === true ||
      nextChapterNum >= MAX_SERIES_CHAPTERS;
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
        console.error("chapter 1 context fetch failed", firstChapterError);
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
      tropeModules,
      spiceLevel,
      language: storyLanguage,
      mode: chapterMode,
      seriesState,
    });
    const finaleNote = isFinale
      ? " This is the FINAL chapter. Bring the story to a satisfying close."
      : "";
    const userPrompt =
      `Continue this story with Chapter ${nextChapterNum}.${finaleNote}\n\nTitle: ${story.title}\nGenre: ${primaryGenre}\n${
        formatSeriesStateBlock(seriesState)
      }\n\nPrevious chapters:\n${previousText}${earliestContext}\n\nRespond with a JSON object only. No markdown fences. Follow the output schema from your instructions.`;

    try {
      const result = await generateStoryText(systemPrompt, userPrompt);
      const output = parseStructuredOutput(
        result.text,
        `Chapter ${nextChapterNum}`,
      );
      const chapterTitle = output.chapter_title || output.title;
      const content = output.chapter_body;
      if (!content) throw new Error("Generation returned no chapter content");
      const wordCount = content.split(/\s+/).length;

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
          p_series_state: isEmptySeriesState(output.series_state)
            ? seriesState
            : output.series_state,
          p_hook_type: isFinale ? "none" : output.hook_type,
          p_hook_text: isFinale ? null : output.hook_text || null,
        },
      );
      if (chapterError || !chapter) {
        throw chapterError ?? new Error("Chapter persistence failed");
      }

      return respond({ chapter, model: result.model });
    } catch (error) {
      console.error("continue-story post-deduction error:", error);
      const { data: refund, error: refundError } = await serviceClient.rpc(
        "refund_generation_operation",
        {
          p_operation_id: operation.id,
          p_user_id: user.id,
          p_error: errorMessage(error),
        },
      );
      if (refundError) {
        console.error("continue-story refund pending:", refundError);
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
    console.error("continue-story error:", error);
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
