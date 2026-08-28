import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { generateStoryText } from "../_shared/llm.ts";
import {
  errorMessage,
  isStaleReservation,
  readJsonObject,
} from "../_shared/operations.ts";
import {
  buildStorySystemPrompt,
  buildUserPrompt,
} from "../_shared/story-prompts.ts";
import { parseStructuredOutput } from "../_shared/story_text.ts";
import { EMPTY_SERIES_STATE } from "../_shared/types.ts";
import {
  deriveContentRating,
  validateGenerationRequest,
} from "../_shared/validation.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

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

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);
    const input = validateGenerationRequest(body);
    if ("error" in input) {
      return respond({ error: input.error }, input.status ?? 400);
    }
    const {
      primaryGenre,
      audienceMode,
      identityLenses,
      tropeModules,
      spiceLevel,
      storyMode,
      seed,
      characters,
      requestId,
      language,
    } = input;
    const chapterRole = storyMode === "series"
      ? "series_opening"
      : "standalone";

    // Use service role client for credit operations
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
      if (
        existingOperation.status === "reserved" &&
        isStaleReservation(existingOperation.updated_at)
      ) {
        const { data: reconciliation, error: reconciliationError } =
          await serviceClient.rpc("refund_generation_operation", {
            p_operation_id: existingOperation.id,
            p_user_id: user.id,
            p_error: "Stale generation reservation reconciled on retry",
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
      if (existingOperation.status !== "completed") {
        return respond({
          error: existingOperation.status === "refunded"
            ? "The previous generation failed. Start a new request."
            : "Generation is already in progress.",
          story_id: existingOperation.story_id,
          status: existingOperation.status,
        }, 409);
      }
      if (!existingOperation.result_chapter_id) {
        throw new Error("Completed operation has no chapter");
      }
      const [storyResult, chapterResult] = await Promise.all([
        serviceClient.from("stories").select("*").eq(
          "id",
          existingOperation.story_id,
        ).single(),
        serviceClient.from("chapters").select("*").eq(
          "id",
          existingOperation.result_chapter_id,
        ).single(),
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

    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .insert({
        author_id: user.id,
        title: "Generating...",
        genre: [primaryGenre],
        primary_genre: primaryGenre,
        audience_mode: audienceMode,
        identity_lenses: identityLenses,
        trope_modules: tropeModules,
        spice_level: spiceLevel,
        story_mode: storyMode,
        topic: seed,
        length_type: "short",
        status: "generating",
      })
      .select()
      .single();

    if (storyError || !story) {
      throw storyError ?? new Error("Story creation failed");
    }

    const { data: operation, error: reservationError } = await serviceClient
      .rpc(
        "reserve_generation_operation",
        {
          p_user_id: user.id,
          p_request_id: requestId,
          p_story_id: story.id,
          p_chapter_number: 1,
          p_kind: "story",
        },
      );
    if (reservationError || !operation) {
      const { error: cleanupError } = await serviceClient
        .from("stories")
        .delete()
        .eq("id", story.id);
      if (cleanupError) {
        console.error("generate-story orphan cleanup failed", {
          storyId: story.id,
          error: cleanupError,
        });
      }
      if (reservationError?.code === "KTH02") {
        return respond({ error: "Insufficient credits" }, 402);
      }
      throw reservationError ?? new Error("Generation reservation failed");
    }
    if (operation.story_id !== story.id) {
      const { error: cleanupError } = await serviceClient
        .from("stories")
        .delete()
        .eq("id", story.id);
      if (cleanupError) {
        console.error("generate-story duplicate cleanup failed", {
          storyId: story.id,
          existingStoryId: operation.story_id,
          error: cleanupError,
        });
      }
      return respond({
        error: "Generation request already exists",
        story_id: operation.story_id,
        status: operation.status,
      }, 409);
    }

    try {
      if (characters?.length) {
        const { error: characterError } = await serviceClient
          .from("characters")
          .insert(
            characters.map((c) => ({
              story_id: story.id,
              name: c.name,
              description: c.description,
              background: c.background,
              appearance: c.appearance,
              is_hero: c.isHero ?? false,
            })),
          );
        if (characterError) throw characterError;
      }

      const systemPrompt = buildStorySystemPrompt({
        primaryGenre,
        audienceMode,
        identityLenses,
        tropeModules,
        spiceLevel,
        storyMode,
        chapterRole,
        language,
      });
      const userPrompt = buildUserPrompt({
        primaryGenre,
        audienceMode,
        tropeModules,
        spiceLevel,
        storyMode,
        chapterRole,
        seed,
        characters,
        language,
      });
      const result = await generateStoryText(systemPrompt, userPrompt);
      const output = parseStructuredOutput(result.text, "Untitled Story");
      if (!output.chapter_body) {
        throw new Error("Generation returned no story content");
      }
      const wordCount = output.chapter_body.split(/\s+/).length;
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
            ? output.series_state
            : EMPTY_SERIES_STATE,
          p_hook_type: storyMode === "series" ? output.hook_type : "none",
          p_hook_text: storyMode === "series" ? output.hook_text || null : null,
        },
      );
      if (completionError || !chapter) {
        throw completionError ?? new Error("Story persistence failed");
      }

      return respond({
        story: {
          ...story,
          title: output.title,
          word_count: wordCount,
          status: "complete",
          primary_genre: primaryGenre,
          story_mode: storyMode,
          series_state: storyMode === "series"
            ? output.series_state
            : EMPTY_SERIES_STATE,
          first_line: output.first_line,
          previously_summary: output.previously_summary,
          content_rating: contentRating,
        },
        chapter,
        balance: operation.balance,
        model: result.model,
      });
    } catch (error) {
      console.error("generate-story post-deduction error:", error);
      const { data: refund, error: refundError } = await serviceClient.rpc(
        "refund_generation_operation",
        {
          p_operation_id: operation.id,
          p_user_id: user.id,
          p_error: errorMessage(error),
        },
      );
      if (refundError) {
        console.error("generate-story refund pending:", refundError);
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
    console.error("generate-story error:", error);
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
