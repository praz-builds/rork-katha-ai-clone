import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
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

    const input = validateGenerationRequest(await req.json());
    if ("error" in input) return jsonResponse({ error: input.error }, 400);
    const { genres, topic, characters, requestId } = input;

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
        if (reconciliationError) {
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
      if (existingOperation.status !== "completed") {
        return jsonResponse({
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
      return jsonResponse({
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
        genre: genres,
        topic,
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
      await serviceClient.from("stories").delete().eq("id", story.id);
      if (reservationError?.message.includes("Insufficient credits")) {
        return jsonResponse({ error: "Insufficient credits" }, 402);
      }
      throw reservationError ?? new Error("Generation reservation failed");
    }
    if (operation.story_id !== story.id) {
      await serviceClient.from("stories").delete().eq("id", story.id);
      return jsonResponse({
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
          p_operation_id: operation.id,
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
        return jsonResponse({
          error: "Story generation failed. Refund is pending retry.",
          operation_id: operation.id,
        }, 503);
      }
      return jsonResponse(
        {
          error: refund?.refunded
            ? "Story generation failed. Credit refunded."
            : "Story generation completed; retry with the same request ID.",
          operation_id: operation.id,
        },
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

type CharacterInput = {
  name: string;
  description?: string;
  background?: string;
  appearance?: string;
  isHero?: boolean;
};

type GenerationInput = {
  genres: string[];
  topic?: string;
  characters: CharacterInput[];
  requestId: string;
};

/** Validate and bound all user-controlled prompt input. */
function validateGenerationRequest(
  value: unknown,
): GenerationInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "Invalid request" };
  const body = value as Record<string, unknown>;
  const rawGenres = Array.isArray(body.genre) ? body.genre : [body.genre];
  if (
    rawGenres.length < 1 ||
    rawGenres.length > 3 ||
    rawGenres.some((genre) =>
      typeof genre !== "string" || !genre.trim() || genre.length > 50
    )
  ) return { error: "genre must contain 1 to 3 short values" };

  const topic = body.topic;
  if (
    topic !== undefined && (typeof topic !== "string" || topic.length > 1000)
  ) {
    return { error: "topic must be a string of 1000 characters or fewer" };
  }

  const characters = body.characters ?? [];
  if (!Array.isArray(characters) || characters.length > 10) {
    return { error: "characters must contain at most 10 items" };
  }
  for (const character of characters) {
    if (!character || typeof character !== "object") {
      return { error: "Each character must be an object" };
    }
    const item = character as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100
    ) {
      return {
        error: "Each character needs a name of 100 characters or fewer",
      };
    }
    for (const field of ["description", "background", "appearance"] as const) {
      if (
        item[field] !== undefined &&
        (typeof item[field] !== "string" || item[field].length > 500)
      ) return { error: `Character ${field} must be 500 characters or fewer` };
    }
    if (item.isHero !== undefined && typeof item.isHero !== "boolean") {
      return { error: "Character isHero must be boolean" };
    }
  }

  if (body.lengthType !== undefined && body.lengthType !== "short") {
    return { error: "Only short-story generation is supported" };
  }

  const requestId = body.request_id ?? crypto.randomUUID();
  if (
    typeof requestId !== "string" ||
    !requestId.trim() ||
    requestId.length > 128
  ) return { error: "Invalid request_id" };

  return {
    genres: rawGenres.map((genre) => (genre as string).trim()),
    topic: typeof topic === "string" ? topic.trim() : undefined,
    characters: characters as CharacterInput[],
    requestId,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStaleReservation(updatedAt: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs >= 5 * 60_000;
}

function buildUserPrompt(params: {
  genre: string[];
  topic?: string;
  characters?: { name: string; description?: string }[];
}): string {
  let prompt = "Write a short story of 500-1500 words.\n";
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
