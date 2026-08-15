import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { deductCredit, grantCredit } from "../_shared/credits.ts";
import { generateStoryText } from "../_shared/llm.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // Auth
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

    // Parse request
    const { genre, topic, characters, lengthType = "short" } = await req.json();

    // Use service role client for credit operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Deduct 1 credit
    let newBalance: number;
    try {
      newBalance = await deductCredit(serviceClient, user.id, 1, "generation");
    } catch {
      return new Response(
        JSON.stringify({ error: "Insufficient credits" }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create story record
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .insert({
        author_id: user.id,
        title: "Generating...",
        genre: Array.isArray(genre) ? genre : [genre],
        topic,
        length_type: lengthType,
        status: "generating",
      })
      .select()
      .single();

    if (storyError) throw storyError;

    // Save characters
    if (characters?.length) {
      await serviceClient.from("characters").insert(
        characters.map((c: { name: string; description?: string; background?: string; appearance?: string; isHero?: boolean }) => ({
          story_id: story.id,
          name: c.name,
          description: c.description,
          background: c.background,
          appearance: c.appearance,
          is_hero: c.isHero ?? false,
        }))
      );
    }

    // Generate story text
    // TODO: Load system prompt from prompts/story-generator.md
    const systemPrompt = "You are a creative story writer. Write engaging, well-structured stories.";
    const userPrompt = buildUserPrompt({ genre, topic, characters, lengthType });

    let result;
    try {
      result = await generateStoryText(systemPrompt, userPrompt);
    } catch {
      // Refund credit on generation failure
      await grantCredit(serviceClient, user.id, 1, "refund", story.id);
      await serviceClient
        .from("stories")
        .update({ status: "failed" })
        .eq("id", story.id);
      return new Response(
        JSON.stringify({ error: "Story generation failed. Credit refunded." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse title from generated text (expect first line as title)
    const lines = result.text.split("\n").filter((l: string) => l.trim());
    const title = lines[0]?.replace(/^#\s*/, "").trim() || "Untitled Story";
    const content = lines.slice(1).join("\n").trim();
    const wordCount = content.split(/\s+/).length;

    // Update story + create chapter
    await serviceClient
      .from("stories")
      .update({
        title,
        word_count: wordCount,
        status: "complete",
      })
      .eq("id", story.id);

    await serviceClient.from("chapters").insert({
      story_id: story.id,
      chapter_number: 1,
      title: "Chapter 1",
      content,
      word_count: wordCount,
    });

    // TODO: Generate cover image (DALL-E / Flux)
    // TODO: Generate audio narration (edge-tts)

    return new Response(
      JSON.stringify({
        story: { ...story, title, word_count: wordCount, status: "complete" },
        chapter: { chapter_number: 1, content, word_count: wordCount },
        balance: newBalance - 1,
        model: result.model,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("generate-story error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function buildUserPrompt(params: {
  genre: string[];
  topic?: string;
  characters?: { name: string; description?: string }[];
  lengthType: string;
}): string {
  const lengthGuide: Record<string, string> = {
    mini: "very short (150-250 words)",
    short: "short (300-500 words)",
    standard: "standard length (600-900 words)",
    long: "long (1000-1500 words)",
  };

  let prompt = `Write a ${lengthGuide[params.lengthType] || "short"} story.\n`;
  prompt += `Genre: ${params.genre.join(", ")}\n`;
  if (params.topic) prompt += `Topic/theme: ${params.topic}\n`;
  if (params.characters?.length) {
    prompt += `Characters:\n`;
    params.characters.forEach((c) => {
      prompt += `- ${c.name}${c.description ? `: ${c.description}` : ""}\n`;
    });
  }
  prompt += `\nStart with the title on the first line (no # prefix), then the story text.`;
  return prompt;
}
