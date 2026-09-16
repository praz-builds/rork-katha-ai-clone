/**
 * Invite codes: read mine, or enter somebody else's.
 *
 * Product decision D10. A referral pays 10 to the referrer and 5 to the
 * invitee, once, and only when BOTH conditions hold: the invitee has
 * generated something, and their account is at least 24 hours old. Caps are 3
 * a month and 10 in a lifetime for the referrer. Self-referral, tester
 * accounts and a second claim by the same account are refused.
 *
 * WHAT THIS FILE DOES NOT DO. It does not pay anybody. `claim_referral_code`
 * records the relationship and `settle_referrals` pays, both in SQL, both
 * SECURITY DEFINER and executable by `service_role` alone. The two grants go
 * through `grant_credit` under distinct operation keys --
 * `referral:referrer:{referred_id}` and `referral:invitee:{referred_id}`.
 *
 * The reason is not that the ledger's operation keys are globally unique --
 * they are not. `idx_credit_ledger_operation_key` (00005) is unique on
 * `(user_id, operation_key)`, and the only global index,
 * `idx_credit_ledger_external_operation_key`, is partial: it covers
 * `reason in ('purchase','subscription')` alone. So the two halves of a
 * referral could in fact share one key without colliding, because they are
 * granted to two different users -- the referrer and the invitee.
 *
 * Two keys are still right, for a different reason: the key has to be unique
 * per user, and it also has to be READABLE as what it paid for. One key would
 * make a referrer's row and their invitee's row indistinguishable in the
 * ledger, so a reconciliation could not tell the 10 from the 5, and a future
 * change that ever pays both halves to one account (a self-referral bug, a
 * merged account) would silently drop the second grant as a duplicate. The
 * side is in the key, so neither can happen. Two keys, one transaction:
 * either both land or neither does.
 *
 * WHY THE CLAIM IS NOT THE PAYOUT. The 24-hour rule has no event. Nothing
 * fires when a day passes, so the payout is retried opportunistically: by
 * `complete_story_generation` and `complete_continuation_generation` when the
 * invitee finishes writing, and by the `profile` fetch on every open. A
 * referral blocked only by age therefore lands the next time its invitee
 * opens the app, with no job and no cron.
 *
 * Identity comes from the caller's JWT and nowhere else; see the long note in
 * `credit-claims/index.ts`, which this file follows exactly.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { readJsonObject } from "../_shared/operations.ts";

/** The refusal keys the contract names. */
const CLAIM_REASONS = new Set([
  "self",
  "invalid",
  "already",
  "too_old",
  "tester",
]);

/**
 * The longest thing that could be an invite code.
 *
 * `profiles_referral_code_shape` caps a real code at 23 characters. This is
 * the bound on what is worth sending to the database at all: anything longer
 * cannot match any row, and the RPC answers `invalid` for it anyway. Refusing
 * it here keeps a megabyte of text from becoming an indexed lookup.
 */
const MAX_CODE_LENGTH = 32;

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function first(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

/**
 * A code as the database stores it: trimmed and lowercased.
 *
 * Codes are shared by voice, by screenshot and by autocorrect, so "  Ada  "
 * and "ADA" are the same invite. The RPC normalises identically; this copy
 * exists so the length check below measures the real thing.
 */
export function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function shapeClaimResult(
  payload: unknown,
): Record<string, unknown> | null {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const root = parsed && typeof parsed === "object"
    ? parsed as Record<string, unknown>
    : {};
  if (root.ok === true) return { ok: true };
  const reason = typeof root.reason === "string" ? root.reason : "";
  // An unrecognised reason is not relayed: the client has no sentence for it.
  // See the same note in `credit-claims/index.ts`.
  return CLAIM_REASONS.has(reason) ? { ok: false, reason } : null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

    if (action === "code") {
      // The code itself is assigned by `ensure_identity` at bootstrap, so it
      // is normally already there. It is ensured again here because the
      // Credits screen is where somebody goes looking for it, and "you have
      // no invite code" is not an answer any account should ever get.
      const { error: identityError } = await service.rpc("ensure_identity", {
        p_user_id: userId,
      });
      if (identityError) throw identityError;

      const { data: profile, error: profileError } = await service
        .from("profiles")
        .select("referral_code")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;

      const { data: summary, error: summaryError } = await service.rpc(
        "referral_summary",
        { p_user_id: userId },
      );
      if (summaryError) throw summaryError;
      const row = first(summary) ?? {};

      return respond({
        code: typeof profile?.referral_code === "string"
          ? profile.referral_code
          : null,
        invited: count(row.invited),
        credited: count(row.credited),
        monthRemaining: count(row.month_remaining),
      });
    }

    if (action === "claim") {
      const code = normalizeCode(body.code);
      if (code.length === 0 || code.length > MAX_CODE_LENGTH) {
        return respond({ ok: false, reason: "invalid" });
      }

      const { data, error } = await service.rpc("claim_referral_code", {
        p_user_id: userId,
        p_code: code,
      });
      if (error) throw error;

      const result = shapeClaimResult(data);
      if (!result) throw new Error("Claim returned an unrecognised verdict");
      return respond(result);
    }

    return respond({ error: "action must be one of: code, claim" }, 400);
  } catch (error) {
    console.error("referral error:", error);
    await logError({
      bucket: "credits",
      severity: "medium",
      errorCode: `referral_${action || "unknown"}`,
      error,
      context: { action },
      userId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
