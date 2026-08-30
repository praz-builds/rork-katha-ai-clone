import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The client type as `createClient(url, key)` actually instantiates it.
 *
 * `ServiceClient` resolves the *generic defaults* instead
 * (`schema: never`), which is not assignable from a real call and fails
 * `deno check` at every call site.
 */
type ServiceClient = ReturnType<typeof makeServiceClient>;
const makeServiceClient = (url: string, key: string) => createClient(url, key);
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";

const MAX_PAGE = 500;

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

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch profile and read history in parallel
    const [profileResult, readCountResult] = await Promise.all([
      serviceClient
        .from("profiles")
        .select("onboarding_purpose, preferred_genres")
        .eq("id", user.id)
        .single(),
      serviceClient
        .from("story_reads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

    if (profileResult.error && profileResult.error.code !== "PGRST116") {
      throw profileResult.error;
    }
    const profile = profileResult.data ?? { onboarding_purpose: null, preferred_genres: [] };
    const isNewUser = (readCountResult.count ?? 0) === 0;

    // Build continue_reading list (stories the user started but have unread chapters)
    const continueReading = await buildContinueReading(serviceClient, user.id);

    let feed: unknown[];
    let total: number;

    if (isNewUser) {
      const result = await buildNewUserFeed(serviceClient, limit, offset);
      feed = result.feed;
      total = result.total;
    } else {
      const result = await buildReturningUserFeed(
        serviceClient,
        user.id,
        profile.preferred_genres ?? [],
        limit,
        offset,
      );
      feed = result.feed;
      total = result.total;
    }

    return respond({
      feed,
      continue_reading: continueReading,
      is_new_user: isNewUser,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("feed error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// New User Feed
// ---------------------------------------------------------------------------

async function buildNewUserFeed(
  serviceClient: ServiceClient,
  limit: number,
  offset: number,
): Promise<{ feed: unknown[]; total: number }> {
  // First, get curated stories
  const { data: curated, count: curatedCount, error: curatedError } =
    await serviceClient
      .from("stories")
      .select(
        "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
        { count: "planned" },
      )
      .eq("is_curated", true)
      .eq("status", "complete")
      .neq("content_rating", "explicit")
      .order("like_count", { ascending: false })
      .range(offset, offset + limit - 1);

  if (curatedError) throw curatedError;

  const curatedTotal = curatedCount ?? 0;

  // If we have enough curated stories, return them
  if ((curated?.length ?? 0) >= limit) {
    return {
      feed: flattenAuthor(curated ?? []),
      total: curatedTotal,
    };
  }

  // Fill remaining slots with public stories ordered by read_count
  const curatedIds = (curated ?? []).map(
    (s: Record<string, unknown>) => s.id as string,
  );
  const remaining = limit - (curated?.length ?? 0);

  // Adjust offset for the fill query: if we're past all curated, offset into public
  const fillOffset = offset > curatedTotal
    ? offset - curatedTotal
    : 0;

  let fillQuery = serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
      { count: "planned" },
    )
    .eq("is_public", true)
    .eq("status", "complete")
    .neq("content_rating", "explicit")
    .order("read_count", { ascending: false })
    .range(fillOffset, fillOffset + remaining - 1);

  if (curatedIds.length > 0) {
    fillQuery = fillQuery.not("id", "in", `(${curatedIds.join(",")})`);
  }

  const { data: publicStories, count: publicCount, error: publicError } =
    await fillQuery;

  if (publicError) throw publicError;

  return {
    feed: flattenAuthor([...(curated ?? []), ...(publicStories ?? [])]),
    total: curatedTotal + (publicCount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Returning User Feed
// ---------------------------------------------------------------------------

interface ScoredStory {
  story: Record<string, unknown>;
  score: number;
}

async function buildReturningUserFeed(
  serviceClient: ServiceClient,
  userId: string,
  preferredGenres: string[],
  limit: number,
  offset: number,
): Promise<{ feed: unknown[]; total: number }> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(
    now - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Fetch user's followed authors, already-read story IDs in parallel
  const [followingResult, readStoriesResult] = await Promise.all([
    serviceClient
      .from("user_followers")
      .select("author_id")
      .eq("follower_id", userId),
    serviceClient
      .from("story_reads")
      .select("story_id")
      .eq("user_id", userId),
  ]);

  if (followingResult.error) throw followingResult.error;
  if (readStoriesResult.error) throw readStoriesResult.error;

  const followedAuthorIds = new Set(
    (followingResult.data ?? []).map(
      (r: Record<string, unknown>) => r.author_id as string,
    ),
  );
  const readStoryIds = new Set(
    (readStoriesResult.data ?? []).map(
      (r: Record<string, unknown>) => r.story_id as string,
    ),
  );

  // Fetch candidate stories: public or curated, complete, not authored by user
  // We fetch a larger batch to score and sort in-memory, then paginate
  const batchSize = Math.max(200, (offset + limit) * 3);

  let candidateQuery = serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
      { count: "planned" },
    )
    .or("is_public.eq.true,is_curated.eq.true")
    .eq("status", "complete")
    .neq("author_id", userId)
    .neq("content_rating", "explicit")
    .order("created_at", { ascending: false })
    .limit(batchSize);

  const { data: candidates, count: totalCandidates, error: candidateError } =
    await candidateQuery;

  if (candidateError) throw candidateError;

  // Score and filter
  const preferredGenreSet = new Set(
    preferredGenres.map((g) => g.toLowerCase()),
  );

  const scored: ScoredStory[] = [];
  for (const story of candidates ?? []) {
    const storyId = story.id as string;

    // Exclude already-read stories
    if (readStoryIds.has(storyId)) continue;

    let score = 0;
    const storyPrimaryGenre = story.primary_genre as string | null;
    const storyGenres: string[] = (story.genre as string[]) ?? [];
    const storyCreatedAt = story.created_at as string;
    const readCount = (story.read_count as number) ?? 0;
    const likeCount = (story.like_count as number) ?? 0;
    const authorId = story.author_id as string;

    // Genre affinity: +3 if primary_genre or any legacy genre overlaps with preferred genres
    if (
      (storyPrimaryGenre && preferredGenreSet.has(storyPrimaryGenre.toLowerCase())) ||
      storyGenres.some((g) => preferredGenreSet.has(g.toLowerCase()))
    ) {
      score += 3;
    }

    // Followed author boost: +5
    if (followedAuthorIds.has(authorId)) {
      score += 5;
    }

    // Trending boost: +2 if >100 reads and created in last 14 days
    if (readCount > 100 && storyCreatedAt >= fourteenDaysAgo) {
      score += 2;
    }

    // Recency: +1 if created in last 7 days
    if (storyCreatedAt >= sevenDaysAgo) {
      score += 1;
    }

    // Engagement signal: +1 if like_count > 50
    if (likeCount > 50) {
      score += 1;
    }

    scored.push({ story, score });
  }

  // Sort by score DESC, then created_at DESC as tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = (a.story.created_at as string) ?? "";
    const bTime = (b.story.created_at as string) ?? "";
    return bTime.localeCompare(aTime);
  });

  const total = scored.length;
  const paginated = scored.slice(offset, offset + limit);

  return {
    feed: flattenAuthor(paginated.map((s) => s.story)),
    total,
  };
}

// ---------------------------------------------------------------------------
// Continue Reading
// ---------------------------------------------------------------------------

async function buildContinueReading(
  serviceClient: ServiceClient,
  userId: string,
): Promise<unknown[]> {
  // Stories the user has read at least one chapter of
  const { data: readStories, error: readError } = await serviceClient
    .from("story_reads")
    .select("story_id")
    .eq("user_id", userId);

  if (readError) throw readError;
  if (!readStories?.length) return [];

  // Deduplicate story IDs
  const storyIds = [...new Set(
    readStories.map((r: Record<string, unknown>) => r.story_id as string),
  )];

  // Get stories with their chapter counts
  const { data: stories, error: storiesError } = await serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
    )
    .in("id", storyIds)
    .eq("status", "complete")
    .neq("content_rating", "explicit")
    .limit(10);

  if (storiesError) throw storiesError;
  if (!stories?.length) return [];

  // For each story, check if there are chapters the user hasn't read
  // by comparing total chapters vs user's read count for that story
  const continueList: unknown[] = [];
  for (const story of stories) {
    const storyId = story.id as string;

    const [chapterCountResult, userReadCountResult] = await Promise.all([
      serviceClient
        .from("chapters")
        .select("id", { count: "exact", head: true })
        .eq("story_id", storyId)
        .eq("is_published", true),
      serviceClient
        .from("story_reads")
        .select("id", { count: "exact", head: true })
        .eq("story_id", storyId)
        .eq("user_id", userId),
    ]);

    const totalChapters = chapterCountResult.count ?? 0;
    const userReads = userReadCountResult.count ?? 0;

    // If more published chapters than the user has read entries, suggest continuing
    if (totalChapters > userReads) {
      continueList.push(story);
      if (continueList.length >= 3) break;
    }
  }

  return flattenAuthor(continueList as Record<string, unknown>[]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenAuthor(
  stories: Record<string, unknown>[],
): Record<string, unknown>[] {
  return stories.map((s) => {
    const profiles = s.profiles as
      | Record<string, unknown>
      | null
      | undefined;
    // The column is `username`; `display_name` has never existed on profiles.
    // The response field keeps its name so the client contract is unchanged.
    const authorDisplayName = profiles?.username ?? null;
    const { profiles: _omit, ...rest } = s;
    return { ...rest, author_display_name: authorDisplayName };
  });
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

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
