import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";

// RevenueCat public SDK keys ship in the app binary and are not secrets.
// TODO: Production `appl_` and `goog_` keys have not been issued yet. Add them
// here before a preview or production build; never use the Test Store in release.
const REVENUECAT_TEST_STORE_PUBLIC_KEY = "test_VzetjoZZQyauDNrUNmaZqGYkSXE";
const REVENUECAT_IOS_RELEASE_PUBLIC_KEY: string | undefined = undefined;
const REVENUECAT_ANDROID_RELEASE_PUBLIC_KEY: string | undefined = undefined;
const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "production");
const IS_DEVELOPMENT_BUILD = APP_ENV === "development";
const REVENUECAT_PUBLIC_KEY = IS_DEVELOPMENT_BUILD
  ? REVENUECAT_TEST_STORE_PUBLIC_KEY
  : Platform.select({
    ios: REVENUECAT_IOS_RELEASE_PUBLIC_KEY,
    android: REVENUECAT_ANDROID_RELEASE_PUBLIC_KEY,
    default: undefined,
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
  katha: "katha",
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
          "Set the production appl_/goog_ keys in src/lib/revenuecat.ts.",
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

  /** Compatibility wrapper for the former placement-based service API. */
  async getPaywallProducts(_placementId?: string): Promise<RevenueCatPaywallProduct[] | null> {
    const offerings = await this.getOfferings();
    return offerings?.current?.availablePackages ?? null;
  }

  /**
   * Resolves with the profile after a completed purchase, `null` when the user
   * cancelled the store sheet. It used to resolve with the OLD profile on a
   * cancel, which made a cancel by an already-premium user indistinguishable
   * from a purchase: the paywall read `isPremium`, saw true, and granted a
   * plan nobody bought. Null is the only honest answer for "nothing happened".
   */
  async purchasePackage(pkg: PurchasesPackage): Promise<RevenueCatProfile | null> {
    if (Platform.OS === "web" || !this._ready) return null;
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
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
    const packages = await this.getPaywallProducts();
    const pkg = packages?.find((candidate) => candidate.product.identifier === productId);
    if (!pkg) throw new Error(`RevenueCat product ${productId} is not in the current offering`);
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
  async presentPaywallIfNeeded(entitlement = "katha"): Promise<unknown> {
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
