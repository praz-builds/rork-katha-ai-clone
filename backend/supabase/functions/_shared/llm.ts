import {
  OPENAI_RESPONSE_FORMAT,
  STORY_OUTPUT_JSON_SCHEMA,
} from "./story_schema.ts";
import { countWords, type WordBand, wordBandBounds } from "./types.ts";
import { parseStructuredOutput } from "./story_text.ts";

/**
 * Secrets are read lazily, not at module load.
 *
 * A top-level `Deno.env.get` makes importing this module a side effect: the
 * test suite then needs --allow-env just to reference a type, and a missing
 * secret fails at import rather than at the call that needs it.
 */

export const GEMINI_MODEL = "gemini-3.1-pro-preview";
/**
 * The configured default for every generation path, served through OpenRouter.
 *
 * One constant, deliberately. Switching the default between the contributor and
 * the standard tier is a data-policy decision that will be revisited, so it is a
 * one-line change here rather than a value spread across four functions.
 *
 * Catalogue properties, 2026-09-05:
 *
 * | property          | value                                              |
 * |-------------------|----------------------------------------------------|
 * | context length    | 1,048,576 tokens                                   |
 * | structured output | `response_format` + `structured_outputs` supported |
 * | prompt price      | $0.0000001 / token ($0.10 per M)                   |
 * | completion price  | $0.0000002 / token ($0.20 per M)                   |
 *
 * That is ~12x cheaper on input and ~21x cheaper on output than the standard
 * `meta/muse-spark-1.3` behind it.
 *
 * **The contributor tier trains on what it is sent, and this account currently
 * refuses it.** The `-contributor` suffix is a cost-reduced tier: it is priced
 * down in exchange for the provider retaining prompts and completions for
 * training, which here means the user's story idea and the generated prose. A
 * live request on 2026-09-05 returned `404`, not a completion:
 *
 *     0 endpoints out of 1 requested are available matching your guardrail
 *     restrictions and data policy... Paid model training violation (account
 *     settings): 1 endpoint excluded
 *
 * So the account's OpenRouter privacy setting blocks training-tier endpoints,
 * and this model cannot serve a single request until that setting is changed at
 * https://openrouter.ai/settings/privacy. That is the account owner's decision
 * and no code change reaches it. The model is wired as the default anyway,
 * because the day the setting changes the cheaper tier simply starts winning -
 * exactly the way an OpenAI entitlement going live needs no deploy. Until then
 * `OPENROUTER_MODELS[1]` serves, and `404` is classified `model_not_found`, so
 * the fallthrough is immediate rather than a stall.
 *
 * The position stays pinned to *named, priced* models. `openrouter/free` picks a
 * free model at random per request, so its output cap, latency and prose quality
 * are not repeatable, and a routed model whose output cap is under the request
 * budget returns `finish_reason: "length"`, which `openAICompatibleContent`
 * rejects. Billing runs through OpenRouter, so a Google-side quota block on
 * `GEMINI_API_KEY` does not take this position down with it - which is why
 * Gemini is still behind it rather than removed.
 */
export const OPENROUTER_MODEL = "meta/muse-spark-1.3-contributor";

/**
 * The OpenRouter position, in preference order.
 *
 * `meta/muse-spark-1.3` is the same model without the training tier. Measured on
 * 2026-09-05 against the real strict schema: `200`, `finish_reason: "stop"`,
 * every requested key present, ~11s. It sits immediately behind the contributor
 * id so that the `404`-by-data-policy above costs one round trip rather than the
 * whole flow, and so onboarding produces a real story today.
 *
 * **Both are reasoning models, and that is the trap in this position.** Reasoning
 * tokens are billed and counted inside `max_tokens`, and they are emitted before
 * any visible content. Measured, same prompt, same day:
 *
 * | budget                              | outcome                              |
 * |-------------------------------------|--------------------------------------|
 * | `max_tokens: 1200`, no effort sent  | `length`, 1197 reasoning, no content |
 * | `max_tokens: 8000`, effort `low`    | `stop`, 957 reasoning, valid JSON    |
 *
 * The first row is the dangerous one: HTTP `200` carrying an empty string. It is
 * caught - `openAICompatibleContent` rejects both `finish_reason: "length"` and
 * empty content as `ProviderMalformedResponseError`, so it falls through to the
 * next model instead of persisting a blank chapter - but being caught is not the
 * same as being survivable, because a position that always fails is not a
 * position. `openRouterRequestShape` therefore sends an explicit
 * `reasoning: { effort: "low" }` and floors the budget at
 * `OPENROUTER_MIN_OUTPUT_TOKENS`, so no caller can hand this position a budget
 * the reasoning alone would consume. The paragraph editor's 2,000-token budget
 * is exactly such a caller.
 */
