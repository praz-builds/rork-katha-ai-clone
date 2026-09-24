/**
 * What the store must sell, as the client expects to find it.
 *
 * `backend/PLAY_BILLING_SETUP.md` is the checklist a person follows to create
 * these products in Google Play and RevenueCat, and
 * `source-of-truth/CREDITS_AND_PRICING.md` §3 *Store SKUs* is where the prices
 * and grants are decided. This file is the client's copy of the identifiers
 * only, and `src/__tests__/store-catalog.test.ts` reads both documents and
 * fails if any of the three disagree -- so a renamed base plan or a moved
 * price cannot ship on one side alone. The server's copy is
 * `backend/supabase/functions/_shared/revenuecat.ts`, pinned the same way by
 * `revenuecat_test.ts`.
 *
 * Nothing here is a price the UI renders. Prices come from RevenueCat's
 * `priceString`; the credit packs' fallback copy lives in `pricing.ts`.
 *
 * Deliberately free of native imports so Jest can load it without mocks.
 */
import { CREDIT_PACKS } from "./pricing";

/** The one entitlement every subscription unlocks. */
export const KATHA_ENTITLEMENT = "katha";

/**
 * The offering the paywall reads. It must be the project's *current* offering
 * in RevenueCat; the client asks for it by id first and falls back to
 * `current`, so a dashboard that renames it still sells.
 */
export const SUBSCRIPTION_OFFERING_ID = "default";

/** The offering the credit packs live in. Packs are found by product id across every offering. */
export const CREDIT_PACK_OFFERING_ID = "credit_packs";

export type SubscriptionPlanId = "weekly" | "monthly" | "yearly";

export type StoreSubscription = {
  plan: SubscriptionPlanId;
  /** The Play subscription id and the App Store product id. */
  productId: string;
  /**
   * The Play base plan id. RevenueCat names an Android subscription product
   * `productId:basePlanId`, and its webhooks send that combined id, so the
   * base plan id is part of the contract, not a console detail.
   */
  basePlanId: string;
  /** RevenueCat's package identifier inside the subscription offering. */
  packageIdentifier: "$rc_weekly" | "$rc_monthly" | "$rc_annual";
  /** RevenueCat's `PackageType` for that package, as a string. */
  packageType: "WEEKLY" | "MONTHLY" | "ANNUAL";
};

export const STORE_SUBSCRIPTIONS: readonly StoreSubscription[] = [
  {
    plan: "weekly",
    productId: "ai.katha.sub.weekly",
    basePlanId: "weekly",
    packageIdentifier: "$rc_weekly",
    packageType: "WEEKLY",
  },
  {
    plan: "monthly",
    productId: "ai.katha.sub.monthly",
    basePlanId: "monthly",
    packageIdentifier: "$rc_monthly",
    packageType: "MONTHLY",
  },
  {
    plan: "yearly",
    productId: "ai.katha.sub.yearly",
    basePlanId: "yearly",
    packageIdentifier: "$rc_annual",
    packageType: "ANNUAL",
  },
];

/**
 * A pack's package identifier inside the `credit_packs` offering. The client
 * finds packs by product id, so this is dashboard hygiene rather than a
 * lookup key -- but it is written down once, here, and the setup checklist is
 * tested against it.
 */
export function creditPackPackageId(credits: number): string {
  return `credits_${credits}`;
}

/** Every product id the client may buy: three subscriptions, five packs. */
export const STORE_PRODUCT_IDS: readonly string[] = [
  ...STORE_SUBSCRIPTIONS.map((subscription) => subscription.productId),
  ...CREDIT_PACKS.map((pack) => pack.sku),
];

/**
 * The product id without RevenueCat's Android base-plan suffix.
 *
 * `ai.katha.sub.weekly:weekly` -> `ai.katha.sub.weekly`. A pack, and every
 * iOS product, has no suffix and comes back unchanged.
 */
export function canonicalProductId(storeIdentifier: string): string {
  const separator = storeIdentifier.indexOf(":");
  return separator === -1 ? storeIdentifier : storeIdentifier.slice(0, separator);
}

/**
 * Whether a store product is the one we mean.
 *
 * An exact comparison is what the client used to do, and on Android it never
 * matched a subscription: the SDK reports `ai.katha.sub.yearly:yearly`.
 */
export function storeProductMatches(storeIdentifier: string, productId: string): boolean {
  return canonicalProductId(storeIdentifier) === productId;
}

// ---------------------------------------------------------------------------
// Finding packages in RevenueCat offerings
// ---------------------------------------------------------------------------

