/**
 * iOS App Tracking Transparency (ATT) wrapper.
 *
 * Apple requires apps to request permission via the ATT framework before
 * accessing the IDFA (Identifier for Advertisers). Without IDFA consent,
 * Google Ads cannot attribute installs back to specific ad clicks on iOS 14.5+.
 *
 * This module uses `expo-tracking-transparency` which provides an Expo-managed
 * wrapper around ATAppTrackingManager. The import is dynamic so the app works
 * on Android, web, and in Expo Go where the native module may be absent.
 *
 * Usage:
 *   import { requestTrackingPermission } from "@/lib/tracking-transparency";
 *
 *   // Call once early in the app lifecycle (e.g. after onboarding splash)
 *   const granted = await requestTrackingPermission();
 *   if (granted) {
 *     // IDFA available -- Firebase Analytics + Google Ads attribution works
 *   }
 *
 * The ATT prompt string is configured in app.json under:
 *   expo.plugins: [
 *     ["expo-tracking-transparency", {
 *       "userTrackingPermission":
 *         "This identifier will be used to deliver personalized ads to you."
 *     }]
 *   ]
 */

import { Platform } from "react-native";

export type TrackingStatus = "granted" | "denied" | "undetermined" | "unavailable";

/**
 * Request iOS App Tracking Transparency permission.
 *
 * @returns `true` if tracking is allowed (granted on iOS, always true on
 *          Android, false on web or if the native module is missing).
 */
export async function requestTrackingPermission(): Promise<boolean> {
  if (Platform.OS !== "ios") {
    // Android and web do not require ATT consent.
    return true;
  }

  try {
    const { requestTrackingPermissionsAsync } = await import(
      "expo-tracking-transparency"
    );
    const { status } = await requestTrackingPermissionsAsync();
    return status === "granted";
  } catch {
    // Module not available (Expo Go, web, or missing native build).
    return false;
  }
}

/**
 * Check current tracking permission status without prompting the user.
 *
 * Useful for conditional UI (e.g. showing an education screen before the
 * system prompt) or for gating analytics collection.
 */
export async function getTrackingStatus(): Promise<TrackingStatus> {
  if (Platform.OS !== "ios") {
    return "granted";
  }

  try {
    const { getTrackingPermissionsAsync } = await import(
      "expo-tracking-transparency"
    );
    const { status } = await getTrackingPermissionsAsync();
    if (status === "granted") return "granted";
    if (status === "denied") return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}
