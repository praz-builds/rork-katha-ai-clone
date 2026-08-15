import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { deductCredit, grantCredit } from "../_shared/credits.ts";
import { generateStoryText } from "../_shared/llm.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { story_id } = await req.json();
    if (!story_id) {
      return new Response(
        JSON.stringify({ error: "story_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify story ownership
    const { data: story } = await serviceClient
      .from("stories")
      .select("id, title, genre, topic, author_id")
      .eq("id", story_id)
      .single();

    if (!story || story.author_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Story not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get existing chapters for context
    const { data: chapters } = await serviceClient
      .from("chapters")
      .select("chapter_number, title, content")
      .eq("story_id", story_id)
      .order("chapter_number", { ascending: true });

    const nextChapterNum = (chapters?.length || 0) + 1;

    // Deduct 1 credit
    try {
      await deductCredit(serviceClient, user.id, 1, "generation", story_id);
    } catch {
      return new Response(
        JSON.stringify({ error: "Insufficient credits" }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build continuation prompt
    const previousText = chapters
      ?.map((c) => `Chapter ${c.chapter_number}: ${c.content}`)
      .join("\n\n");

    const systemPrompt =
      "You are a creative story writer continuing an existing story. Maintain consistency with previous chapters.";
    const userPrompt = `Continue this story with Chapter ${nextChapterNum}.\n\nTitle: ${story.title}\nGenre: ${story.genre.join(", ")}\n\nPrevious chapters:\n${previousText}\n\nWrite the next chapter (600-900 words). Start with the chapter title on the first line.`;

    let result;
    try {
      result = await generateStoryText(systemPrompt, userPrompt);
    } catch {
      await grantCredit(serviceClient, user.id, 1, "refund", story_id);
      return new Response(
        JSON.stringify({ error: "Generation failed. Credit refunded." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const lines = result.text.split("\n").filter((l: string) => l.trim());
    const chapterTitle = lines[0]?.replace(/^#\s*/, "").trim() || `Chapter ${nextChapterNum}`;
    const content = lines.slice(1).join("\n").trim();
    const wordCount = content.split(/\s+/).length;

    const { data: chapter } = await serviceClient
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

    return new Response(
      JSON.stringify({ chapter, model: result.model }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("continue-story error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
