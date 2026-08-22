import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { deductCredit, grantCredit } from "../_shared/credits.ts";
import { generateStoryText } from "../_shared/llm.ts";

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

    const { story_id } = await req.json();
    if (!story_id) {
      return jsonResponse({ error: "story_id is required" }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify story ownership
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .select("id, title, genre, topic, author_id")
      .eq("id", story_id)
      .single();

    if (storyError || !story || story.author_id !== user.id) {
      return jsonResponse({ error: "Story not found" }, 404);
    }

    // Get existing chapters for context
    const { data: chapters, error: chaptersError } = await serviceClient
      .from("chapters")
      .select("chapter_number, title, content")
      .eq("story_id", story_id)
      .order("chapter_number", { ascending: true });
    if (chaptersError) throw chaptersError;

    const nextChapterNum = (chapters?.at(-1)?.chapter_number ?? 0) + 1;
    const operationReference = `${story_id}:chapter:${nextChapterNum}`;

    // Deduct 1 credit
    try {
      await deductCredit(
        serviceClient,
        user.id,
        1,
        "generation",
        operationReference,
      );
    } catch (error) {
      if (
        error instanceof Error && error.message === "Duplicate credit operation"
      ) {
        return jsonResponse({
          error: "This chapter generation is already in progress",
        }, 409);
      }
      if (error instanceof Error && error.message === "Insufficient credits") {
        return jsonResponse({ error: "Insufficient credits" }, 402);
      }
      throw error;
    }

    // Build continuation prompt
    const previousText = chapters
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

      const { data: chapter, error: chapterError } = await serviceClient
        .from("chapters")
        .insert({
          story_id,
          chapter_number: nextChapterNum,
          title: chapterTitle,
          content,
          word_count: wordCount,
        })
        .select()
        .single();
      if (chapterError || !chapter) {
        throw chapterError ?? new Error("Chapter persistence failed");
      }

      return jsonResponse({ chapter, model: result.model });
    } catch (error) {
      console.error("continue-story post-deduction error:", error);
      await grantCredit(
        serviceClient,
        user.id,
        1,
        "refund",
        operationReference,
      );
      return jsonResponse(
        { error: "Generation failed. Credit refunded." },
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
