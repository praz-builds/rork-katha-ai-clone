import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";

import {
  basePlanOption,
  findPackageInOfferings,
  KATHA_ENTITLEMENT,
  resolveRevenueCatKey,
  subscriptionPackages,
} from "./store-catalog";

// RevenueCat public SDK keys ship in the app binary and are not secrets.
//
// The release keys come from BUILD CONFIGURATION, never from an edit to this
// file: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (the `goog_` key) and
// `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (the `appl_` key), set as EAS environment
// variables for the production environment (`backend/PLAY_BILLING_SETUP.md`
// step 6). Expo inlines `EXPO_PUBLIC_*` at bundle time, so the value is baked
// into the build and into every `eas update` published with the same
// environment. With no key, or a key for the wrong store, purchases stay
// disabled and every paywall says so; nothing else changes.
const REVENUECAT_TEST_STORE_PUBLIC_KEY = "test_VzetjoZZQyauDNrUNmaZqGYkSXE";
const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "production");
const REVENUECAT_PUBLIC_KEY = resolveRevenueCatKey({
  platform: Platform.OS,
  appEnv: APP_ENV,
  androidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  iosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  testStoreKey: REVENUECAT_TEST_STORE_PUBLIC_KEY,
});

/**
 * Add a tier by adding exactly one entitlement-to-tier entry here.
 *
 * ONE TIER, THREE DURATIONS. There is no reader tier and no writer tier: the
 * split shipped in the old onboarding paywall and was removed by pricing on
 * 2026-09-10, so the product is one plan (`katha`) sold weekly, monthly or
 * yearly. Keeping two tiers here meant a "reader" could be premium for reading
 * and not for writing, which nothing in the app charges for any more.
 */
export const ENTITLEMENT_TIER_MAP = {
  [KATHA_ENTITLEMENT]: "katha",
  // Kept while the existing RevenueCat Test Store configuration is migrated.
  katha_ai_pro: "katha",
} as const;

export type KathaTier = (typeof ENTITLEMENT_TIER_MAP)[keyof typeof ENTITLEMENT_TIER_MAP];
export type RevenueCatProfile = CustomerInfo;
export type RevenueCatPaywallProduct = PurchasesPackage;

type ProfileListener = (profile: RevenueCatProfile | null) => void;

function isUserCancelled(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" &&
      "userCancelled" in error &&
      (error as { userCancelled?: unknown }).userCancelled,
  );
}

class RevenueCatService {
  private static _instance: RevenueCatService;
  private _profile: RevenueCatProfile | null = null;
  private _listeners: ProfileListener[] = [];
  private _ready = false;
  private readonly _customerInfoListener = (profile: CustomerInfo) => {
    this.setProfile(profile);
  };

  static get shared(): RevenueCatService {
    if (!RevenueCatService._instance) {
      RevenueCatService._instance = new RevenueCatService();
    }
    return RevenueCatService._instance;
  }

  /** Configure RevenueCat once at startup. Anonymous users receive an SDK ID. */
  async activate(appUserID?: string): Promise<void> {
    if (Platform.OS === "web") return;
    if (!REVENUECAT_PUBLIC_KEY) {
      // Fail loudly. A release build with no key silently has no billing at all,
      // which otherwise only surfaces as zero revenue days later.
      console.error(
        `RevenueCat has no public SDK key for APP_ENV="${APP_ENV}" on ${Platform.OS}. ` +
          "Purchases, restores, paywalls and Customer Center are all disabled. " +
          "Set EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (goog_) / EXPO_PUBLIC_REVENUECAT_IOS_KEY " +
          "(appl_) as EAS environment variables and rebuild (backend/PLAY_BILLING_SETUP.md).",
      );
      return;
    }

    if (this._ready) {
      if (appUserID) await this.identify(appUserID);
      return;
    }

    try {
      Purchases.configure({
        apiKey: REVENUECAT_PUBLIC_KEY,
        ...(appUserID ? { appUserID } : {}),
      });
      Purchases.addCustomerInfoUpdateListener(this._customerInfoListener);
      this._profile = await Purchases.getCustomerInfo();
      this._ready = true;
      this.notify();
    } catch (error) {
      console.warn("RevenueCat activation failed:", error);
    }
  }

