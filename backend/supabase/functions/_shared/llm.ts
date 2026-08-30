import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";
import {
  ANTHROPIC_OUTPUT_FORMAT,
  OPENAI_RESPONSE_FORMAT,
} from "./story_schema.ts";

/**
 * Secrets are read lazily, not at module load.
 *
 * A top-level `Deno.env.get` makes importing this module a side effect: the
 * test suite then needs --allow-env just to reference a type, and a missing
 * secret fails at import rather than at the call that needs it.
 */

/**
 * Claude auth here is an OAuth bearer token, not a Console API key.
 *
 * `CLAUDE_CODE_OAUTH_TOKEN` is canonical; `ANTHROPIC_AUTH_TOKEN` and
 * `CLAUDE_TOKEN` are accepted so a runtime already carrying either name keeps
 * working without a redeploy. First non-empty wins, in that order.
 *
 * The value goes to the SDK as `authToken`, which sends
 * `Authorization: Bearer <token>`. An API key instead travels in `x-api-key`,
 * so the two are not interchangeable and must not be conflated.
 */
export const CLAUDE_TOKEN_ENV_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_TOKEN",
] as const;

/**
 * Builds the Claude client with API-key auth explicitly disabled.
 *
 * `apiKey: null` is load-bearing, not defensive noise. The SDK constructor
 * defaults an omitted `apiKey` to `readEnv("ANTHROPIC_API_KEY")`, and
 * `authHeaders()` returns `[apiKeyAuth(), bearerAuth()]` — so passing only
 * `authToken` while a leftover `ANTHROPIC_API_KEY` sits in the environment
 * sends BOTH `X-Api-Key` and `Authorization`, and the Console key can bill
 * and authenticate traffic this project believes is running on OAuth.
 *
 * `fetchImpl` exists so a test can assert the outgoing headers directly.
 */