export const OPENROUTER_MODELS: readonly string[] = [
  OPENROUTER_MODEL,
  "meta/muse-spark-1.3",
];
/**
 * The free-tier position: last resort, and empirically thin.
 *
 * This was a single string, `openrouter/free` - a router that picks a free
 * model at random per request. Production has seen it hand a *code* model a
 * prose rewrite, and a routed model whose output cap is under
 * `MAX_OUTPUT_TOKENS` returns `finish_reason: "length"`, which
 * `openAICompatibleContent` rejects.
 *
 * The obvious fix was to name the free models instead, choosing them from
 * OpenRouter's catalogue by filtering on `supported_parameters` containing
 * `structured_outputs`. **That metadata is aspirational, not observed.** Every
 * candidate was run against the real `STORY_OUTPUT_JSON_SCHEMA` with
 * `strict: true` and a 16,000-token budget on 2026-09-03:
 *
 * | model                                  | result                              |
 * |----------------------------------------|-------------------------------------|
 * | z-ai/glm-5.2:free                      | 429, repeatedly - never answered    |
 * | nvidia/nemotron-3-super-120b-a12b:free | `finish_reason: length` after 119s  |
 * | dots-studio/dots-3-note-preview:free   | `length`, empty content, 108s       |
 * | minimax/minimax-m3:free                | 200, but ignored the schema         |
 * | minimax/minimax-m2.7:free              | 200, but ignored the schema         |
 * | google/gemma-4-*:free                  | 429                                 |
 * | thinkingmachines/inkling:free          | 403, not available on this account  |
 * | nvidia/nemotron-3-ultra-550b-a55b:free | passed once (44s), errored once     |
 * | openrouter/free                        | routed a code model to write prose  |
 *
 * The reasoning-model failures share one cause: they emit their chain of
 * thought into `content`, which both consumes the budget and means the body is
 * not the JSON the schema demanded.
 *
 * So the free tier is kept, but it is decoration rather than depth. The chain's
 * real redundancy is the two paid `OPENROUTER_MODELS` -> Gemini -> the three
 * OpenAI models. (The model measured here at 10.6s for a schema-valid 520-word
 * chapter was `google/gemini-2.5-flash`, which held the OpenRouter position
 * until 2026-09-05.) What survives here is the one free model that ever
 * produced valid output, and the blind router behind it, because at this point
 * the only remaining alternative is refunding the user's credit.
 *
 * **Do not re-add a model from catalogue metadata alone.** Run it against the
 * real schema first; the table above is what that costs to learn.
 */
export const OPENROUTER_FREE_MODELS: readonly string[] = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/free",
];

/** The preferred free model; the rest of the list is fallback. */
export const OPENROUTER_FREE_MODEL = OPENROUTER_FREE_MODELS[0];
const geminiKey = () => Deno.env.get("GEMINI_API_KEY")?.trim();
const openRouterKey = () => Deno.env.get("OPENROUTER_API_KEY")?.trim();
/**
 * Providers to skip entirely, as a comma-separated env value.
 *
 * `LLM_DISABLED_PROVIDERS=gemini` takes the Gemini position out of the chain.
 *
 * Gemini has hard-failed with `429 RESOURCE_EXHAUSTED` since 2026-08-31 while
 * holding the first 35% of the deadline. When the 429 comes back fast that
 * costs only a round trip - measured at a few hundred milliseconds - but a
 * quota-blocked provider is exactly the one likely to *hang*, and then it burns
 * up to 42 seconds before the model that actually works is asked anything.
 *
 * Config rather than a circuit breaker, for two reasons. Edge Function isolates
 * share no memory, so an in-process breaker learns nothing that outlives a
 * single request; and a breaker backed by a table would put a database round
 * trip on the hot path in order to save latency. A secret costs nothing to
 * read and is changed without a deploy.
 *
 * The cost is that it is manual, and a stale entry silently shortens the chain.
 * So it is read in exactly one place and the skip is logged on every request,
 * where it cannot be forgotten quietly.
 */
