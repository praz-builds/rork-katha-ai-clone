import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, Crown, X } from "lucide-react-native";
import i18n from "@/i18n";
import { revenueCatService } from "@/lib/revenuecat";
import { manageSubscriptionsUrl } from "@/lib/store-catalog";
import { colors, fonts, radius, spacing } from "@/theme";
import { Button } from "@/components/Button";

/**
 * The member state, as a sheet (D7).
 *
 * Shown to a subscriber when the Customer Center cannot be: on web, where
 * RevenueCat is disabled outright, and in a native build whose SDK never
 * configured. A subscriber who taps "Katha Plus" must land on something that
 * says they have it. Sending them to the paywall, which is what the row did
 * before, is the app asking a paying customer to pay.
 *
 * It states the plan's facts and nothing it cannot deliver: the four
 * promises are the paywall's four rows, so a member reads here exactly what
 * they read when they bought. Managing the subscription is the store's job:
 * on a phone the line at the bottom is a link to that store's subscriptions
 * page (Play's Subscriptions policy wants a working manage/cancel path for a
 * member, and this sheet is where Profile and Credits land when the Customer
 * Center cannot open). On web there is no store to link, so it stays a line.
 */
export const PLAN_FACTS: readonly string[] = [
  "50 credits a month",
  "Unlimited portraits and reimagines",
  "Premium voices",
  "Download as PDF",
];

export default function MemberSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const store = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
  const openStore = () => {
    const held = revenueCatService?.profile?.activeSubscriptions?.[0] ?? null;
    void Linking.openURL(manageSubscriptionsUrl(Platform.OS, held)).catch(() => undefined);
  };

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
        <View style={styles.sheet} testID="member-sheet">
          <View style={styles.header}>
            <View style={styles.crown}>
              <Crown size={20} color={colors.accent} />
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.title}>You're a Katha member</Text>
          <Text style={styles.sub}>Your plan is active. Here is what it includes.</Text>
          <View style={styles.facts}>
            {PLAN_FACTS.map((fact) => (
              <View key={fact} style={styles.factRow}>
                <Check size={16} color={colors.accent} strokeWidth={3} />
                <Text style={styles.fact}>{fact}</Text>
              </View>
            ))}
          </View>
          {store
            ? (
              <Pressable
                onPress={openStore}
                accessibilityRole="link"
                testID="member-sheet-manage"
                hitSlop={{ top: 12, bottom: 12 }}
              >
                <Text style={[styles.manage, styles.manageLink]}>
                  {i18n.t(`paywall.manageInStore.${store}`)}
                </Text>
              </Pressable>
            )
            : (
              <Text style={styles.manage}>
                Manage or cancel any time from the store you subscribed on.
              </Text>
            )}
          <Button
            label="Done"
            onPress={onClose}
            testID="member-sheet-done"
            style={styles.done}
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
  },
  crown: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  title: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    fontWeight: "700",
    color: colors.ink,
    fontSize: 24,
  },
  sub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  facts: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  fact: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 15 },
  manage: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  manageLink: { textDecorationLine: "underline" },
  /** Layout only; the recipe is `Button`'s. */
  done: { marginTop: spacing.md },
});
