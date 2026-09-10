import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { viewerStateForStories } from "../_shared/engagement.ts";

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
import { logError } from "../_shared/errors.ts";

const MAX_PAGE = 500;

/**
 * How much of a reader's history the Continue reading rail looks at.
 *
 * The rail renders a handful of cards from the most recently read stories, so
 * it never needed the whole table -- and an unbounded select here would be
 * silently truncated by PostgREST's 1000-row ceiling long before anyone
 * noticed the transfer cost.
 */
const CONTINUE_READING_HISTORY_ROWS = 200;

/**
 * How much read history the ranked feed consults to demote finished stories.
 *
 * Deliberately under PostgREST's default 1000-row ceiling, so the window is
 * one this code chose rather than one the API silently imposed.
 */
const READ_HISTORY_RANKING_ROWS = 800;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  // Hoisted so the catch below can attribute a failure to a caller. The
  // handler had no telemetry at all until 2026-09-10, which is how a feed
  // that was 500ing for every user went unnoticed: `console.error` is not
  // readable (the Supabase CLI has no `functions logs`), and the client
  // falls back to local content on a failed fetch, so nothing surfaced.
  let observedUserId: string | null = null;

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

    // Fetch profile, read history, and the caller's block list in parallel.
    // `user_blocks` is keyed (blocker_id, blocked_id) with blocker_id leading
    // the primary key, so this is a single indexed lookup -- one cheap extra
    // query, run in parallel so it costs no wall-clock time even for the
    // overwhelmingly common case where it comes back empty.
    //
    // Read through `supabase` (the caller's own JWT), NOT `serviceClient`.
    // Migration 00043 ends with `revoke all on table public.user_blocks from
    // public, anon` and grants only `authenticated`, so `service_role` has no
    // SELECT on this table at all and the read fails with 42501 -- which this
    // handler turns into a 500 for every request, for every user, because the
    // block list is fetched before any feed is built. That is what shipped:
    // the feed was returning "Internal server error" to everyone in
    // production while the client quietly fell back to local content, so the
    // home screen still looked populated. Verified on production 2026-09-10.
    //
    // The caller's client is also the correct client on the merits: RLS on
    // `user_blocks` is `select using (auth.uid() = blocker_id)`, so the read
    // is scoped to the caller by the database rather than by the filter
    // below, and the block list stays as narrow as 00043 intended.
    const [profileResult, readCountResult, blockedRowsResult] = await Promise
      .all([
        serviceClient
          .from("profiles")
          .select("onboarding_purpose, preferred_genres")
          .eq("id", user.id)
          .single(),
        serviceClient
          .from("story_reads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("user_blocks")
          .select("blocked_id")
          .eq("blocker_id", user.id),
      ]);

    if (profileResult.error && profileResult.error.code !== "PGRST116") {
      throw profileResult.error;
    }
    if (readCountResult.error) throw readCountResult.error;
    if (blockedRowsResult.error) throw blockedRowsResult.error;
    const profile = profileResult.data ??
      { onboarding_purpose: null, preferred_genres: [] };
    const isNewUser = (readCountResult.count ?? 0) === 0;
    // Authors the caller has blocked. Almost always empty; both feed builders
    // treat an empty list as "no exclusion clause" so the common case pays
    // for this array but not for any extra query shape or filtering work.
    const blockedAuthorIds = (blockedRowsResult.data ?? []).map(
      (r: Record<string, unknown>) => r.blocked_id as string,
    );

    // Build continue_reading list (stories the user started but have unread chapters)
    const continueReading = await buildContinueReading(serviceClient, user.id);

    let feed: unknown[];
    let total: number;

    if (isNewUser) {
      const result = await buildNewUserFeed(
        serviceClient,
        limit,
        offset,
        blockedAuthorIds,
      );
      feed = result.feed;
      total = result.total;
    } else {
      const result = await buildReturningUserFeed(
        serviceClient,
        user.id,
        profile.preferred_genres ?? [],
        limit,
        offset,
        blockedAuthorIds,
      );
      feed = result.feed;
      total = result.total;
    }

    const [feedWithViewerState, continueWithViewerState] = await Promise.all([
      viewerStateForStories(
        serviceClient,
        user.id,
        feed as Record<string, unknown>[],
      ),
      viewerStateForStories(
        serviceClient,
        user.id,
        continueReading as Record<string, unknown>[],
      ),
    ]);

    return respond({
      feed: feedWithViewerState,
      continue_reading: continueWithViewerState,
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
    // `discovery` has been a permitted bucket since 00058 and no code had
    // ever written to it. A home feed that fails is the most user-visible
    // failure in the product, so it is the one that must be visible to us.
    await logError({
      bucket: "discovery",
      severity: "high",
      source: "runtime",
      errorCode: "feed_unhandled",
      error,
      context: { feature: "feed" },
      userId: observedUserId,
    });
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
  blockedAuthorIds: string[],
): Promise<{ feed: unknown[]; total: number }> {
  // First, get curated stories. Blocking is filtered inside the query, not
  // after: this path pages with a real SQL `.range()`, so a post-fetch
  // filter would silently short a page (and skip rows on deeper pages) the
  // moment a blocked author's story falls inside the requested range.
  // Filtering here also means `count` (and therefore `total`/`pages` in the
  // response) correctly reflects what the blocker can actually see.
  let curatedQuery = serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
      { count: "planned" },
    )
    .eq("is_curated", true)
    .eq("status", "complete")
    .neq("content_rating", "explicit");

  if (blockedAuthorIds.length > 0) {
    curatedQuery = curatedQuery.not(
      "author_id",
      "in",
      `(${blockedAuthorIds.join(",")})`,
    );
  }

  const { data: curated, count: curatedCount, error: curatedError } =
    await curatedQuery
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
  const fillOffset = offset > curatedTotal ? offset - curatedTotal : 0;

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
  if (blockedAuthorIds.length > 0) {
    fillQuery = fillQuery.not(
      "author_id",
      "in",
      `(${blockedAuthorIds.join(",")})`,
    );
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
  blockedAuthorIds: string[],
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
    // Ordered and bounded rather than unbounded.
    //
    // This set demotes stories the reader has already finished. Asking for
    // every row would be silently cut off at PostgREST's 1000-row ceiling in
    // whatever order the planner happened to return -- so a heavy reader
    // would get an arbitrary slice of their history and watch finished
    // stories drift back into the feed. Taking the most recent window is a
    // deliberate slice instead of an accidental one, and it is the half that
    // matters: a story read two years ago resurfacing is a re-recommendation,
    // one read on Tuesday is a bug.
    serviceClient
      .from("story_reads")
      .select("story_id, read_at")
      .eq("user_id", userId)
      .order("read_at", { ascending: false })
      .limit(READ_HISTORY_RANKING_ROWS),
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
  // We fetch a larger batch to score and sort in-memory, then paginate.
  //
  // The ceiling is not decoration. `page` reaches 500 and `limit` reaches 50,
  // so an uncapped (offset + limit) * 3 asks for ~75,000 rows on a single deep
  // page and materializes the whole catalogue inside the isolate. Ranking only
  // ever reads the newest slice anyway, so a deep page returning short is the
  // correct answer rather than a bug worth spending that memory to avoid.
  const MAX_CANDIDATE_BATCH = 500;
  const batchSize = Math.min(
    MAX_CANDIDATE_BATCH,
    Math.max(200, (offset + limit) * 3),
  );

  let candidateQuery = serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
      { count: "planned" },
    )
    .or("is_public.eq.true,is_curated.eq.true")
    .eq("status", "complete")
    .neq("author_id", userId)
    .neq("content_rating", "explicit");

  // Excluded here, in the same WHERE clause as the author's own stories,
  // rather than after the fetch: this query is `.limit(batchSize)`, not
  // paginated with `.range()`, but the in-memory ranking below slices off of
  // it, so anything filtered out only after the fetch would eat into
  // `batchSize` for free (a blocked author's rows would occupy candidate
  // slots that never reach the ranked list) without the ceiling comment
  // above accounting for it. Filtering in the query means every row the
  // batch actually returns is one the caller can see, so `batchSize` doesn't
  // need to grow to compensate.
  if (blockedAuthorIds.length > 0) {
    candidateQuery = candidateQuery.not(
      "author_id",
      "in",
      `(${blockedAuthorIds.join(",")})`,
    );
  }

  candidateQuery = candidateQuery
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
      (storyPrimaryGenre &&
        preferredGenreSet.has(storyPrimaryGenre.toLowerCase())) ||
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
  // Stories the user has read at least one chapter of.
  //
  // Bounded on purpose. `record_story_read` writes one row per (user,
  // chapter, 24h), so a reader who finishes three chapters a day passes a
  // thousand rows inside a year -- and PostgREST's default `max-rows` is
  // exactly 1000, so this select would silently truncate rather than error.
  // The rail shows at most a handful of cards and only ever wants the recent
  // end of this list, so asking for the recent end is both correct and
  // cheaper than shipping the reader's entire history twice per feed load.
  const { data: readStories, error: readError } = await serviceClient
    .from("story_reads")
    .select("story_id, read_at")
    .eq("user_id", userId)
    .order("read_at", { ascending: false })
    .limit(CONTINUE_READING_HISTORY_ROWS);

  if (readError) throw readError;
  if (!readStories?.length) return [];

  // Deduplicate story IDs
  const storyIds = [
    ...new Set(
      readStories.map((r: Record<string, unknown>) => r.story_id as string),
    ),
  ];

  // Get stories with their chapter counts
  const { data: stories, error: storiesError } = await serviceClient
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, topic, cover_image_url, read_count, like_count, word_count, created_at, author_id, content_rating, profiles!stories_author_id_fkey(username)",
    )
    .in("id", storyIds)
    .eq("status", "complete")
    .neq("content_rating", "explicit")
    // Visibility, which this query alone was missing.
    //
    // Every other feed query filters on it; this one selected purely by "the
    // caller has read it", so a story kept its place on the reader's home
    // screen -- title, topic, cover -- after its author took it private. That
    // includes a story forced private by 00050 for naming a real living
    // person, where continuing to show it is the specific outcome the gate
    // exists to prevent. Having read something once is not a standing licence
    // to keep seeing it.
    //
    // The author keeps their own: a writer reading back their own private
    // draft should still find it here.
    .or(`is_public.eq.true,is_curated.eq.true,author_id.eq.${userId}`)
    .limit(10);

  if (storiesError) throw storiesError;
  if (!stories?.length) return [];

  // Two queries for the whole rail, not two per story.
  //
  // This was a sequential `for` loop issuing a chapter count and a read count
  // per story - up to twenty round trips, in series, to decide which three
  // cards to show. The counts are trivially batchable: fetch both sets scoped
  // to the story ids already in hand, then tally in memory. The work is the
  // same; the waiting is not.
  const ids = stories.map((story) => story.id as string);

  const [chapterRows, readRows] = await Promise.all([
    serviceClient
      .from("chapters")
      .select("story_id")
      .in("story_id", ids)
      .eq("is_published", true),
    serviceClient
      .from("story_reads")
      .select("story_id")
      .in("story_id", ids)
      .eq("user_id", userId),
  ]);
  if (chapterRows.error) throw chapterRows.error;
  if (readRows.error) throw readRows.error;

  const tally = (rows: { story_id: string }[] | null) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      counts.set(row.story_id, (counts.get(row.story_id) ?? 0) + 1);
    }
    return counts;
  };
  const publishedChapters = tally(
    chapterRows.data as { story_id: string }[] | null,
  );
  const chaptersRead = tally(readRows.data as { story_id: string }[] | null);

  // More published chapters than read entries means there is something left to
  // continue. Order is preserved from the query above, so the first three
  // still win, exactly as the loop's early break did.
  const continueList = stories
    .filter((story) => {
      const id = story.id as string;
      return (publishedChapters.get(id) ?? 0) > (chaptersRead.get(id) ?? 0);
    })
    .slice(0, 3);

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