function disabledProviders(): ReadonlySet<string> {
  const raw = Deno.env.get("LLM_DISABLED_PROVIDERS")?.trim();
  if (!raw) return new Set();
  return new Set(
    raw.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
}

/** True when this provider is switched off by configuration. */
export function isProviderDisabled(
  provider: string,
  disabled: ReadonlySet<string> = disabledProviders(),
): boolean {
  return disabled.has(provider.toLowerCase());
}

/**
 * The buffered generation budget, in milliseconds.
 *
 * **Raised from 120s on 2026-09-09.** A real chapter from the leading model
 * was measured at 70 seconds (1,846 words), and at 120s the OpenRouter phase
 * split evenly across two models gave each 42s - so the leader timed out
 * before it had written a chapter, every time, and the caller saw
 * `Story generation failed. Credit refunded.` after two minutes with a healthy
 * credential. The budget is now sized so that BOTH paid models can each take
 * a full measured chapter in sequence (see `openRouterPhaseDeadlines`), with
 * Gemini and the free tier keeping small real slices behind them. 200s sits
 * well under the Edge Function wall-clock limit and matches the streamed
 * path, which already allowed 180s of prose plus a 45s metadata call.
 */
export const GENERATION_DEADLINE_MS = 200_000;

/**
 * A story plus its series_state runs well past 4096 tokens.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/** A paragraph rewrite is short, and the editor UI waits on it inline. */
const EDIT_MAX_OUTPUT_TOKENS = 2_000;
const EDIT_DEADLINE_MS = 60_000;
const GEMINI_TIMEOUT_MS = 70_000;
/**
 * 30s while OpenRouter was a fallback carrying a fast non-reasoning model. It is
 * now the primary, running a reasoning model over a 16,000-token visible budget,
 * and 30s is no longer defensible: the measured 11s was a ~1.4k-token shaping
 * call, and a full chapter emits roughly an order of magnitude more, reasoning
 * included. Raised past `GEMINI_TIMEOUT_MS` on 2026-09-09, because a chapter
 * measured at 70s against a 70s socket timeout is a coin toss: the point of a
 * per-request timeout here is to end a hung socket, not to second-guess the
 * phase budget, so it sits above the measured chapter with room to spare.
 */
const OPENROUTER_TIMEOUT_MS = 90_000;
/** A reasoning model thinks before it writes, so it needs a longer window. */

/**
 * Reasoning tokens are counted and billed inside `max_completion_tokens`, so the
 * reasoning path needs headroom above the visible story length that
 * `MAX_OUTPUT_TOKENS` describes. Without it a long story is truncated by the
 * budget its own reasoning consumed, and surfaces as `finish_reason: "length"`.
 */

/**
 * The Muse Spark models reason inside `max_tokens`, so the OpenRouter budget
 * carries the same 2x headroom the OpenAI reasoning path does.
 */
const OPENROUTER_REASONING_TOKEN_MULTIPLIER = 2;

/**
 * The floor under any OpenRouter budget, in tokens.
 *
 * 8,000 is the measured working value: at `max_tokens: 8000` with effort `low`,
 * `meta/muse-spark-1.3` spent 957 tokens reasoning and still returned complete
 * JSON; at 1,200 it spent 1,197 reasoning and returned an empty string with
 * `finish_reason: "length"`. A multiplier alone does not protect the small
 * callers - `EDIT_MAX_OUTPUT_TOKENS * 2` is 4,000 and the shaping call's 900 * 2
 * is 1,800, which is the failing row - so the floor is what keeps a short
 * request from being answered entirely in thought.
 */
const OPENROUTER_MIN_OUTPUT_TOKENS = 8_000;

/**
 * Cumulative fractions of `deadlineMs` at which each provider phase must end.
 *
 * A provider's moderation retries are bounded only by the shared deadline, so
 * without per-phase caps the first provider can spend the entire budget and
 * every fallback aborts before it sends a request - the chain collapses to one
 * provider in exactly the slow case the fallbacks exist for.
 *
 * **Re-balanced 2026-09-05 for the new order, and again 2026-09-09 for the
 * 200s budget.** These are cumulative, so moving a phase without moving its
 * share silently hands the new leader the old leader's slice and starves
 * whoever now runs last. Slices, against the 200s generation deadline:
 *
 * | phase          | slice | window | per model                                  |
 * |----------------|-------|--------|--------------------------------------------|
 * | openrouter     | 0.80  | 160s   | leader up to 90s, follower the rest (70s+) |
 * | gemini         | 0.12  | 24s    | 24s                                        |
 * | openrouterFree | 0.08  | 16s    | 8s each                                    |
 *
 * The paid phase is no longer split evenly - see `openRouterPhaseDeadlines`.
 *
 * OpenAI held 0.28 of this budget until its credential was revoked
 * (2026-09-08). Its share went to the leader and to Gemini rather than being
 * left unallocated: an unclaimed slice is not saved time, it is time the phases
 * that remain are forbidden from using.
 *
 * The leader takes the largest share because it is the only phase expected to succeed and
 * because two models share it, one of which is `404` by policy today and returns
 * in a round trip. Gemini keeps a real but small slice: it has hard-failed with
 * `429` since 2026-08-31, and a quota-blocked provider needs enough time to say
 * so and no more. The free tier keeps the smallest slice, unchanged in spirit
 * from when it was 0.1 - it is decoration, and the honest alternative to it is
 * refunding the credit.
 */
export const PHASE_END_SHARE = {
  openrouter: 0.8,
  gemini: 0.92,
  openrouterFree: 1,
} as const;

/**
 * How much of the paid OpenRouter window is held back for each model still
 * to come, instead of halving the window.
 *
 * The phase used to be cut into equal slices by model index. That is the
 * arithmetic that broke production: two models, 84s, 42s each, against a
 * chapter that takes 70s. A slice is only worth having if a chapter fits in
 * it, so the reserve IS a chapter - the measured 70s - and the leader gets
 * everything the phase has minus one reserve per follower. With the 200s
 * budget and the 0.8 share the paid window is 160s: the leader may take 90s
 * (its own socket timeout) and the follower still has a full 70s if the
 * leader burns its slice. When the leader fails fast - the contributor tier
 * answers `404` in a round trip today - everything it did not use passes
 * straight to the follower.
 *
 * Capped at an equal share for small budgets, so a 60s paragraph edit does
 * not hand its leader a negative slice.
 */
export const OPENROUTER_CHAPTER_RESERVE_MS = 70_000;

/**
 * Per-model deadlines for the paid OpenRouter phase, as offsets from the
 * phase start. Exported for `llm.test.ts`.
 */
export function openRouterPhaseDeadlines(
  windowMs: number,
  models: number,
): number[] {
  const window = Math.max(0, Math.floor(windowMs));
  if (models <= 0) return [];
  const reserve = Math.min(
    OPENROUTER_CHAPTER_RESERVE_MS,
    Math.floor(window / models),
  );
  return Array.from(
    { length: models },
    (_, index) => Math.max(0, window - reserve * (models - 1 - index)),
  );
}

interface GenerationResult {
  text: string;
  model: string;
}

/**
 * A provider failure, shaped for `error_events` (migration 00016).
 *
 * Identifiers and enums only - never prompts, seeds, or story prose. Callers can
 * hand `context` straight to `logError` without having to sanitize it.
 */
export interface LlmFailure {
  provider: "gemini" | "openrouter";
  model: string;
  /** Stable slug for grouping recurrences, e.g. "rate_limited". */
  code: string;
  /** HTTP status when the provider returned one. */
  status?: number;
  retryable: boolean;
  message: string;
}

/**
 * Raised when a provider has no credential configured at all.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/** A non-2xx provider response, carrying the status through to classification. */
export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export class ProviderMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderMalformedResponseError";
  }
}

/**
 * A provider refused the prompt or its own output on content-policy grounds.
 *
 * Distinct from a malformed response: softening retries have already been spent,
 * so retrying the same prompt against the same provider will be refused again.
 * `isModerationRejection` still matches it by message, so the retry ladder in
 * each generator keeps working unchanged.
 */
export class ProviderModerationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderModerationRejectedError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: LlmFailure[]) {
    super(
      `All LLM providers failed: ${
        failures.map((f) => `${f.model}=${f.code}`).join(", ")
      }`,
    );
    this.name = "AllProvidersFailedError";
  }

  /** Ready for logError({ bucket: "llm.provider", context: ... }). */
  toContext(): Record<string, unknown> {
    return {
      attempts: this.failures.length,
      providers: this.failures.map((f) => f.provider),
      models: this.failures.map((f) => f.model),
      codes: this.failures.map((f) => f.code),
      statuses: this.failures.map((f) => f.status ?? null),
      retryable: this.failures.some((f) => f.retryable),
    };
  }
}

