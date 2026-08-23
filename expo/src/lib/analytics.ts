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

export function initSentry() {
  const dsn = extra.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    environment: (extra.APP_ENV as string) || 'development',
    enableAutoSessionTracking: true,
  });
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
