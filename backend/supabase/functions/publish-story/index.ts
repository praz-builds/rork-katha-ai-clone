import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

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

    // Publishing carries whole chapters, so it needs a larger budget than the
    // shared default - but a bounded one: 30 chapters at MAX_CHAPTER_CHARS.
    const body = await readJsonObject(req, 30 * MAX_CHAPTER_CHARS + 64 * 1024);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const storyId = parseUuid(body.story_id);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);

    // Hand-edited content, saved as part of publishing.
    //
    // Create Studio's editor is local: typing, restructuring and retitling all
    // live in React state, and `publishStory` used to send nothing but a story
    // id. So the server published the text the model originally produced, and
    // every manual edit the user made was silently discarded at the exact
    // moment they committed to the story. Editing is free and unlimited
    // (`STORY_GENERATION_FLOW.md` §10.3), which made this worse, not better -
    // the more care a user took, the more they lost.
    //
    // Both fields are optional so the old single-field call keeps working.
    const edits = parseEdits(body);
    if ("error" in edits) return respond({ error: edits.error }, 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify story exists and user is the author
    const { data: story, error: storyError } = await serviceClient
      .from("stories")
      .select("id, author_id, status, is_public")
      .eq("id", storyId)
      .single();

    if (storyError || !story) {
      return respond({ error: "Story not found" }, 404);
    }
    if (story.author_id !== user.id) {
      return respond({ error: "Not authorized to publish this story" }, 403);
    }

    // Verify story status is 'complete'
    if (story.status !== "complete") {
      return respond(
        {
          error:
            `Story cannot be published with status '${story.status}'. Only complete stories can be published.`,
        },
        400,
      );
    }

    // Already public — idempotent success
    if (story.is_public) {
      return respond({ published: true, story_id: storyId });
    }

    // A story needs content before it can go public.
    //
    // This used to require a chapter that already had `is_published = true`,
    // which nothing in the codebase ever set - not generate-story, not
    // continue-story, and there is no chapter-level publish endpoint. The
    // client calls publish-story with a story id and nothing else, so the
    // gate could never be satisfied and publishing was unreachable.
    //
    // Publishing a story publishes its chapters: that is what the single
    // action in Create Studio means.
    const { count, error: chapterError } = await serviceClient
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .eq("story_id", storyId);

    if (chapterError) throw chapterError;
    if ((count ?? 0) < 1) {
      return respond(
        { error: "Story must have at least 1 chapter" },
        400,
      );
    }

    // Persist the edits before anything goes public. If a write fails the
    // story must stay private: publishing content the user did not approve is
    // worse than not publishing at all.
    if (edits.title !== undefined) {
      const { error } = await serviceClient
        .from("stories")
        .update({ title: edits.title })
        .eq("id", storyId);
      if (error) throw error;
    }

    for (const chapter of edits.chapters) {
      const wordCount = chapter.content.trim().split(/\s+/).filter(Boolean)
        .length;
      const { data: updated, error } = await serviceClient
        .from("chapters")
        .update({ content: chapter.content, word_count: wordCount })
        .eq("id", chapter.id)
        // Scoped to this story as well as this id. The id came from the
        // request body, and ownership was verified for the story, not for an
        // arbitrary chapter id a caller might substitute.
        .eq("story_id", storyId)
        .select("id");
      if (error) throw error;
      // A predicate that matches nothing is not an error to PostgREST, so
      // without this check a stale or mistyped chapter id would update zero
      // rows, report success, and publish the original text - which is exactly
      // the failure this whole edits path exists to prevent. Refuse rather than
      // publish content the user did not approve.
      if (!updated?.length) {
        return respond(
          {
            error:
              "One of the chapters to save does not belong to this story. Nothing was published.",
            chapter_id: chapter.id,
          },
          409,
        );
      }
    }

    if (edits.chapters.length > 0) {
      const { data: totals, error: totalsError } = await serviceClient
        .from("chapters")
        .select("word_count")
        .eq("story_id", storyId);
      if (totalsError) throw totalsError;
      const { error: storyWordError } = await serviceClient
        .from("stories")
        .update({
          word_count: (totals ?? []).reduce(
            (sum, c) => sum + (c.word_count ?? 0),
            0,
          ),
        })
        .eq("id", storyId);
      if (storyWordError) throw storyWordError;
    }

    // Publish the chapters first. If the story row went public while its
    // chapters were still unpublished, the feed would list a story whose
    // chapter count query returns zero.
    const { error: chapterPublishError } = await serviceClient
      .from("chapters")
      .update({ is_published: true, published_at: new Date().toISOString() })
      .eq("story_id", storyId)
      .eq("is_published", false);

    if (chapterPublishError) throw chapterPublishError;

    // Publish the story
    const { error: updateError } = await serviceClient
      .from("stories")
      .update({ is_public: true })
      .eq("id", storyId);

    if (updateError) throw updateError;

    return respond({ published: true, story_id: storyId });
  } catch (error) {
    console.error("publish-story error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

/**
 * Longest a hand-edited chapter may be, in characters.
 *
 * The widest word band is `long`, ceilinged at 3,900 words - roughly 25,000
 * characters. 60,000 leaves generous room for heavy hand-editing while staying
 * two orders of magnitude below the 200,000 this started at, which allowed a
 * single publish to carry 6 MB of text.
 */
const MAX_CHAPTER_CHARS = 60_000;
/** Longest a title may be, matching the column's practical use. */
const MAX_TITLE_CHARS = 200;

/**
 * Read the optional `title` and `chapters` edits from a publish request.
 *
 * Absent fields mean "unchanged", not "clear": a client that only sends a story
 * id — every client before this change — must publish exactly what it would
 * have published before.
 */
function parseEdits(
  body: Record<string, unknown>,
):
  | { title?: string; chapters: { id: string; content: string }[] }
  | { error: string } {
  let title: string | undefined;
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return { error: "title must be a non-empty string" };
    }
    if (body.title.length > MAX_TITLE_CHARS) {
      return { error: `title must be ${MAX_TITLE_CHARS} characters or fewer` };
    }
    title = body.title.trim();
  }

  const chapters: { id: string; content: string }[] = [];
  if (body.chapters !== undefined) {
    if (!Array.isArray(body.chapters) || body.chapters.length > 30) {
      return { error: "chapters must be an array of at most 30 items" };
    }
    for (const raw of body.chapters) {
      if (!raw || typeof raw !== "object") {
        return { error: "Each chapter must be an object" };
      }
      const item = raw as Record<string, unknown>;
      const id = parseUuid(item.id);
      if (!id) return { error: "Each chapter needs a valid id" };
      if (typeof item.content !== "string" || !item.content.trim()) {
        // An empty chapter body is almost certainly a client-state bug rather
        // than an intention, and overwriting a paid chapter with nothing is
        // unrecoverable.
        return { error: "Each chapter needs non-empty content" };
      }
      if (item.content.length > MAX_CHAPTER_CHARS) {
        return {
          error:
            `Chapter content must be ${MAX_CHAPTER_CHARS} characters or fewer`,
        };
      }
      chapters.push({ id, content: item.content });
    }
  }

  return { title, chapters };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