/**
 * Classify a thrown provider error into a stable, loggable shape.
 */
export function classifyLlmError(
  error: unknown,
  provider: LlmFailure["provider"],
  model: string,
): LlmFailure {
  const base = { provider, model, message: failureMessage(error) };

  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return { ...base, code: "timeout", retryable: true };
  }
  if (error instanceof ProviderNotConfiguredError) {
    return { ...base, code: "not_configured", retryable: false };
  }
  if (error instanceof ProviderHttpError) {
    return {
      ...base,
      code: classifyHttpStatus(error.status),
      status: error.status,
      retryable: error.status >= 500 || error.status === 408 ||
        error.status === 409 || error.status === 429,
    };
  }
  if (error instanceof ProviderModerationRejectedError) {
    return { ...base, code: "moderation_blocked", retryable: false };
  }
  if (error instanceof ProviderMalformedResponseError) {
    return { ...base, code: "malformed_response", retryable: true };
  }
  return { ...base, code: "unknown", retryable: true };
}

/**
 * Generate story text with a fallback chain:
 * OpenRouter (meta/muse-spark-1.3-contributor, then meta/muse-spark-1.3) ->
 * gemini-3.1-pro-preview -> OpenAI (gpt-5.6-luna, gpt-5-mini, gpt-4o-mini) ->
 * openrouter/free (last).
 *
 * Each phase is additionally capped at a cumulative fraction of `deadlineMs`
 * (`PHASE_END_SHARE`), so one slow provider cannot starve the rest of the chain.
 *
 * Every attempt is schema-constrained where the provider supports it, so a
 * success should parse as the story JSON object. On total failure this throws
 * AllProvidersFailedError, whose `toContext()` feeds straight into
 * logError({ bucket: "llm.provider" }).
 */
export function generateStoryText(
  systemPrompt: string,
  userPrompt: string,
  wordBand?: WordBand,
): Promise<GenerationResult> {
  return runProviderChain(systemPrompt, userPrompt, {
    maxTokens: MAX_OUTPUT_TOKENS,
    constrainToStorySchema: true,
    deadlineMs: GENERATION_DEADLINE_MS,
    wordBand,
  });
}

/**
 * A small, strict JSON request. This is the call onboarding makes.
 *
 * It used to go straight to the first non-reasoning OpenAI model and had no
 * fallback at all, which meant the default model was whatever happened to be
 * cheap enough for a short request rather than the model the product runs on.
 * `shape-story` is the first generation a new user ever triggers, so it leads
 * with `OPENROUTER_MODEL` like every other path.
 *
 * The window is split rather than shared, and the split is why this is not just
 * a two-line change: the caller's default deadline is 8s because the user is
 * watching, so a stalled leader would otherwise abort the fallback before
 * `fetch` was called and the screen would render with no shape at all. The
 * leader gets `FAST_OPENROUTER_SHARE`, the OpenAI model gets the rest.
 */
const FAST_OPENROUTER_SHARE = 0.6;

/**
 * The tail held back for the runner-up, instead of halving the window.
 *
 * The window used to be cut into equal slices by model index, and that is a
 * bad shape for a two-model phase where only one of them is expected to
 * answer. `OPENROUTER_MODELS[0]` returns `404` by account data policy today,
 * so it costs a round trip and `[1]` inherits nearly the whole window - the
 * arrangement the measured 11s median was taken against. The moment that
 * account setting is changed at https://openrouter.ai/settings/privacy, `[0]`
 * starts serving and an even split hands it half: 13.5s of onboarding's 45s
 * against an 11s median, so a normal-length request would abort near the
 * finish and be re-run from scratch on `[1]`. Latency roughly doubles because
 * somebody flipped a checkbox, with no deploy and nothing in this repo
 * changing.
 *
 * So the leader gets the window minus this reserve, and the reserve is what
 * keeps the original guarantee: a stalled leader still cannot abort the
 * fallback before `fetch` is called. It is sized for a fast failure - a `404`,
 * a `429`, a refused key - because a leader that burns the whole window has
 * already established that this phase is not going to answer, and the OpenAI
 * phase behind it holds the real redundancy.
 */
const FAST_OPENROUTER_RESERVE_MS = 6_000;

/**
 * The OpenRouter phase's per-model deadlines, as offsets from the phase start.
 *
 * Exported for `llm.test.ts` rather than inlined, because the property that
 * matters here is a number of seconds the leader is allowed to take, and the
 * only way to assert that from outside is to wait for it.
 */
export function fastOpenRouterDeadlines(
  deadlineMs: number,
  models: number,
): number[] {
  const window = Math.max(0, Math.floor(deadlineMs * FAST_OPENROUTER_SHARE));
  const reserve = Math.min(FAST_OPENROUTER_RESERVE_MS, Math.floor(window / 2));
  return Array.from(
    { length: models },
    // One reserve per model still to come, so the last one owns the rest of
    // the phase and nobody's slice is time that cannot be spent: a leader
    // that fails in a round trip hands everything it did not use straight to
    // whoever is behind it.
    (_, index) => Math.max(0, window - reserve * (models - 1 - index)),
  );
}