  get tier(): KathaTier | null {
    const active = this._profile?.entitlements.active ?? {};
    for (const [entitlement, tier] of Object.entries(ENTITLEMENT_TIER_MAP)) {
      if (active[entitlement]?.isActive) return tier;
    }
    return null;
  }

  /** Whether the user has any active Katha subscription entitlement. */
  get isPremium(): boolean {
    return this.tier !== null;
  }

  /** Current CustomerInfo (may be null before activation). */
  get profile(): RevenueCatProfile | null {
    return this._profile;
  }

  /**
   * Whether the store can be talked to at all.
   *
   * False on web, and false in a native build whose SDK never configured (no
   * key, activation failed). The credits screen reads this to decide between
   * a live Purchase button and the disabled "Purchases work in the app" state
   * (D8), rather than discovering it on the tap.
   */
  get isAvailable(): boolean {
    return Platform.OS !== "web" && this._ready;
  }

  /** Subscribe to CustomerInfo changes. Returns an unsubscribe function. */
  subscribe(listener: ProfileListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((candidate) => candidate !== listener);
    };
  }

  async reloadProfile(): Promise<RevenueCatProfile | null> {
    if (Platform.OS === "web" || !this._ready) return this._profile;
    try {
      this.setProfile(await Purchases.getCustomerInfo());
    } catch (error) {
      console.warn("RevenueCat profile refresh failed:", error);
    }
    return this._profile;
  }

  async getOfferings(): Promise<PurchasesOfferings | null> {
    if (Platform.OS === "web" || !this._ready) return null;
    try {
      return await Purchases.getOfferings();
    } catch (error) {
      console.warn("RevenueCat getOfferings failed:", error);
      return null;
    }
  }

  /**
   * The package selling one store product, searched across EVERY offering.
   *
   * The credit packs (`ai.katha.credits.*`) are one-time products and need
   * not sit in the `current` subscription offering, so a lookup limited to
   * `current` would report every pack as unavailable on a correctly
   * configured dashboard. Null when the store has no such product, or when
   * the store cannot be asked at all.
   */
  async findPackageByProductId(productId: string): Promise<PurchasesPackage | null> {
    const offerings = await this.getOfferings();
    if (!offerings) return null;
    return findPackageInOfferings(offerings, productId);
  }

  /**
   * The subscription packages the paywall sells: the `default` offering when
   * the dashboard has one by that id, otherwise whichever offering is current.
   */
  async getPaywallProducts(_placementId?: string): Promise<RevenueCatPaywallProduct[] | null> {
    return subscriptionPackages(await this.getOfferings());
  }

  /**
   * Resolves with the profile after a completed purchase, `null` when the user
   * cancelled the store sheet. It used to resolve with the OLD profile on a
   * cancel, which made a cancel by an already-premium user indistinguishable
   * from a purchase: the paywall read `isPremium`, saw true, and granted a
   * plan nobody bought. Null is the only honest answer for "nothing happened".
   */
  async purchasePackage(
    pkg: PurchasesPackage,
    options: { basePlanOnly?: boolean } = {},
  ): Promise<RevenueCatProfile | null> {
    if (Platform.OS === "web" || !this._ready) return null;
    try {
      // `basePlanOnly`: buy the plan at the price the screen showed. Google
      // Play's default option is the longest free trial the user is eligible
      // for, so a plain `purchasePackage` on the yearly plan would start a
      // 3-day trial (10 credits) from a paywall that sells $59 and 50 credits
      // and never mentions a trial. Where no base-plan option is reported
      // (iOS, packs) the package is bought as it is.
      const basePlan = options.basePlanOnly ? basePlanOption(pkg) : null;
      const { customerInfo } = basePlan
        ? await Purchases.purchaseSubscriptionOption(basePlan)
        : await Purchases.purchasePackage(pkg);
      this.setProfile(customerInfo);
      return customerInfo;
    } catch (error) {
      if (isUserCancelled(error)) return null;
      console.warn("RevenueCat purchase failed:", error);
      throw error;
    }
  }

  /** Compatibility helper for callers that only have a store product identifier. */
  async purchase(productId: string): Promise<RevenueCatProfile | null> {
    const pkg = await this.findPackageByProductId(productId);
    if (!pkg) throw new Error(`RevenueCat product ${productId} is not in any offering`);
    return this.purchasePackage(pkg);
  }

  async restorePurchases(): Promise<RevenueCatProfile | null> {
    if (Platform.OS === "web" || !this._ready) return this._profile;
    try {
      const profile = await Purchases.restorePurchases();
      this.setProfile(profile);
      return profile;
    } catch (error) {
      if (isUserCancelled(error)) return this._profile;
      console.warn("RevenueCat restore failed:", error);
      throw error;
    }
  }

  async presentPaywall(): Promise<unknown> {
    if (Platform.OS === "web" || !this._ready) return null;
    try {
      return await RevenueCatUI.presentPaywall();
    } catch (error) {
      if (isUserCancelled(error)) return null;
      console.warn("RevenueCat paywall failed:", error);
      throw error;
    }
  }

  // `katha`, not `katha_writer`: the writer/reader entitlement split is gone
  // (see ENTITLEMENT_TIER_MAP). A stale default here would present the paywall
  // to a paying subscriber, because the entitlement it asked about no longer
  // exists on anyone's profile.
  async presentPaywallIfNeeded(entitlement = KATHA_ENTITLEMENT): Promise<unknown> {
    if (Platform.OS === "web" || !this._ready) return null;
    try {
      return await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: entitlement,
      });
    } catch (error) {
      if (isUserCancelled(error)) return null;
      console.warn("RevenueCat conditional paywall failed:", error);
      throw error;
    }
  }

  /**
   * Returns false when the Customer Center cannot be shown at all — web, or the
   * SDK never configured (no key, activation failed). Callers must handle that,
   * otherwise the entry point silently does nothing and reads as a dead control.
   */
  async presentCustomerCenter(): Promise<boolean> {
    if (Platform.OS === "web" || !this._ready) return false;
    try {
      await RevenueCatUI.presentCustomerCenter();
      return true;
    } catch (error) {
      if (isUserCancelled(error)) return true;
      console.warn("RevenueCat Customer Center failed:", error);
      throw error;
    }
  }

  /** Link an anonymous customer to the authenticated Supabase user ID. */
  async identify(appUserID: string): Promise<void> {
    if (Platform.OS === "web" || !this._ready) return;
    try {
      const { customerInfo } = await Purchases.logIn(appUserID);
      this.setProfile(customerInfo);
    } catch (error) {
      console.warn("RevenueCat identify failed:", error);
    }
  }

  /**
   * `identify` under the name the post-auth contract uses. Same behaviour: a
   * no-op on web or before activation, so `completeSignIn` can call it
   * unconditionally.
   */
  async logIn(appUserID: string): Promise<void> {
    await this.identify(appUserID);
  }

  async logout(): Promise<void> {
    if (Platform.OS === "web" || !this._ready) return;
    try {
      this.setProfile(await Purchases.logOut());
    } catch (error) {
      console.warn("RevenueCat logout failed:", error);
    }
  }

  dispose(): void {
    if (this._ready) {
      Purchases.removeCustomerInfoUpdateListener(this._customerInfoListener);
    }
    this._listeners = [];
  }

  private setProfile(profile: RevenueCatProfile | null): void {
    this._profile = profile;
    this.notify();
  }

  private notify(): void {
    this._listeners.forEach((listener) => listener(this._profile));
  }
}

export const revenueCatService = RevenueCatService.shared;

/** Shorthand for App.tsx initialization. */
export async function initRevenueCat(appUserID?: string): Promise<void> {
  await revenueCatService.activate(appUserID);
}

export default RevenueCatService;
