/**
 * Sentry push notifications for the edge functions, layered on top of
 * `_shared/errors.ts` rather than replacing it.
 *
 * `error_events` (via `logError`) stays the system of record: durable,
 * queryable, and required by the Observability Gate in `AGENTS.md`. Sentry is
 * the push notification on top of that row. `reportError` below writes both,
 * independently -- a Sentry outage can never cost the durable row, and a
 * database outage can never cost the alert.
 *
 * ## The DSN gap
 *
 * `SENTRY_DSN` is not set in Supabase secrets today. Every function on this
 * path must behave *exactly* as it does now until it is: `captureError` reads
 * the env var itself, and an absent value is a hard no-op. The SDK import
 * below is dynamic rather than static for exactly this reason -- a function
 * that never sees a DSN must not pay for fetching or evaluating the Sentry
 * module graph on cold start either, so nothing changes about today's
 * production behaviour or performance until the secret is set.
 * `AGENTS.md`'s Observability Gate section names the two values
 * (`SENTRY_DSN` here, `sentryDsn` in `expo/app.json`) that both have to be
 * set before any of this reaches Sentry.
 *
 * ## PII
 *
 * Sentry's payload follows the same rule telemetry context already follows:
 * identifiers and enums only, never story prose, seeds, prompts, titles, or
 * any other free user text. `captureMessage` is used instead of
 * `captureException` so the reported message is always the same bounded,
 * allowlisted string `safeErrorMessage` already computes for `error_events`
 * -- never an original error's own `message`, which callers across this
 * codebase build by interpolating provider payloads and is not vetted for
 * this. `extra` reuses `sanitizeErrorContext`'s allowlist verbatim, and
 * `defaultIntegrations: false` plus `sendDefaultPii: false` turn off
 * breadcrumbs, console capture, and request/IP capture, so nothing outside
 * what this module explicitly sends is ever attached to an event.
 *
 * ## Never blocks, never throws
 *
 * `captureError` and `reportError` follow `logError`'s contract precisely:
 * they never throw, and they are bounded by an internal timeout so a slow or
 * dead Sentry ingest endpoint cannot hang the caller. In practice the Sentry
 * SDK already swallows its own transport failures (a dead DSN host does not
 * reject `flush()`), but the timeout and try/catch here do not depend on
 * that -- they hold even if a future SDK version changes it.
 */
import {
  type ErrorSeverity,
  logError,
  type LogErrorInput,
  safeErrorMessage,
  sanitizeErrorContext,
} from "./errors.ts";

// `FLUSH_TIMEOUT_MS` bounds Sentry's own internal delivery attempt.
// `CAPTURE_TIMEOUT_MS` is the outer safety net around the whole call
// (dynamic import, init, and the flush above) and is deliberately larger,
// not equal -- two independent timers racing at the same duration is a coin
// flip under load, not a bound, and a flush finishing at 1,499ms of its own
// 1,500ms budget must not lose a race against an outer clock that started at
// the same moment.
const FLUSH_TIMEOUT_MS = 1_500;
const CAPTURE_TIMEOUT_MS = 3_000;
const SENTRY_MODULE_URL = "https://esm.sh/@sentry/deno@10.73.0";

type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

function sentryLevel(severity: ErrorSeverity): SentryLevel {
  switch (severity) {
    case "critical":
      return "fatal";
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "info";
    default:
      return "warning";
  }
}

/**
 * The narrow slice of `@sentry/deno`'s surface this module actually calls.
 *
 * A dynamic `import()` of a bare URL resolves to `Promise<any>` as far as
 * TypeScript is concerned -- there is no module specifier for it to attach a
 * declaration file to. Declaring exactly the calls made below (rather than
 * reaching for `any`, which this codebase disallows) keeps every call site
 * type-checked against a real, if partial, contract instead of an escape
 * hatch.
 */
interface SentryInitOptions {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate: number;
  defaultIntegrations: boolean;
  sendDefaultPii: boolean;
}

interface SentryCaptureMessageOptions {
  level: SentryLevel;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  user?: { id: string };
}

interface SentryModule {
  init(options: SentryInitOptions): void;
  captureMessage(
    message: string,
    options: SentryCaptureMessageOptions,
  ): string;
  flush(timeoutMs?: number): Promise<boolean>;
}

let sentryModulePromise: Promise<SentryModule> | null = null;
let initializedForDsn: string | null = null;

function loadSentry(): Promise<SentryModule> {
  if (!sentryModulePromise) {
    sentryModulePromise = import(SENTRY_MODULE_URL) as Promise<SentryModule>;
  }
  return sentryModulePromise;
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

async function ensureInitialized(dsn: string): Promise<SentryModule> {
  const Sentry = await loadSentry();
  if (initializedForDsn !== dsn) {
    Sentry.init({
      dsn,
      environment: environment(),
      release: releaseRef() ?? undefined,
      // No performance tracing, no auto-capture: every field this module
      // sends is built by hand above, nothing is attached implicitly.
      tracesSampleRate: 0,
      defaultIntegrations: false,
      sendDefaultPii: false,
    });
    initializedForDsn = dsn;
  }
  return Sentry;
}

/**
 * Reset the module's "already initialized" memory. Test-only: production
 * never needs to re-point the SDK at a different DSN mid-process.
 */
export function resetSentryForTests(): void {
  initializedForDsn = null;
}

/**
 * Send one event to Sentry. Resolves `false` without throwing when
 * `SENTRY_DSN` is unset (the default today) or when reporting otherwise
 * fails; resolves `true` once the event has been handed to Sentry's
 * transport. Bounded by `CAPTURE_TIMEOUT_MS` so a stalled ingest endpoint
 * cannot hang the caller.
 */
export async function captureError(input: LogErrorInput): Promise<boolean> {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return false;

  return await withTimeout(CAPTURE_TIMEOUT_MS, async () => {
    const Sentry = await ensureInitialized(dsn);
    const severity: ErrorSeverity = input.severity ?? "medium";
    const message = safeErrorMessage(input.error, input.errorCode);

    Sentry.captureMessage(message, {
      level: sentryLevel(severity),
      tags: {
        bucket: input.bucket,
        severity,
        source: input.source ?? "runtime",
        ...(input.errorCode ? { error_code: input.errorCode } : {}),
      },
      extra: sanitizeErrorContext(input.context),
      user: input.userId ? { id: input.userId } : undefined,
    });
    await Sentry.flush(FLUSH_TIMEOUT_MS);
    return true;
  });
}

/**
 * Write the durable `error_events` row (via `logError`, unmodified) and,
 * independently, push a Sentry event for the same failure. Neither call can
 * make the other fail: `logError` runs first so the durable row exists even
 * if Sentry's SDK throws synchronously, and any such throw is swallowed here
 * rather than propagated.
 */
export async function reportError(input: LogErrorInput): Promise<void> {
  await logError(input);
  try {
    await captureError(input);
  } catch (sentryFailure) {
    console.error(
      "[sentry] capture threw:",
      sentryFailure instanceof Error
        ? sentryFailure.message
        : String(sentryFailure),
    );
  }
}

async function withTimeout<T>(
  ms: number,
  operation: () => Promise<T>,
): Promise<T | false> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      operation(),
      new Promise<false>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(false), {
          once: true,
        });
      }),
    ]);
  } catch (error) {
    console.error(
      "[sentry] capture failed:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
