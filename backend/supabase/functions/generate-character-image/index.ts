import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import { generateDraftCharacterPortrait } from "../_shared/image.ts";
import { parseRequestId, readJsonObject } from "../_shared/operations.ts";

const MAX_CHARACTER_FIELD_LENGTH = 500;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  let observedUserId: string | null = null;
  let observedRequestId: string | null = null;

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
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const requestId = parseRequestId(body.request_id);
    if (!requestId) return respond({ error: "request_id is required" }, 400);
    observedRequestId = requestId;

    const name = stringField(body.name);
    const description = stringField(body.description);
    const appearance = stringField(body.appearance);

    if (!name) return respond({ error: "name is required" }, 400);
    if (
      name.length > 100 ||
      description.length > MAX_CHARACTER_FIELD_LENGTH ||
      appearance.length > MAX_CHARACTER_FIELD_LENGTH
    ) {
      return respond({ error: "Character image fields are too long" }, 400);
    }
    if (!description && !appearance) {
      return respond(
        { error: "description or appearance is required" },
        400,
      );
    }

    const image = await generateDraftCharacterPortrait(user.id, requestId, {
      name,
      description,
      appearance,
    });
    if (!image) {
      return respond({ error: "Character image could not be generated" }, 502);
    }

    return respond({
      url: image.url,
      image_url: image.url,
      storage_path: image.storagePath,
      provider: image.provider,
      model: image.model,
    });
  } catch (error) {
    console.error("generate-character-image error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.cover",
      severity: "medium",
      source: "runtime",
      errorCode: "draft_character_image_failed",
      error,
      context: {
        request_id: observedRequestId,
      },
      userId: observedUserId ?? undefined,
    });
    return respond({ error: "Internal server error" }, 500);
  }
});

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
