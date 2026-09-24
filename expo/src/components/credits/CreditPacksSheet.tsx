import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, X } from "lucide-react-native";
import {
  CREDIT_PACKS,
  type CreditPack,
  creditPackBaseRate,
  creditPackSavingPercent,
  creditPackUnitPrice,
  formatUnitPrice,
} from "@/lib/pricing";
import { revenueCatService, type RevenueCatPaywallProduct } from "@/lib/revenuecat";
import { colors, fonts, radius, spacing } from "@/theme";
import { Button } from "@/components/Button";

/**
 * The credit packs, as a sheet (D8).
 *
 * Five rows, 2 to 1000 credits, "Popular" on the 10. Every figure on a row is
 * derived from the price on that row: the unit price is price over credits,
 * and "Save N%" is measured against the 2-pack's rate, so the badges cannot
 * disagree with the prices above them however the store localizes them.
 *
 * PRICES. The store's `priceString` when RevenueCat has a package for the
 * SKU; the canonical USD figure otherwise, as fallback copy. On web
 * RevenueCat is disabled outright, so there is never a package and the
 * Purchase button is disabled with "Purchases work in the app" rather than
 * pretending to a checkout the platform cannot run.
 *
 * WHAT A PURCHASE DOES. The store sheet, then RevenueCat's webhook grants the
 * credits on the server. The client never mints them: after a completed
 * purchase it tells the caller, who re-reads the balance.
 */
export const PACKS_HEADLINE = "Credit packs that never expire";
export const WEB_PURCHASE_NOTE = "Purchases work in the app";
/**
 * A native build whose store never configured (no RevenueCat key in the
 * build). "Purchases work in the app" was shown here too, which is nonsense
 * to somebody already in the app.
 */
export const STORE_UNAVAILABLE_NOTE = "Purchases aren't available in this version yet";
/** The store answered but does not sell this pack (not created, or not in an offering). */
export const PACK_UNAVAILABLE_NOTE = "This pack isn't available right now";

/** What the disabled Purchase button says, by why it is disabled. */
export function unavailablePurchaseNote(platform: string, storeAvailable: boolean): string {
  if (platform === "web") return WEB_PURCHASE_NOTE;
  return storeAvailable ? PACK_UNAVAILABLE_NOTE : STORE_UNAVAILABLE_NOTE;
}

type PackOffer = {
  pack: CreditPack;
  /** The store package, when there is one. */
  pkg: RevenueCatPaywallProduct | null;
  /** What the row shows. */
  priceString: string;
  /** The same figure as a number, for the derived lines. */
  amount: number;
};

function offerFor(pack: CreditPack, pkg: RevenueCatPaywallProduct | null): PackOffer {
  return {
    pack,
    pkg,
    priceString: pkg?.product.priceString ?? pack.fallbackPrice,
    amount: typeof pkg?.product.price === "number" ? pkg.product.price : pack.usd,
  };
}

