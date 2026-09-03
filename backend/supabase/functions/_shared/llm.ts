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
 * The second position is a pinned, priced model, not the free router.
 *
 * `openrouter/free` picks a free model at random per request, so its output cap,
 * latency and prose quality are not repeatable, and free-tier daily request caps
 * apply. A routed model whose output cap is under `MAX_OUTPUT_TOKENS` returns
 * `finish_reason: "length"`, which `openAICompatibleContent` rejects. Gemini 2.5
 * Flash is pinned here: 65k output tokens, native structured output, and it bills
 * through OpenRouter, so a Google-side quota block on `GEMINI_API_KEY` does not
 * take this position down with it.
 */
export const OPENROUTER_MODEL = "google/gemini-2.5-flash";
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
 * real redundancy is Gemini -> OpenRouter's *paid* `google/gemini-2.5-flash`
 * (measured at 10.6s for a schema-valid 520-word chapter) -> the three OpenAI
 * models. What survives here is the one free model that ever produced valid
 * output, and the blind router behind it, because at this point the only
 * remaining alternative is refunding the user's credit.
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
/**
 * The OpenAI position, in preference order.
 *
 * `gpt-5.6-luna` is the model we want: far stronger prose than `gpt-4o-mini` at
 * $0.20/$1.20 per M. Access to it is granted per OpenAI *project* - the org
 * grant alone is not enough - and a project without it gets
 * `403 ... does not have access to model`, not a degraded result. Note that
 * `/v1/models` still lists Luna for an unentitled project: that endpoint returns
 * the catalogue, not the entitlement, so it cannot be used to probe access.
 *
 * The models behind it keep generating meanwhile, and enabling Luna upstream
 * needs no deploy - the 403 simply stops happening and the better model wins.
 *
 * `reasoning` selects the chat-completions contract: a reasoning model takes
 * `max_completion_tokens` and rejects `temperature`. See the request shapes.
 */
export interface OpenAIModelSpec {
  model: string;
  reasoning: boolean;
}

export const OPENAI_MODELS: readonly OpenAIModelSpec[] = [
  { model: "gpt-5.6-luna", reasoning: true },
  // Added while Luna was unentitled; kept as the second tier now that Luna is
  // entitled. Per ~1k-word story: luna ~$0.004, gpt-5-mini ~$0.006,
  // gpt-4o-mini ~$0.002. Luna is both cheaper and better than this model, so
  // in the normal case the position costs nothing and is pure redundancy.
  { model: "gpt-5-mini", reasoning: true },
  // The safety net. Not gated behind any entitlement, so it always answers.
  { model: "gpt-4o-mini", reasoning: false },
];

/** The preferred OpenAI model; the rest of the list is fallback. */
export const OPENAI_MODEL = OPENAI_MODELS[0].model;

const geminiKey = () => Deno.env.get("GEMINI_API_KEY")?.trim();
const openRouterKey = () => Deno.env.get("OPENROUTER_API_KEY")?.trim();
/**
 * Story generation prefers its own OpenAI credential and falls back to the
 * shared one.
 *
 * `OPENAI_API_KEY` also authenticates DALL-E 3 cover generation in
 * `_shared/image.ts`, so while it is the only key set, one spend cap, rate
 * limit, revocation or rotation takes down covers and stories together - and
 * with Gemini and OpenRouter both unavailable, every position that can serve
 * authenticates with it. Setting `OPENAI_STORY_API_KEY` separates the two blast
 * radii with no code change; leaving it unset preserves today's behaviour.
 */
const openaiKey = () =>
  Deno.env.get("OPENAI_STORY_API_KEY")?.trim() ||
  Deno.env.get("OPENAI_API_KEY")?.trim();

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

/** Test seam: which credential story generation would use right now. */
export const openAIKeyForTest = () => openaiKey();
const GENERATION_DEADLINE_MS = 120_000;

/**
 * A story plus its series_state runs well past 4096 tokens.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/** A paragraph rewrite is short, and the editor UI waits on it inline. */
const EDIT_MAX_OUTPUT_TOKENS = 2_000;
const EDIT_DEADLINE_MS = 60_000;
const GEMINI_TIMEOUT_MS = 70_000;
const OPENROUTER_TIMEOUT_MS = 30_000;
/** A reasoning model thinks before it writes, so it needs a longer window. */
const OPENAI_TIMEOUT_MS = 60_000;

/**
 * Reasoning tokens are counted and billed inside `max_completion_tokens`, so the
 * reasoning path needs headroom above the visible story length that
 * `MAX_OUTPUT_TOKENS` describes. Without it a long story is truncated by the
 * budget its own reasoning consumed, and surfaces as `finish_reason: "length"`.
 */
const OPENAI_REASONING_TOKEN_MULTIPLIER = 2;

/**
 * Cumulative fractions of `deadlineMs` at which each provider phase must end.
 *
 * A provider's moderation retries are bounded only by the shared deadline, so
 * without per-phase caps the first provider can spend the entire budget and
 * every fallback aborts before it sends a request - the chain collapses to one
 * provider in exactly the slow case the fallbacks exist for.
 */
const PHASE_END_SHARE = {
  gemini: 0.35,
  openrouter: 0.5,
  openai: 0.9,
  openrouterFree: 1,
} as const;

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
  provider: "gemini" | "openrouter" | "openai";
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
 * gemini-3.1-pro-preview -> OpenRouter google/gemini-2.5-flash (pinned, priced)
 * -> OpenAI (gpt-5.6-luna, gpt-5-mini, gpt-4o-mini) -> openrouter/free (last).
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
  /**
   * The chapter length contract for this request. Omitted for paragraph edits,
   * which have no band. A generation outside its tolerated bounds is treated
   * like any other unusable output: it falls through to the next provider
   * rather than reaching persistence.
   */
  wordBand?: WordBand;
}

