import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { parseUuid, readJsonObject } from "../_shared/operations.ts";

const OUTCOMES = new Set(["again", "hard", "good", "easy"]);

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
    const outcome = typeof body.outcome === "string" ? body.outcome : "";
    if (!phraseId) return respond({ error: "Invalid phraseId" }, 400);
    if (!OUTCOMES.has(outcome)) {
      return respond({ error: "Invalid outcome" }, 400);
    }

    const { data, error } = await supabase.rpc("record_phrase_practice", {
      p_user_id: user.id,
      p_saved_phrase_id: phraseId,
      p_outcome: outcome,
    });

    if (error) {
      if (error.code === "KTH03") {
        return respond({ error: "Phrase not found" }, 404);
      }
      if (error.code === "KTH02") {
        return respond({ error: "Invalid outcome" }, 400);
      }
      throw error;
    }

    return respond({ practice: data });
  } catch (error) {
    console.error("record-practice error:", error);
    await logError({
      bucket: "phrase.learning",
      severity: "medium",
      errorCode: "record_practice_failed",
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
