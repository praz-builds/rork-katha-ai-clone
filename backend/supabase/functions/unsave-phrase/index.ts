import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  try {
    if (req.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = authedClient(authHeader);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await readJsonObject(req, 1024);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const phraseId = parseUuid(body.phraseId);
    if (!phraseId) return respond({ error: "Invalid phraseId" }, 400);

    const { error } = await supabase
      .from("saved_phrases")
      .delete()
      .eq("id", phraseId)
      .eq("user_id", user.id);
    if (error) throw error;

    return respond({ unsaved: true, phrase_id: phraseId });
  } catch (error) {
    console.error("unsave-phrase error:", error);
    await logError({
      bucket: "phrase.learning",
      severity: "medium",
      errorCode: "unsave_phrase_failed",
      error,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

serve(handleRequest);

function authedClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
