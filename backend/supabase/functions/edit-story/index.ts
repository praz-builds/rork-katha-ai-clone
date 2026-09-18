import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import {
  type ChapterUpdateClient,
  updateChapterContentIfUnchanged,
} from "../_shared/chapters.ts";
import { logError } from "../_shared/errors.ts";
import { AllProvidersFailedError, editParagraph } from "../_shared/llm.ts";
import {
  streamChapterProse,
  StreamCommittedError,
} from "../_shared/story-stream.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";
import { enforceProseIntegrity } from "../_shared/prose-integrity.ts";

const EDIT_SYSTEM_PROMPT =
  `You are a story editor. You will receive a paragraph from a story and an editing instruction.
Return ONLY the edited paragraph text. Do not add commentary, labels, or explanations.
Maintain the story's existing voice, tense, and point of view unless the instruction specifically asks to change them.`;

/**
 * The ceiling on a whole-chapter save, in characters.
 *
 * The notepad hands back the entire chapter, so this is the one request in the
 * product where a user can post a large body of text. A generated chapter is
 * 500-2,600 words - call it 20,000 characters at the top of the band - and a
 * writer who expands one by hand is still nowhere near this. 200,000 is
 * generous enough that nobody legitimate meets it and small enough that a
 * runaway client cannot post a novel into one row; it is also well inside
 * `MAX_REQUEST_BYTES` (128 KiB) in `_shared/operations.ts`, which refuses the
 * body before this check ever runs. Both exist: one bounds the transport, this
 * one bounds what a chapter is allowed to be.
 */
const MAX_CHAPTER_BODY_CHARS = 200_000;

/** A chapter title is a line, not a paragraph. */
const MAX_CHAPTER_TITLE_CHARS = 200;

const VALID_INSTRUCTIONS = new Set([
  "rewrite",
  "expand",
  "shorten",
  "change_tone",
  "custom",
]);

