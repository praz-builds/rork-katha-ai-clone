/**
 * The narration voice picker's data source.
 *
 * Returns active voices, optionally filtered by language, with the tier and a
 * reusable preview URL a picker needs to render without touching the
 * provider. Previews are generated once by `seed-voice-previews`, never on
 * this read path -- this function only resolves the stable path that
 * function already wrote to a public URL.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { listVoices } from "../_shared/voices.ts";
import { publicAudioUrl } from "../_shared/narration-audio.ts";

const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  if (req.method !== "GET") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const url = new URL(req.url);
    const languageParam = url.searchParams.get("language");
    if (languageParam && !LANGUAGE_PATTERN.test(languageParam)) {
      return respond({ error: "Invalid language" }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const voices = await listVoices(serviceClient, languageParam ?? undefined);

    const payload = await Promise.all(voices.map(async (voice) => ({
      id: voice.id,
      display_name: voice.display_name,
      language: voice.language,
      gender: voice.gender,
      tier: voice.tier,
      preview_url: voice.preview_path
        ? await publicAudioUrl(serviceClient, voice.preview_path)
        : null,
    })));

    return respond({ voices: payload });
  } catch (error) {
    console.error("voices error:", error);
    return respond({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
