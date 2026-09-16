/**
 * The store reviewer's sign-in.
 *
 * Google Play and the App Store both require working credentials for an
 * account a human reviewer can sign into, and Katha's only sign-in is an
 * emailed OTP -- which a reviewer cannot receive. This function is the
 * narrowest thing that solves that: ONE pre-provisioned address, a fixed
 * six-digit code, and a one-time `token_hash` the client then verifies as an
 * ordinary magic link, so the session that comes out is a normal Supabase
 * session with no special powers and no separate auth path to maintain.
 *
 * `verify_jwt = false` in `config.toml`, because somebody who cannot sign in
 * has no JWT to present. Everything below exists because of that.
 *
 * ## The rules, and the reason for each
 *
 * ONE ANSWER FOR EVERY FAILURE. An unknown address, a wrong code, an account
 * with no code configured, a lockout and a missing pepper all return exactly
 * `401 {"error":"invalid"}`. Anything more specific turns this into an oracle
 * that tells an attacker which addresses exist and when they have found one.
 *
 * CONSTANT-TIME COMPARE, ALWAYS PERFORMED. The digest is computed and
 * compared even when there is no account and no stored digest, against a
 * throwaway value. A short-circuit `return` on the unknown-email branch would
 * answer measurably faster than a wrong code for the real address, which is
 * the same oracle by a different route.
 *
 * THE CODE IS NEVER STORED. `tester_accounts.code_hmac` holds
 * `hmac_sha256(email || ':' || code, REVIEWER_CODE_PEPPER)`. The pepper lives
 * only in the function's secrets, so a database dump does not yield the code,
 * and the email is inside the message so a digest cannot be replayed against
 * a different address.
 *
 * NOTHING IDENTIFYING IS WRITTEN OR LOGGED. `reviewer_signin_attempts` stores
 * sha256 digests of the email and the IP, never the values: the table exists
 * to COUNT attempts, not to know who made them. No log line in this file
 * carries the address or the code, including in the error path -- which is
 * why the catch block reports a bare error code and not the request.
 *
 * THE ROW'S `user_id` IS THE ACCOUNT, NOT THE ADDRESS TYPED AT THE DOOR.
 * GoTrue's `generateLink({type:"magiclink"})` signs up an address it cannot
 * find, so minting the link from the request's (or even the table's) email
 * would turn a drifted `tester_accounts.email` into a session for a brand-new
 * account. The address is therefore read back out of `auth.users` by
 * `tester_accounts.user_id`, and the user the link resolves to is checked
 * against that same id before anything is returned. Both refusals are the
 * same generic 401.
 *
 * LOCKOUT BEFORE WORK. `reviewer_signin_locked` (00089) is asked first: five
 * failures for one address in fifteen minutes, or a hundred attempts from one
 * IP in an hour. A locked request is refused without a digest being computed
 * and without an attempt row being written, so a lockout cannot be extended
 * indefinitely by hammering it.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { readJsonObject } from "../_shared/operations.ts";
import { constantTimeEquals } from "../_shared/revenuecat.ts";

/** Every refusal, byte for byte. */
const INVALID = { error: "invalid" } as const;

/**
 * A digest to compare against when there is nothing real to compare against.
 *
 * Its only job is to make the unknown-email path do the same work as the
 * known one. It is 64 hex characters so the comparison runs over the same
 * number of bytes as a real digest.
 */
const DECOY_DIGEST = "0".repeat(64);

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `hmac_sha256(message, key)` as lowercase hex, matching the column's format. */
export async function hmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
  );
}

