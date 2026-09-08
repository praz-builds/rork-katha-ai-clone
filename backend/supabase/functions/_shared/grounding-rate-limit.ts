/**
 * Rate-gates the grounding FALLBACK -- the classification `generate-story`
 * and `generate-story-stream` start on their own when the client supplied no
 * cards (the unshaped Create-studio path). See migration
 * `00051_grounding_fallback_rate_limit.sql` for the limits, the two windows,
 * and why the numbers are what they are.
 *
 * This module does not decide *when* the fallback runs, and it does not touch
 * `resolveGrounding`'s ordering relative to `begin_story_generation` -- both
 * call sites still start the fallback promise before that RPC, so most of the
 * classification is spent against time the request was already going to wait.
 * This only decides, cheaply, whether that promise is allowed to do anything
 * once the caller's LLM budget is on the table.
 *
 * `claimGroundingFallback` never throws. A denial here is not an error: the
 * caller's contract is the same one every other failure path in the grounding
 * system already has -- skip the fallback, generate ungrounded, and never let
 * a convenience feature's own guard rail surface to the writer.
 */
import {
  anonymousGrantScope,
  hashAnonymousGrantScope,
  isAnonymousUser,
} from "./guest-bootstrap.ts";
import { logError } from "./errors.ts";

/**
 * The narrowest thing this module needs from Supabase, mirroring
 * `GroundingCacheClient` in `grounding-pipeline.ts` so both can be satisfied
 * by the same service-role client without a second interface at the call
 * site.
 */
export interface GroundingRateLimitClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ClaimGroundingFallbackInput {
  /** The verified Supabase auth user, signed-in or anonymous. */
  user: { id: string; is_anonymous?: boolean };
  /** For the anonymous network fingerprint only; never read otherwise. */
  request: Request;
  /** Salts the persisted scope hash, same as the guest bootstrap grant. */
  serviceRoleKey: string;
  client: GroundingRateLimitClient;
}

/**
 * True if this caller may run the grounding fallback right now.
 *
 * An anonymous caller behind a proxy that omits the trusted network header
 * fails closed here, same posture `anonymousGrantScope` already documents for
 * the credit grant: no scope to rate-limit by means no fallback, not an
 * unlimited one.
 *
 * A database error also fails closed rather than open. The check sits in
 * front of an LLM call specifically to bound its cost, so a broken check
 * defaulting to "allow" would defeat the reason this exists; defaulting to
 * "skip" costs the writer nothing but grounding on a request that was already
 * going to generate.
 */
export async function claimGroundingFallback(
  input: ClaimGroundingFallbackInput,
): Promise<boolean> {
  const guest = isAnonymousUser(input.user);
  let scopeHash: string | null = null;
  if (guest) {
    const scope = anonymousGrantScope(input.request);
    if (!scope) return false;
    scopeHash = await hashAnonymousGrantScope(scope, input.serviceRoleKey);
  }

  try {
    const { data, error } = await input.client.rpc(
      "claim_grounding_fallback_request",
      { p_user_id: input.user.id, p_anonymous_scope_hash: scopeHash },
    );
    if (error) {
      void logError({
        bucket: "generation.story",
        severity: "low",
        source: "runtime",
        error,
        context: { code: "grounding_fallback_rate_limit_error" },
        userId: input.user.id,
      });
      return false;
    }
    return data === true;
  } catch (thrown) {
    void logError({
      bucket: "generation.story",
      severity: "low",
      source: "runtime",
      error: thrown,
      context: { code: "grounding_fallback_rate_limit_error" },
      userId: input.user.id,
    });
    return false;
  }
}
