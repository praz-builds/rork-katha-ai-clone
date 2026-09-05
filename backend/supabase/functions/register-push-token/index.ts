import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { isValidExpoToken, type PushPlatform } from "../_shared/push.ts";

/**
 * Called once after the user grants notification permission, and again on every
 * cold start.
 *
 * Re-registering on cold start is not redundant. Expo tokens rotate on
 * reinstall, on some OS updates, and when a user restores a backup onto a new
 * device, and the app is the only thing that learns the new value. A token that
 * is only ever written once goes stale silently, and the failure is invisible
 * until a user reports never being told their story was ready.
 */
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
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null) as
      | { expo_token?: unknown; platform?: unknown; device_id?: unknown }
      | null;
    if (!body) return respond({ error: "Invalid request body" }, 400);

    if (!isValidExpoToken(body.expo_token)) {
      return respond({ error: "Invalid Expo push token" }, 400);
    }
    if (body.platform !== "ios" && body.platform !== "android") {
      return respond({ error: "platform must be 'ios' or 'android'" }, 400);
    }
    const platform = body.platform as PushPlatform;
    const deviceId = typeof body.device_id === "string" &&
        body.device_id.trim()
      ? body.device_id.trim().slice(0, 128)
      : null;

    const serviceClient = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await serviceClient.rpc("register_push_token", {
      p_user_id: user.id,
      p_expo_token: body.expo_token,
      p_platform: platform,
      p_device_id: deviceId,
    });
    if (error) throw error;

    return respond({ registered: true });
  } catch (error) {
    console.error("register-push-token error:", error);
    return respond({ error: "Unable to register push token" }, 500);
  }
});

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