/** A plain sha256, for the two values the attempts table counts by. */
export async function sha256Hex(value: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/**
 * What gets peppered: the address and the code, separated.
 *
 * The separator matters. Without it, `("ab", "123456")` and `("ab1", "23456")`
 * would hash identically -- an equivalence nobody would ever exploit here,
 * with one account and a fixed-length code, and still not a property worth
 * leaving in a credential check.
 */
export function codeMessage(email: string, code: string): string {
  return `${email}:${code}`;
}

/** Lowercased and trimmed, the way the `tester_accounts` primary key stores it. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Exactly six digits. The code's shape is fixed, so anything else is not one. */
export function normalizeCode(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{6}$/.test(trimmed) ? trimmed : "";
}

/**
 * The caller's address, as far as the edge runtime knows it.
 *
 * `x-forwarded-for` is a client-settable header, so this is not an identity --
 * it is a bucket. A caller who rotates it evades the per-IP ceiling and is
 * still held by the per-email one, which is the limit that actually protects
 * the account. Null when absent rather than a constant, so every request
 * without the header does not share one bucket and lock each other out.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 && first.length <= 64 ? first : null;
}

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const pepper = Deno.env.get("REVIEWER_CODE_PEPPER");
    if (!url || !serviceKey) {
      throw new Error("Supabase environment is not configured");
    }
    // A missing pepper is a deploy fault, not a bad code. It is reported as
    // one and answered as the other: with no pepper nothing can be verified,
    // so the only safe answer is the refusal everybody else gets.
    if (!pepper) {
      await logError({
        bucket: "engagement",
        severity: "high",
        errorCode: "reviewer_pepper_missing",
        error: new Error("REVIEWER_CODE_PEPPER is not configured"),
      });
      return respond(INVALID, 401);
    }

    const body = await readJsonObject(req);
    if (!body) return respond(INVALID, 401);

    const email = normalizeEmail(body.email);
    const code = normalizeCode(body.code);
    const emailHash = await sha256Hex(email);
    const ip = clientIp(req);
    const ipHash = ip ? await sha256Hex(ip) : null;

    const service = createClient(url, serviceKey);

    const { data: locked, error: lockedError } = await service.rpc(
      "reviewer_signin_locked",
      { p_email_hash: emailHash, p_ip_hash: ipHash },
    );
    if (lockedError) throw lockedError;
    if (locked === true) return respond(INVALID, 401);

    // One row, by primary key. A `maybeSingle` rather than a `single` so an
    // unknown address is an absent row and not an error to be caught.
    const { data: tester, error: testerError } = await service
      .from("tester_accounts")
      .select("email, user_id, code_hmac")
      .eq("email", email)
      .maybeSingle();
    if (testerError) throw testerError;

    const expected = typeof tester?.code_hmac === "string" && tester.code_hmac
      ? tester.code_hmac
      : DECOY_DIGEST;
    const actual = await hmacHex(pepper, codeMessage(email, code));
    // `code === ""` covers a malformed or absent code: the digest above is
    // still computed and compared so the timing does not give it away, and
    // then the result is discarded here.
    const ok = code.length === 6 && tester !== null &&
      constantTimeEquals(expected, actual);

    const { error: attemptError } = await service
      .from("reviewer_signin_attempts")
      .insert({ email: emailHash, ip: ipHash, ok });
    if (attemptError) throw attemptError;

    if (!ok) return respond(INVALID, 401);

    // THE PRE-PROVISIONED ID IS AUTHORITATIVE, NOT THE ADDRESS.
    //
    // `generateLink({type:"magiclink"})` is a SIGN-UP path in GoTrue: an
    // address it does not find is created, and the link it returns then logs
    // somebody into a brand-new account. So the address typed at the door is
    // never the address the link is minted for. `tester_accounts.user_id` is
    // the account this table was provisioned against, and the address is read
    // back out of `auth.users` by that id -- so a row whose `email` column has
    // drifted away from the auth user's cannot mint anything.
    const { data: authUser, error: authUserError } = await service.auth.admin
      .getUserById(tester!.user_id);
    if (authUserError) throw authUserError;
    const authEmail = normalizeEmail(authUser?.user?.email);
    if (!authEmail) {
      // Provisioning fault, answered as the refusal everybody else gets.
      await logError({
        bucket: "engagement",
        severity: "high",
        errorCode: "reviewer_tester_user_missing",
        error: new Error(
          "tester_accounts.user_id has no auth user with an email",
        ),
      });
      return respond(INVALID, 401);
    }

    // A one-time link, taken apart and handed over as its hash.
    //
    // `generateLink` does NOT send mail for a magic link generated this way;
    // it returns the properties the link would have carried, of which the
    // client needs exactly one. The full action link is deliberately not
    // returned: it is a URL that logs somebody in, and this response travels
    // over the network to a device we have not authenticated.
    const { data: link, error: linkError } = await service.auth.admin
      .generateLink({ type: "magiclink", email: authEmail });
    if (linkError) throw linkError;

    // Belt to the braces above: whatever address went in, the user that came
    // back has to be the one row this account was provisioned as. A created
    // user, or any other drift, is refused rather than handed a session.
    if (link?.user?.id !== tester!.user_id) {
      await logError({
        bucket: "engagement",
        severity: "high",
        errorCode: "reviewer_user_mismatch",
        error: new Error("generateLink resolved to a different auth user"),
      });
      return respond(INVALID, 401);
    }

    const tokenHash = link?.properties?.hashed_token;
    if (typeof tokenHash !== "string" || tokenHash.length === 0) {
      throw new Error("generateLink returned no hashed_token");
    }

    return respond({ token_hash: tokenHash, type: "magiclink" });
  } catch (error) {
    // No context, no user id, no request echo. Everything identifying in this
    // request is a credential or an address.
    console.error("reviewer-signin error");
    await logError({
      bucket: "engagement",
      severity: "high",
      errorCode: "reviewer_signin_failed",
      error,
    });
    return respond(INVALID, 401);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