const VALID_TONES = new Set([
  "darker",
  "lighter",
  "more poetic",
  "more dramatic",
  "simpler",
  "funnier",
  "sadder",
  "more suspenseful",
  "warmer",
  "colder",
]);

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);
  let observedUserId: string | null = null;
  let observedStoryId: string | null = null;
  let observedChapterId: string | null = null;
  let observedParagraphIndex: number | null = null;

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
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    // Validate inputs
    const storyId = parseUuid(body.story_id);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);
    observedStoryId = storyId;

    const chapterId = parseUuid(body.chapter_id);
    if (!chapterId) return respond({ error: "Invalid chapter_id" }, 400);
    observedChapterId = chapterId;

    // --- The notepad save. ---
    //
    // A whole-chapter write with no model in it at all: the writer edited the
    // text by hand and pressed Save. It shares this function because it shares
    // everything that matters - the ownership check, the chapter lookup, the
    // compare-and-swap that stops two edits silently overwriting each other,
    // and the story word-count recompute - and differs only in where the new
    // text came from. A separate function would have to restate all of that
    // and would drift from it.
    //
    // Recognised by the presence of `chapter_body`, before any of the
    // paragraph-edit validation below, because none of that applies here.
    if (body.chapter_body !== undefined) {
      return await saveWholeChapter(req, body, storyId, chapterId, user.id);
    }

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
    observedParagraphIndex = paragraphIndex;

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

    // `custom_notes` is the name older client builds send. They are already
    // installed on devices and cannot be fixed by a deploy, so both are
    // accepted; the client now sends the singular.
    const customNote = body.custom_note ?? body.custom_notes;
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

    if (instruction === "change_tone") {
      if (!tone || typeof tone !== "string") {
        return respond(
          { error: "tone is required for change_tone instruction" },
          400,
        );
      }
      if (!VALID_TONES.has(tone.toLowerCase())) {
        return respond(
          { error: `tone must be one of: ${[...VALID_TONES].join(", ")}` },
          400,
        );
      }
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
          error: `paragraph_index ${paragraphIndex} is out of range (0-${
            paragraphs.length - 1
          })`,
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

    // Splicing the rewrite back in and saving it is identical whether the text
    // arrived whole or in chunks, so both transports call this. The
    // optimistic-concurrency predicate in particular must not be duplicated:
    // it is the only thing standing between two overlapping edits and a
    // silently discarded one.
    //
    // The rewrite is model prose, so it passes the same integrity check as a
    // generated chapter before it is spliced in: an editor model asked for
    // "only the edited paragraph" still returns a note or a trailing brace
    // often enough. No brief is passed -- this path never sends the model one,
    // so there is nothing for it to have pasted. The notepad save below is the
    // writer's own typing and is deliberately NOT checked: what a person wrote
    // is theirs, whatever it looks like.
    const persistRewrite = async (rewritten: string) => {
      const checked = await enforceProseIntegrity(rewritten, {}, {
        feature: "edit_story",
        storyId,
      });
      paragraphs[paragraphIndex] = checked.text.trim();
      const updatedContent = paragraphs.join("\n\n");
      const wordCount = updatedContent.split(/\s+/).filter(Boolean).length;
      const { updated } = await updateChapterContentIfUnchanged(
        serviceClient as unknown as ChapterUpdateClient,
        {
          chapterId,
          previousContent: content,
          nextContent: updatedContent,
          wordCount,
        },
      );
      if (!updated) return { updated: false as const };

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
      return { updated: true as const };
    };

    // --- The streamed transport. ---
    //
    // Every rejection this handler can make - auth, ownership, the paragraph
    // index - has already happened, so only the delivery differs. Editing is
    // free, which makes the failure model much simpler than generation's:
    // there is no credit to refund, so a failure after the first token costs
    // the user nothing but the retry.
    if (body.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          };
          try {
            send("meta", { paragraph_index: paragraphIndex });
            const rewrite = await streamChapterProse({
              systemPrompt: EDIT_SYSTEM_PROMPT,
              userPrompt,
              // A paragraph has no word band, and the bandless default is a
              // whole chapter's budget. This is the edit path's own ceiling.
              maxTokens: 2_000,
              onCommit: () => send("stage", { stage: "writing" }),
              onDelta: (text) => send("delta", { text }),
            });

            const { updated } = await persistRewrite(rewrite.text);
            if (!updated) {
              // The chapter moved under the edit. The rewrite is good, it just
              // cannot be saved onto a version that no longer exists. The text
              // stays on screen so the writer can keep it by hand rather than
              // watching good work disappear.
              send("error", {
                error:
                  "This chapter changed while the edit was being generated. Reload the chapter and try again.",
                code: "chapter_changed",
                partial_prose_shown: true,
              });
              return;
            }
            send("done", {
              updated_paragraph: paragraphs[paragraphIndex],
              paragraph_index: paragraphIndex,
              model: rewrite.model,
            });
          } catch (error) {
            console.error("edit-story stream failed:", error);
            send("error", {
              error: "The rewrite could not be finished. Please try again.",
              partial_prose_shown: error instanceof StreamCommittedError,
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
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Call the LLM
    const result = await editParagraph(EDIT_SYSTEM_PROMPT, userPrompt);

    const { updated } = await persistRewrite(result.text);

    if (!updated) {
      return respond(
        {
          error:
            "This chapter changed while the edit was being generated. Reload the chapter and try again.",
        },
        409,
      );
    }

    return respond({
      updated_paragraph: paragraphs[paragraphIndex],
      paragraph_index: paragraphIndex,
      model: result.model,
    });
  } catch (error) {
    console.error("edit-story error:", error);
    if (error instanceof AllProvidersFailedError) {
      await logError({
        bucket: "llm.provider",
        severity: "critical",
        source: "runtime",
        errorCode: "all_providers_failed",
        error,
        context: {
          ...error.toContext(),
          story_id: observedStoryId,
          chapter_id: observedChapterId,
          paragraph_index: observedParagraphIndex,
        },
        userId: observedUserId,
      });
    }
    await logError({
      bucket: "generation.edit",
      severity: "high",
      source: "runtime",
      errorCode: "unhandled",
      error,
      context: {
        story_id: observedStoryId,
        chapter_id: observedChapterId,
        paragraph_index: observedParagraphIndex,
      },
      userId: observedUserId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
});

/**
 * Persist a hand-edited chapter.
 *
 * The compare-and-swap is deliberately NOT used here, and that is the one real
 * difference from the AI edit path. An AI edit reads a chapter, spends seconds
 * in a model call, and writes back text derived from what it read - so a
 * concurrent write must invalidate it. A notepad save is the writer looking at
 * the text and typing: their copy IS the intent, and refusing it because the
 * cover job or a narration write touched the row would lose work they can see
 * on screen. The client sends the whole chapter, and the whole chapter is what
 * is stored.
 */
async function saveWholeChapter(
  req: Request,
  body: Record<string, unknown>,
  storyId: string,
  chapterId: string,
  userId: string,
): Promise<Response> {
  const respond = (payload: unknown, status = 200) =>
    jsonResponse(req, payload, status);

  const chapterBody = body.chapter_body;
  if (typeof chapterBody !== "string" || !chapterBody.trim()) {
    return respond({ error: "chapter_body must be a non-empty string" }, 400);
  }
  if (chapterBody.length > MAX_CHAPTER_BODY_CHARS) {
    return respond(
      {
        error:
          `chapter_body must be ${MAX_CHAPTER_BODY_CHARS} characters or fewer`,
      },
      400,
    );
  }

  const rawTitle = body.chapter_title;
  if (
    rawTitle !== undefined && rawTitle !== null &&
    (typeof rawTitle !== "string" || rawTitle.length > MAX_CHAPTER_TITLE_CHARS)
  ) {
    return respond(
      {
        error:
          `chapter_title must be a string of ${MAX_CHAPTER_TITLE_CHARS} characters or fewer`,
      },
      400,
    );
  }
  const title = typeof rawTitle === "string" ? rawTitle.trim() : undefined;

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: story, error: storyError } = await serviceClient
    .from("stories")
    .select("id, author_id")
    .eq("id", storyId)
    .single();
  if (storyError || !story) return respond({ error: "Story not found" }, 404);
  if (story.author_id !== userId) {
    return respond({ error: "Not authorized to edit this story" }, 403);
  }

  // Trailing whitespace on a line the writer is still typing on is not
  // content; the leading/trailing blank lines a text area collects are not
  // either. Paragraph structure inside the chapter is left exactly as typed,
  // because that is what the reader's pagination reads.
  const content = chapterBody.replace(/[ \t]+$/gm, "").trim();
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  const update: Record<string, unknown> = {
    content,
    word_count: wordCount,
    // The narration read the old prose; see the chapter_audio delete below.
    audio_url: null,
  };
  // An empty title means "leave it": the notepad shows the existing title in
  // an input, and a writer who clears it is not asking for an untitled chapter.
  if (title) update.title = title;

  const { data: saved, error: saveError } = await serviceClient
    .from("chapters")
    .update(update)
    .eq("id", chapterId)
    .eq("story_id", storyId)
    .select("id, chapter_number, title, content, word_count")
    .maybeSingle();
  if (saveError) throw saveError;
  if (!saved) return respond({ error: "Chapter not found" }, 404);

  // The story's word count is the sum of its chapters, and it is shown on
  // every card. Summed and written by ONE statement (migration 00062) rather
  // than read here and written back: this used to be a SELECT of every
  // chapter followed by an UPDATE of the story, and a concurrent save landing
  // between the two left the story holding a total that matched neither of
  // them. Failure is not fatal -- the chapter is already saved, and the next
  // save of any chapter in this story corrects the count.
  const { error: recountError } = await serviceClient.rpc(
    "recompute_story_word_count",
    { p_story_id: storyId },
  );
  if (recountError) {
    console.error(
      "recompute_story_word_count failed:",
      recountError.message ?? recountError,
    );
  }

  // Narration read the old prose. Same rule as a reimagined chapter: drop the
  // rows so the next Listen tap generates audio for what is actually there.
  const { error: audioError } = await serviceClient
    .from("chapter_audio")
    .delete()
    .eq("chapter_id", chapterId);
  if (audioError) {
    console.error("chapter_audio cleanup failed:", audioError);
  }

  return respond({ chapter: saved, saved: true });
}

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
      editInstruction = "Condense this paragraph while keeping its essence.";
      break;
    case "change_tone":
      editInstruction = `Rewrite this paragraph with a ${
        tone!.toLowerCase()
      } tone.`;
      break;
    case "custom":
      editInstruction =
        `Apply the following edit to this paragraph. Edit request: "${
          customNote!.slice(0, 500)
        }"`;
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
