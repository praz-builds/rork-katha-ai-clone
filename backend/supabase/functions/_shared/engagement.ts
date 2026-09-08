import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "./cors.ts";
import { logError } from "./errors.ts";
import { parseUuid, readJsonObject } from "./operations.ts";

type JsonRecord = Record<string, unknown>;
const makeClient = (url: string, key: string) => createClient(url, key);
type RpcClient = ReturnType<typeof makeClient>;

type ToggleRpc =
  | "toggle_story_like"
  | "toggle_bookmark"
  | "toggle_story_follow"
  | "toggle_user_follow";

type ToggleConfig = {
  bodyKey: "storyId" | "authorId";
  rpc: ToggleRpc;
  logName: string;
};

type ToggleRow = {
  on: boolean;
  count: number;
  refused?: boolean;
};

type ReadRow = {
  recorded: boolean;
  counted: boolean;
  count: number;
  read_id: string;
  is_own_story: boolean;
  counts_for_earnings: boolean;
};

type StreakRow = {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string;
};

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function clients(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Supabase environment is not configured");
  }

  return {
    authed: createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    }),
    service: createClient(url, serviceKey),
  };
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Unauthorized" as const };

  const pair = clients(authHeader);
  const { data: { user }, error } = await pair.authed.auth.getUser();
  if (error || !user) return { error: "Unauthorized" as const };

  return { userId: user.id, service: pair.service };
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseDuration(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
      value <= 86400
    ? value
    : null;
}

