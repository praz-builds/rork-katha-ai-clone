import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { touchStreak } from "../_shared/engagement.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

/**
 * Publish a story, or save it privately.
 *
 * Exported and separated from `serve` so the visibility contract can be driven
 * directly from a test. `serve` only runs when this module is the entrypoint;
 * importing it must never bind a port.
 */
export async function handleRequest(req: Request): Promise<Response> {
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
    // Absent means private, and it has to mean private.
    //
    // This defaulted to "public", which made publishing to the world the
    // consequence of a *missing field* rather than of a decision: an older
    // client build still in the wild, a retry that rebuilt the body from a
    // story id alone, or any future integration that never learned about the
    // field would put a user's story on the public feed without the user ever
    // asking. Going public is deliberate and irreversible in the way that
    // matters - other people have already read it - so the failure modes are
    // not symmetric. A story that stayed private when it should have been
    // published is one more tap; a story that went public when it should have
    // stayed private cannot be taken back.
    //
    // The column default (`stories.is_public boolean default false`, 00001)
    // has always agreed with this. The endpoint was the one place that did not.
    const visibility = resolveVisibility(body.visibility);
    if (visibility === null) {
      return respond({ error: "visibility must be private or public" }, 400);
    }
    if (user.is_anonymous === true && visibility === "public") {
      return respond(
        { error: "Create an account before publishing publicly." },
        403,
      );
    }

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
      .select(
        "id, author_id, status, is_public",
      )
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

    // A public story is never silently demoted by a stale client retry, but
    // "already public" is not the same as "nothing left to do". This used to
    // return here, above the edit-persistence block below, so every save made
    // to an already-published story was answered `published: true` and then
    // silently dropped. The editor kept the text on screen and the author lost
    // it on the next refresh.
    //
    // The guard now covers only the thing it was written to protect - the
    // visibility transition - and edits fall through to be persisted.
    const alreadyPublic = story.is_public === true;

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

    // Every chapter id is checked to belong to this story *before* any of them
    // is written. Validating inside the write loop meant a bad id at position
    // three returned 409 after positions one and two were already persisted -
    // a partially-edited story that was then not published, which is the worst
    // of both outcomes. One extra read buys all-or-nothing.
    if (edits.chapters.length > 0) {
      const { data: owned, error: ownedError } = await serviceClient
        .from("chapters")
        .select("id")
        .eq("story_id", storyId)
        .in("id", edits.chapters.map((c) => c.id));
      if (ownedError) throw ownedError;

      const ownedIds = new Set((owned ?? []).map((c) => c.id as string));
      const foreign = edits.chapters.find((c) => !ownedIds.has(c.id));
      if (foreign) {
        return respond(
          {
            error:
              "One of the chapters to save does not belong to this story. Nothing was published.",
            chapter_id: foreign.id,
          },
          409,
        );
      }
    }

    for (const chapter of edits.chapters) {
      const wordCount = chapter.content.trim().split(/\s+/).filter(Boolean)
        .length;
      const { error } = await serviceClient
        .from("chapters")
        .update({ content: chapter.content, word_count: wordCount })
        .eq("id", chapter.id)
        // Still scoped to the story as well as the id: the ownership check
        // above and this predicate are not redundant, because a chapter could
        // be deleted between the two.
        .eq("story_id", storyId);
      if (error) throw error;
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

    // The writing half of the streak.
    //
    // `record-read` has kept `streaks` for the reading half since 00046, and
    // nothing kept it for writing -- so a person who spent an evening editing
    // and publishing a chapter and never opened somebody else's story lost the
    // day. That is the wrong lesson for the surface to teach, and it is exactly
    // the person a writing app should be counting.
    //
    // CALLED AT EACH SUCCESSFUL EXIT, NOT ONCE HERE. An earlier version ran it
    // at this point, above two refusals that then sat below it, so a publish
    // the server turned down still recorded a writing day. A day credited for
    // work the server refused to do is the counter lying, and a streak is only
    // worth anything if it is true. Those refusals are gone (migration 00091),
    // but a call per exit keeps the counter honest if one is ever added back.
    //
    // The private branch below is a success and does count: the edits are
    // committed, which is the work.
    //
    // Best effort by construction (`touchStreak` never throws) -- a counter
    // must not be able to fail a publish that succeeded.
    const countWritingDay = () =>
      touchStreak(serviceClient, user.id, { story_id: storyId });

    // Private is a save operation. Edits are durable, but neither chapters nor
    // the story enter public feeds - and this is the branch a request that
    // omitted `visibility` takes.
    if (visibility === "private") {
      // This is where the demotion guard actually belongs. A save against a
      // story that is already public keeps its edits and keeps its visibility:
      // a client that omits `visibility` is saving, not asking to unpublish.
      // Taking a live story out of the feed has to be an explicit act.
      await countWritingDay();
      if (alreadyPublic) {
        return respond({ saved: true, published: true, story_id: storyId });
      }
      return respond({ saved: true, published: false, story_id: storyId });
    }

    // There is no content gate between a public request and a public story.
    //
    // Until 2026-09-18 two refusals sat here: a story whose idea named a
    // living public figure or a private individual (migration 00050) was
    // refused with a 403, and so was one whose entity classification never
    // answered (migration 00058). The owner removed both for the MVP
    // (migration 00091), because in practice they refused almost everything:
    // every name on a writer's character sheet is classified
    // `private_individual` - the sheet is the sole authority on who a
    // character is - so every story with a named cast, which is nearly every
    // story, could never be published. A toggle that says "public" and a
    // story that stays private is the product lying to its writer.
    //
    // The writer's toggle is now honoured. The only refusal left on this path
    // is the guest rule above, which is abuse control, not privacy.

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

    await countWritingDay();
    return respond({ published: true, story_id: storyId });
  } catch (error) {
    console.error("publish-story error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}

/**
 * Resolve the requested visibility, or null if the field is unusable.
 *
 * Kept as its own function so the default has a name and a test, rather than
 * living as a ternary inside a 200-line handler where flipping it back would
 * read as a typo.
 */
export function resolveVisibility(
  value: unknown,
): "private" | "public" | null {
  if (value === undefined || value === null) return "private";
  if (value === "private" || value === "public") return value;
  return null;
}

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
