import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import {
  logError,
  type LogErrorInput,
  safeErrorMessage,
} from "../_shared/errors.ts";
import {
  type ClassificationOutcome,
  EMPTY_RESOLVED_GROUNDING,
  reportClassificationFailure,
  type ResolvedGrounding,
  resolveGrounding,
  type ResolveGroundingInput,
} from "../_shared/grounding-pipeline.ts";
import {
  generateFastStructuredText,
  type StructuredOutputSpec,
} from "../_shared/llm.ts";
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
 * than 8 seconds, and the deadline was split before it was spent - 60% to the
 * OpenRouter phase, divided again across the two models in `OPENROUTER_MODELS`,
 * so the leader actually got ~2.4s of an 8s budget while needing four times
 * that. Every provider aborted, the chain exhausted, and the handler's own
 * catch answered `null` - which onboarding renders as a title derived from the
 * user's own sentence. It looked like a missing deploy. It was a deadline.
 *
 * The same arithmetic, on a tighter budget, is what kept entity classification
 * from ever succeeding; `FAST_OPENROUTER_SHARE` is 1.0 as of 2026-09-09 (there
 * is no phase behind OpenRouter to hold time back for) and the leader now gets
 * the caller's deadline minus one reserve.
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

/**
 * Everything the handler reaches outside itself, so a test can stand in for
 * the network.
 *
 * Injected rather than mocked at the module level because the two outcomes
 * this seam exists to prove -- a refused claim and an unparseable answer --
 * were both SILENT until 2026-09-24: they returned `{shape: null}` and wrote
 * nothing, so "Where does it begin?" could come up empty for a writer while
 * `error_events` held no row to say why. A test that cannot drive those two
 * branches cannot keep them logged.
 */
export type ShapeStoryDeps = {
  /** The caller's user id from their JWT, or null when it is not accepted. */
  authenticate: (authHeader: string) => Promise<string | null>;
  /** The per-caller rate-limit claim. `true` means go ahead. */
  claim: (userId: string) => Promise<boolean>;
  shape: (
    systemPrompt: string,
    userPrompt: string,
    output: StructuredOutputSpec,
    maxTokens: number,
    deadlineMs: number,
  ) => Promise<{ text: string; model: string }>;
  ground: (input: ResolveGroundingInput) => Promise<ResolvedGrounding>;
  log: (input: LogErrorInput) => Promise<unknown>;
  reportClassification: typeof reportClassificationFailure;
  /**
   * Keeps telemetry alive after the response has gone. A bare detached
   * promise is not enough on the edge runtime: the isolate can be torn down
   * once the response is sent, and the insert with it. `waitUntil` is what
   * tells the runtime the work is still owed.
   */
  background: (work: Promise<unknown>) => void;
};

/**
 * `EdgeRuntime.waitUntil`, the same contract as `runInBackground` in
 * `_shared/media.ts`, restated here so this call site does not load the image
 * stack that module imports.
 */
function waitUntil(work: Promise<unknown>): void {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  const settled = work.catch(() => {});
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(settled);
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const defaultDeps: ShapeStoryDeps = {
  authenticate: async (authHeader) => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  },
  claim: async (userId) => {
    const { data, error } = await serviceClient().rpc(
      "claim_story_shape_request",
      { p_user_id: userId },
    );
    if (error) throw error;
    return data === true;
  },
  shape: generateFastStructuredText,
  ground: (input) => resolveGrounding({ ...input, cache: serviceClient() }),
  log: logError,
  reportClassification: reportClassificationFailure,
  background: waitUntil,
};

if (import.meta.main) {
  serve((req) => handleRequest(req));
}