export function createClaudeClient(
  authToken: string,
  fetchImpl?: typeof fetch,
): Anthropic {
  return new Anthropic({
    authToken,
    apiKey: null,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/**
 * Resolves the Claude OAuth bearer token from the environment.
 *
 * Returns the first non-empty value across {@link CLAUDE_TOKEN_ENV_VARS},
 * trimmed. Whitespace-only counts as absent: a secret set with a trailing
 * newline is the usual way a "configured" secret is in fact empty.
 *
 * @returns the token, or `undefined` when no credential is configured.
 */
export function claudeAuthToken(): string | undefined {
  for (const name of CLAUDE_TOKEN_ENV_VARS) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

const openaiKey = () => Deno.env.get("OPENAI_API_KEY");
const GENERATION_DEADLINE_MS = 120_000;

/**
 * Model IDs are complete as written - never append a date suffix. The previous
 * "claude-haiku-4-5-20251001" was not a valid id, so the Haiku fallback could
 * only ever 404, and "claude-sonnet-4-6" is superseded by Sonnet 5, which is
 * both newer and cheaper ($2/$10 per MTok against $3/$15).
 */
const PRIMARY_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-haiku-4-5";
const OPENAI_MODEL = "gpt-4o-mini";

/**
 * A story plus its series_state runs well past 4096 tokens. The old ceiling
 * truncated mid-JSON, which parsed as garbage and silently degraded to the text
 * parser - the root of the intermittent "hook_type: none, state frozen" chapters.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/** A paragraph rewrite is short, and the editor UI waits on it inline. */
const EDIT_MAX_OUTPUT_TOKENS = 2_000;
const EDIT_DEADLINE_MS = 60_000;

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
  provider: "anthropic" | "openai";
  model: string;
  /** Stable slug for grouping recurrences, e.g. "rate_limited". */
  code: string;
  /** HTTP status when the provider returned one. */
  status?: number;
  retryable: boolean;
  message: string;
}

/** A non-2xx provider response, carrying the status through to classification. */
/**
 * Raised when a provider has no credential configured at all.
 *
 * Distinct from an auth failure: nothing was sent, so this is a deployment
 * gap rather than a rejected token, and it must never be retried. The OpenAI
 * leg reports the same `not_configured` code without throwing, because it is
 * the last link in the chain and has nothing to fall through to.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProviderHttpError";
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
 *
 * Uses the SDK's typed error classes rather than string matching, so a 429 stays
 * distinguishable from a 400 even when provider wording changes.
 */
export function classifyLlmError(
  error: unknown,
  provider: "anthropic" | "openai",
  model: string,
): LlmFailure {
  const base = { provider, model, message: failureMessage(error) };

  // The SDK raises APIUserAbortError when our deadline signal fires. It extends
  // APIError, so it must be matched before the APIError branch or a timeout is
  // mislabelled as a provider error.
  if (error instanceof Anthropic.APIUserAbortError) {
    return { ...base, code: "timeout", retryable: true };
  }
  // The fetch path rejects with the AbortSignal reason.
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
      code: error.status >= 500 ? "provider_5xx" : "provider_error",
      status: error.status,
      // 4xx is a request or credential problem; retrying the same call repeats it.
      retryable: error.status >= 500 || error.status === 429,
    };
  }
  if (error instanceof Anthropic.NotFoundError) {
    // Almost always a bad model id - not worth retrying on another attempt.
    return { ...base, code: "model_not_found", status: 404, retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { ...base, code: "rate_limited", status: 429, retryable: true };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { ...base, code: "auth_failed", status: 401, retryable: false };
  }
  // APIConnectionError extends APIError in the TS SDK, so it must be checked first.
  if (error instanceof Anthropic.APIConnectionError) {
    return { ...base, code: "connection_failed", retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    const status = (error as { status?: number }).status;
    return {
      ...base,
      code: status && status >= 500 ? "provider_5xx" : "provider_error",
      status,
      retryable: !status || status >= 500,
    };
  }
  return { ...base, code: "unknown", retryable: true };
}

/**
 * Generate story text with a fallback chain:
 * Sonnet 5 (60s) -> Haiku 4.5 (30s) -> gpt-4o-mini (30s).
 *
 * Every attempt is schema-constrained, so a success is guaranteed to parse.
 * On total failure this throws AllProvidersFailedError, whose `toContext()`
 * feeds straight into logError({ bucket: "llm.provider" }).
 */
export function generateStoryText(
  systemPrompt: string,
  userPrompt: string,
): Promise<GenerationResult> {
  return runProviderChain(systemPrompt, userPrompt, {
    maxTokens: MAX_OUTPUT_TOKENS,
    // Story generation must come back as the story JSON object.
    constrainToStorySchema: true,
    deadlineMs: GENERATION_DEADLINE_MS,
  });
}

/**
 * Rewrite a single paragraph for the Create Studio editor.
 *
 * Runs the same provider chain, but returns prose: the response is the edited
 * paragraph itself, so the story JSON schema must NOT be applied here. A much
 * smaller ceiling and a shorter deadline keep an inline edit responsive.
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

/**
 * The provider-specific bits of a request that depend on chain options.
 *
 * Exported so the branch that decides whether to constrain output can be tested
 * without a network call - it is the difference between a story (must be the
 * JSON object) and a paragraph edit (must be prose).
 */
export function anthropicRequestShape(options: ChainOptions) {
  return {
    max_tokens: options.maxTokens,
    ...(options.constrainToStorySchema
      ? { output_config: { format: ANTHROPIC_OUTPUT_FORMAT } }
      : {}),
  };
}

export function openAIRequestShape(options: ChainOptions) {
  return {
    max_tokens: options.maxTokens,
    ...(options.constrainToStorySchema
      ? { response_format: OPENAI_RESPONSE_FORMAT }
      : {}),
  };
}

export interface ChainOptions {
  maxTokens: number;
  constrainToStorySchema: boolean;
  deadlineMs: number;
}

/**
 * Tries each provider in order and returns the first success.
 *
 * Sonnet, then Haiku, then gpt-4o-mini. Both Claude legs are skipped as a
 * unit when no credential is configured, recording one `not_configured`
 * failure rather than one per model.
 *
 * @throws {AllProvidersFailedError} with the per-provider failure list when
 * every attempt fails, so the caller can refund the credit and log context.
 */
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
  // The credential is resolved once, ahead of both Claude legs. Checking it
  // per-leg would throw the identical preflight error twice and write two
  // `not_configured` rows for a single deployment gap - inflating any
  // occurrence count that a recurrence check later reads.
  const claudeToken = claudeAuthToken();
  if (claudeToken) {
    // Attempt 1: Sonnet
    try {
      const text = await generateAnthropicText(
        PRIMARY_MODEL,
        60000,
        options,
        systemPrompt,
        userPrompt,
        deadline,
        safetyLevel,
        recordModerationRetry,
        claudeToken,
      );
      return { text, model: PRIMARY_MODEL };
    } catch (e) {
      console.error(`${PRIMARY_MODEL} failed:`, e);
      failures.push(classifyLlmError(e, "anthropic", PRIMARY_MODEL));
    }

    // Attempt 2: Haiku
    try {
      const text = await generateAnthropicText(
        FALLBACK_MODEL,
        30000,
        options,
        systemPrompt,
        userPrompt,
        deadline,
        safetyLevel,
        recordModerationRetry,
        claudeToken,
      );
      return { text, model: FALLBACK_MODEL };
    } catch (e) {
      console.error(`${FALLBACK_MODEL} failed:`, e);
      failures.push(classifyLlmError(e, "anthropic", FALLBACK_MODEL));
    }
  } else {
    console.error(
      "Claude skipped: no credential. Set CLAUDE_CODE_OAUTH_TOKEN.",
    );
    failures.push({
      provider: "anthropic",
      model: `${PRIMARY_MODEL}+${FALLBACK_MODEL}`,
      code: "not_configured",
      retryable: false,
      message:
        "Claude credentials are not configured; both Claude models skipped. Set CLAUDE_CODE_OAUTH_TOKEN.",
    });
  }

  // Attempt 3: gpt-4o-mini
  const openaiApiKey = openaiKey();
  if (openaiApiKey) {
    try {
      const text = await withAbortTimeout(
        remainingDuration(deadline, 30000),
        async (signal) => {
          const res = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              signal,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openaiApiKey}`,
              },
              body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [
                  { role: "system", content: systemPrompt },
                  {
                    role: "user",
                    content: moderationSafePrompt(userPrompt, safetyLevel),
                  },
                ],
                // json_object guarantees valid JSON but not the right shape,
                // which still degraded to the text parser. The strict schema
                // guarantees both.
                ...openAIRequestShape(options),
              }),
            },
          );
          const payload: unknown = await res.json();
          if (!res.ok) {
            throw new ProviderHttpError(
              `OpenAI request failed (${res.status}): ${
                providerError(payload)
              }`,
              res.status,
            );
          }
          return openAIContent(payload);
        },
      );
      return { text, model: OPENAI_MODEL };
    } catch (e) {
      console.error(`${OPENAI_MODEL} failed:`, e);
      failures.push(classifyLlmError(e, "openai", OPENAI_MODEL));
    }
  } else {
    failures.push({
      provider: "openai",
      model: OPENAI_MODEL,
      code: "not_configured",
      retryable: false,
      message: "OPENAI_API_KEY is not configured",
    });
  }

  throw new AllProvidersFailedError(failures);
}

/**
 * Runs one Claude model attempt, retrying only on moderation refusals.
 *
 * The caller resolves the credential and passes it in, so this never reads
 * the environment and there is a single resolution point per chain run.
 *
 * @param authToken OAuth bearer token; see {@link createClaudeClient}.
 * @param onModerationRetry raises the shared safety level so a later
 * provider in the chain starts at the softened prompt rather than
 * rediscovering the refusal.
 * @throws the provider error unmodified, for {@link classifyLlmError}.
 */
async function generateAnthropicText(
  model: string,
  timeoutMs: number,
  options: ChainOptions,
  systemPrompt: string,
  userPrompt: string,
  deadline: number,
  initialSafetyLevel: number,
  onModerationRetry: (level: number) => void,
  authToken: string,
): Promise<string> {
  const client = createClaudeClient(authToken);

  for (let attempt = initialSafetyLevel; attempt < 3; attempt += 1) {
    try {
      const response = await withAbortTimeout(
        remainingDuration(deadline, timeoutMs),
        (signal) =>
          client.messages.create(
            {
              model,
              ...anthropicRequestShape(options),
              system: systemPrompt,
              messages: [{
                role: "user",
                content: moderationSafePrompt(userPrompt, attempt),
              }],
            } as Anthropic.MessageCreateParamsNonStreaming,
            { signal },
          ),
      );
      if (String(response.stop_reason) === "refusal") {
        throw new Error("Anthropic moderation refusal");
      }
      const text = response.content
        .filter((block: Anthropic.ContentBlock) => block.type === "text")
        .map((block: Anthropic.TextBlock) => block.text)
        .join("");
      if (!text.trim()) throw new Error("Anthropic returned no text content");
      return text;
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

  throw new Error("Anthropic moderation retries exhausted");
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
  ].some((marker) => message.includes(marker));
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error);
}

function remainingDuration(deadline: number, providerLimit: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Generation deadline exceeded");
  return Math.min(remaining, providerLimit);
}

function openAIContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI returned an invalid response");
  }
  const choices = (payload as Record<string, unknown>).choices;
  if (
    !Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object"
  ) {
    throw new Error("OpenAI returned no choices");
  }
  const finishReason = (choices[0] as Record<string, unknown>).finish_reason;
  if (finishReason === "length") {
    // Truncated output is partial JSON. Parsing it fails and the caller falls
    // back to the text parser, which persists a chapter with no hook and an
    // empty series_state while still charging a credit. Fail instead so the
    // existing refund path runs.
    throw new Error("OpenAI response truncated (finish_reason=length)");
  }
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error("OpenAI returned no message");
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI returned no content");
  }
  return content;
}

function providerError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid error body";
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "unknown provider error";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string"
    ? message.slice(0, 500)
    : "unknown provider error";
}

async function withAbortTimeout<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    // A DOMException named AbortError is what fetch and the SDK both surface,
    // so classifyLlmError can recognise a timeout rather than guessing.
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
