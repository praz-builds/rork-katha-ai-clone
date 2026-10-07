/**
 * The app-version switch: whether the installed build must update, may update,
 * or is fine (2026-10-07).
 *
 * THREE THINGS, KEPT APART:
 *   - **Store automatic updates** are the stores' job. The app never downloads
 *     or installs a binary; when a phone's store settings allow it, Play and
 *     the App Store update the app themselves.
 *   - **A recommended update** (`latest_version`) is a dismissable prompt with
 *     a link to the store listing.
 *   - **A forced update** (`minimum_supported_version`) is a blocking screen
 *     with no way past it but the store.
 * (OTA JavaScript updates are a fourth, separate thing: `expo-updates`, which
 * replaces the JS inside the same build. This file never decides those.)
 *
 * WHERE THE NUMBERS LIVE. `public.app_config` (migration 00103), one row per
 * platform, readable with the anon key. Raising `minimum_supported_version`
 * there forces every older build to update at its next launch, with no deploy
 * and no store review.
 *
 * NEVER IN THE WAY. The check has a short timeout. Offline or on any error the
 * app runs normally, UNLESS the last config this device successfully read
 * already said this build is below the minimum: a forced update cannot be
 * bypassed by turning the network off.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppVersionConfig = {
  minimumSupportedVersion: string;
  latestVersion: string;
  storeUrl: string;
};

export type UpdateStatus = "required" | "recommended" | "ok";

/** Numeric segments of "1.10.0"; anything non-numeric stops the parse. */
function segments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((value, index, all) =>
      all.slice(0, index + 1).every((piece) => Number.isFinite(piece))
    );
}

/**
 * -1, 0 or 1. Segment by segment, numerically, so "1.10.0" > "1.9.0" (a string
 * compare says the opposite). Missing segments count as 0: "1.2" == "1.2.0".
 */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Whether the installed build must update, may, or is fine. */
export function evaluateUpdate(
  config: AppVersionConfig | null,
  installed: string | null,
): UpdateStatus {
  if (!config || !installed || !segments(installed).length) return "ok";
  if (compareVersions(installed, config.minimumSupportedVersion) < 0) return "required";
  if (compareVersions(installed, config.latestVersion) < 0) return "recommended";
  return "ok";
}

/** The row as PostgREST returns it, checked before it is trusted. */
export function parseAppConfigRow(row: unknown): AppVersionConfig | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const min = record.minimum_supported_version;
  const latest = record.latest_version;
  const url = record.store_url;
  if (typeof min !== "string" || typeof latest !== "string" || typeof url !== "string") {
    return null;
  }
  if (!segments(min).length || !segments(latest).length) return null;
  return { minimumSupportedVersion: min, latestVersion: latest, storeUrl: url };
}

const CACHE_KEY = "katha.app-version-config.v1";
const DISMISSED_KEY = "katha.app-version-dismissed.v1";
export const CONFIG_TIMEOUT_MS = 4000;

export type ConfigFetcher = (platform: string) => Promise<unknown>;

/**
 * The config to decide with: fresh when the fetch answers in time (and then
 * cached), otherwise the last cached one. Never throws, never hangs past the
 * timeout.
 */
export async function loadAppVersionConfig(
  platform: string,
  fetchRow: ConfigFetcher,
  timeoutMs: number = CONFIG_TIMEOUT_MS,
): Promise<{ config: AppVersionConfig | null; fresh: boolean }> {
  try {
    const row = await Promise.race([
      fetchRow(platform),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("app config timed out")), timeoutMs)
      ),
    ]);
    const config = parseAppConfigRow(row);
    if (config) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(config)).catch(() => undefined);
      return { config, fresh: true };
    }
  } catch {
    // Offline, timed out, or the table is unreachable: fall back below.
  }
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    const parsed = cached ? (JSON.parse(cached) as Record<string, unknown>) : null;
    const config = parsed
      ? parseAppConfigRow({
        minimum_supported_version: parsed.minimumSupportedVersion,
        latest_version: parsed.latestVersion,
        store_url: parsed.storeUrl,
      })
      : null;
    return { config, fresh: false };
  } catch {
    return { config: null, fresh: false };
  }
}

/**
 * The status to act on. A stale (cached) config may only BLOCK, never prompt:
 * offline, the app keeps working unless the device already knows this build is
 * below the minimum.
 */
export function statusFrom(
  loaded: { config: AppVersionConfig | null; fresh: boolean },
  installed: string | null,
): UpdateStatus {
  const status = evaluateUpdate(loaded.config, installed);
  if (!loaded.fresh && status === "recommended") return "ok";
  return status;
}

/** The latest version whose prompt was dismissed, so it is not shown twice. */
export async function dismissedLatest(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export async function rememberDismissed(latest: string): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, latest).catch(() => undefined);
}

/** Play's own app link, tried when the https listing cannot be opened. */
export function marketUrl(storeUrl: string): string | null {
  const id = /[?&]id=([\w.]+)/.exec(storeUrl)?.[1];
  return id ? `market://details?id=${id}` : null;
}
