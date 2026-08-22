import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { editParagraph } from "../_shared/llm.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

const EDIT_SYSTEM_PROMPT = `You are a story editor. You will receive a paragraph from a story and an editing instruction.
Return ONLY the edited paragraph text. Do not add commentary, labels, or explanations.
Maintain the story's existing voice, tense, and point of view unless the instruction specifically asks to change them.`;

const VALID_INSTRUCTIONS = new Set([
  "rewrite",
  "expand",
  "shorten",
  "change_tone",
  "custom",
]);

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
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    // Validate inputs
    const storyId = parseUuid(body.story_id);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);

    const chapterId = parseUuid(body.chapter_id);
    if (!chapterId) return respond({ error: "Invalid chapter_id" }, 400);

    const paragraphIndex = body.paragraph_index;
    if (
      typeof paragraphIndex !== "number" ||
      !Number.isInteger(paragraphIndex) ||
      paragraphIndex < 0
    ) {
      return respond(
        { error: "paragraph_index must be a non-negative integer" },
        400,
      );
    }

    const instruction = body.instruction;
    if (
      typeof instruction !== "string" ||
      !VALID_INSTRUCTIONS.has(instruction)
    ) {
      return respond(
        {
          error:
            "instruction must be one of: rewrite, expand, shorten, change_tone, custom",
        },
        400,
      );
    }

    const customNote = body.custom_note;
    if (instruction === "custom") {
      if (
        typeof customNote !== "string" ||
        !customNote.trim() ||
        customNote.length > 1000
      ) {
        return respond(
          {
            error:
              "custom_note is required for custom instruction (max 1000 characters)",
          },
          400,
        );
      }
    } else if (
      customNote !== undefined &&
      customNote !== null &&
      (typeof customNote !== "string" || customNote.length > 1000)
    ) {
      return respond(
        { error: "custom_note must be a string of 1000 characters or fewer" },
        400,
      );
    }

    const tone = body.tone;
    if (
      tone !== undefined &&
      tone !== null &&
      (typeof tone !== "string" || !tone.trim() || tone.length > 200)
    ) {
      return respond(
        { error: "tone must be a string of 200 characters or fewer" },
        400,
      );
    }

    if (instruction === "change_tone" && (!tone || typeof tone !== "string")) {
      return respond(
        { error: "tone is required for change_tone instruction" },
        400,
      );
    }

    // Use service role for mutations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify story ownership
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .select("id, author_id")
      .eq("id", storyId)
      .single();

    if (storyError || !story) {
      return respond({ error: "Story not found" }, 404);
    }
    if (story.author_id !== user.id) {
      return respond({ error: "Not authorized to edit this story" }, 403);
    }

    // Fetch the chapter
    const { data: chapter, error: chapterError } = await serviceClient
      .from("chapters")
      .select("id, story_id, content")
      .eq("id", chapterId)
      .eq("story_id", storyId)
      .single();

    if (chapterError || !chapter) {
      return respond({ error: "Chapter not found" }, 404);
    }

    const content = chapter.content as string;
    if (!content) {
      return respond({ error: "Chapter has no content" }, 400);
    }

    // Split into paragraphs
    const paragraphs = content.split("\n\n");
    if (paragraphIndex >= paragraphs.length) {
      return respond(
        {
          error: `paragraph_index ${paragraphIndex} is out of range (0-${paragraphs.length - 1})`,
        },
        400,
      );
    }

    const targetParagraph = paragraphs[paragraphIndex];

    // Build user prompt based on instruction type
    const userPrompt = buildEditPrompt(
      instruction,
      targetParagraph,
      tone as string | undefined,
      customNote as string | undefined,
    );

    // Call the LLM
    const result = await editParagraph(EDIT_SYSTEM_PROMPT, userPrompt);

    // Replace the paragraph
    paragraphs[paragraphIndex] = result.text.trim();
    const updatedContent = paragraphs.join("\n\n");
    const wordCount = updatedContent.split(/\s+/).filter(Boolean).length;

    // Update the chapter
    const { error: updateError } = await serviceClient
      .from("chapters")
      .update({ content: updatedContent, word_count: wordCount })
      .eq("id", chapterId);

    if (updateError) throw updateError;

    // Update story word count (sum of all chapters)
    const { data: allChapters, error: chaptersError } = await serviceClient
      .from("chapters")
      .select("word_count")
      .eq("story_id", storyId);

    if (!chaptersError && allChapters) {
      const totalWordCount = allChapters.reduce(
        (sum: number, c: Record<string, unknown>) =>
          sum + ((c.word_count as number) ?? 0),
        0,
      );
      await serviceClient
        .from("stories")
        .update({ word_count: totalWordCount })
        .eq("id", storyId);
    }

    return respond({
      updated_paragraph: paragraphs[paragraphIndex],
      paragraph_index: paragraphIndex,
      model: result.model,
    });
  } catch (error) {
    console.error("edit-story error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

function buildEditPrompt(
  instruction: string,
  paragraph: string,
  tone?: string,
  customNote?: string,
): string {
  let editInstruction: string;

  switch (instruction) {
    case "rewrite":
      editInstruction =
        "Rewrite this paragraph maintaining the story's style and context.";
      break;
    case "expand":
      editInstruction =
        "Expand this paragraph with more detail and description.";
      break;
    case "shorten":
      editInstruction =
        "Condense this paragraph while keeping its essence.";
      break;
    case "change_tone":
      editInstruction = `Rewrite this paragraph with a ${tone} tone.`;
      break;
    case "custom":
      editInstruction = customNote!;
      break;
    default:
      editInstruction = "Rewrite this paragraph.";
  }

  return `Instruction: ${editInstruction}\n\nParagraph:\n${paragraph}`;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
