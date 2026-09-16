import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Crown, Package } from "lucide-react-native";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The two ways to pay (D8): the plan, and a pack.
 *
 * The plan card leads because a plan is always the best price per credit.
 * For a member it turns into the member state rather than a pitch, and the
 * caller decides what that opens (Customer Center or the plan-facts sheet).
 */
export default function PaidOptions({
  subscribed,
  onPlus,
  onPacks,
}: {
  subscribed: boolean;
  onPlus: () => void;
  onPacks: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Pressable
        onPress={onPlus}
        accessibilityRole="button"
        accessibilityLabel="Katha Plus"
        testID="credits-plus"
        style={({ pressed }) => [styles.card, styles.plusCard, pressed && styles.pressed]}
      >
        <View style={[styles.icon, styles.plusIcon]}>
          <Crown size={20} color={colors.surface} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Katha Plus</Text>
          <Text style={styles.sub}>
            {subscribed
              ? "You're a Katha member"
              : "50 credits a month, premium voices and PDF. The best price per credit."}
          </Text>
        </View>
        {subscribed
          ? (
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>Member</Text>
            </View>
          )
          : <ChevronRight size={16} color={colors.tertiary} />}
      </Pressable>

      <Pressable
        onPress={onPacks}
        accessibilityRole="button"
        accessibilityLabel="Credit packs"
        testID="credits-packs"
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <Package size={20} color={colors.accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Credit packs</Text>
          <Text style={styles.sub}>From 2 to 1000 credits. They never expire.</Text>
        </View>
        <ChevronRight size={16} color={colors.tertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  plusCard: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  plusIcon: { backgroundColor: colors.accent },
  text: { flex: 1 },
  title: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 16 },
  sub: {
    marginTop: spacing.tight,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  badgeLabel: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "800", fontSize: 12 },
});
