import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { getBalance } from "../_shared/credits.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  anonymousGrantScope,
  hashAnonymousGrantScope,
  isAnonymousUser,
} from "../_shared/guest-bootstrap.ts";

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

    return respond({
      user_id: user.id,
      balance,
      is_anonymous: guest,
      welcome_granted: welcomeGranted,
      rate_limited: rateLimited,
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

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
