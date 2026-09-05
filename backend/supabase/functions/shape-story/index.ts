import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  anonymousGrantScope,
  hashAnonymousGrantScope,
  isAnonymousUser,
} from "../_shared/guest-bootstrap.ts";
import { generateFastStructuredText } from "../_shared/llm.ts";
import { readJsonObject } from "../_shared/operations.ts";
import {
  buildStoryShapePrompt,
  ONBOARDING_SHAPE_OUTPUT,
  ONBOARDING_SHAPE_SYSTEM_PROMPT,
  parseStoryShape,
  STORY_SHAPE_OUTPUT,
  STORY_SHAPE_SYSTEM_PROMPT,
} from "../_shared/story-shape.ts";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);
  let userId: string | null = null;

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
    userId = user.id;

    const body = await readJsonObject(req);
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (!idea || idea.length > 1000) {
      return respond({ error: "idea must be 1-1000 characters" }, 400);
    }
    // Onboarding needs a title and a real opening; the Create studio needs
    // neither, and asking for prose it will not show is waste on a call that
    // sits directly in front of a user who is waiting.
    const onboarding = body?.variant === "onboarding";
    // The creator's chosen shelf. Validated against the controlled list inside
    // buildStoryShapePrompt, so an unknown value degrades to no hint rather
    // than reaching the model as free text.
    const genre = typeof body?.genre === "string" ? body.genre.trim() : "";

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );
    const guest = isAnonymousUser(user);
    const scope = guest ? anonymousGrantScope(req) : null;
    if (guest && !scope) return respond({ shape: null });
    const scopeHash = scope
      ? await hashAnonymousGrantScope(scope, serviceRoleKey)
      : null;
    const { data: allowed, error: rateLimitError } = await serviceClient.rpc(
      "claim_story_shape_request",
      {
        p_user_id: user.id,
        p_anonymous_scope_hash: scopeHash,
      },
    );
    if (rateLimitError) throw rateLimitError;
    if (allowed !== true) return respond({ shape: null });

    try {
      const result = await generateFastStructuredText(
        onboarding ? ONBOARDING_SHAPE_SYSTEM_PROMPT : STORY_SHAPE_SYSTEM_PROMPT,
        buildStoryShapePrompt(idea, genre || undefined),
        onboarding ? ONBOARDING_SHAPE_OUTPUT : STORY_SHAPE_OUTPUT,
      );
      return respond({
        shape: parseStoryShape(result.text),
        model: result.model,
      });
    } catch (error) {
      // Shape is optional scaffolding. Record the provider condition without
      // retaining the user's idea, then let Screen 2 render normally.
      console.error("shape-story provider error:", safeErrorMessage(error));
      await logError({
        bucket: "llm.provider",
        severity: "low",
        source: "runtime",
        errorCode: "story_shape_failed",
        error,
        context: { feature: "story_shape" },
        userId,
      });
      return respond({ shape: null });
    }
  } catch (error) {
    console.error("shape-story error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.story",
      severity: "low",
      source: "runtime",
      errorCode: "story_shape_unhandled",
      error,
      context: { feature: "story_shape" },
      userId,
    });
    return respond({ shape: null });
  }
});

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
