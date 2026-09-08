import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { viewerStateForStories } from "../_shared/engagement.ts";

const MAX_PAGE = 500;

/**
 * Exported and separated from `serve` so the scope contract can be driven from
 * a test without binding a port. Importing a module must never start a server.
 */
export async function handleRequest(req: Request): Promise<Response> {
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

    /**
     * `?scope=mine` — the caller's own stories, published or not.
     *
     * Without this a writer's own work was unreachable. Stories persist
     * correctly, but the default query is `is_public OR is_curated`, and a
     * fresh story is private (that is the column default, and the entity gate
     * forces it), so no endpoint anywhere returned it. The client kept its
     * stories in a `useState` array, which meant a browser reload erased every
     * story a writer had ever made -- from the interface, while the rows sat
     * safe in the database. They had paid credits for those.
     *
     * Ownership is enforced by `author_id = user.id` below, not by trusting the
     * parameter: `scope=mine` from an unauthenticated caller returns the public
     * library, never someone else's drafts.
     */
    const scope = url.searchParams.get("scope");
    if (scope !== null && scope !== "mine" && scope !== "public") {
      return respond({ error: "scope must be mine or public" }, 400);
    }

    // The library is a public endpoint that becomes personalised when the
    // caller is signed in, so a token is optional. It must also be allowed to
    // be *bad*: an expired or malformed one is ordinary, not exceptional.
    //
    // Resolving the viewer and reading the stories are therefore two clients.
    // Previously one client carried the caller's Authorization header into the
    // stories query even when `getUser()` had already returned null, so an
    // expired token turned a public browse into a 401 instead of simply
    // returning the public library unpersonalised.
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let user: { id: string } | null = null;
    if (authHeader) {
      const authed = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await authed.auth.getUser();
      user = data.user ?? null;
    }

    // Only a token that actually resolved to a user is carried forward.
    const supabase = user
      ? createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader! } },
      })
      : createClient(supabaseUrl, anonKey);

    const mine = scope === "mine" && user !== null;

    let query = supabase
      .from("stories")
      .select(
        "id, title, genre, primary_genre, topic, cover_image_url, length_type, word_count, created_at, content_rating, author_id",
        { count: "planned" },
      )
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (mine) {
      // A writer sees their own work whatever its visibility, and the content
      // rating filter does not apply to them either: refusing to show someone
      // the story they wrote and paid for, because of how it was rated, is not
      // a safety measure. RLS still scopes this to rows they may read.
      query = query.eq("author_id", user!.id);
    } else {
      query = query
        .or("is_public.eq.true,is_curated.eq.true")
        .neq("content_rating", "explicit");
    }

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
}

if (import.meta.main) {
  serve(handleRequest);
}

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
