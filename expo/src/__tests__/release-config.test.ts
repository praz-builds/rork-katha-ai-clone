/**
 * What the first store binary bakes in, and cannot change by an update.
 *
 * The runtime version, the OTA channel, the Android permission list, the iOS
 * background-audio mode and the Sentry build wiring all live in the native
 * build. A slip in any of them is only fixable by a new store submission, so
 * they are pinned here rather than trusted to review.
 */
import appJson from "../../app.json";
import easJson from "../../eas.json";
import packageJson from "../../package.json";
import { resolveAppConfig, UPDATE_URL_PLACEHOLDER } from "../../app.config";
import type { ExpoConfig } from "expo/config";

const expo = appJson.expo as unknown as ExpoConfig;

describe("app.json", () => {
  it("ships as 1.0.0 with the runtime version following it", () => {
    expect(expo.version).toBe("1.0.0");
    expect(expo.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("blocks every Android permission the app does not use", () => {
    expect(expo.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        "android.permission.RECORD_AUDIO",
        "android.permission.CAMERA",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "com.google.android.gms.permission.AD_ID",
      ]),
    );
    // Notifications are the one runtime permission the app does ask for.
    expect(expo.android?.permissions).toContain("POST_NOTIFICATIONS");
    expect(expo.android?.blockedPermissions).not.toContain("android.permission.POST_NOTIFICATIONS");
  });

  it("lets iOS keep narration and music playing on lock", () => {
    expect(expo.ios?.infoPlist?.UIBackgroundModes).toContain("audio");
  });
});

describe("eas.json", () => {
  // EAS's default pnpm predates `patchedDependencies` in pnpm-workspace.yaml,
  // so a frozen install there fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
  // (first production build, 2026-10-01). Pinned to what CI and the lockfile
  // use.
  it.each(["development", "preview", "production"] as const)(
    "pins the %s build to the toolchain the lockfile was written with",
    (profile) => {
      expect(easJson.build[profile]).toMatchObject({
        node: "22.23.0",
        pnpm: "11.22.0",
      });
    }
  );

  it("gives every build profile the OTA channel it will listen on", () => {
    expect(easJson.build.production.channel).toBe("production");
    expect(easJson.build.preview.channel).toBe("preview");
    expect(easJson.build.development.channel).toBe("development");
  });

  // `.env` is gitignored, so an EAS cloud build never sees it. Without these
  // the anon key falls back to "" and the app silently runs offline, and
  // bookmarks and follows answer optimistically without ever being saved.
  it.each(["development", "preview", "production"] as const)(
    "gives the %s build the public Supabase config and real engagement",
    (profile) => {
      const env = easJson.build[profile].env as Record<string, string>;
      expect(env.EXPO_PUBLIC_SUPABASE_URL).toBe(
        "https://iafeuxgoiknncgyjmugd.supabase.co"
      );
      const segment = env.EXPO_PUBLIC_SUPABASE_ANON_KEY.split(".")[1];
      const payload = JSON.parse(
        atob(segment.replace(/-/g, "+").replace(/_/g, "/"))
      );
      expect(payload).toMatchObject({
        ref: "iafeuxgoiknncgyjmugd",
        role: "anon",
      });
      expect(env.EXPO_PUBLIC_ENABLE_ENGAGEMENT_ENDPOINTS).toBe("true");
    }
  );
});

describe("Firebase", () => {
  it("is not a dependency: it pulled in AD_ID and was never configured", () => {
    const deps = Object.keys(packageJson.dependencies);
    expect(deps.filter((name) => name.includes("firebase"))).toEqual([]);
  });
});

describe("app.config.ts", () => {
  const withProjectId = (projectId: string): ExpoConfig => ({
    ...expo,
    extra: { ...expo.extra, eas: { projectId } },
  });

  it("derives the update URL from the EAS project id once eas init has run", () => {
    const resolved = resolveAppConfig(withProjectId("abc-123"), {});
    expect(resolved.updates?.url).toBe("https://u.expo.dev/abc-123");
  });

  it("leaves the placeholder until there is a project id", () => {
    expect(resolveAppConfig(withProjectId(""), {}).updates?.url).toBe(
      UPDATE_URL_PLACEHOLDER
    );
  });

  it("is linked to the katha-ai EAS project (eas init, 2026-10-01)", () => {
    expect(expo.extra?.eas?.projectId).toBe(
      "22595b84-dff7-407a-b37a-66d409528369"
    );
    expect(expo.owner).toBe("traction-labs");
    expect(resolveAppConfig(expo, {}).updates?.url).toBe(
      "https://u.expo.dev/22595b84-dff7-407a-b37a-66d409528369"
    );
  });

  it("never overwrites a real update URL", () => {
    const config = {
      ...withProjectId("abc-123"),
      updates: { url: "https://u.expo.dev/other" },
    };
    expect(resolveAppConfig(config, {}).updates?.url).toBe("https://u.expo.dev/other");
  });

  it("wires Sentry's organization and project from the environment", () => {
    const resolved = resolveAppConfig(expo, {
      SENTRY_ORG: "katha-org",
      SENTRY_PROJECT: "katha-app",
      SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
      APP_ENV: "production",
    });
    expect(resolved.plugins).toContainEqual([
      "@sentry/react-native/expo",
      { organization: "katha-org", project: "katha-app" },
    ]);
    expect(resolved.extra?.sentryDsn).toBe("https://key@o1.ingest.sentry.io/2");
    expect(resolved.extra?.APP_ENV).toBe("production");
  });

  it("invents nothing when the environment is empty", () => {
    const resolved = resolveAppConfig(expo, {});
    expect(resolved.plugins).toContain("@sentry/react-native/expo");
    expect(resolved.extra?.sentryDsn).toBe("");
    expect(resolved.extra?.APP_ENV).toBeUndefined();
  });

  it("never writes the Sentry auth token into the app", () => {
    const resolved = resolveAppConfig(expo, { SENTRY_AUTH_TOKEN: "secret", SENTRY_ORG: "o" });
    expect(JSON.stringify(resolved)).not.toContain("secret");
  });
});
