import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

/**
 * Threaded comments, voting, reporting, and author-blocking, all served from
 * one function and routed by HTTP method plus a `action` field on POST
 * bodies (GET reads a thread; every write is a POST with `action`). No other
 * edge function in this repo multiplexes several operations behind one path,
 * so this is a new shape rather than a copy of an existing one -- but the
 * primitives (serve, corsHeadersFor/handleCors, parseUuid, readJsonObject,
 * the anon-key-plus-caller-JWT client, the try/catch/respond skeleton) are
 * the same ones `feed`, `library`, and `edit-story` already use.
 *
 * Every operation runs as the CALLING USER, never the service role. The
 * client is built with the anon key and the caller's own `Authorization`
 * header, so every insert/update/delete/select goes through the RLS
 * policies migration 00042 defines. That is deliberate: those policies ARE
 * the security model for comments, votes, reports, and blocks (a reporter
 * cannot read reports back, a user cannot see anyone else's vote or block
 * list, and so on), and a service-role shortcut here would silently discard
 * all of it. There is no service-role client anywhere in this file.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A comment can run to a real paragraph or two; 5,000 characters is well
 * past any legitimate reply and comfortably below what would make a single
 * abusive post dominate a thread render.
 */
const MAX_CONTENT_LENGTH = 5_000;

/** Matches the `details` column's own check constraint in 00042. */
const MAX_REPORT_DETAILS_LENGTH = 2_000;

const DEFAULT_THREAD_LIMIT = 100;
/**
 * The thread read returns a flat list the client trees itself (see the task
 * this function was built against). A flat cap, not a top-level-comment
 * cap, keeps a single request bounded regardless of how replies are
 * distributed; 300 is generous for any thread a phone screen can usefully
 * render and still a small, fixed page size.
 */
const MAX_THREAD_LIMIT = 300;
const MAX_PAGE = 500;

/** Exactly the `reason` enum from migration 00042's `content_reports` check. */
const REPORT_REASONS = new Set([
  "spam",
  "harassment",
  "hate_speech",
  "sexual_content",
  "violence",
  "self_harm",
  "misinformation",
  "other",
]);

type AuthedClient = ReturnType<typeof createAuthedClient>;

function createAuthedClient(url: string, anonKey: string, authHeader: string) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

/** What a per-action handler hands back to the top-level router. */
type OperationResult =
  | { status: number; body: Record<string, unknown> }
  | { status: number; error: string };

// ---------------------------------------------------------------------------
// Pure validation helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Rejects non-strings, whitespace-only content, and over-length content. */
export function validateCommentContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CONTENT_LENGTH) return null;
  return trimmed;
}

/** `1` (upvote), `-1` (downvote), or `0` (remove my vote). Anything else is invalid. */
export function validateVoteValue(value: unknown): -1 | 0 | 1 | null {
  return value === -1 || value === 0 || value === 1 ? value : null;
}

export function validateReportReason(value: unknown): string | null {
  return typeof value === "string" && REPORT_REASONS.has(value)
    ? value
    : null;
}

/** `details` is optional; blank is treated the same as omitted. */
export function validateReportDetails(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MAX_REPORT_DETAILS_LENGTH) return { ok: false };
  return { ok: true, value: trimmed };
}

/** A report targets exactly one of a story or a comment, never both, never neither. */
export function validateReportTarget(
  storyId: string | null,
  commentId: string | null,
): boolean {
  return (storyId !== null) !== (commentId !== null);
}

export function isSelfBlock(userId: string, blockedId: string): boolean {
  return userId === blockedId;
}

