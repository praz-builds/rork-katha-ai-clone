/**
 * The update gate: a blocking "Update required" screen, or a dismissable
 * "New version available" prompt, from the remote switch in `app_config`
 * (`src/lib/app-version.ts`, migration 00103).
 *
 * Rendered once, last, at the app's root (`App.tsx`), over everything: the
 * blocking screen sits above onboarding and the tabs alike, and swallows the
 * Android Back button, so there is no way past it but the store. It checks at
 * launch and again whenever the app returns to the foreground.
 *
 * It never shows a spinner and never delays the app: until the check answers,
 * nothing is drawn, and a check that cannot answer leaves the app running
 * (unless this device already knows the build is below the minimum).
 *
 * Skipped on web and in development, which have no store build to compare.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AppState,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Application from "expo-application";

import { Button } from "@/components/Button";
import {
  type AppVersionConfig,
  dismissedLatest,
  loadAppVersionConfig,
  marketUrl,
  rememberDismissed,
  statusFrom,
  type UpdateStatus,
} from "@/lib/app-version";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radius, spacing } from "@/theme";

const STORE_FAILED =
  "Couldn't open the store. Open Google Play and search for Katha to update.";

async function fetchConfigRow(platform: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("app_config")
    .select("minimum_supported_version, latest_version, store_url")
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Open the listing; fall back to Play's app link; report when neither opens. */
export async function openStore(storeUrl: string): Promise<boolean> {
  try {
    await Linking.openURL(storeUrl);
    return true;
  } catch {
    const market = marketUrl(storeUrl);
    if (!market) return false;
    try {
      await Linking.openURL(market);
      return true;
    } catch {
      return false;
    }
  }
}

export type UpdateGateProps = {
  /** Injected in tests; the store build's own version by default. */
  installedVersion?: string | null;
  /** Injected in tests; `app_config` through Supabase by default. */
  fetchRow?: (platform: string) => Promise<unknown>;
  /** Injected in tests; skips web and development builds by default. */
  enabled?: boolean;
};

export function UpdateGate({
  installedVersion = Application.nativeApplicationVersion,
  fetchRow = fetchConfigRow,
  enabled = !__DEV__ && (Platform.OS === "android" || Platform.OS === "ios"),
}: UpdateGateProps) {
  const [status, setStatus] = useState<UpdateStatus>("ok");
  const [config, setConfig] = useState<AppVersionConfig | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [storeError, setStoreError] = useState(false);

  const check = useCallback(async () => {
    const loaded = await loadAppVersionConfig(Platform.OS, fetchRow);
    const next = statusFrom(loaded, installedVersion ?? null);
    const seen = await dismissedLatest();
    setConfig(loaded.config);
    setDismissed(seen);
    setStatus(next);
  }, [fetchRow, installedVersion]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [check, enabled]);

  // The blocking screen has no way out: Android Back is consumed while it shows.
  useEffect(() => {
    if (status !== "required") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [status]);

  const update = useCallback(async () => {
    if (!config) return;
    setStoreError(!(await openStore(config.storeUrl)));
  }, [config]);

  if (!enabled || !config) return null;

  if (status === "required") {
    return (
      <View style={styles.blocking} testID="update-required" accessibilityViewIsModal>
        <View style={styles.blockingBody}>
          <Text style={styles.title} accessibilityRole="header">
            Update required
          </Text>
          <Text style={styles.body}>
            This version of Katha is no longer supported. Update to keep reading
            and writing. Your stories and credits are safe and waiting for you.
          </Text>
          {storeError ? <Text style={styles.error}>{STORE_FAILED}</Text> : null}
        </View>
        <Button label="Update Now" onPress={() => void update()} testID="update-now" />
      </View>
    );
  }

  if (status === "recommended" && dismissed !== config.latestVersion) {
    const dismiss = () => {
      setDismissed(config.latestVersion);
      void rememberDismissed(config.latestVersion);
    };
    return (
      <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
        <View style={styles.scrim}>
          <View style={styles.sheet} testID="update-recommended">
            <Text style={styles.sheetTitle} accessibilityRole="header">
              New version available
            </Text>
            <Text style={styles.body}>
              A newer version of Katha is ready in the store.
            </Text>
            {storeError ? <Text style={styles.error}>{STORE_FAILED}</Text> : null}
            <Button label="Update" onPress={() => void update()} testID="update-recommended-cta" />
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              hitSlop={12}
              style={styles.notNow}
            >
              <Text style={styles.notNowText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  blocking: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.onboardingBg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.huge * 2,
    paddingBottom: spacing.huge,
    justifyContent: "space-between",
  },
  blockingBody: { gap: spacing.md },
  title: {
    fontFamily: fonts.display,
    fontWeight: "700",
    fontSize: 28,
    lineHeight: 32,
    color: colors.ink,
  },
  body: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, color: colors.muted },
  error: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: colors.ink },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontWeight: "700",
    fontSize: 22,
    color: colors.ink,
  },
  notNow: { alignSelf: "center", paddingVertical: spacing.sm },
  notNowText: { fontFamily: fonts.ui, fontSize: 15, color: colors.muted },
});