export async function handleToggle(
  req: Request,
  config: ToggleConfig,
): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  let storyId: string | null = null;
  let authorId: string | null = null;
  let userId: string | null = null;

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return respond({ error: auth.error }, 401);
    userId = auth.userId;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON body" }, 400);

    const targetId = parseUuid(body[config.bodyKey]);
    const on = parseBoolean(body.on);
    if (!targetId) {
      return respond({ error: `${config.bodyKey} must be a valid UUID` }, 400);
    }
    if (on === null) return respond({ error: "on must be a boolean" }, 400);

    const params = { p_user_id: userId, p_story_id: targetId, p_on: on };
    storyId = config.bodyKey === "storyId" ? targetId : null;
    authorId = config.bodyKey === "authorId" ? targetId : null;

    const { data, error } = await auth.service.rpc(config.rpc, params);
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as ToggleRow | null;
    if (!row) throw new Error(`${config.rpc} returned no row`);

    return respond({
      on: row.on,
      count: row.count,
      ...(row.refused === true ? { refused: true } : {}),
    });
  } catch (error) {
    console.error(`${config.logName} error:`, error);
    await logError({
      bucket: "engagement",
      severity: "medium",
      errorCode: config.rpc,
      error,
      context: safeContext({ story_id: storyId, author_id: authorId }),
      userId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

export async function handleRecordRead(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  let storyId: string | null = null;
  let chapterId: string | null = null;
  let userId: string | null = null;

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return respond({ error: auth.error }, 401);
    userId = auth.userId;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON body" }, 400);

    storyId = parseUuid(body.storyId);
    const chapter = body.chapterId === undefined || body.chapterId === null
      ? null
      : parseUuid(body.chapterId);
    if (!storyId) {
      return respond({ error: "storyId must be a valid UUID" }, 400);
    }
    if (body.chapterId !== undefined && body.chapterId !== null && !chapter) {
      return respond({ error: "chapterId must be a valid UUID" }, 400);
    }
    chapterId = chapter;

    const durationSeconds = parseDuration(body.durationSeconds);
    if (durationSeconds === null) {
      return respond(
        { error: "durationSeconds must be an integer from 0 to 86400" },
        400,
      );
    }

    const { data, error } = await auth.service.rpc("record_story_read", {
      p_user_id: userId,
      p_story_id: storyId,
      p_chapter_id: chapterId,
      p_duration_seconds: durationSeconds ?? null,
      p_device_id: null,
      p_ip_hash: null,
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as ReadRow | null;
    if (!row) throw new Error("record_story_read returned no row");

    // The read is already committed by the time we get here, so the streak is
    // explicitly best-effort: throwing would answer 500 for work that actually
    // succeeded, and the client would be told its read was lost when it was
    // recorded. These are two RPCs and cannot be one transaction from here, so
    // the honest shape is to report the read and degrade the streak to null.
    let streak: StreakRow | null = null;
    const { data: streakData, error: streakError } = await auth.service.rpc(
      "touch_streak",
      { p_user_id: userId },
    );
    if (streakError) {
      console.error("record-read: touch_streak failed", streakError);
      await logError({
        bucket: "engagement",
        severity: "low",
        errorCode: "touch_streak",
        error: streakError,
        context: safeContext({ story_id: storyId }),
        userId,
      });
    } else {
      streak = (Array.isArray(streakData) ? streakData[0] : streakData) as
        | StreakRow
        | null;
    }

    return respond({
      recorded: row.recorded,
      counted: row.counted,
      count: row.count,
      readId: row.read_id,
      isOwnStory: row.is_own_story,
      countsForEarnings: row.counts_for_earnings,
      streak: streak
        ? {
          currentStreak: streak.current_streak,
          longestStreak: streak.longest_streak,
          lastActivityDate: streak.last_activity_date,
        }
        : null,
    });
  } catch (error) {
    console.error("record-read error:", error);
    await logError({
      bucket: "engagement",
      severity: "medium",
      errorCode: "record_story_read",
      error,
      context: safeContext({ story_id: storyId, chapter_id: chapterId }),
      userId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

function safeContext(values: JsonRecord): JsonRecord {
  const context: JsonRecord = {};
  for (const [key, value] of Object.entries(values)) {
    if (value) context[key] = value;
  }
  return context;
}

export async function viewerStateForStories(
  service: RpcClient,
  userId: string | null,
  stories: JsonRecord[],
): Promise<JsonRecord[]> {
  if (!userId || stories.length === 0) return stories;

  const storyIds = [
    ...new Set(
      stories.map((story) => story.id).filter((id): id is string =>
        typeof id === "string"
      ),
    ),
  ];
  const authorIds = [
    ...new Set(
      stories.map((story) => story.author_id).filter((id): id is string =>
        typeof id === "string"
      ),
    ),
  ];
  if (storyIds.length === 0) return stories;

  const [likes, bookmarks, storyFollows, authorFollows] = await Promise.all([
    service.from("story_likes").select("story_id").eq("user_id", userId).in(
      "story_id",
      storyIds,
    ),
    service.from("bookmarks").select("story_id").eq("user_id", userId).in(
      "story_id",
      storyIds,
    ),
    service.from("story_followers").select("story_id").eq("user_id", userId).in(
      "story_id",
      storyIds,
    ),
    authorIds.length > 0
      ? service.from("user_followers").select("author_id").eq(
        "follower_id",
        userId,
      ).in("author_id", authorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (likes.error) throw likes.error;
  if (bookmarks.error) throw bookmarks.error;
  if (storyFollows.error) throw storyFollows.error;
  if (authorFollows.error) throw authorFollows.error;

  const liked = new Set(
    ((likes.data ?? []) as { story_id: string }[]).map((row) => row.story_id),
  );
  const bookmarked = new Set(
    ((bookmarks.data ?? []) as { story_id: string }[]).map((row) =>
      row.story_id
    ),
  );
  const followsStory = new Set(
    ((storyFollows.data ?? []) as { story_id: string }[]).map((row) =>
      row.story_id
    ),
  );
  const followsAuthor = new Set(
    ((authorFollows.data ?? []) as { author_id: string }[]).map((row) =>
      row.author_id
    ),
  );

  return stories.map((story) => {
    const storyId = typeof story.id === "string" ? story.id : "";
    const authorId = typeof story.author_id === "string" ? story.author_id : "";
    return {
      ...story,
      viewerHasLiked: liked.has(storyId),
      viewerHasBookmarked: bookmarked.has(storyId),
      viewerFollowsStory: followsStory.has(storyId),
      viewerFollowsAuthor: followsAuthor.has(authorId),
    };
  });
}