export function geminiRequestShape(options: ChainOptions) {
  return {
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: options.maxTokens,
      ...(options.constrainToStorySchema
        ? {
          responseMimeType: "application/json",
          responseSchema: geminiSchema(STORY_OUTPUT_JSON_SCHEMA),
        }
        : {}),
    },
  };
}

export function openRouterRequestShape(options: ChainOptions) {
  return openAICompatibleRequestShape(options);
}

export function openAIRequestShape(
  options: ChainOptions,
  spec: OpenAIModelSpec = OPENAI_MODELS[0],
) {
  return spec.reasoning
    ? openAIReasoningRequestShape(options)
    : openAICompatibleRequestShape(options);
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

  let openRouterModel = OPENROUTER_MODEL;
  const openRouterText = isProviderDisabled("openrouter", disabled)
    ? null
    : await tryProvider({
      failures,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      run: async () => {
        const result = await generateOpenRouterText(
          OPENROUTER_MODEL,
          OPENROUTER_TIMEOUT_MS,
          options,
          systemPrompt,
          userPrompt,
          phaseDeadline(PHASE_END_SHARE.openrouter),
          safetyLevel,
          recordModerationRetry,
        );
        openRouterModel = result.model;
        return requireUsableStoryOutput(result.text, options);
      },
    });
  if (openRouterText) {
    return { text: openRouterText, model: openRouterModel };
  }

  // Each OpenAI model records its own failure, so telemetry shows whether the
  // preferred model was merely unentitled or actually broken.
  //
  // The OpenAI window is split evenly across the models rather than shared. A
  // shared deadline lets a stalled preferred model spend the whole window, and
  // `remainingDuration` then aborts the model behind it before `fetch` is even
  // called - the same starvation the per-provider phases exist to prevent,
  // recurring one level down. An even split guarantees the last model a slice.
  const openAIPhaseEnd = phaseDeadline(PHASE_END_SHARE.openai);
  const openAIPhaseStart = Date.now();
  const openAIWindow = Math.max(0, openAIPhaseEnd - openAIPhaseStart);
  const openAIModels = isProviderDisabled("openai", disabled)
    ? []
    : OPENAI_MODELS;
  for (const [index, spec] of openAIModels.entries()) {
    const modelDeadline = openAIPhaseStart +
      Math.floor((openAIWindow * (index + 1)) / openAIModels.length);
    const openAIText = await tryProvider({
      failures,
      provider: "openai",
      model: spec.model,
      run: () =>
        generateOpenAIText(
          spec,
          OPENAI_TIMEOUT_MS,
          options,
          systemPrompt,
          userPrompt,
          modelDeadline,
          safetyLevel,
          recordModerationRetry,
        ).then((text) => requireUsableStoryOutput(text, options)),
    });
    if (openAIText) {
      return { text: openAIText, model: spec.model };
    }
  }

  // The free tier, last. Every model whose identity is known in advance and
  // whose output is paid for has now been tried; what remains is free capacity,
  // which is still strictly better than refunding the credit.
  //
  // The window is split evenly across the list for the same reason the OpenAI
  // window is: a stalled first entry would otherwise spend the whole slice and
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

async function generateOpenAIText(
  spec: OpenAIModelSpec,
  timeoutMs: number,
  options: ChainOptions,
  systemPrompt: string,
  userPrompt: string,
  deadline: number,
  initialSafetyLevel: number,
  onModerationRetry: (level: number) => void,
): Promise<string> {
  const model = spec.model;
  const apiKey = openaiKey();
  if (!apiKey) {
    throw new ProviderNotConfiguredError(
      "OPENAI_STORY_API_KEY / OPENAI_API_KEY is not configured",
    );
  }

  for (let attempt = initialSafetyLevel; attempt < 3; attempt += 1) {
    try {
      const payload = await chatCompletionRequest({
        providerName: "OpenAI",
        url: "https://api.openai.com/v1/chat/completions",
        apiKey,
        model,
        reasoning: spec.reasoning,
        timeoutMs,
        options,
        systemPrompt,
        userPrompt: moderationSafePrompt(userPrompt, attempt),
        deadline,
      });
      return openAICompatibleContent(payload, "OpenAI");
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
    "OpenAI moderation retries exhausted",
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
  /** OpenAI reasoning models take a different chat-completions contract. */
  reasoning?: boolean;
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
          ...(input.reasoning
            ? openAIReasoningRequestShape(input.options)
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
  return {
    temperature: 0.8,
    max_tokens: options.maxTokens,
    ...(options.constrainToStorySchema
      ? { response_format: OPENAI_RESPONSE_FORMAT }
      : {}),
  };
}

/**
 * The chat-completions contract for an OpenAI reasoning model.
 *
 * These models reject `max_tokens` outright and ignore `temperature`, so the
 * shape shared with OpenRouter cannot be reused: OpenRouter still routes to
 * older models that only understand `max_tokens`. `reasoning_effort` is held low
 * because prose does not benefit from long deliberation, and every reasoning
 * token is latency the reader waits through and budget the story cannot spend.
 */
function openAIReasoningRequestShape(options: ChainOptions) {
  return {
    max_completion_tokens: options.maxTokens *
      OPENAI_REASONING_TOKEN_MULTIPLIER,
    reasoning_effort: "low",
    ...(options.constrainToStorySchema
      ? { response_format: OPENAI_RESPONSE_FORMAT }
      : {}),
  };
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
