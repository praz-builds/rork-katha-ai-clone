import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

// Sentry
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

// PostHog
let posthog: PostHog | null = null;

export function initPostHog() {
  const apiKey = extra.posthogApiKey;
  const host = extra.posthogHost;
  if (!apiKey) return;
  posthog = new PostHog(apiKey, { host });
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
