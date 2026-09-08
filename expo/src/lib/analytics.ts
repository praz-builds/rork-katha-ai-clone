import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

// ---------------------------------------------------------------------------
// PostHog — Katha AI project (EU Cloud, org separate from Story For My Kid)
// Public write-only key, safe for client-side use.
// ---------------------------------------------------------------------------

const POSTHOG_API_KEY = 'phc_onpzv6Zkxv7SATYPHRM2oWQ7JTPmpETXV9ZHNV4b8cpm';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

// ---------------------------------------------------------------------------
// Sentry
// ---------------------------------------------------------------------------

/**
 * Whether `initSentry()` actually configured the SDK. `expo/app.json`'s
 * `sentryDsn` is empty today, so this stays `false` in every current build --
 * `captureError` below reads it to stay a true no-op until that changes, the
 * same contract `_shared/sentry.ts` follows on the backend for `SENTRY_DSN`.
 */
let sentryReady = false;

export function initSentry() {
  const dsn = extra.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    environment: (extra.APP_ENV as string) || 'development',
    enableAutoSessionTracking: true,
  });
  sentryReady = true;
}

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CaptureErrorInput {
  /** The backend's `ErrorBucket` vocabulary, e.g. `"generation.audio"`. */
  bucket: string;
  severity?: ErrorSeverity;
  errorCode?: string;
  error: unknown;
  /**
   * Identifiers and enums only -- never story prose, a seed, a prompt, or
   * any other free user text. Values are capped defensively (see
   * `sanitizeClientContext`); the caller is still the one responsible for
   * never passing free text here in the first place.
   */
  context?: Record<string, string | number | boolean | null>;
}

const MAX_CONTEXT_VALUE_LENGTH = 128;

function sanitizeClientContext(
  context: CaptureErrorInput['context'],
): Record<string, string | number | boolean | null> {
  if (!context) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
      continue;
    }
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_CONTEXT_VALUE_LENGTH
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function severityLevel(severity: ErrorSeverity): Sentry.SeverityLevel {
  switch (severity) {
    case 'critical':
      return 'fatal';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'warning';
  }
}

/** A bounded, identifier-only message -- never the original error's own text. */
function safeMessage(error: unknown, errorCode?: string): string {
  if (errorCode) return errorCode.slice(0, 96);
  if (error instanceof Error) return error.name.slice(0, 96) || 'Error';
  return typeof error === 'string' ? 'string_error' : `${typeof error}_error`;
}

/**
 * Report a client error to Sentry. Identifiers and enums only in `context`
 * -- never the story's own text, matching the rule the backend's telemetry
 * context already follows. A no-op when Sentry was never initialised (the
 * DSN gap noted in `AGENTS.md`'s Observability Gate), and never throws:
 * reporting an error must never itself become one.
 */
export function captureError(input: CaptureErrorInput): void {
  if (!sentryReady) return;
  try {
    const severity = input.severity ?? 'medium';
    Sentry.captureMessage(safeMessage(input.error, input.errorCode), {
      level: severityLevel(severity),
      tags: {
        bucket: input.bucket,
        severity,
        ...(input.errorCode ? { error_code: input.errorCode } : {}),
      },
      extra: sanitizeClientContext(input.context),
    });
  } catch {
    // Reporting must never break the app it is reporting from.
  }
}

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

let posthog: PostHog | null = null;

export function initPostHog() {
  if (posthog) return;
  posthog = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
  });
}

export function trackEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
) {
  posthog?.capture(event, properties);
}

export function identifyUser(
  userId: string,
  traits?: Record<string, string | number | boolean | null>,
) {
  posthog?.identify(userId, traits);
  Sentry.setUser({ id: userId });
}

export function resetAnalytics() {
  posthog?.reset();
  Sentry.setUser(null);
}
