import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { viewerStateForStories } from "../_shared/engagement.ts";

const MAX_PAGE = 500;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  try {
    const url = new URL(req.url);
    const page = parsePositiveInteger(url.searchParams.get("page"), 1);
    const requestedLimit = parsePositiveInteger(
      url.searchParams.get("limit"),
      20,
    );
    if (page === null || requestedLimit === null) {
      return respond(
        { error: "page and limit must be positive integers" },
        400,
      );
    }
    if (page > MAX_PAGE) {
      return respond({ error: "page is too large" }, 400);
    }
    const limit = Math.min(requestedLimit, 50);

    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      return respond({ error: "page is too large" }, 400);
    }

    const genre = parseFilter(
      url.searchParams.get("genre"),
      50,
      /^[\p{L}\p{N} &-]+$/u,
    );
    const search = parseFilter(
      url.searchParams.get("q"),
      200,
      /^[\p{L}\p{N}\s'!?-]+$/u,
    );
    if (genre === null || search === null) {
      return respond({ error: "Invalid genre or search query" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      authHeader
        ? { global: { headers: { Authorization: authHeader } } }
        : undefined,
    );
    const {
      data: { user },
    } = authHeader ? await supabase.auth.getUser() : { data: { user: null } };

    let query = supabase
      .from("stories")
      .select(
        "id, title, genre, primary_genre, topic, cover_image_url, length_type, word_count, created_at, content_rating, author_id",
        { count: "planned" },
      )
      .or("is_public.eq.true,is_curated.eq.true")
      .eq("status", "complete")
      .neq("content_rating", "explicit")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (genre) {
      query = query.eq("primary_genre", genre);
    }
    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    const { data: stories, count, error } = await query;
    if (error) throw error;

    const storyRows = (stories ?? []) as Record<string, unknown>[];
    const storiesWithViewerState = user
      ? await viewerStateForStories(
        createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        ),
        user.id,
        storyRows,
      )
      : storyRows;

    return respond({
      stories: storiesWithViewerState,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error("library error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

function parseFilter(
  value: string | null,
  maxLength: number,
  allowed: RegExp,
): string | undefined | null {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (
    !normalized || normalized.length > maxLength || !allowed.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
