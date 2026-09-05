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

/**
 * The shaping call's budget, and why it is not the library default.
 *
 * `generateFastStructuredText` defaults to an 8s deadline, and this call site
 * used to take it. That default is what made `shape-story` return
 * `{"shape": null}` in production for every request: the call is simply slower
 * than 8 seconds, and the deadline is split before it is spent. 60% goes to
 * OpenRouter (`FAST_OPENROUTER_SHARE`), divided again across the two models in
 * `OPENROUTER_MODELS`, so the leader actually got ~2.4s of an 8s budget while
 * needing four times that. Every provider aborted, the chain exhausted, and the
 * handler's own catch answered `null` - which onboarding renders as a title
 * derived from the user's own sentence. It looked like a missing deploy. It was
 * a deadline.
 *
 * Measured against the live model on 2026-09-05, `meta/muse-spark-1.3-contributor`
 * with `reasoning: { effort: "minimal" }` and a strict schema:
 *
 * | variant             | observed                       |
 * |---------------------|--------------------------------|
 * | onboarding (n=4)    | 8.2s, 9.2s, 11.4s, 33.6s       |
 * | create studio (n=4) | 5.7s, 5.8s, 6.3s, 7.5s         |
 *
 * Onboarding is slower because it additionally writes a title and 120-180 words
 * of real opening prose. The 33.6s outlier is why the deadline is a multiple of
 * the median rather than a snug fit: this is a cap that only a hung provider
 * should ever reach, not a target.
 *
 * The two variants get different budgets because the user is in a different
 * place. Onboarding prefetches this call when the writer leaves the idea screen
 * and warms it through the details, email and code screens, so a long tail costs
 * the user nothing; the crafting loader holds until it lands. The Create studio
 * has no such cover - the writer is watching - so it is capped tighter and is
 * the faster variant anyway.
 *
 * Token budgets are raised off the 900 default for the same reason. OpenRouter
 * floors its own budget at `OPENROUTER_MIN_OUTPUT_TOKENS`, so 900 never bound
 * the leader, but it does bind the OpenAI fallback, and the onboarding response
 * measured ~2,500 characters of JSON including the opening prose.
 */
const ONBOARDING_SHAPE_DEADLINE_MS = 45_000;
const SHAPE_DEADLINE_MS = 30_000;
const ONBOARDING_SHAPE_MAX_TOKENS = 2_000;
const SHAPE_MAX_TOKENS = 1_200;

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
        onboarding ? ONBOARDING_SHAPE_MAX_TOKENS : SHAPE_MAX_TOKENS,
        onboarding ? ONBOARDING_SHAPE_DEADLINE_MS : SHAPE_DEADLINE_MS,
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
