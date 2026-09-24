/**
 * The build-time half of the app config.
 *
 * `app.json` stays the static record -- and stays the file `eas init` writes
 * to: Expo's config writer edits `app.json` when a function-style
 * `app.config.ts` spreads it, then re-reads this file to check the edit came
 * through. So everything here takes what `app.json` says and only fills in
 * what can only be known at build time:
 *
 * - `updates.url` follows the EAS project id. `app.json` carries the
 *   placeholder `https://u.expo.dev/UPDATE_PROJECT_ID`; once `eas init` has
 *   written `extra.eas.projectId`, the URL is derived from it, so there is one
 *   value to fill, not two that can disagree. A real URL in `app.json` (for
 *   instance from `eas update:configure`) is left alone.
 * - The Sentry plugin's `organization` / `project` come from `SENTRY_ORG` /
 *   `SENTRY_PROJECT`, and the DSN from `SENTRY_DSN`, so the founder sets EAS
 *   environment variables and nobody edits a file. Nothing is invented: an
 *   unset variable leaves the plugin exactly as `app.json` has it, and the
 *   Sentry build step falls back to the same environment variables itself.
 * - `extra.APP_ENV` carries the EAS profile's `APP_ENV`, which
 *   `src/lib/analytics.ts` reads as the Sentry environment. It was never set
 *   before, so every build would have reported as "development".
 *
 * The auth token is deliberately NOT read here: anything in the plugin config
 * is written into the app package. `SENTRY_AUTH_TOKEN` stays an EAS secret
 * that only the Sentry Gradle / Xcode step reads.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

export const UPDATE_URL_PLACEHOLDER = "https://u.expo.dev/UPDATE_PROJECT_ID";
const SENTRY_PLUGIN = "@sentry/react-native/expo";

type Env = Record<string, string | undefined>;
type PluginEntry = NonNullable<ExpoConfig["plugins"]>[number];

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function withSentryPlugin(plugins: PluginEntry[], env: Env): PluginEntry[] {
  const organization = present(env.SENTRY_ORG);
  const project = present(env.SENTRY_PROJECT);
  if (!organization && !project) return plugins;
  return plugins.map((entry) => {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (name !== SENTRY_PLUGIN) return entry;
    const existing =
      Array.isArray(entry) && entry[1] && typeof entry[1] === "object"
        ? (entry[1] as Record<string, unknown>)
        : {};
    return [
      SENTRY_PLUGIN,
      {
        ...existing,
        ...(organization ? { organization } : {}),
        ...(project ? { project } : {}),
      },
    ];
  });
}

export function resolveAppConfig(config: ExpoConfig, env: Env): ExpoConfig {
  const extra = config.extra ?? {};
  const projectId = present(extra.eas?.projectId);

  const updates = config.updates ? { ...config.updates } : undefined;
  if (updates && projectId && updates.url === UPDATE_URL_PLACEHOLDER) {
    updates.url = `https://u.expo.dev/${projectId}`;
  }

  const sentryDsn =
    present(env.SENTRY_DSN) ?? present(env.EXPO_PUBLIC_SENTRY_DSN) ?? extra.sentryDsn ?? "";
  const appEnv = present(env.APP_ENV) ?? extra.APP_ENV;

  return {
    ...config,
    ...(updates ? { updates } : {}),
    plugins: withSentryPlugin(config.plugins ?? [], env),
    extra: {
      ...extra,
      sentryDsn,
      ...(appEnv ? { APP_ENV: appEnv } : {}),
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  resolveAppConfig(config as ExpoConfig, process.env);
