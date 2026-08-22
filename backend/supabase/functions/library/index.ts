import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const url = new URL(req.url);
    const page = parsePositiveInteger(url.searchParams.get("page"), 1);
    const requestedLimit = parsePositiveInteger(
      url.searchParams.get("limit"),
      20,
    );
    if (page === null || requestedLimit === null) {
      return jsonResponse(
        { error: "page and limit must be positive integers" },
        400,
      );
    }
    const limit = Math.min(requestedLimit, 50);

    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      return jsonResponse({ error: "page is too large" }, 400);
    }

    const genre = url.searchParams.get("genre");
    const search = url.searchParams.get("q");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    let query = supabase
      .from("stories")
      .select(
        "id, title, genre, topic, cover_image_url, length_type, word_count, created_at",
        { count: "exact" },
      )
      .or("is_public.eq.true,is_curated.eq.true")
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (genre) {
      query = query.contains("genre", [genre]);
    }
    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    const { data: stories, count, error } = await query;
    if (error) throw error;

    return new Response(
      JSON.stringify({
        stories,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil((count || 0) / limit),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("library error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