export async function generateFastStructuredText(
  systemPrompt: string,
  userPrompt: string,
  structuredOutput: StructuredOutputSpec,
  maxTokens = 900,
  deadlineMs = 8_000,
): Promise<GenerationResult> {
  const options: ChainOptions = {
    maxTokens,
    constrainToStorySchema: false,
    deadlineMs,
    structuredOutput,
  };
  const start = Date.now();
  const deadline = start + deadlineMs;
  const failures: LlmFailure[] = [];
  const disabled = disabledProviders();

  const openRouterModels = isProviderDisabled("openrouter", disabled)
    ? []
    : OPENROUTER_MODELS;
  const openRouterOffsets = fastOpenRouterDeadlines(
    deadlineMs,
    openRouterModels.length,
  );
  for (const [index, model] of openRouterModels.entries()) {
    const modelDeadline = start + openRouterOffsets[index];
    try {
      return await generateOpenRouterText(
        model,
        OPENROUTER_TIMEOUT_MS,
        options,
        systemPrompt,
        userPrompt,
        modelDeadline,
        0,
        () => undefined,
      );
    } catch (error) {
      console.error(`${model} failed:`, error);
      failures.push(classifyLlmError(error, "openrouter", model));
    }
  }

  throw new AllProvidersFailedError(failures);
}

/**
 * Rewrite a single paragraph for the Create Studio editor.
 */
export function editParagraph(
  systemPrompt: string,
  userPrompt: string,
): Promise<GenerationResult> {
  return runProviderChain(systemPrompt, userPrompt, {
    maxTokens: EDIT_MAX_OUTPUT_TOKENS,
    constrainToStorySchema: false,
    deadlineMs: EDIT_DEADLINE_MS,
  });
}

export interface ChainOptions {
  maxTokens: number;
  constrainToStorySchema: boolean;
  deadlineMs: number;
  /** API-level strict JSON shape for compact non-story structured requests. */
  structuredOutput?: StructuredOutputSpec;
  /**
   * The chapter length contract for this request. Omitted for paragraph edits,
   * which have no band. A generation outside its tolerated bounds is treated
   * like any other unusable output: it falls through to the next provider
   * rather than reaching persistence.
   */
  wordBand?: WordBand;
}

export interface StructuredOutputSpec {
  name: string;
  schema: unknown;
}

export function geminiRequestShape(options: ChainOptions) {
  const schema = structuredSchemaFor(options);
  return {
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: options.maxTokens,
      ...(schema
        ? {
          responseMimeType: "application/json",
          responseSchema: geminiSchema(schema),
        }
        : {}),
    },
  };
}

/**
 * The chat-completions contract for the OpenRouter position.
 *
 * It keeps `max_tokens` and `temperature` rather than adopting the OpenAI
 * reasoning shape, because OpenRouter still routes to models that only
 * understand the legacy pair and normalises per model on its side. What it adds
 * is OpenRouter's own `reasoning` control and a floored budget, because the
 * models in `OPENROUTER_MODELS` reason inside `max_tokens`:
 *
 * - `reasoning: { effort: "minimal" }` is sent explicitly. Reasoning is
 *   mandatory on this endpoint: `reasoning: { enabled: false }` is rejected
 *   with HTTP 400, "Reasoning is mandatory for this endpoint and cannot be
 *   disabled." So the effort level is the only latency lever there is, and it
 *   is worth a lot. Measured on the onboarding shaping call, same prompt,
 *   same 8,000 budget:
 *
 *   | reasoning setting     | latency | reasoning tokens | result |
 *   |-----------------------|---------|------------------|--------|
 *   | omitted entirely      | 17.2s   | 2,286            | valid  |
 *   | `max_tokens: 200`     | 16.6s   | 2,629            | valid  |
 *   | `effort: "low"`       | 11.7s   | 1,161            | valid  |
 *   | `effort: "minimal"`   | 8.0s    | 632              | valid  |
 *
 *   Note the second row: capping reasoning with `max_tokens` does not cap it,
 *   it makes it worse. Only `effort` moves the number. Prose does not benefit
 *   from long deliberation and every reasoning token is latency the reader
 *   waits through, so this sits at the floor the endpoint allows.
 *
 *   Left unset entirely, `max_tokens: 1200` produced 1,197 reasoning tokens
 *   and an empty `content` with HTTP 200, which is why the budget below has a
 *   floor as well.
 * - The budget is `maxTokens * 2`, floored at `OPENROUTER_MIN_OUTPUT_TOKENS`, so
 *   a caller with a small visible budget - the paragraph editor at 2,000, the
 *   onboarding shaping call at 900 - cannot be answered entirely in thought.
 *
 * A model in this position that does *not* reason ignores the extra parameter
 * and is merely given a larger cap than it needs, which the response's own
 * `finish_reason` already bounds. The free-tier models below reason and dump
 * their chain of thought into `content`; an explicit minimal effort is the
 * only lever this code has over that.
 */
