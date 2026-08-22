import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { generateStoryText } from "../_shared/llm.ts";
import {
  errorMessage,
  isStaleReservation,
  parseRequestId,
} from "../_shared/operations.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { story_id, request_id } = await req.json();
    if (!story_id) {
      return jsonResponse({ error: "story_id is required" }, 400);
    }
    const requestId = parseRequestId(request_id ?? crypto.randomUUID());
    if (!requestId) return jsonResponse({ error: "Invalid request_id" }, 400);

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
        return jsonResponse(
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
          return jsonResponse({
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
        return jsonResponse({ chapter, replayed: true });
      }
      return jsonResponse({
        error: existingOperation.status === "refunded"
          ? "The previous generation failed. Start a new request."
          : "Generation is already in progress.",
        status: existingOperation.status,
      }, 409);
    }

    // Verify story ownership
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .select("id, title, genre, topic, author_id")
      .eq("id", story_id)
      .single();

    if (storyError || !story || story.author_id !== user.id) {
      return jsonResponse({ error: "Story not found" }, 404);
    }

    // Keep prompt context bounded while deriving the next chapter from latest.
    const { data: chapters, error: chaptersError } = await serviceClient
      .from("chapters")
      .select("chapter_number, title, content")
      .eq("story_id", story_id)
      .order("chapter_number", { ascending: false })
      .limit(4);
    if (chaptersError) throw chaptersError;

    const nextChapterNum = (chapters?.[0]?.chapter_number ?? 0) + 1;
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
      if (reservationError?.message.includes("Insufficient credits")) {
        return jsonResponse({ error: "Insufficient credits" }, 402);
      }
      if (reservationError?.code === "KTH01") {
        return jsonResponse({
          error: "This chapter generation is already in progress",
        }, 409);
      }
      throw reservationError ?? new Error("Generation reservation failed");
    }
    if (operation.replayed) {
      return jsonResponse({
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

    const systemPrompt =
      "You are a creative story writer continuing an existing story. Maintain consistency with previous chapters.";
    const userPrompt =
      `Continue this story with Chapter ${nextChapterNum}.\n\nTitle: ${story.title}\nGenre: ${
        story.genre.join(", ")
      }\n\nPrevious chapters:\n${previousText}\n\nWrite the next chapter (600-900 words). Start with the chapter title on the first line.`;

    try {
      const result = await generateStoryText(systemPrompt, userPrompt);
      const lines = result.text.split("\n").filter((line: string) =>
        line.trim()
      );
      const chapterTitle = lines[0]?.replace(/^#\s*/, "").trim() ||
        `Chapter ${nextChapterNum}`;
      const content = lines.slice(1).join("\n").trim();
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
        },
      );
      if (chapterError || !chapter) {
        throw chapterError ?? new Error("Chapter persistence failed");
      }

      return jsonResponse({ chapter, model: result.model });
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
        return jsonResponse({
          error: "Generation failed. Refund is pending retry.",
          operation_id: operation.id,
        }, 503);
      }
      return jsonResponse(
        {
          error: refund?.refunded
            ? "Generation failed. Credit refunded."
            : "Generation completed; retry with the same request ID.",
          operation_id: operation.id,
        },
        500,
      );
    }
  } catch (error) {
    console.error("continue-story error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

/** Return a JSON response with the shared CORS headers. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
