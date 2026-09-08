import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  try {
    if (req.method !== "GET") {
      return respond({ error: "Method not allowed" }, 405);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = authedClient(authHeader);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const now = new Date().toISOString();
    const [savedResult, dueResult] = await Promise.all([
      supabase
        .from("saved_phrases")
        .select(
          "id, phrase_id, phrase_text, phrase_key, language, story_id, chapter_id, sentence, saved_at",
        )
        .eq("user_id", user.id)
        .order("saved_at", { ascending: false }),
      supabase
        .from("phrase_practice")
        .select(
          "id, saved_phrase_id, attempted_at, outcome, interval_days, ease, due_at",
        )
        .eq("user_id", user.id)
        .lte("due_at", now)
        .order("due_at", { ascending: true }),
    ]);

    if (savedResult.error) throw savedResult.error;
    if (dueResult.error) throw dueResult.error;

    const saved = savedResult.data ?? [];
    const byId = new Map(saved.map((phrase) => [phrase.id, phrase]));
    const due = (dueResult.data ?? [])
      .map((practice) => ({
        ...practice,
        phrase: byId.get(practice.saved_phrase_id) ?? null,
      }))
      .filter((practice) => practice.phrase);

    return respond({ phrases: saved, due });
  } catch (error) {
    console.error("phrases error:", error);
    await logError({
      bucket: "phrase.learning",
      severity: "medium",
      errorCode: "phrases_read_failed",
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
