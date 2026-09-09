import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { deriveGatingReason } from "../_shared/entity-visibility-gate.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import {
  EMPTY_RESOLVED_GROUNDING,
  resolveGrounding,
} from "../_shared/grounding-pipeline.ts";
import { generateFastStructuredText } from "../_shared/llm.ts";
import { readJsonObject } from "../_shared/operations.ts";
import {
  buildStoryShapePrompt,
  normalizeStoryShapeBrief,
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
    const brief = normalizeStoryShapeBrief({
      characters: body?.characters,
      moments: body?.moments,
      writingStyle: body?.writing_style,
      avoid: body?.avoid,
      chapterLength: body?.chapter_length,
      plannedChapterCount: body?.planned_chapter_count,
    });

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    /**
     * The one limit left, and it is not a ceiling on the product.
     *
     * There were three. Two of them counted anonymous users against a shared
     * budget - 500 shapes a day across the whole project and 30 a day per
     * network - and onboarding is anonymous, so both were caps on how many
     * people could be shown a shaped preview at all. Migration 00046 removed
     * them. What is left is six requests a minute for this one caller, which
     * stops a client stuck in a retry loop and is never reached by somebody
     * writing a story.
     *
     * The scope hash goes with them. It existed to identify a network for the
     * per-network ceiling, and computing an HMAC of a guest's address to feed
     * a parameter the function now ignores would be keeping the fingerprint
     * and throwing away the only reason it was taken. `p_anonymous_scope_hash`
     * stays in the RPC signature, accepted and ignored, so that a migration
     * and a function deploy in either order are both correct.
     */
    const { data: allowed, error: rateLimitError } = await serviceClient.rpc(
      "claim_story_shape_request",
      { p_user_id: user.id },
    );
    if (rateLimitError) throw rateLimitError;
    /**
     * A refused claim is capacity, not content, and the client could not tell.
     *
     * This answered a bare `{shape: null}`, which the client reads as "the
     * model returned something unusable" - a non-retryable condition that put
     * onboarding on its error screen with no way past it. Onboarding now falls
     * back to a preview built from what the writer typed, which is the right
     * answer whether they hit the per-minute window or the model failed.
     */
    if (allowed !== true) {
      return respond({ shape: null, reason: "rate_limited" });
    }

    try {
      // Shaping and grounding run together, not in sequence.
      //
      // They share this call's deadline but need nothing from each other: the
      // classifier reads the raw idea, not the shaped brief. Chaining them
      // would add the grounding latency to a call the writer is already
      // waiting on, and this is the one moment in the flow where that latency
      // is free - the writer spends it editing chips, and onboarding prefetches
      // this call and warms it through three more screens.
      //
      // `allSettled`, because grounding must not be able to take shaping down
      // with it. A rejected grounding promise here would cost the writer their
      // shaped brief for a convenience they never asked for.
      const [shapeResult, groundingResult] = await Promise.allSettled([
        generateFastStructuredText(
          onboarding
            ? ONBOARDING_SHAPE_SYSTEM_PROMPT
            : STORY_SHAPE_SYSTEM_PROMPT,
          buildStoryShapePrompt(idea, genre || undefined, brief),
          onboarding ? ONBOARDING_SHAPE_OUTPUT : STORY_SHAPE_OUTPUT,
          onboarding ? ONBOARDING_SHAPE_MAX_TOKENS : SHAPE_MAX_TOKENS,
          onboarding ? ONBOARDING_SHAPE_DEADLINE_MS : SHAPE_DEADLINE_MS,
        ),
        resolveGrounding({
          idea,
          // The writer's own cast, forced to `private_individual` by the
          // parser. This is the enforcement half of the rule that a user's
          // named family never becomes a search query.
          characterNames: brief.characters?.map((c) => c.name).filter(Boolean),
          cache: serviceClient,
          deadlineMs: onboarding
            ? ONBOARDING_SHAPE_DEADLINE_MS
            : SHAPE_DEADLINE_MS,
        }),
      ]);

      const grounding = groundingResult.status === "fulfilled"
        ? groundingResult.value
        : EMPTY_RESOLVED_GROUNDING;

      if (shapeResult.status === "rejected") throw shapeResult.reason;

      return respond({
        shape: parseStoryShape(shapeResult.value.text),
        model: shapeResult.value.model,
        // Echoed to the client, which carries both into the generation request.
        // They are re-validated there; see the note in validation.ts on why
        // client transport is safe for this particular payload.
        grounding: grounding.cards,
        grounding_entities: grounding.entities,
        // The entity visibility gate's answer, BEFORE a credit is spent.
        //
        // Product decision 2026-09-09: the visibility toggle in the brief is
        // the publish button, so a writer who switches it to public while
        // their idea names a living public figure or someone from their own
        // life must be told now - "this one will stay private; change the
        // idea or keep it private" - rather than after the story exists.
        // `generate-story` still derives the gate from its own server-side
        // classification and records that; this is the same rule applied to
        // the same classifier's output, one screen earlier. Null when nothing
        // in the idea gates it, which is the common case.
        gating_reason: deriveGatingReason(grounding.entities),
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
      return respond({ shape: null, reason: "provider_failed" });
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
    return respond({ shape: null, reason: "unavailable" });
  }
});

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