export function openRouterRequestShape(options: ChainOptions) {
  const responseFormat = structuredResponseFormatFor(options);
  return {
    temperature: 0.8,
    max_tokens: openRouterTokenBudget(options.maxTokens),
    reasoning: { effort: "minimal" },
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
}

/** The visible budget plus reasoning headroom, never below the measured floor. */
export function openRouterTokenBudget(maxTokens: number): number {
  return Math.max(
    OPENROUTER_MIN_OUTPUT_TOKENS,
    maxTokens * OPENROUTER_REASONING_TOKEN_MULTIPLIER,
  );
}

/**
 * The chat-completions request body, in the OpenAI dialect.
 *
 * The name is the wire protocol, not the vendor: OpenRouter speaks the same
 * chat-completions contract, which is why this outlives OpenAI's removal from
 * the chain. It used to take a model spec and branch on `reasoning`, because
 * OpenAI's reasoning models take `max_completion_tokens` and reject
 * `temperature`. No remaining provider needs that shape, so the branch, the
 * spec argument and `openAIReasoningRequestShape` are gone with it.
 */
export function openAIRequestShape(options: ChainOptions) {
  return openAICompatibleRequestShape(options);
}

async function runProviderChain(
  systemPrompt: string,
  userPrompt: string,
  options: ChainOptions,
): Promise<GenerationResult> {
  const failures: LlmFailure[] = [];
  const start = Date.now();
  const deadline = start + options.deadlineMs;
  /** End of a provider's slice, never past the shared deadline. */
  const phaseDeadline = (share: number) =>
    Math.min(deadline, start + Math.floor(options.deadlineMs * share));
  let safetyLevel = 0;
  const recordModerationRetry = (level: number) => {
    safetyLevel = Math.max(safetyLevel, level);
  };

  const disabled = disabledProviders();
  if (disabled.size) {
    console.log(
      `[llm] providers disabled by config: ${[...disabled].join(", ")}`,
    );
  }

  // OpenRouter leads. The default model is configured in `OPENROUTER_MODEL` and
  // the standard tier stands immediately behind it, because the contributor tier
  // is `404`-by-data-policy on this account until the privacy setting changes -
  // see the constant. The window is NOT split evenly: the leader gets the
  // phase minus a chapter-sized reserve per follower, so a stalled leader
  // still cannot abort its fallback before `fetch` is called, and a leader
  // that fails fast hands the follower everything it did not use.
  const openRouterModels = isProviderDisabled("openrouter", disabled)
    ? []
    : OPENROUTER_MODELS;
  const openRouterPhaseEnd = phaseDeadline(PHASE_END_SHARE.openrouter);
  const openRouterPhaseStart = Date.now();
  const openRouterWindow = Math.max(
    0,
    openRouterPhaseEnd - openRouterPhaseStart,
  );
  const openRouterDeadlines = openRouterPhaseDeadlines(
    openRouterWindow,
    openRouterModels.length,
  );
  for (const [index, model] of openRouterModels.entries()) {
    const modelDeadline = openRouterPhaseStart + openRouterDeadlines[index];
    let resolvedModel = model;
    const openRouterText = await tryProvider({
      failures,
      provider: "openrouter",
      model,
      run: async () => {
        const result = await generateOpenRouterText(
          model,
          OPENROUTER_TIMEOUT_MS,
          options,
          systemPrompt,
          userPrompt,
          modelDeadline,
          safetyLevel,
          recordModerationRetry,
        );
        resolvedModel = result.model;
        return requireUsableStoryOutput(result.text, options);
      },
    });
    if (openRouterText) {
      return { text: openRouterText, model: resolvedModel };
    }
  }

  // Gemini second. It was the primary until 2026-09-05 and is kept as a real
  // fallback rather than deleted: it bills on a different account entirely, so
  // an OpenRouter billing or policy failure does not take it down too. It has
  // hard-failed with `429 RESOURCE_EXHAUSTED` since 2026-08-31, which is why it
  // is behind the model that actually answers and holds a small slice.
  const geminiResult = isProviderDisabled("gemini", disabled)
    ? null
    : await tryProvider({
      failures,
      provider: "gemini",
      model: GEMINI_MODEL,
      run: () =>
        generateGeminiText(
          GEMINI_MODEL,
          GEMINI_TIMEOUT_MS,
          options,
          systemPrompt,
          userPrompt,
          phaseDeadline(PHASE_END_SHARE.gemini),
          safetyLevel,
          recordModerationRetry,
        ).then((text) => requireUsableStoryOutput(text, options)),
    });
  if (geminiResult) {
    return { text: geminiResult, model: GEMINI_MODEL };
  }

  // The free tier, last. Every model whose identity is known in advance and
  // whose output is paid for has now been tried; what remains is free capacity,
  // which is still strictly better than refunding the credit.
  //
  // The window is split evenly across the list because a stalled first entry
  // would otherwise spend the whole slice and
  // `remainingDuration` would abort the models behind it before `fetch` was
  // called. Free models are the most likely of all to stall or throttle, so an
  // even split matters more here than anywhere else in the chain.
  const freeModels = isProviderDisabled("openrouter", disabled)
    ? []
    : OPENROUTER_FREE_MODELS;
  const freePhaseEnd = phaseDeadline(PHASE_END_SHARE.openrouterFree);
  const freePhaseStart = Date.now();
  const freeWindow = Math.max(0, freePhaseEnd - freePhaseStart);
  for (const [index, freeModel] of freeModels.entries()) {
    const modelDeadline = freePhaseStart +
      Math.floor((freeWindow * (index + 1)) / freeModels.length);
    let resolvedModel = freeModel;
    const freeText = await tryProvider({
      failures,
      provider: "openrouter",
      model: freeModel,
      run: async () => {
        const result = await generateOpenRouterText(
          freeModel,
          OPENROUTER_TIMEOUT_MS,
          options,
          systemPrompt,
          userPrompt,
          modelDeadline,
          safetyLevel,
          recordModerationRetry,
        );
        // `openrouter/free` reports which model it actually routed to; a named
        // free model reports itself. Either way telemetry records the truth.
        resolvedModel = result.model;
        return requireUsableStoryOutput(result.text, options);
      },
    });
    if (freeText) {
      return { text: freeText, model: resolvedModel };
    }
  }

  throw new AllProvidersFailedError(failures);
}

export function requireUsableStoryOutput(
  text: string,
  options: Pick<ChainOptions, "constrainToStorySchema" | "wordBand">,
): string {
  if (!options.constrainToStorySchema) return text;
  if (!hasCompleteStoryShape(text)) {
    throw new ProviderMalformedResponseError(
      "Provider returned malformed story JSON",
    );
  }
  requireUsableChapterLength(text, options.wordBand);
  return text;
}

/**
 * Reject a chapter whose length has run away from the band the prompt asked for.
 *
 * The count comes from `chapter_body`, never from the model's self-reported
 * `word_count`: a model that ignores the band is not a reliable narrator of how
 * badly it ignored it, and every persistence path counts the body anyway.
 *
 * Drift inside the tolerance is normal and is only logged. Outside it the output
 * is unusable, so it falls through to the next provider exactly like malformed
 * JSON does - the caller refunds the credit if the whole chain fails, which
 * beats charging for a chapter that breaks reading-time estimates and narration
 * cost downstream.
 */
function requireUsableChapterLength(text: string, band?: WordBand): void {
  if (!band) return;
  const body = parseJsonObject(text)?.chapter_body;
  if (typeof body !== "string") return;

  const words = countWords(body);
  const bounds = wordBandBounds(band);
  if (words < bounds.min || words > bounds.max) {
    throw new ProviderMalformedResponseError(
      `Chapter length ${words} words is outside the usable range ` +
        `${bounds.min}-${bounds.max} for a ${band.min}-${band.max} band`,
    );
  }
  if (words < band.min || words > band.max) {
    console.warn(
      `chapter length ${words} words drifted from the ${band.min}-${band.max} band`,
    );
  }
}

function hasCompleteStoryShape(text: string): boolean {
  const parsed = parseStructuredOutput(text, "Untitled Story");
  if (!parsed.structured || !parsed.chapter_body.trim()) return false;

  const json = parseJsonObject(text);
  if (!json) return false;

  for (const key of STORY_OUTPUT_JSON_SCHEMA.required) {
    if (!(key in json)) return false;
  }

  const seriesState = json.series_state;
  if (
    !seriesState || typeof seriesState !== "object" ||
    Array.isArray(seriesState)
  ) {
    return false;
  }
  for (const key of STORY_OUTPUT_JSON_SCHEMA.properties.series_state.required) {
    if (!(key in seriesState)) return false;
  }
  return true;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
    : trimmed;
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function tryProvider(input: {
  failures: LlmFailure[];
  provider: LlmFailure["provider"];
  model: string;
  run: () => Promise<string>;
}): Promise<string | undefined> {
  try {
    return await input.run();
  } catch (error) {
    console.error(`${input.model} failed:`, error);
    input.failures.push(classifyLlmError(error, input.provider, input.model));
    return undefined;
  }
}

async function generateGeminiText(
  model: string,
  timeoutMs: number,
  options: ChainOptions,
  systemPrompt: string,
  userPrompt: string,
  deadline: number,
  initialSafetyLevel: number,
  onModerationRetry: (level: number) => void,
): Promise<string> {
  const apiKey = geminiKey();
  if (!apiKey) {
    throw new ProviderNotConfiguredError("GEMINI_API_KEY is not configured");
  }

  for (let attempt = initialSafetyLevel; attempt < 3; attempt += 1) {
    try {
      return await withAbortTimeout(
        remainingDuration(deadline, timeoutMs),
        async (signal) => {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${
              encodeURIComponent(model)
            }:generateContent`,
            {
              method: "POST",
              signal,
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{
                  role: "user",
                  parts: [{ text: moderationSafePrompt(userPrompt, attempt) }],
                }],
                ...geminiRequestShape(options),
              }),
            },
          );
          const payload = await parseProviderPayload(response);
          if (!response.ok) {
            throw new ProviderHttpError(
              `Gemini request failed (${response.status}): ${
                providerError(payload)
              }`,
              response.status,
            );
          }
          return geminiContent(payload);
        },
      );
    } catch (error) {
      if (!isModerationRejection(error)) throw error;
      onModerationRetry(Math.min(attempt + 1, 2));
      if (attempt === 2) throw error;
      console.warn(
        `${model} moderation retry ${attempt + 1} of 2:`,
        failureMessage(error),
      );
    }
  }

  throw new ProviderModerationRejectedError(
    "Gemini moderation retries exhausted",
  );
}

async function generateOpenRouterText(
  model: string,
  timeoutMs: number,
  options: ChainOptions,
  systemPrompt: string,
  userPrompt: string,
  deadline: number,
  initialSafetyLevel: number,
  onModerationRetry: (level: number) => void,
): Promise<GenerationResult> {
  const apiKey = openRouterKey();
  if (!apiKey) {
    throw new ProviderNotConfiguredError(
      "OPENROUTER_API_KEY is not configured",
    );
  }

  for (let attempt = initialSafetyLevel; attempt < 3; attempt += 1) {
    try {
      const payload = await chatCompletionRequest({
        providerName: "OpenRouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey,
        model,
        timeoutMs,
        options,
        systemPrompt,
        userPrompt: moderationSafePrompt(userPrompt, attempt),
        deadline,
        requestShape: openRouterRequestShape,
        headers: {
          "HTTP-Referer": "https://katha.ai",
          "X-Title": "Katha AI",
        },
      });
      return {
        text: openAICompatibleContent(payload, "OpenRouter"),
        model: responseModel(payload) ?? model,
      };
    } catch (error) {
      if (!isModerationRejection(error)) throw error;
      onModerationRetry(Math.min(attempt + 1, 2));
      if (attempt === 2) throw error;
      console.warn(
        `${model} moderation retry ${attempt + 1} of 2:`,
        failureMessage(error),
      );
    }
  }

  throw new ProviderModerationRejectedError(
    "OpenRouter moderation retries exhausted",
  );
}

async function chatCompletionRequest(input: {
  providerName: string;
  url: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  options: ChainOptions;
  systemPrompt: string;
  userPrompt: string;
  deadline: number;
  headers?: Record<string, string>;
  /**
   * Overrides the default OpenAI-dialect shaping. OpenRouter has its own
   * `reasoning` control and its own budget floor, so it supplies its own shape
   * rather than inheriting the plain chat-completions contract.
   */
  requestShape?: (options: ChainOptions) => Record<string, unknown>;
}): Promise<unknown> {
  return await withAbortTimeout(
    remainingDuration(input.deadline, input.timeoutMs),
    async (signal) => {
      const response = await fetch(input.url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
          ...input.headers,
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ],
          ...(input.requestShape
            ? input.requestShape(input.options)
            : openAICompatibleRequestShape(input.options)),
        }),
      });
      const payload = await parseProviderPayload(response);
      if (!response.ok) {
        throw new ProviderHttpError(
          `${input.providerName} request failed (${response.status}): ${
            providerError(payload)
          }`,
          response.status,
        );
      }
      return payload;
    },
  );
}

function openAICompatibleRequestShape(options: ChainOptions) {
  const responseFormat = structuredResponseFormatFor(options);
  return {
    temperature: 0.8,
    max_tokens: options.maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
}

function structuredSchemaFor(options: ChainOptions): unknown | undefined {
  if (options.structuredOutput) return options.structuredOutput.schema;
  return options.constrainToStorySchema ? STORY_OUTPUT_JSON_SCHEMA : undefined;
}

function structuredResponseFormatFor(
  options: ChainOptions,
): unknown | undefined {
  if (options.structuredOutput) {
    return {
      type: "json_schema",
      json_schema: {
        name: options.structuredOutput.name,
        strict: true,
        schema: options.structuredOutput.schema,
      },
    };
  }
  return options.constrainToStorySchema ? OPENAI_RESPONSE_FORMAT : undefined;
}

function moderationSafePrompt(userPrompt: string, attempt: number): string {
  if (attempt === 0) return userPrompt;
  if (attempt === 1) {
    return `${userPrompt}\n\nDescribe tense or sensitive scenes gently and indirectly. Avoid graphic detail while preserving the requested characters, genre, and plot.`;
  }
  return `${userPrompt}\n\nUse calm, age-appropriate language throughout. Resolve danger off-page, omit graphic or explicit detail, and preserve only the essential characters and story arc.`;
}

function isModerationRejection(error: unknown): boolean {
  const message = failureMessage(error).toLowerCase();
  return [
    "moderation",
    "content policy",
    "safety policy",
    "unsafe content",
    "content blocked",
    "content filtering",
    "safety_ratings",
    "blocked",
  ].some((marker) => message.includes(marker));
}

function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404) return "model_not_found";
  if (status === 408) return "timeout";
  if (status === 409) return "provider_conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_5xx";
  return "provider_error";
}

function geminiContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new ProviderMalformedResponseError(
      "Gemini returned an invalid response",
    );
  }
  const promptFeedback = (payload as Record<string, unknown>).promptFeedback;
  if (promptFeedback && typeof promptFeedback === "object") {
    const blockReason = (promptFeedback as Record<string, unknown>).blockReason;
    if (typeof blockReason === "string" && blockReason.trim().length > 0) {
      throw new ProviderModerationRejectedError(
        `Gemini moderation rejection: ${blockReason}`,
      );
    }
  }
  const candidates = (payload as Record<string, unknown>).candidates;
  if (
    !Array.isArray(candidates) || !candidates[0] ||
    typeof candidates[0] !== "object"
  ) {
    throw new ProviderMalformedResponseError("Gemini returned no candidates");
  }
  const candidate = candidates[0] as Record<string, unknown>;
  const finishReason = candidate.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new ProviderMalformedResponseError(
      "Gemini response truncated (finishReason=MAX_TOKENS)",
    );
  }
  if (
    typeof finishReason === "string" &&
    ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(
      finishReason,
    )
  ) {
    throw new ProviderModerationRejectedError(
      `Gemini moderation rejection: ${finishReason}`,
    );
  }
  const content = candidate.content;
  if (!content || typeof content !== "object") {
    throw new ProviderMalformedResponseError("Gemini returned no content");
  }
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) {
    throw new ProviderMalformedResponseError("Gemini returned no parts");
  }
  const text = parts
    .filter((part): part is Record<string, unknown> =>
      Boolean(part) && typeof part === "object"
    )
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
  if (!text.trim()) {
    throw new ProviderMalformedResponseError(
      "Gemini returned no text content",
    );
  }
  return text;
}

async function parseProviderPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return { error: { message: body.slice(0, 500) } };
  }
}

function openAICompatibleContent(
  payload: unknown,
  providerName: string,
): string {
  if (!payload || typeof payload !== "object") {
    throw new ProviderMalformedResponseError(
      `${providerName} returned an invalid response`,
    );
  }
  const choices = (payload as Record<string, unknown>).choices;
  if (
    !Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object"
  ) {
    throw new ProviderMalformedResponseError(
      `${providerName} returned no choices`,
    );
  }
  const finishReason = (choices[0] as Record<string, unknown>).finish_reason;
  if (finishReason === "length") {
    throw new ProviderMalformedResponseError(
      `${providerName} response truncated (finish_reason=length)`,
    );
  }
  if (finishReason === "content_filter") {
    throw new ProviderModerationRejectedError(
      `${providerName} moderation rejection: content_filter`,
    );
  }
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new ProviderMalformedResponseError(
      `${providerName} returned no message`,
    );
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ProviderMalformedResponseError(
      `${providerName} returned no content`,
    );
  }
  return content;
}

function responseModel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const model = (payload as Record<string, unknown>).model;
  return typeof model === "string" && model.trim() ? model : null;
}

function providerError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid error body";
  const error = (payload as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    return typeof message === "string"
      ? message.slice(0, 500)
      : "unknown provider error";
  }
  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string"
    ? message.slice(0, 500)
    : "unknown provider error";
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error);
}

function remainingDuration(deadline: number, providerLimit: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new DOMException("Generation deadline exceeded", "AbortError");
  }
  return Math.min(remaining, providerLimit);
}

async function withAbortTimeout<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException(`Timeout after ${ms}ms`, "AbortError")),
    ms,
  );

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "additionalProperties" || key === "description") continue;
    output[key] = key === "type" && typeof child === "string"
      ? child.toUpperCase()
      : geminiSchema(child);
  }
  return output;
}