export async function handleRequest(
  req: Request,
  deps: ShapeStoryDeps = defaultDeps,
): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);
  let userId: string | null = null;
  // Every telemetry write goes behind the response, never in front of it: a
  // writer is watching this call, and `logError` may take up to 1.5s.
  const logLater = (input: LogErrorInput) =>
    deps.background(Promise.resolve().then(() => deps.log(input)));

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    userId = await deps.authenticate(authHeader);
    if (!userId) return respond({ error: "Unauthorized" }, 401);

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
    const allowed = await deps.claim(userId);
    /**
     * A refused claim is capacity, not content, and the client could not tell.
     *
     * This answered a bare `{shape: null}`, which the client reads as "the
     * model returned something unusable" - a non-retryable condition that put
     * onboarding on its error screen with no way past it. Onboarding now falls
     * back to a preview built from what the writer typed, which is the right
     * answer whether they hit the per-minute window or the model failed.
     *
     * And it is logged. It used to be the one refusal that left no trace, so
     * a writer who hit it saw an empty "Where does it begin?" screen and
     * `error_events` had nothing to say about it. Written behind the response
     * (`logLater`): the writer is watching it.
     */
    if (allowed !== true) {
      // `generation.story`, not `llm.provider`: a refused claim is our own
      // capacity limit, and no provider was asked. There is no rate-limit
      // bucket in `error_events_bucket_check` (00058); the code is what
      // distinguishes it.
      logLater({
        bucket: "generation.story",
        severity: "low",
        source: "runtime",
        errorCode: "story_shape_rate_limited",
        error: new Error("story_shape_rate_limited"),
        context: {
          feature: "story_shape",
          kind: onboarding ? "onboarding" : "create",
        },
        userId,
      });
      return respond({ shape: null, reason: "rate_limited" });
    }

    // Captured out of `resolveGrounding` so this handler can tell "the idea
    // names nobody" from "the classifier never answered". Both leave
    // `grounding.entities` empty, and only one of them is a verdict.
    const classified: { outcome: ClassificationOutcome | null } = {
      outcome: null,
    };

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
        deps.shape(
          onboarding
            ? ONBOARDING_SHAPE_SYSTEM_PROMPT
            : STORY_SHAPE_SYSTEM_PROMPT,
          buildStoryShapePrompt(idea, genre || undefined, brief),
          onboarding ? ONBOARDING_SHAPE_OUTPUT : STORY_SHAPE_OUTPUT,
          onboarding ? ONBOARDING_SHAPE_MAX_TOKENS : SHAPE_MAX_TOKENS,
          onboarding ? ONBOARDING_SHAPE_DEADLINE_MS : SHAPE_DEADLINE_MS,
        ),
        deps.ground({
          idea,
          // The writer's own cast, forced to `private_individual` by the
          // parser. This is the enforcement half of the rule that a user's
          // named family never becomes a search query.
          characterNames: brief.characters?.map((c) => c.name).filter(Boolean),
          deadlineMs: onboarding
            ? ONBOARDING_SHAPE_DEADLINE_MS
            : SHAPE_DEADLINE_MS,
          onClassification: (outcome) => {
            classified.outcome = outcome;
          },
        }),
      ]);

      const grounding = groundingResult.status === "fulfilled"
        ? groundingResult.value
        : EMPTY_RESOLVED_GROUNDING;

      if (shapeResult.status === "rejected") throw shapeResult.reason;

      // A classification that did not answer is logged here too, and it is
      // the same row the generation path writes - same bucket, same code, a
      // different `feature`. Nothing about the response changes; what changes
      // is that the failure is countable. Not awaited: onboarding is watching this
      // response and a telemetry insert must never be in front of it.
      const classification = classified.outcome;
      if (classification && classification.status !== "ok") {
        deps.background(deps.reportClassification({
          outcome: classification,
          feature: "story_shape",
          userId,
        }));
      }

      const shape = parseStoryShape(shapeResult.value.text);
      /*
        THE MODEL ANSWERED AND THERE IS NOTHING TO USE.

        A provider that returns text `parseStoryShape` cannot read -- truncated
        JSON, the wrong schema, an empty string -- was the second silent null.
        The response is unchanged (the client degrades exactly as before); what
        changes is that it is countable, with the model that did it and how
        much it said, never what it said.
      */
      if (!shape) {
        logLater({
          bucket: "llm.provider",
          severity: "low",
          source: "runtime",
          errorCode: "story_shape_empty",
          error: new Error("story_shape_empty"),
          context: {
            feature: "story_shape",
            kind: onboarding ? "onboarding" : "create",
            model: shapeResult.value.model,
            chars: shapeResult.value.text.length,
          },
          userId,
        });
        return respond({
          shape: null,
          reason: "unavailable",
          model: shapeResult.value.model,
          grounding: grounding.cards,
          grounding_entities: grounding.entities,
        });
      }

      return respond({
        shape,
        model: shapeResult.value.model,
        // Echoed to the client, which carries both into the generation request.
        // They are re-validated there; see the note in validation.ts on why
        // client transport is safe for this particular payload.
        grounding: grounding.cards,
        grounding_entities: grounding.entities,
        // No `gating_reason` any more. This used to warn a writer who
        // switched the brief to public that a named cast would keep the story
        // private; the gate it previewed was removed on 2026-09-18 (migration
        // 00091), so there is nothing to warn about.
      });
    } catch (error) {
      // Shape is optional scaffolding. Record the provider condition without
      // retaining the user's idea, then let Screen 2 render normally.
      console.error("shape-story provider error:", safeErrorMessage(error));
      logLater({
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
    logLater({
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
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
