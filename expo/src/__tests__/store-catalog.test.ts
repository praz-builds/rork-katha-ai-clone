/**
 * The store catalogue: what the client expects the store to sell, pinned to
 * the two documents a person reads to create it.
 *
 * `backend/PLAY_BILLING_SETUP.md` is the checklist the founder follows in
 * Play Console and RevenueCat; `source-of-truth/CREDITS_AND_PRICING.md` §3
 * *Store SKUs* is where the prices are decided. A product id, base plan,
 * package, offering or price that differs between any of them and this code
 * is a purchase that charges and grants nothing, so it fails here instead.
 */

import { CREDIT_PACKS } from "@/lib/pricing";
import {
  ANDROID_PACKAGE_NAME,
  basePlanOption,
  canonicalProductId,
  CREDIT_PACK_OFFERING_ID,
  creditPackPackageId,
  findPackageInOfferings,
  KATHA_ENTITLEMENT,
  manageSubscriptionsUrl,
  resolveRevenueCatKey,
  STORE_PRODUCT_IDS,
  STORE_SUBSCRIPTIONS,
  SUBSCRIPTION_OFFERING_ID,
  subscriptionPackages,
} from "@/lib/store-catalog";

// `@types/node` is deliberately not a dependency (see button-recipe.test.ts),
// so the two Node functions this test needs are declared, not imported.
declare const __dirname: string;
declare function require(id: string): unknown;
const { readFileSync } = require("fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join } = require("path") as { join(...parts: string[]): string };

const REPO = join(__dirname, "..", "..", "..");

type CatalogueRow = {
  type: string;
  productId: string;
  basePlanId: string | null;
  price: string;
  credits: number;
  packageId: string;
  offering: string;
  entitlement: string | null;
};

const unticked = (cell: string) => cell.replace(/`/g, "").trim();
const orNull = (cell: string) => (unticked(cell) === "—" ? null : unticked(cell));

function setupCatalogue(): CatalogueRow[] {
  const doc = readFileSync(join(REPO, "backend", "PLAY_BILLING_SETUP.md"), "utf8");
  const block = doc.split("<!-- catalogue:start -->")[1]?.split("<!-- catalogue:end -->")[0];
  if (!block) throw new Error("PLAY_BILLING_SETUP.md has no catalogue block");
  return block
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Type") && !line.startsWith("|---"))
    .map((line) => {
      const cells = line.split("|").slice(1, -1);
      return {
        type: unticked(cells[0]),
        productId: unticked(cells[1]),
        basePlanId: orNull(cells[2]),
        price: unticked(cells[4]),
        credits: Number(unticked(cells[5]).split(" ")[0]),
        packageId: unticked(cells[6]),
        offering: unticked(cells[7]),
        entitlement: orNull(cells[8]),
      };
    });
}

/** `ai.katha.sub.yearly` -> `59` from the pricing doc's Store SKUs table. */
function sourceOfTruthPrices(): Map<string, number> {
  const doc = readFileSync(
    join(REPO, "source-of-truth", "CREDITS_AND_PRICING.md"),
    "utf8",
  );
  const section = doc.split("### Store SKUs")[1]?.split("\n## ")[0] ?? "";
  const prices = new Map<string, number>();
  for (const match of section.matchAll(/\| `(ai\.katha\.[a-z0-9.]+)` \|[^|]*\$(\d+(?:\.\d+)?)/g)) {
    prices.set(match[1], Number(match[2]));
  }
  return prices;
}

const dollars = (price: string) => Number(price.replace("$", ""));

describe("the Play billing checklist matches the code", () => {
  const rows = setupCatalogue();

  it("lists exactly the eight products the client can buy", () => {
    expect(rows.map((row) => row.productId).sort()).toEqual([...STORE_PRODUCT_IDS].sort());
    expect(rows).toHaveLength(8);
  });

  it("gives each subscription the base plan, package, offering and entitlement the client asks for", () => {
    for (const subscription of STORE_SUBSCRIPTIONS) {
      const row = rows.find((candidate) => candidate.productId === subscription.productId);
      expect(row).toMatchObject({
        type: "Subscription",
        basePlanId: subscription.basePlanId,
        packageId: subscription.packageIdentifier,
        offering: SUBSCRIPTION_OFFERING_ID,
        entitlement: KATHA_ENTITLEMENT,
      });
    }
  });

  it("gives each pack its credits, price, package and offering, with no entitlement", () => {
    for (const pack of CREDIT_PACKS) {
      const row = rows.find((candidate) => candidate.productId === pack.sku);
      expect(row).toMatchObject({
        type: "Credit pack",
        basePlanId: null,
        credits: pack.credits,
        packageId: creditPackPackageId(pack.credits),
        offering: CREDIT_PACK_OFFERING_ID,
        entitlement: null,
      });
      expect(dollars(row!.price)).toBe(pack.usd);
    }
  });

  it("prices every product as the pricing source of truth does", () => {
    const prices = sourceOfTruthPrices();
    expect([...prices.keys()].sort()).toEqual([...STORE_PRODUCT_IDS].sort());
    for (const row of rows) {
      expect([row.productId, dollars(row.price)]).toEqual([row.productId, prices.get(row.productId)]);
    }
  });
});

describe("Android product identifiers", () => {
  it("strips RevenueCat's base-plan suffix and leaves packs alone", () => {
    expect(canonicalProductId("ai.katha.sub.yearly:yearly")).toBe("ai.katha.sub.yearly");
    expect(canonicalProductId("ai.katha.credits.10")).toBe("ai.katha.credits.10");
  });

  // Before: `candidate.product.identifier === productId`, which on Android
  // never matched a subscription, because the SDK reports `sub:baseplan`.
  it("finds an Android subscription package by its bare product id", () => {
    const yearly = { product: { identifier: "ai.katha.sub.yearly:yearly" } };
    const pack = { product: { identifier: "ai.katha.credits.2" } };
    const offerings = {
      current: { availablePackages: [yearly] },
      all: { [CREDIT_PACK_OFFERING_ID]: { availablePackages: [pack] } },
    };
    expect(findPackageInOfferings(offerings, "ai.katha.sub.yearly")).toBe(yearly);
    expect(findPackageInOfferings(offerings, "ai.katha.credits.2")).toBe(pack);
    expect(findPackageInOfferings(offerings, "ai.katha.credits.10")).toBeNull();
    expect(findPackageInOfferings(null, "ai.katha.credits.2")).toBeNull();
  });

  it("does not match a product whose id merely starts the same", () => {
    const offerings = {
      current: { availablePackages: [{ product: { identifier: "ai.katha.credits.1000" } }] },
    };
    expect(findPackageInOfferings(offerings, "ai.katha.credits.10")).toBeNull();
  });

  it("reads the subscription offering by id, then the current one", () => {
    const byId = [{ id: "default" }];
    const current = [{ id: "current" }];
    expect(
      subscriptionPackages({
        current: { availablePackages: current },
        all: { [SUBSCRIPTION_OFFERING_ID]: { availablePackages: byId } },
      }),
    ).toBe(byId);
    expect(subscriptionPackages({ current: { availablePackages: current }, all: {} })).toBe(current);
    expect(subscriptionPackages(null)).toBeNull();
  });

  it("picks the base plan, not a free-trial offer", () => {
    const base = { id: "yearly", isBasePlan: true };
    const trial = { id: "yearly:yearly-trial-3d", isBasePlan: false };
    expect(basePlanOption({ product: { subscriptionOptions: [trial, base] } })).toBe(base);
    expect(basePlanOption({ product: { subscriptionOptions: null } })).toBeNull();
  });
});

describe("the RevenueCat key comes from build configuration", () => {
  const base = { testStoreKey: "test_abc", androidKey: undefined, iosKey: undefined };

  it("uses the Test Store in development builds", () => {
    expect(resolveRevenueCatKey({ ...base, platform: "android", appEnv: "development" })).toBe("test_abc");
  });

  it("uses the goog_ key on an Android release build", () => {
    expect(
      resolveRevenueCatKey({ ...base, platform: "android", appEnv: "production", androidKey: " goog_live " }),
    ).toBe("goog_live");
  });

  it("turns purchases off, rather than misconfiguring them, with no key or the wrong store's key", () => {
    expect(resolveRevenueCatKey({ ...base, platform: "android", appEnv: "production" })).toBeNull();
    expect(resolveRevenueCatKey({ ...base, platform: "android", appEnv: "production", androidKey: "" })).toBeNull();
    expect(
      resolveRevenueCatKey({ ...base, platform: "android", appEnv: "production", androidKey: "appl_x" }),
    ).toBeNull();
    expect(
      resolveRevenueCatKey({ ...base, platform: "android", appEnv: "production", androidKey: "test_abc" }),
    ).toBeNull();
    expect(resolveRevenueCatKey({ ...base, platform: "ios", appEnv: "production", iosKey: "appl_y" })).toBe("appl_y");
    expect(resolveRevenueCatKey({ ...base, platform: "web", appEnv: "development" })).toBeNull();
  });
});

describe("managing a subscription", () => {
  it("links Play's subscriptions page, for the held plan when there is one", () => {
    expect(manageSubscriptionsUrl("android")).toBe("https://play.google.com/store/account/subscriptions");
    expect(manageSubscriptionsUrl("android", "ai.katha.sub.yearly:yearly")).toBe(
      "https://play.google.com/store/account/subscriptions?sku=ai.katha.sub.yearly&package=ai.katha.createstories",
    );
    expect(manageSubscriptionsUrl("ios")).toBe("https://apps.apple.com/account/subscriptions");
  });

  it("names the package app.json declares", () => {
    const appJson = JSON.parse(readFileSync(join(REPO, "expo", "app.json"), "utf8"));
    expect(appJson.expo.android.package).toBe(ANDROID_PACKAGE_NAME);
  });
});
