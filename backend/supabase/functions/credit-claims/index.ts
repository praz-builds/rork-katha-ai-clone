/**
 * Feedback credits: the list of comments that could earn one, and the claim.
 *
 * Product decision D9 reversed an earlier removal. The old faucet
 * (`create_feedback`) paid a credit for any comment, once a day, forever --
 * a one-character "ok" was worth the same as a paragraph, which made it a
 * currency press rather than a reward. What replaced it pays for a comment
 * the reader explicitly claims, under rules that all live in SQL:
 *
 *   forty characters, somebody else's story, a two-minute read of that story
 *   recorded BEFORE the comment, one per story, one per day, six per month,
 *   not deleted, not upheld-reported, not a tester.
 *
 * NONE of those are checked here, and that is the design. `claim_comment_
 * credit` re-derives every one of them under a lock immediately before it
 * pays, so a client that skipped the list, replayed an old response or
 * hand-rolled the request gets the same answer as one that did everything in
 * order. This file's whole job is: prove who is calling, and pass that id to
 * the RPC.
 *
 * WHY TWO CLIENTS. The caller's JWT identifies them -- `getUser()` against
 * the anon key is what verifies the token's signature and expiry, and it is
 * the only thing in this request that cannot be forged. The RPCs then run
 * through a service-role client, because both are SECURITY DEFINER and
 * executable by `service_role` alone (00089): they take a user id as an
 * argument on trust, so the caller must be something that has verified it.
 * The id handed to them is ALWAYS `user.id` from the verified token and
 * never a field from the body -- a body-supplied user id on a service-role
 * RPC is the whole vulnerability class this shape exists to make impossible.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import {
  parseRequestId,
  parseUuid,
  readJsonObject,
} from "../_shared/operations.ts";

/** The refusal keys the contract names. Anything else is a bug, not a reason. */
const CLAIM_REASONS = new Set([
  "too_short",
  "own_story",
  "not_read",
  "already_claimed",
  "story_cap",
  "daily_cap",
  "monthly_cap",
  "deleted",
  "reported",
  "tester",
]);

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** A status the client has a rendering for; anything else reads as ineligible. */
function claimStatus(value: unknown): "claimable" | "claimed" | "ineligible" {
  return value === "claimable" || value === "claimed" ? value : "ineligible";
}

/**
 * Turn `comment_credit_claims`'s jsonb into the contract's camelCase shape.
 *
 * Exported for the test: this mapping is where a rename on either side would
 * show up as a screen full of blank rows rather than as an error.
 */
export function shapeClaims(payload: unknown): {
  claims: Record<string, unknown>[];
  remaining: { today: number; month: number };
} {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const root = asRecord(parsed);
  const rows = Array.isArray(root.claims) ? root.claims : [];
  const remaining = asRecord(root.remaining);

  return {
    claims: rows
      .map((row) => asRecord(row))
      .filter((row) => typeof row.comment_id === "string")
      .map((row) => {
        const reason = text(row.reason);
        return {
          commentId: String(row.comment_id),
          storyId: text(row.story_id) ?? "",
          storyTitle: text(row.story_title) ?? "",
          excerpt: text(row.excerpt) ?? "",
          createdAt: text(row.created_at),
          status: claimStatus(row.status),
          // Omitted rather than null when there is nothing to say: the
          // contract makes `reason` optional and the client tests for its
          // presence.
          ...(reason ? { reason } : {}),
        };
      }),
    remaining: {
      today: count(remaining.today),
      month: count(remaining.month),
    },
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The claim verdict, normalised, or null when it is not a verdict at all.
 *
 * `ok` decides; a refusal carries exactly one of the contract's reasons. A
 * reason outside that set is not passed on: the client has no sentence for it
 * and would render a Claim button that does nothing and says nothing, which
 * is indistinguishable from a broken app. Null makes the caller raise, which
 * reaches `error_events` and produces an honest "try again" instead.
 *
 * `replayed` is deliberately dropped. The RPC reports it so the ledger can be
 * reasoned about; to the person tapping the button, a replay and a first
 * claim are the same event and must read the same.
 */
export function shapeClaimResult(
  payload: unknown,
): Record<string, unknown> | null {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const root = asRecord(parsed);
  if (root.ok === true) {
    return {
      ok: true,
      credits: count(root.credits) || 1,
      balance: count(root.balance),
    };
  }
  const reason = text(root.reason);
  if (reason && CLAIM_REASONS.has(reason)) return { ok: false, reason };
  return null;
}

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  let action = "";
  let userId: string | null = null;

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      throw new Error("Supabase environment is not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const authed = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);
    userId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON body" }, 400);
    action = typeof body.action === "string" ? body.action : "";

    const service = createClient(url, serviceKey);

    if (action === "list") {
      const { data, error } = await service.rpc("comment_credit_claims", {
        p_user_id: userId,
      });
      if (error) throw error;
      return respond(shapeClaims(data));
    }

    if (action === "claim") {
      const commentId = parseUuid(body.comment_id);
      if (!commentId) {
        return respond({ error: "comment_id must be a valid UUID" }, 400);
      }
      // The same request id delivered twice is one claim, not two: the RPC
      // recognises its own replay and answers `ok` again without a second
      // ledger row. A missing or malformed one is refused here rather than
      // being invented, because an invented id would make every retry a new
      // claim -- which is exactly the double-pay this guards against.
      const requestId = parseRequestId(body.request_id);
      if (!requestId) {
        return respond({ error: "request_id is required" }, 400);
      }

      const { data, error } = await service.rpc("claim_comment_credit", {
        p_user_id: userId,
        p_comment_id: commentId,
        p_request_id: requestId,
      });
      if (error) {
        // KTH03 is "that comment is not yours, or does not exist". A 404 and
        // a 403 would be the same answer with the second one confirming the
        // comment exists, so both are this.
        if (pgErrorCode(error) === "KTH03") {
          return respond({ error: "Comment not found" }, 404);
        }
        throw error;
      }

      const result = shapeClaimResult(data);
      if (!result) throw new Error("Claim returned an unrecognised verdict");
      return respond(result);
    }

    return respond({ error: "action must be one of: list, claim" }, 400);
  } catch (error) {
    console.error("credit-claims error:", error);
    await logError({
      bucket: "credits",
      severity: "medium",
      errorCode: `credit_claims_${action || "unknown"}`,
      error,
      context: { action },
      userId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

/** The SQLSTATE off a PostgREST error, when there is one. */
function pgErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

if (import.meta.main) {
  serve(handleRequest);
}