export default function CreditPacksSheet({
  visible,
  onClose,
  onPurchased,
}: {
  visible: boolean;
  onClose: () => void;
  /** A purchase completed. The caller re-reads the balance. */
  onPurchased: (pack: CreditPack) => void;
}) {
  const [offers, setOffers] = useState<PackOffer[]>(() =>
    CREDIT_PACKS.map((pack) => offerFor(pack, null))
  );
  const [selected, setSelected] = useState<number>(
    CREDIT_PACKS.find((pack) => pack.popular)?.credits ?? CREDIT_PACKS[0].credits,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const available = revenueCatService.isAvailable;

  // Store prices, when the store can be asked. A failure keeps the fallback
  // copy: the packs are still real, the figures are still the canonical ones.
  useEffect(() => {
    if (!visible || !available) return;
    let cancelled = false;
    Promise.all(
      CREDIT_PACKS.map((pack) =>
        revenueCatService
          .findPackageByProductId(pack.sku)
          .then((pkg) => offerFor(pack, pkg))
          .catch(() => offerFor(pack, null))
      ),
    ).then((next) => {
      if (!cancelled) setOffers(next);
    });
    return () => {
      cancelled = true;
    };
  }, [available, visible]);

  const chosen = offers.find((offer) => offer.pack.credits === selected) ?? offers[0];
  const baseRate = creditPackBaseRate((pack) =>
    offers.find((offer) => offer.pack.credits === pack.credits)?.amount ?? pack.usd
  );
  const purchasable = available && chosen?.pkg !== null;
  const unavailableNote = unavailablePurchaseNote(Platform.OS, available);

  const purchase = useCallback(async () => {
    if (busy || !chosen?.pkg) return;
    setBusy(true);
    setNotice(null);
    try {
      const profile = await revenueCatService.purchasePackage(chosen.pkg);
      // A cancel resolves null and says nothing: the user knows what they did.
      if (profile === null) return;
      setNotice(`${chosen.pack.credits} credits are on their way to your balance.`);
      onPurchased(chosen.pack);
    } catch {
      setNotice("Purchase didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, chosen, onPurchased]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID="credit-packs-sheet">
          <View style={styles.header}>
            <Text style={styles.title}>{PACKS_HEADLINE}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.sub}>
            Buy once, spend whenever. Pack credits sit in your balance until you use them.
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {offers.map((offer) => {
              const isSelected = offer.pack.credits === selected;
              const saving = creditPackSavingPercent(offer.pack, offer.amount, baseRate);
              const unit = formatUnitPrice(
                creditPackUnitPrice(offer.pack, offer.amount),
                offer.priceString,
              );
              return (
                <Pressable
                  key={offer.pack.sku}
                  onPress={() => {
                    setSelected(offer.pack.credits);
                    setNotice(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${offer.pack.credits} credits, ${offer.priceString}`}
                  testID={`credit-pack-${offer.pack.credits}`}
                  style={[styles.row, isSelected && styles.rowSelected]}
                >
                  <View style={styles.rowTick}>
                    {isSelected ? <Check size={14} color={colors.surface} strokeWidth={3} /> : null}
                  </View>
                  <View style={styles.rowText}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle}>{offer.pack.credits} credits</Text>
                      {offer.pack.popular
                        ? (
                          <View style={styles.popular}>
                            <Text style={styles.popularLabel}>Popular</Text>
                          </View>
                        )
                        : null}
                    </View>
                    <Text style={styles.rowMeta}>
                      {unit}
                      {saving > 0 ? `  ·  Save ${saving}%` : ""}
                    </Text>
                  </View>
                  <Text style={styles.rowPrice}>{offer.priceString}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {notice ? <Text style={styles.notice} testID="credit-packs-notice">{notice}</Text> : null}

          <Button
            label={purchasable
              ? busy
                ? "Purchasing..."
                : `Purchase ${chosen?.pack.credits ?? ""} credits for ${chosen?.priceString ?? ""}`
              : unavailableNote}
            accessibilityLabel={purchasable ? "Purchase" : unavailableNote}
            onPress={purchase}
            disabled={!purchasable}
            /* `loading`, not just `disabled`: a purchase in flight is busy,
               which is a different fact from a purchase that is unavailable.
               A screen reader that only hears "dimmed" cannot tell them
               apart. */
            loading={busy}
            testID="credit-packs-purchase"
            style={styles.purchase}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.related,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: { flex: 1, fontFamily: fonts.display, color: colors.ink, fontSize: 22 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  sub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  list: { flexGrow: 0, marginTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rowTick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 16 },
  rowMeta: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.muted, fontSize: 12 },
  rowPrice: { fontFamily: fonts.display, color: colors.ink, fontSize: 18 },
  popular: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.tight,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  popularLabel: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "800", fontSize: 10 },
  notice: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, textAlign: "center" },
  /** Layout only; the recipe is `Button`'s. */
  purchase: { marginTop: spacing.sm },
});
