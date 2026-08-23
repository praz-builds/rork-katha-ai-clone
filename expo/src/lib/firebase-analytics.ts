/**
 * Firebase Analytics wrapper for Google Analytics + Google Ads conversion tracking.
 *
 * All Firebase imports are loaded dynamically so the app compiles and runs in
 * Expo Go, on web, and in any environment where native Firebase modules are
 * unavailable. In EAS production builds with the Firebase native SDK linked,
 * events flow to GA4 automatically and can be imported into Google Ads as
 * conversion actions.
 *
 * Setup checklist (for EAS builds):
 * 1. Place google-services.json (Android) in expo/android/app/
 * 2. Place GoogleService-Info.plist (iOS) in expo/ios/
 * 3. Add @react-native-firebase/app and @react-native-firebase/analytics
 *    Expo config plugins in app.json or app.config.ts
 * 4. Link GA4 property to Google Ads for conversion import
 */

// ---------------------------------------------------------------------------
// Lazy singleton -- resolved once per app lifecycle, cached thereafter.
//
// The v26 @react-native-firebase/analytics uses a modular API:
//   import { getAnalytics, logEvent } from "@react-native-firebase/analytics";
//   const analytics = getAnalytics();
//   logEvent(analytics, "event_name", { key: "value" });
//
// We wrap the dynamic import + instance creation behind a single helper so
// every public function only needs `const ctx = await resolve();`.
// ---------------------------------------------------------------------------

interface FirebaseAnalyticsContext {
  instance: unknown; // Analytics opaque handle
  logEventFn: (
    analytics: unknown,
    name: string,
    params?: Record<string, unknown>,
  ) => void;
  logScreenViewFn: (
    analytics: unknown,
    params: { screen_name: string; screen_class: string },
  ) => Promise<void>;
  setUserIdFn: (analytics: unknown, id: string | null) => Promise<void>;
  setUserPropertyFn: (
    analytics: unknown,
    name: string,
    value: string | null,
  ) => Promise<void>;
  setCollectionEnabledFn: (
    analytics: unknown,
    enabled: boolean,
  ) => Promise<void>;
}

let _ctx: FirebaseAnalyticsContext | null = null;
let _resolved = false;

async function resolve(): Promise<FirebaseAnalyticsContext | null> {
  if (_resolved) return _ctx;
  _resolved = true;

  try {
    // Dynamic import -- only evaluates when native Firebase modules exist.
    const mod = await import("@react-native-firebase/analytics");

    const instance = mod.getAnalytics();

    _ctx = {
      instance,
      logEventFn: mod.logEvent as FirebaseAnalyticsContext["logEventFn"],
      logScreenViewFn:
        mod.logScreenView as FirebaseAnalyticsContext["logScreenViewFn"],
      setUserIdFn: mod.setUserId as FirebaseAnalyticsContext["setUserIdFn"],
      setUserPropertyFn:
        mod.setUserProperty as FirebaseAnalyticsContext["setUserPropertyFn"],
      setCollectionEnabledFn:
        mod.setAnalyticsCollectionEnabled as FirebaseAnalyticsContext["setCollectionEnabledFn"],
    };
    return _ctx;
  } catch {
    // Native module unavailable (Expo Go, web, missing config).
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Log a screen view to Firebase Analytics / GA4.
 */
export async function logScreenView(screenName: string): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  try {
    await ctx.logScreenViewFn(ctx.instance, {
      screen_name: screenName,
      screen_class: screenName,
    });
  } catch {
    // Silently swallow -- analytics must never crash the app.
  }
}

/**
 * Log a custom event to Firebase Analytics / GA4.
 *
 * Event names should use snake_case, max 40 characters. Parameter keys max 40
 * characters, values max 100 characters (strings) or any number.
 */
export async function logEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  try {
    ctx.logEventFn(ctx.instance, name, params);
  } catch {
    // Silently swallow.
  }
}

/**
 * Associate future events with a user ID for cross-device analytics.
 * Pass `null` on sign-out to clear.
 */
export async function setUserId(id: string | null): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  try {
    await ctx.setUserIdFn(ctx.instance, id);
  } catch {
    // Silently swallow.
  }
}

/**
 * Set a user property for audience segmentation in GA4.
 */
export async function setUserProperty(
  name: string,
  value: string | null,
): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  try {
    await ctx.setUserPropertyFn(ctx.instance, name, value);
  } catch {
    // Silently swallow.
  }
}

/**
 * Enable or disable analytics collection (e.g. after ATT consent).
 */
export async function setAnalyticsCollectionEnabled(
  enabled: boolean,
): Promise<void> {
  const ctx = await resolve();
  if (!ctx) return;
  try {
    await ctx.setCollectionEnabledFn(ctx.instance, enabled);
  } catch {
    // Silently swallow.
  }
}

// ---------------------------------------------------------------------------
// Pre-defined events -- typed helpers for every key conversion point.
//
// Naming follows GA4 recommended-event conventions where applicable and uses
// custom names for Katha-specific actions. Google Ads conversion import picks
// up events by name from the linked GA4 property.
// ---------------------------------------------------------------------------

export const AppEvents = {
  // -- Onboarding ----------------------------------------------------------
  onboardingStarted: () => logEvent("onboarding_started"),
  onboardingCompleted: (purpose: string) =>
    logEvent("onboarding_completed", { purpose }),

  // -- Story creation ------------------------------------------------------
  storyGenerated: (genre: string, language: string) =>
    logEvent("story_generated", { genre, language }),
  storyPublished: (storyId: string) =>
    logEvent("story_published", { story_id: storyId }),
  storyRead: (storyId: string, durationSeconds: number) =>
    logEvent("story_read", {
      story_id: storyId,
      duration_seconds: durationSeconds,
    }),

  // -- Monetization (Google Ads conversion events) -------------------------
  // Use the GA4 recommended `purchase` event so Google Ads can auto-import it
  // as a conversion. The `value` + `currency` fields enable ROAS bidding.
  trialStarted: (plan: string) => logEvent("trial_started", { plan }),
  subscriptionPurchased: (plan: string, price: number) =>
    logEvent("subscription_purchased", {
      plan,
      value: price,
      currency: "USD",
    }),
  creditsPurchased: (pack: string, price: number) =>
    logEvent("credits_purchased", {
      pack,
      value: price,
      currency: "USD",
    }),

  // -- Engagement ----------------------------------------------------------
  audioPlayed: (storyId: string) =>
    logEvent("audio_played", { story_id: storyId }),
  storyLiked: (storyId: string) =>
    logEvent("story_liked", { story_id: storyId }),
  storyBookmarked: (storyId: string) =>
    logEvent("story_bookmarked", { story_id: storyId }),
  authorFollowed: (authorId: string) =>
    logEvent("author_followed", { author_id: authorId }),

  // -- Acquisition attribution ---------------------------------------------
  adImpression: () => logEvent("ad_impression"),
} as const;