/*
 * Structural shapes of the SDK's `PurchasesOfferings` / `PurchasesPackage`,
 * so these rules are testable without loading the native module. The real
 * SDK types satisfy them.
 */
type OptionLike = { isBasePlan: boolean };
type PackageLike = {
  product: { identifier: string; subscriptionOptions?: readonly OptionLike[] | null };
};
type OfferingLike<P> = { availablePackages: P[] };
type OfferingsLike<P> = {
  current?: OfferingLike<P> | null;
  all?: Record<string, OfferingLike<P> | undefined> | null;
};

/**
 * The packages of the subscription offering: `SUBSCRIPTION_OFFERING_ID` when
 * the dashboard has it, otherwise whichever offering is current.
 */
export function subscriptionPackages<P>(
  offerings: OfferingsLike<P> | null | undefined,
): P[] | null {
  if (!offerings) return null;
  return offerings.all?.[SUBSCRIPTION_OFFERING_ID]?.availablePackages ??
    offerings.current?.availablePackages ??
    null;
}

/**
 * The package selling one product, searched across EVERY offering, the packs'
 * offering first. Packs need not sit in the current offering, so a lookup
 * limited to `current` would call every pack unavailable. Null when no
 * offering sells it.
 */
export function findPackageInOfferings<P extends PackageLike>(
  offerings: OfferingsLike<P> | null | undefined,
  productId: string,
): P | null {
  if (!offerings) return null;
  const pools: P[][] = [];
  const packs = offerings.all?.[CREDIT_PACK_OFFERING_ID];
  if (packs?.availablePackages) pools.push(packs.availablePackages);
  if (offerings.current?.availablePackages) pools.push(offerings.current.availablePackages);
  for (const offering of Object.values(offerings.all ?? {})) {
    if (offering?.availablePackages) pools.push(offering.availablePackages);
  }
  for (const pool of pools) {
    const match = pool.find((candidate) =>
      storeProductMatches(candidate.product.identifier, productId)
    );
    if (match) return match;
  }
  return null;
}

/**
 * A Google Play subscription's base-plan option -- the plan at its full
 * price, with no free trial or intro offer applied. Null on iOS and for packs,
 * which report no options.
 */
export function basePlanOption<O extends OptionLike>(
  pkg: { product: { subscriptionOptions?: readonly O[] | null } },
): O | null {
  return pkg.product.subscriptionOptions?.find((option) => option.isBasePlan) ?? null;
}

// ---------------------------------------------------------------------------
// The RevenueCat public SDK key
// ---------------------------------------------------------------------------

export type RevenueCatKeyInput = {
  platform: string;
  /** `EXPO_PUBLIC_APP_ENV`, or the build's default. */
  appEnv: string;
  androidKey?: string | null;
  iosKey?: string | null;
  testStoreKey: string;
};

/**
 * The key RevenueCat is configured with, or null when purchases are off.
 *
 * Development builds use the Test Store. A release build takes the platform's
 * key from build configuration (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` /
 * `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, set as EAS environment variables), and
 * only when it carries that platform's prefix: a `test_` key in a release
 * build is refused by the SDK, and an `appl_` key on Android configures a
 * store that cannot sell anything, so either is treated as no key at all and
 * the app runs with purchases visibly disabled rather than broken.
 */
export function resolveRevenueCatKey(input: RevenueCatKeyInput): string | null {
  if (input.platform === "web") return null;
  if (input.appEnv === "development") return input.testStoreKey;
  const candidate = input.platform === "android"
    ? { key: input.androidKey, prefix: "goog_" }
    : input.platform === "ios"
    ? { key: input.iosKey, prefix: "appl_" }
    : null;
  const key = candidate?.key?.trim();
  if (!candidate || !key || !key.startsWith(candidate.prefix)) return null;
  return key;
}

// ---------------------------------------------------------------------------
// Managing a subscription
// ---------------------------------------------------------------------------

/** The Android application id, as `app.json` declares it. */
export const ANDROID_PACKAGE_NAME = "ai.katha.createstories";

/**
 * Where "Manage subscription" goes when RevenueCat's Customer Center cannot
 * open: the store's own subscriptions page. Play's deep link opens the Katha
 * subscription directly when it is given the product id; without one it opens
 * the list of every subscription on the account.
 */
export function manageSubscriptionsUrl(platform: string, productId?: string | null): string {
  if (platform === "ios") return "https://apps.apple.com/account/subscriptions";
  const base = "https://play.google.com/store/account/subscriptions";
  if (!productId) return base;
  const sku = encodeURIComponent(canonicalProductId(productId));
  return `${base}?sku=${sku}&package=${ANDROID_PACKAGE_NAME}`;
}