/** `null`/`undefined` are valid (no parent, or no target) -- an actual malformed value is not. */
export function parseOptionalUuid(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const parsed = parseUuid(value);
  return parsed ? { ok: true, value: parsed } : { ok: false };
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
): number | null {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseThreadPagination(
  url: URL,
): { page: number; limit: number } | null {
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const requestedLimit = parsePositiveInteger(
    url.searchParams.get("limit"),
    DEFAULT_THREAD_LIMIT,
  );
  if (page === null || requestedLimit === null || page > MAX_PAGE) {
    return null;
  }
  return { page, limit: Math.min(requestedLimit, MAX_THREAD_LIMIT) };
}

/**
 * Postgres error code off a PostgREST/postgres-js error object, if there is
 * one. Used to tell "the unique index already has this row" (23505) or "the
 * foreign key target is gone" (23503) apart from a real failure, without
 * ever pattern-matching on a locale-dependent message for those cases.
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Read a thread
// ---------------------------------------------------------------------------

async function handleReadThread(
  client: AuthedClient,
  userId: string,
  url: URL,
): Promise<OperationResult> {
  const storyId = parseUuid(url.searchParams.get("story_id"));
  if (!storyId) {
    return { status: 400, error: "story_id must be a valid UUID" };
  }

  const pagination = parseThreadPagination(url);
  if (!pagination) {
    return {
      status: 400,
      error: "page and limit must be positive integers",
    };
  }
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return { status: 400, error: "page is too large" };
  }

  // RLS on `user_blocks` (`select using (auth.uid() = blocker_id)`) already
  // guarantees this only ever returns the caller's own blocks; the explicit
  // filter below is belt-and-suspenders, not the security boundary.
  const { data: blocks, error: blocksError } = await client
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);
  if (blocksError) throw blocksError;
  const blockedIds = (blocks ?? []).map((row) => row.blocked_id as string);

  let query = client
    .from("comments")
    .select(
      "id, parent_id, depth, content, created_at, score, deleted_at, user_id, profiles!comments_user_id_fkey(username)",
      // `exact`, not `planned`: a planner ESTIMATE reported `total: 1` for a
      // story with no comments at all, because that is what the planner
      // guesses for an unanalyzed table. A client paging on that waits for a
      // comment that does not exist. A thread is bounded by one story, so an
      // exact count is cheap here in a way it would not be on a global table.
      { count: "exact" },
    )
    .eq("story_id", storyId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  // Same pattern `feed/index.ts` already uses for excluding curated IDs from
  // the fill query: `blockedIds` comes back from our own prior query against
  // a uuid column, never from the request body, so this is not user input
  // reaching SQL -- it is our own trusted read joined into the next one.
  if (blockedIds.length > 0) {
    query = query.not("user_id", "in", `(${blockedIds.join(",")})`);
  }

  const { data: comments, count, error } = await query;
  if (error) throw error;

  const commentIds = (comments ?? []).map((row) => row.id as string);
  const myVotes = new Map<string, number>();
  if (commentIds.length > 0) {
    // RLS on `comment_votes` (`select using (auth.uid() = user_id)`) means
    // this plain select can never come back with anyone else's vote, no
    // matter what `commentIds` contains.
    const { data: votes, error: votesError } = await client
      .from("comment_votes")
      .select("comment_id, value")
      .in("comment_id", commentIds);
    if (votesError) throw votesError;
    for (const vote of votes ?? []) {
      myVotes.set(vote.comment_id as string, vote.value as number);
    }
  }

  const items = (comments ?? []).map((row) => {
    const profile = row.profiles as { username?: string | null } | null;
    return {
      id: row.id,
      parent_id: row.parent_id,
      depth: row.depth,
      author_id: row.user_id,
      author_display_name: profile?.username ?? null,
      content: row.content,
      created_at: row.created_at,
      score: row.score,
      deleted_at: row.deleted_at,
      my_vote: myVotes.get(row.id as string) ?? 0,
    };
  });

  const total = count ?? 0;
  return {
    status: 200,
    body: {
      comments: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  };
}

// ---------------------------------------------------------------------------
// Post a comment
// ---------------------------------------------------------------------------

async function handlePostComment(
  client: AuthedClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<OperationResult> {
  const storyId = parseUuid(body.story_id);
  if (!storyId) return { status: 400, error: "story_id must be a valid UUID" };

  const parentResult = parseOptionalUuid(body.parent_id);
  if (!parentResult.ok) {
    return { status: 400, error: "parent_id must be a valid UUID" };
  }

  const content = validateCommentContent(body.content);
  if (content === null) {
    return {
      status: 400,
      error:
        `content is required and must be ${MAX_CONTENT_LENGTH} characters or fewer`,
    };
  }

  const { data, error } = await client
    .from("comments")
    .insert({
      user_id: userId,
      story_id: storyId,
      parent_id: parentResult.value,
      content,
    })
    .select(
      "id, parent_id, depth, content, created_at, score, deleted_at, user_id, profiles!comments_user_id_fkey(username)",
    )
    .single();

  if (error) {
    // The depth/parent triggers in 00042 (`comments_set_depth`) all
    // `raise exception` with a plain message and no distinguishing SQLSTATE
    // (they come back as P0001), so telling them apart means matching the
    // message text -- but only to pick a clean 4xx, never to leak the raw
    // Postgres message to the client.
    const message = error.message ?? "";
    if (message.includes("maximum depth")) {
      return {
        status: 400,
        error: "This thread has reached the maximum reply depth",
      };
    }
    if (message.includes("does not exist")) {
      return { status: 404, error: "Parent comment not found" };
    }
    if (message.includes("same story")) {
      return {
        status: 400,
        error: "A reply must belong to the same story as its parent comment",
      };
    }
    if (pgErrorCode(error) === "42501") {
      return {
        status: 403,
        error: "You do not have access to comment on this story",
      };
    }
    throw error;
  }

  const profile = data.profiles as { username?: string | null } | null;
  return {
    status: 201,
    body: {
      comment: {
        id: data.id,
        parent_id: data.parent_id,
        depth: data.depth,
        author_id: data.user_id,
        author_display_name: profile?.username ?? null,
        content: data.content,
        created_at: data.created_at,
        score: data.score,
        deleted_at: data.deleted_at,
        my_vote: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

async function castVote(
  client: AuthedClient,
  commentId: string,
  value: -1 | 0 | 1,
): Promise<void> {
  const { error } = await client.rpc("set_comment_vote", {
    p_comment_id: commentId,
    p_value: value,
  });
  if (error) throw error;
}

async function handleVote(
  client: AuthedClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<OperationResult> {
  const commentId = parseUuid(body.comment_id);
  if (!commentId) return { status: 400, error: "comment_id must be a valid UUID" };

  const value = validateVoteValue(body.value);
  if (value === null) {
    return { status: 400, error: "value must be -1, 0, or 1" };
  }

  try {
    await castVote(client, commentId, value);
  } catch (error) {
    if (pgErrorCode(error) === "23503") {
      return { status: 404, error: "Comment not found" };
    }
    throw error;
  }

  // Best-effort echo of the resulting score. `comments` SELECT is gated by
  // the "Accessible story comments are viewable" policy, so a vote cast on a
  // comment the caller can no longer see (story unpublished after the vote,
  // say) still succeeds -- the score just comes back null.
  const { data: comment, error: scoreError } = await client
    .from("comments")
    .select("score")
    .eq("id", commentId)
    .maybeSingle();
  if (scoreError) throw scoreError;

  return {
    status: 200,
    body: {
      comment_id: commentId,
      my_vote: value,
      score: comment?.score ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function handleReport(
  client: AuthedClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<OperationResult> {
  const storyResult = parseOptionalUuid(body.story_id);
  const commentResult = parseOptionalUuid(body.comment_id);
  if (!storyResult.ok || !commentResult.ok) {
    return { status: 400, error: "story_id and comment_id must be valid UUIDs" };
  }
  if (!validateReportTarget(storyResult.value, commentResult.value)) {
    return {
      status: 400,
      error: "Provide exactly one of story_id or comment_id",
    };
  }

  const reason = validateReportReason(body.reason);
  if (!reason) {
    return {
      status: 400,
      error: `reason must be one of: ${[...REPORT_REASONS].join(", ")}`,
    };
  }

  const detailsResult = validateReportDetails(body.details);
  if (!detailsResult.ok) {
    return {
      status: 400,
      error: `details must be ${MAX_REPORT_DETAILS_LENGTH} characters or fewer`,
    };
  }

  // No `.select()` here: `content_reports` has no SELECT policy for
  // `authenticated` at all (by design -- a reporter cannot read reports
  // back), so asking PostgREST to return the inserted row would come back
  // empty regardless and just be a wasted round trip.
  const { error } = await client.from("content_reports").insert({
    reporter_id: userId,
    story_id: storyResult.value,
    comment_id: commentResult.value,
    reason,
    details: detailsResult.value,
  });

  if (error) {
    const code = pgErrorCode(error);
    // Already reported: a clean, idempotent success, not a 500 leaking a
    // unique-index violation.
    if (code === "23505") {
      return { status: 200, body: { reported: true, already_reported: true } };
    }
    if (code === "23503") {
      return { status: 404, error: "Reported content not found" };
    }
    if (code === "23514") {
      return { status: 400, error: "Invalid report" };
    }
    throw error;
  }

  return { status: 200, body: { reported: true, already_reported: false } };
}

// ---------------------------------------------------------------------------
// Block / unblock
// ---------------------------------------------------------------------------

async function handleBlock(
  client: AuthedClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<OperationResult> {
  const blockedId = parseUuid(body.blocked_id);
  if (!blockedId) return { status: 400, error: "blocked_id must be a valid UUID" };

  if (isSelfBlock(userId, blockedId)) {
    return { status: 400, error: "You cannot block yourself" };
  }

  const { error } = await client
    .from("user_blocks")
    .insert({ blocker_id: userId, blocked_id: blockedId });

  if (error) {
    const code = pgErrorCode(error);
    // Already blocked: a no-op success, per the task -- not an error.
    if (code === "23505") {
      return { status: 200, body: { blocked: true, already_blocked: true } };
    }
    if (code === "23503") return { status: 404, error: "User not found" };
    // The DB's own check constraint is the backstop for the self-block rule
    // above; this should be unreachable given the check at the top, but a
    // second, independent guard beats a bypass being silently swallowed.
    if (code === "23514") return { status: 400, error: "You cannot block yourself" };
    throw error;
  }

  return { status: 200, body: { blocked: true, already_blocked: false } };
}

async function handleUnblock(
  client: AuthedClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<OperationResult> {
  const blockedId = parseUuid(body.blocked_id);
  if (!blockedId) return { status: 400, error: "blocked_id must be a valid UUID" };

  // Unconditional delete: unblocking someone never blocked in the first
  // place removes zero rows and is still a clean success -- a user must
  // always be able to undo a block, and a block they cannot undo is a trap.
  const { error } = await client
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", blockedId);
  if (error) throw error;

  return { status: 200, body: { blocked: false } };
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function toResponse(req: Request, result: OperationResult): Response {
  return "error" in result
    ? jsonResponse(req, { error: result.error }, result.status)
    : jsonResponse(req, result.body, result.status);
}

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) => jsonResponse(req, body, status);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    // Anon key + the caller's own JWT: every downstream query runs as this
    // user and is bound by the RLS policies in 00042, exactly as the guest
    // (anonymously-authenticated) or signed-in caller is allowed to.
    const client = createAuthedClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      authHeader,
    );
    const { data: { user } } = await client.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const url = new URL(req.url);

    if (req.method === "GET") {
      return toResponse(req, await handleReadThread(client, user.id, url));
    }

    if (req.method === "POST") {
      const body = await readJsonObject(req);
      if (!body) return respond({ error: "Invalid JSON request body" }, 400);

      const action = body.action;
      if (typeof action !== "string") {
        return respond({ error: "action is required" }, 400);
      }

      switch (action) {
        case "post":
          return toResponse(req, await handlePostComment(client, user.id, body));
        case "vote":
          return toResponse(req, await handleVote(client, user.id, body));
        case "report":
          return toResponse(req, await handleReport(client, user.id, body));
        case "block":
          return toResponse(req, await handleBlock(client, user.id, body));
        case "unblock":
          return toResponse(req, await handleUnblock(client, user.id, body));
        default:
          return respond(
            { error: "action must be one of: post, vote, report, block, unblock" },
            400,
          );
      }
    }

    return respond({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("comments error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
}

// Only bind a listener when this file is the process entrypoint (how the
// Supabase edge runtime invokes it). Importing this module for its exported
// pure functions -- which is exactly what `index.test.ts` does -- must not
// have the side effect of opening a network listener.
if (import.meta.main) {
  serve(handleRequest);
}
