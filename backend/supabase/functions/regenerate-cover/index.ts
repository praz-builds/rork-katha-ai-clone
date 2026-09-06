/**
 * Re-roll a story's cover.
 *
 * `STORY_GENERATION_FLOW.md` §10.4: chapter 1's art *is* the cover, and once it
 * exists the writer may regenerate it - one free retry, then 1 credit per
 * `CREDITS_AND_PRICING.md`. Until this endpoint existed the Create Studio
 * carried a permanently disabled "Regenerate Cover" button and a prompt box
 * whose contents were collected and thrown away.
 *
 * The function owns one resource - the cover of one story - and answers two
 * verbs against it. **GET** reports what the cover currently is, which is how
 * the client learns that chapter 1's art has landed: `generate-story` returns
 * `cover_status: "generating"` and then finishes the job on a background task,
 * so without a read there is no second moment at which the client could ever
 * find out. That is the same shape `audio-status` already uses for the other
 * background media job, and it is deliberately not a second function: a status
 * read and the action it reports on disagreeing about ownership or staleness is
 * a class of bug that one file cannot have. **POST** re-rolls it.
 *
 * The handler is deliberately thin. Auth, validation and CORS live here; the
 * claim, the price decision, the provider call and the refund live in
 * `_shared/cover-regeneration.ts`, where they can be tested without a live
 * project. Ownership is checked twice on purpose - the JWT identifies the
 * caller here, and `claim_cover_regeneration` re-checks `author_id` inside the
 * transaction that claims the row, which is the check that actually holds.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  MAX_COVER_NOTE_LENGTH,
  regenerateCover,
} from "../_shared/cover-regeneration.ts";
import {
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  let observedUserId: string | null = null;
  let observedStoryId: string | null = null;
  let observedRequestId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);
    observedUserId = user.id;

    // Service role for every read and write past this point. The claim, the
    // reservation and the refund are all SECURITY DEFINER functions granted to
    // service_role only, and `cover_regen_count` is deliberately outside the
    // owner-update grant so a client cannot reset its own price.
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (req.method === "GET") {
      const storyId = parseUuid(new URL(req.url).searchParams.get("story_id"));
      if (!storyId) return respond({ error: "story_id is required" }, 400);
      observedStoryId = storyId;

      const { data, error } = await service
        .from("stories")
        .select("author_id, cover_image_url, cover_status, cover_regen_count")
        .eq("id", storyId)
        .single();

      // 404 for a story that is not the caller's, not 403. The same reasoning
      // as the regeneration path: the difference between "no such story" and
      // "not yours" enumerates the table for anyone who wants it.
      if (error || !data || data.author_id !== user.id) {
        return respond({ error: "Story not found" }, 404);
      }

      return respond({
        cover_image_url: data.cover_image_url,
        cover_status: data.cover_status,
        cover_regen_count: data.cover_regen_count ?? 0,
      });
    }

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const storyId = parseUuid(body.story_id);
    if (!storyId) return respond({ error: "story_id is required" }, 400);
    observedStoryId = storyId;

    const requestId = parseRequestId(body.request_id);
    if (!requestId) return respond({ error: "request_id is required" }, 400);
    observedRequestId = requestId;

    // The note is optional and over-long is a 400 rather than a truncation:
    // silently cutting a writer's instruction in half produces a cover that
    // answers half of what they asked for, with nothing to say why.
    const promptNote = typeof body.prompt_note === "string"
      ? body.prompt_note.trim()
      : "";
    if (promptNote.length > MAX_COVER_NOTE_LENGTH) {
      return respond({
        error:
          `Cover note must be ${MAX_COVER_NOTE_LENGTH} characters or fewer`,
      }, 400);
    }

    const result = await regenerateCover({
      client: service,
      storyId,
      userId: user.id,
      requestId,
      promptNote: promptNote || undefined,
    });

    if (!result.ok) {
      // Refused, not crashed. A 402 or a 409 is the system working, so only the
      // outcomes that cost somebody something are logged, and at the severity
      // that matches: an outstanding credit is high, a missed image is medium.
      if (result.status >= 500) {
        await logError({
          bucket: result.code === "refund_pending"
            ? "credits"
            : "generation.cover",
          severity: result.code === "refund_pending" ? "high" : "medium",
          source: "runtime",
          errorCode: `cover_regeneration_${result.code}`,
          error: new Error(result.code),
          context: {
            story_id: storyId,
            request_id: requestId,
            operation_id: result.operationId ?? null,
            status_name: result.code,
          },
          userId: user.id,
        });
      }
      return respond(
        {
          error: result.error,
          ...(result.operationId ? { operation_id: result.operationId } : {}),
        },
        result.status,
      );
    }

    return respond({
      cover_image_url: result.coverImageUrl,
      cover_status: "ready",
      cover_regen_count: result.coverRegenCount,
      // What this cost, stated by the server. The client needs it to decide
      // whether to decrement the balance it is showing, and the next press's
      // price is read from `cover_regen_count` rather than guessed.
      charged: result.charged,
      // True when this request id had already bought this cover and the stored
      // one was handed back rather than a second one generated.
      replayed: result.replayed,
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.model ? { model: result.model } : {}),
    });
  } catch (error) {
    console.error("regenerate-cover error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.cover",
      severity: "high",
      source: "runtime",
      errorCode: "cover_regeneration_unhandled",
      error,
      context: {
        story_id: observedStoryId,
        request_id: observedRequestId,
      },
      userId: observedUserId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
});
