import {
  OPENAI_RESPONSE_FORMAT,
  STORY_OUTPUT_JSON_SCHEMA,
} from "./story_schema.ts";
import { parseStructuredOutput } from "./story_text.ts";

/**
 * Secrets are read lazily, not at module load.
 *
 * A top-level `Deno.env.get` makes importing this module a side effect: the
 * test suite then needs --allow-env just to reference a type, and a missing
 * secret fails at import rather than at the call that needs it.
 */

export const GEMINI_MODEL = "gemini-3.1-pro-preview";
export const OPENROUTER_FREE_MODEL = "openrouter/free";
export const OPENAI_MODEL = "gpt-4o-mini";

const geminiKey = () => Deno.env.get("GEMINI_API_KEY")?.trim();
const openRouterKey = () => Deno.env.get("OPENROUTER_API_KEY")?.trim();
const openaiKey = () => Deno.env.get("OPENAI_API_KEY")?.trim();
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
const OPENAI_TIMEOUT_MS = 30_000;

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
  if (error instanceof ProviderMalformedResponseError) {
    return { ...base, code: "malformed_response", retryable: true };
  }
  return { ...base, code: "unknown", retryable: true };
}

/**
 * Generate story text with a fallback chain:
 * Gemini 3.1 Pro Preview (70s) -> OpenRouter Free Router (30s) ->
 * gpt-4o-mini (30s).
 *
 * Every attempt is schema-constrained where the provider supports it, so a
 * success should parse as the story JSON object. On total failure this throws
 * AllProvidersFailedError, whose `toContext()` feeds straight into
 * logError({ bucket: "llm.provider" }).
 */
export function generateStoryText(
  systemPrompt: string,
  userPrompt: string,
): Promise<GenerationResult> {
  return runProviderChain(systemPrompt, userPrompt, {
    maxTokens: MAX_OUTPUT_TOKENS,
    constrainToStorySchema: true,
    deadlineMs: GENERATION_DEADLINE_MS,
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

export function openAIRequestShape(options: ChainOptions) {
  return openAICompatibleRequestShape(options);
}

async function runProviderChain(
  systemPrompt: string,
  userPrompt: string,
  options: ChainOptions,
): Promise<GenerationResult> {
  const failures: LlmFailure[] = [];
  const deadline = Date.now() + options.deadlineMs;
  let safetyLevel = 0;
  const recordModerationRetry = (level: number) => {
    safetyLevel = Math.max(safetyLevel, level);
  };

  const geminiResult = await tryProvider({
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
        deadline,
        safetyLevel,
        recordModerationRetry,
      ).then((text) => requireUsableStoryOutput(text, options)),
  });
  if (geminiResult) {
    return { text: geminiResult, model: GEMINI_MODEL };
  }

  let openRouterModel = OPENROUTER_FREE_MODEL;
  const openRouterText = await tryProvider({
    failures,
    provider: "openrouter",
    model: OPENROUTER_FREE_MODEL,
    run: async () => {
      const result = await generateOpenRouterText(
        OPENROUTER_FREE_MODEL,
        OPENROUTER_TIMEOUT_MS,
        options,
        systemPrompt,
        userPrompt,
        deadline,
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

  const openAIText = await tryProvider({
    failures,
    provider: "openai",
    model: OPENAI_MODEL,
    run: () =>
      generateOpenAIText(
        OPENAI_MODEL,
        OPENAI_TIMEOUT_MS,
        options,
        systemPrompt,
        userPrompt,
        deadline,
        safetyLevel,
        recordModerationRetry,
      ).then((text) => requireUsableStoryOutput(text, options)),
  });
  if (openAIText) {
    return { text: openAIText, model: OPENAI_MODEL };
  }

  throw new AllProvidersFailedError(failures);
}

export function requireUsableStoryOutput(
  text: string,
  options: Pick<ChainOptions, "constrainToStorySchema">,
): string {
  if (!options.constrainToStorySchema) return text;
  if (hasCompleteStoryShape(text)) return text;
  throw new ProviderMalformedResponseError(
    "Provider returned malformed story JSON",
  );
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

  throw new Error("Gemini moderation retries exhausted");
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

  throw new Error("OpenRouter moderation retries exhausted");
}

async function generateOpenAIText(
  model: string,
  timeoutMs: number,
  options: ChainOptions,
  systemPrompt: string,
  userPrompt: string,
  deadline: number,
  initialSafetyLevel: number,
  onModerationRetry: (level: number) => void,
): Promise<string> {
  const apiKey = openaiKey();
  if (!apiKey) {
    throw new ProviderNotConfiguredError("OPENAI_API_KEY is not configured");
  }

  for (let attempt = initialSafetyLevel; attempt < 3; attempt += 1) {
    try {
      const payload = await chatCompletionRequest({
        providerName: "OpenAI",
        url: "https://api.openai.com/v1/chat/completions",
        apiKey,
        model,
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

  throw new Error("OpenAI moderation retries exhausted");
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
          temperature: 0.8,
          ...openAICompatibleRequestShape(input.options),
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
    max_tokens: options.maxTokens,
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
      throw new Error(`Gemini moderation rejection: ${blockReason}`);
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
    throw new Error(`Gemini moderation rejection: ${finishReason}`);
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
    throw new Error(`${providerName} moderation rejection: content_filter`);
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
