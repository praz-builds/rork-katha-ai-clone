import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import { generateDraftCharacterPortrait } from "../_shared/image.ts";
import { parseRequestId, readJsonObject } from "../_shared/operations.ts";

const MAX_CHARACTER_FIELD_LENGTH = 500;

/**
 * Largest style-reference photo accepted, measured on the base64 text.
 *
 * 6 MB of base64 is roughly a 4.5 MB image -- comfortably above a downscaled
 * phone photo and far below anything that would push the request past the
 * platform's own body limit. The client is expected to downscale before
 * sending; this is the backstop, not the resize.
 */
const MAX_REFERENCE_IMAGE_CHARS = 6 * 1024 * 1024;

/**
 * Image types accepted as a style reference.
 *
 * An allowlist rather than a "starts with data:image/" check. The generic form
 * would admit `data:image/svg+xml`, and SVG is a document that can carry script
 * and remote references -- not something to hand to a parser or ever echo back.
 */
const REFERENCE_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
] as const;

/**
 * Read the optional style-reference photo, or explain why it is unusable.
 *
 * Returns `{ value }` on success (including the absent case, where `value` is
 * undefined) and `{ error }` when the field is present but wrong. A malformed
 * reference is rejected rather than silently dropped: the writer attached a
 * photo on purpose, and generating without it while reporting success would
 * hand them a portrait that ignored the one input they cared most about.
 */
export function parseReferenceImage(
  value: unknown,
): { value?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" || !value) {
    return { error: "reference_image must be a data URL string" };
  }
  if (value.length > MAX_REFERENCE_IMAGE_CHARS) {
    return { error: "reference_image is too large" };
  }
  if (!REFERENCE_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return {
      error: "reference_image must be a JPEG, PNG or WebP data URL",
    };
  }
  return { value };
}

/**
 * Exported and separated from `serve` so a test can drive the handler without
 * binding a port. Importing this module used to start a listener on :8000 --
 * `publish-story` had the same bug and the same fix.
 */
export async function handleRequest(req: Request): Promise<Response> {
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

    // A photo the writer attached to steer this character's look. It is a
    // STYLE reference, never a likeness target: `_shared/image.ts` tells the
    // model so explicitly, the base Safety Rules forbid real people, and a real
    // name typed into a character sheet is reclassified `private_individual`
    // and locks the story private (00050). Three layers, because the prompt
    // alone is the weakest of them.
    const reference = parseReferenceImage(body.reference_image);
    if ("error" in reference) return respond({ error: reference.error }, 400);

    const image = await generateDraftCharacterPortrait(user.id, requestId, {
      name,
      description,
      appearance,
      referenceImage: reference.value,
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
}

if (import.meta.main) {
  serve(handleRequest);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
