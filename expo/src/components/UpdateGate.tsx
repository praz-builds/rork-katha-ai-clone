/**
 * The update gate: a blocking "Update required" screen, or a dismissable
 * "New version available" prompt, from the remote switch in `app_config`
 * (`src/lib/app-version.ts`, migration 00103).
 *
 * Rendered once, last, at the app's root (`App.tsx`). The blocking screen is a
 * full-screen `Modal`, not a view: on Android a `Modal` is its own window, so
 * a plain view (however high its zIndex) would sit UNDER any sheet a screen
 * had open, and the user could keep using an unsupported build behind it.
 * Presented last, the gate's Modal stacks above those, and its
 * `onRequestClose` swallows Back, so there is no way past it but the store.
 * It checks at launch and again whenever the app returns to the foreground.
 *
 * The OPTIONAL prompt waits for `promptAllowed` (the app passes "the user is in
 * the tabs"), so a first launch never opens on an update nag over onboarding
 * or a paywall. The forced screen ignores it: a build below the minimum is
 * blocked wherever it is.
 *
 * It never shows a spinner and never delays the app: until the check answers,
 * nothing is drawn, and a check that cannot answer leaves the app running
 * (unless this device already knows the build is below the minimum).
 *
 * Android only for now: there is no iOS build or `app_config` row yet, and the
 * store-link fallback below is Play's. Off on web and in development.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { colors, radius, spacing, type } from "@/theme";

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
  /** Injected in tests; Android store builds only by default. */
  enabled?: boolean;
  /** Whether the optional prompt may show now (the app passes "in the tabs"). */
  promptAllowed?: boolean;
};

export function UpdateGate({
  installedVersion = Application.nativeApplicationVersion,
  fetchRow = fetchConfigRow,
  enabled = !__DEV__ && Platform.OS === "android",
  promptAllowed = true,
}: UpdateGateProps) {
  const [status, setStatus] = useState<UpdateStatus>("ok");
  const [config, setConfig] = useState<AppVersionConfig | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [storeError, setStoreError] = useState(false);

  // Launch and foreground can both start a check. Only the newest may write
  // state, so a slow, older answer can never undo a newer one.
  const latestCheck = useRef(0);

  const check = useCallback(async () => {
    const ticket = ++latestCheck.current;
    const loaded = await loadAppVersionConfig(Platform.OS, fetchRow);
    const next = statusFrom(loaded, installedVersion ?? null);
    const seen = await dismissedLatest();
    if (ticket !== latestCheck.current) return;
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

  const update = useCallback(async () => {
    if (!config) return;
    setStoreError(!(await openStore(config.storeUrl)));
  }, [config]);

  if (!enabled || !config) return null;

  if (status === "required") {
    return (
      <Modal
        visible
        testID="update-required-modal"
        animationType="none"
        statusBarTranslucent
        // Back does nothing: the only way past this screen is the store.
        onRequestClose={() => undefined}
      >
        <View style={styles.blocking} testID="update-required" accessibilityViewIsModal>
          {/* Scrolls at large text sizes so the button below can never be
              pushed off the screen that has no other exit. */}
          <ScrollView contentContainerStyle={styles.blockingBody}>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Update required
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={1.3}>
              This version of Katha is no longer supported. Update to keep reading
              and writing. Your stories and credits are safe and waiting for you.
            </Text>
            {storeError
              ? <Text style={styles.error} maxFontSizeMultiplier={1.3}>{STORE_FAILED}</Text>
              : null}
          </ScrollView>
          <Button label="Update Now" onPress={() => void update()} testID="update-now" />
        </View>
      </Modal>
    );
  }

  if (status === "recommended" && promptAllowed && dismissed !== config.latestVersion) {
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
    flex: 1,
    backgroundColor: colors.onboardingBg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.huge * 2,
    paddingBottom: spacing.huge,
  },
  blockingBody: { gap: spacing.md, paddingBottom: spacing.xl },
  title: { ...type.title, color: colors.ink },
  body: { ...type.body, lineHeight: 22, color: colors.muted },
  error: { ...type.bodySmall, color: colors.ink },
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
  sheetTitle: { ...type.headline, color: colors.ink },
  notNow: { alignSelf: "center", paddingVertical: spacing.sm },
  notNowText: { ...type.body, color: colors.muted },
});
