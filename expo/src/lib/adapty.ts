import { adapty, type AdaptyProfile, type AdaptyPaywallProduct } from 'react-native-adapty';

// ---------------------------------------------------------------------------
// Constants — hardcoded per Adapty skill guidance (no env var indirection
// for the public key; it ships in the binary and is not a secret).
// ---------------------------------------------------------------------------

const ADAPTY_PUBLIC_KEY = 'public_live_FMZlbSiA.aQUGsvwyAZRPPsurup8V';
const PLACEMENT_ONBOARDING = 'onboarding';
const ACCESS_LEVEL_ID = 'premium';

// ---------------------------------------------------------------------------
// AdaptyService — singleton that holds reactive profile state
// ---------------------------------------------------------------------------

type ProfileListener = (profile: AdaptyProfile | null) => void;

class AdaptyService {
  private static _instance: AdaptyService;
  private _profile: AdaptyProfile | null = null;
  private _listeners: ProfileListener[] = [];
  private _profileUnsub: { remove: () => void } | null = null;
  private _ready = false;

  static get shared(): AdaptyService {
    if (!AdaptyService._instance) {
      AdaptyService._instance = new AdaptyService();
    }
    return AdaptyService._instance;
  }

  /** Call once at app startup (App.tsx useEffect). */
  async activate(customerUserId?: string): Promise<void> {
    if (this._ready) return;
    try {
      await adapty.activate(ADAPTY_PUBLIC_KEY, {
        customerUserId: customerUserId ?? undefined,
        logLevel: __DEV__ ? 'verbose' : 'error',
        __ignoreActivationOnFastRefresh: __DEV__,
      });
      this._profileUnsub = adapty.addEventListener('onLatestProfileLoad', (profile) => {
        this._profile = profile;
        this._listeners.forEach((l) => l(profile));
      });
      this._profile = await adapty.getProfile();
      this._ready = true;
    } catch (error) {
      console.warn('Adapty activation failed:', error);
    }
  }

  /** Whether the user has an active premium access level. */
  get isPremium(): boolean {
    return this._profile?.accessLevels?.[ACCESS_LEVEL_ID]?.isActive ?? false;
  }

  /** Current profile (may be null before activation). */
  get profile(): AdaptyProfile | null {
    return this._profile;
  }

  /** Subscribe to profile changes. Returns unsubscribe function. */
  subscribe(listener: ProfileListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  /** Force-refresh profile from Adapty servers. */
  async reloadProfile(): Promise<AdaptyProfile | null> {
    try {
      this._profile = await adapty.getProfile();
      this._listeners.forEach((l) => l(this._profile));
      return this._profile;
    } catch {
      return this._profile;
    }
  }

  // -------------------------------------------------------------------------
  // Paywall & Products
  // -------------------------------------------------------------------------

  /** Fetch paywall products for a placement. */
  async getPaywallProducts(
    placementId: string = PLACEMENT_ONBOARDING,
  ): Promise<AdaptyPaywallProduct[] | null> {
    try {
      const flow = await adapty.getFlow(placementId);
      const products = await adapty.getPaywallProducts(flow);
      return products;
    } catch (error) {
      console.warn('Adapty getPaywallProducts failed:', error);
      return null;
    }
  }

  /** Purchase a product by its vendor product ID. */
  async purchase(vendorProductId: string, placementId?: string): Promise<AdaptyProfile | null> {
    try {
      const products = await this.getPaywallProducts(placementId);
      const product = products?.find((p) => p.vendorProductId === vendorProductId);
      if (!product) {
        throw new Error(`Product ${vendorProductId} not found in placement`);
      }
      const result = await adapty.makePurchase(product);
      if (result.type === 'success') {
        // Purchase succeeded — reload profile to get updated access levels
        return this.reloadProfile();
      }
      // user_cancelled or pending — no action needed
      return this._profile;
    } catch (error) {
      console.warn('Adapty purchase failed:', error);
      throw error;
    }
  }

  /** Restore previous purchases. */
  async restorePurchases(): Promise<AdaptyProfile | null> {
    try {
      const profile = await adapty.restorePurchases();
      this._profile = profile;
      this._listeners.forEach((l) => l(profile));
      return profile;
    } catch (error) {
      console.warn('Adapty restore failed:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // User identity
  // -------------------------------------------------------------------------

  /** Identify the user after sign-in (links anonymous profile to your user ID). */
  async identify(customerUserId: string): Promise<void> {
    try {
      await adapty.identify(customerUserId);
      await this.reloadProfile();
    } catch (error) {
      console.warn('Adapty identify failed:', error);
    }
  }

  /** Log out the current user (reverts to anonymous profile). */
  async logout(): Promise<void> {
    try {
      await adapty.logout();
      this._profile = null;
      this._listeners.forEach((l) => l(null));
    } catch (error) {
      console.warn('Adapty logout failed:', error);
    }
  }

  /** Remove event listener. Call on unmount if needed. */
  dispose(): void {
    this._profileUnsub?.remove();
    this._profileUnsub = null;
    this._listeners = [];
  }
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export const adaptyService = AdaptyService.shared;

/** Shorthand for App.tsx init. */
export async function initAdapty(customerUserId?: string): Promise<void> {
  await adaptyService.activate(customerUserId);
}

export default AdaptyService;
