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

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const storyId = parseUuid(body.story_id);
    if (!storyId) return respond({ error: "Invalid story_id" }, 400);

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
          error: `Story cannot be published with status '${story.status}'. Only complete stories can be published.`,
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

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
