import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { getBalance } from "../_shared/credits.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  anonymousGrantScope,
  hashAnonymousGrantScope,
  isAnonymousUser,
  readGuestClaimToken,
} from "../_shared/guest-bootstrap.ts";
import { readJsonObject } from "../_shared/operations.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(url, serviceRoleKey);
    const { error: profileError } = await serviceClient.from("profiles").upsert(
      { id: user.id },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (profileError) throw profileError;

    const guest = isAnonymousUser(user);

    // A name, a face and an invite code, before the first screen renders.
    //
    // `ensure_identity` (00089) fills `username`, `avatar_id` and
    // `referral_code` only when they are null, so this is a no-op on every
    // call after the first and cheap enough to make unconditionally. It runs
    // here because this is the one request every client makes at boot and
    // again after sign-in, which means a profile can never reach the home
    // screen as an unnamed, faceless row -- the state the old flow left
    // anybody who skipped the identity editor.
    //
    // NOT for a guest. A pre-auth session is infrastructure (D1: nobody gets
    // past onboarding without an email), and handing one a handle and an
    // invite code would burn both on an account that is about to be thrown
    // away -- and put a referral code into the hands of something that costs
    // nothing to create.
    //
    // Reported, never fatal: a person with credits and no handle can still
    // read, and failing boot over a cosmetic default would be the worse
    // outcome by a wide margin.
    if (!guest) {
      const { error: identityError } = await serviceClient.rpc(
        "ensure_identity",
        { p_user_id: user.id },
      );
      if (identityError) {
        await logError({
          bucket: "engagement",
          severity: "low",
          source: "runtime",
          errorCode: "ensure_identity_failed",
          error: identityError,
          userId: user.id,
        });
      }
    }

    let balance = await getBalance(serviceClient, user.id);
    let welcomeGranted = false;
    let rateLimited = false;

    if (guest) {
      const scope = anonymousGrantScope(req);
      const scopeHash = scope
        ? await hashAnonymousGrantScope(scope, serviceRoleKey)
        : null;
      if (!scopeHash) {
        rateLimited = true;
      } else {
        const { data: result, error: bootstrapError } = await serviceClient.rpc(
          "bootstrap_anonymous_user",
          { p_user_id: user.id, p_scope_hash: scopeHash },
        );
        if (bootstrapError) throw bootstrapError;
        if (!result || typeof result !== "object") {
          throw new Error("Anonymous bootstrap returned an invalid result");
        }
        balance = typeof result.balance === "number" ? result.balance : balance;
        welcomeGranted = result.welcome_granted === true;
        rateLimited = result.rate_limited === true;
      }
    }

    // How many of the six free character images are left, so the client can
    // price the button BEFORE the user taps it.
    //
    // It rides on bootstrap rather than on an endpoint of its own because this
    // is the one call every client already makes at boot and after sign-in, and
    // a second round trip for one small integer would be a second thing to keep
    // in sync. A failure degrades to null and the client quotes nothing rather
    // than quoting a guess -- an affordance that lies about a price is worse
    // than one that shows none.
    let characterImagesFreeRemaining: number | null = null;
    {
      const { data, error } = await serviceClient.rpc(
        "character_image_free_remaining",
        { p_user_id: user.id },
      );
      if (error) {
        console.error(
          "character_image_free_remaining failed:",
          safeErrorMessage(error),
        );
      } else if (typeof data === "number") {
        characterImagesFreeRemaining = data;
      }
    }

    // A character made before sign-in, on the one path where the identity
    // could not be kept. See migration 00082 for why this is verified here
    // rather than trusted from a user id in the body.
    let claimedCharacters = 0;
    if (!guest) {
      const claimToken = readGuestClaimToken(await readJsonObject(req));
      if (claimToken) {
        claimedCharacters = await claimGuestCharacters(
          url,
          anonKey,
          serviceRoleKey,
          claimToken,
          user.id,
        );
      }
    }

    return respond({
      user_id: user.id,
      balance,
      is_anonymous: guest,
      welcome_granted: welcomeGranted,
      rate_limited: rateLimited,
      // Additive: an older client that never sends a token always reads 0.
      claimed_characters: claimedCharacters,
      // Additive too, and null when it could not be read. See above.
      character_images_free_remaining: characterImagesFreeRemaining,
    });
  } catch (error) {
    console.error("bootstrap-user error:", safeErrorMessage(error));
    await logError({
      bucket: "credits",
      severity: "medium",
      source: "runtime",
      errorCode: "guest_bootstrap_failed",
      error,
      context: { feature: "guest_bootstrap" },
    });
    return respond({ error: "Unable to bootstrap user" }, 500);
  }
});

/**
 * Move an anonymous session's saved characters onto the caller's account.
 *
 * The token is the proof, and it is checked against Supabase Auth rather than
 * decoded here: whoever holds an unexpired anonymous JWT is the device that
 * created it. Two further conditions, both required -- the token must resolve
 * to an ANONYMOUS user (a named account's token would let one real user drain
 * another's library), and it must not be the caller's own token (that is the
 * in-place conversion, where nothing has to move).
 *
 * Never fatal. The user has verified their email and is on the last screen of
 * onboarding; failing their sign-in because a character could not be re-homed
 * costs them more than the character does. The failure is logged instead --
 * a silent one here is the exact class of bug 00082 exists to close.
 */
async function claimGuestCharacters(
  url: string,
  anonKey: string,
  serviceRoleKey: string,
  claimToken: string,
  ownerId: string,
): Promise<number> {
  try {
    const guestClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${claimToken}` } },
    });
    const { data: { user: guestUser } } = await guestClient.auth.getUser();
    if (!guestUser || !isAnonymousUser(guestUser)) return 0;
    if (guestUser.id === ownerId) return 0;

    const { data, error } = await createClient(url, serviceRoleKey)
      .rpc("claim_guest_characters", {
        p_guest_user_id: guestUser.id,
        p_owner_id: ownerId,
      });
    if (error) throw error;
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.error(
      "bootstrap-user guest claim failed:",
      safeErrorMessage(error),
    );
    await logError({
      bucket: "credits",
      severity: "high",
      source: "runtime",
      errorCode: "guest_character_claim_failed",
      error,
      context: { feature: "guest_character_claim" },
    });
    return 0;
  }
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
