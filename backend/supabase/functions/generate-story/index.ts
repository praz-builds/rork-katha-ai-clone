import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { deductCredit, grantCredit } from "../_shared/credits.ts";
import { generateStoryText } from "../_shared/llm.ts";
import { STORY_SYSTEM_PROMPT } from "../_shared/prompts.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
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
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { genre, topic, characters, lengthType = "short" } = await req.json();
    const genres = Array.isArray(genre) ? genre : [genre];
    if (
      !genres.length ||
      genres.some((value) => typeof value !== "string" || !value.trim())
    ) {
      return jsonResponse({ error: "At least one genre is required" }, 400);
    }
    if (
      !Object.hasOwn(
        { mini: true, short: true, standard: true, long: true },
        lengthType,
      )
    ) {
      return jsonResponse({ error: "Invalid lengthType" }, 400);
    }

    // Use service role client for credit operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .insert({
        author_id: user.id,
        title: "Generating...",
        genre: genres,
        topic,
        length_type: lengthType,
        status: "generating",
      })
      .select()
      .single();

    if (storyError || !story) {
      throw storyError ?? new Error("Story creation failed");
    }

    let newBalance: number;
    try {
      newBalance = await deductCredit(
        serviceClient,
        user.id,
        1,
        "generation",
        story.id,
      );
    } catch (error) {
      await serviceClient.from("stories").delete().eq("id", story.id);
      if (error instanceof Error && error.message === "Insufficient credits") {
        return jsonResponse({ error: "Insufficient credits" }, 402);
      }
      throw error;
    }

    try {
      if (characters?.length) {
        const { error: characterError } = await serviceClient
          .from("characters")
          .insert(
            characters.map((
              c: {
                name: string;
                description?: string;
                background?: string;
                appearance?: string;
                isHero?: boolean;
              },
            ) => ({
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

      const userPrompt = buildUserPrompt({
        genre: genres,
        topic,
        characters,
        lengthType,
      });
      const result = await generateStoryText(STORY_SYSTEM_PROMPT, userPrompt);
      const lines = result.text.split("\n").filter((line: string) =>
        line.trim()
      );
      const title = lines[0]?.replace(/^#\s*/, "").trim() || "Untitled Story";
      const content = lines.slice(1).join("\n").trim();
      if (!content) throw new Error("Generation returned no story content");
      const wordCount = content.split(/\s+/).length;

      const { data: chapter, error: completionError } = await serviceClient.rpc(
        "complete_story_generation",
        {
          p_story_id: story.id,
          p_author_id: user.id,
          p_title: title,
          p_content: content,
          p_word_count: wordCount,
        },
      );
      if (completionError || !chapter) {
        throw completionError ?? new Error("Story persistence failed");
      }

      return jsonResponse({
        story: { ...story, title, word_count: wordCount, status: "complete" },
        chapter,
        balance: newBalance,
        model: result.model,
      });
    } catch (error) {
      console.error("generate-story post-deduction error:", error);
      try {
        await grantCredit(serviceClient, user.id, 1, "refund", story.id);
      } finally {
        await serviceClient
          .from("stories")
          .update({ status: "failed" })
          .eq("id", story.id);
      }
      return jsonResponse(
        { error: "Story generation failed. Credit refunded." },
        500,
      );
    }
  } catch (error) {
    console.error("generate-story error:", error);
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
  prompt +=
    `\nStart with the title on the first line (no # prefix), then the story text.`;
  return prompt;
}
