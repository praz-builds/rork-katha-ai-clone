import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage } from "./operations.ts";

/**
 * Persistent error telemetry.
 *
 * `logError` never throws and never rejects. Telemetry that can take down a
 * user request is worse than no telemetry, so a logging failure degrades to a
 * console line and nothing else.
 *
 * PII rule: `context` carries identifiers and enums only. Never story prose,
 * seeds, prompts, titles, comments, or free user text.
 */

export type ErrorBucket =
  | "generation.story"
  | "generation.edit"
  | "generation.cover"
  | "generation.audio"
  | "llm.provider"
  | "publishing"
  | "discovery"
  | "credits"
  | "payments"
  | "engagement"
  | "feedback"
  | "client.app"
  | "ci.test";

export type ErrorSeverity = "critical" | "high" | "medium" | "low";
export type ErrorSource = "runtime" | "smoke_test" | "ci" | "client";

export type LogErrorInput = {
  bucket: ErrorBucket;
  severity?: ErrorSeverity;
  source?: ErrorSource;
  errorCode?: string;
  error: unknown;
  context?: Record<string, unknown>;
  userId?: string | null;
};

const ALLOWED_CONTEXT_KEYS = new Set([
  "attempts",
  "author_id",
  "chapter_id",
  "chapter_number",
  "chapter_role",
  "code",
  "codes",
  "environment",
  "genre",
  "http_status",
  "job_id",
  "model",
  "models",
  "operation_id",
  "paragraph_index",
  "primary_genre",
  "provider",
  "providers",
  "recovered_by",
  "request_id",
  "retryable",
  "status",
  "statuses",
  "status_name",
  "story_id",
  "story_mode",
  "upstream_status",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[A-Za-z0-9_.:/-]{1,96}$/;
const LOG_TIMEOUT_MS = 1_500;

export function sanitizeErrorContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {};

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined) continue;
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;

    const sanitized = sanitizeContextValue(key, value);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
}

function sanitizeContextValue(
  key: string,
  value: unknown,
):
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return allowedString(key, value) ? value : "<omitted: invalid>";
  }
  if (Array.isArray(value)) {
    if (value.length > 16) return "<omitted: too_many_values>";
    const result: Array<string | number | boolean | null> = [];
    for (const item of value) {
      if (item === null) {
        result.push(null);
        continue;
      }
      const sanitized = sanitizeContextValue(key, item);
      if (
        typeof sanitized === "string" ||
        typeof sanitized === "number" ||
        typeof sanitized === "boolean"
      ) {
        result.push(sanitized);
      }
    }
    return result;
  }
  return "<omitted: invalid>";
}

function allowedString(key: string, value: string): boolean {
  if (!value || value.length > 128) return false;
  if (
    key === "story_id" ||
    key === "chapter_id" ||
    key === "operation_id"
  ) {
    return UUID_RE.test(value);
  }
  if (key === "request_id" || key === "job_id") {
    return value.length <= 128 && SLUG_RE.test(value);
  }
  return SLUG_RE.test(value);
}

function releaseRef(): string | null {
  return Deno.env.get("KATHA_RELEASE_REF") ??
    Deno.env.get("SUPABASE_FUNCTION_VERSION") ??
    null;
}

function environment(): string {
  const value = Deno.env.get("KATHA_ENVIRONMENT");
  return value === "staging" || value === "local" ? value : "production";
}

export async function logError(input: LogErrorInput): Promise<boolean> {
  return await withTimeout(
    LOG_TIMEOUT_MS,
    (signal) => insertErrorEvent(input, signal),
  );
}

async function insertErrorEvent(
  input: LogErrorInput,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("[errors] cannot log: service credentials unavailable");
      return false;
    }

    const serviceClient = createClient(url, serviceKey);
    const { error } = await serviceClient.from("error_events").insert({
      bucket: input.bucket,
      severity: input.severity ?? "medium",
      source: input.source ?? "runtime",
      error_code: input.errorCode ?? null,
      message: safeErrorMessage(input.error, input.errorCode),
      context: sanitizeErrorContext(input.context),
      user_id: input.userId ?? null,
      environment: environment(),
      release_ref: releaseRef(),
      occurred_at: new Date().toISOString(),
    }).abortSignal(signal);

    if (error) {
      console.error("[errors] insert failed:", error.message);
      return false;
    }
    return true;
  } catch (loggingFailure) {
    console.error("[errors] logging threw:", errorMessage(loggingFailure));
    return false;
  }
}

async function withTimeout<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T | false> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<false>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(false), {
          once: true,
        });
      }),
    ]);
  } catch (error) {
    console.error("[errors] timed logging failed:", safeErrorMessage(error));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function safeErrorMessage(error: unknown, errorCode?: string): string {
  if (errorCode) return errorCode.slice(0, 96);
  if (error instanceof Error) return error.name.slice(0, 96) || "Error";
  const kind = typeof error;
  return kind === "string" ? "string_error" : `${kind}_error`;
}

export function withErrorLogging<T>(
  bucket: ErrorBucket,
  handler: () => Promise<T>,
  options: { severity?: ErrorSeverity; context?: Record<string, unknown> } = {},
): Promise<T> {
  return handler().catch(async (error: unknown) => {
    await logError({
      bucket,
      severity: options.severity ?? "high",
      source: "runtime",
      errorCode: "unhandled",
      error,
      context: options.context,
    });
    throw error;
  });
}
