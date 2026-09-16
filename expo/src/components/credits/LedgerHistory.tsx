import { StyleSheet, Text, View } from "react-native";
import { type LedgerEntry, ledgerLabel } from "@/lib/profile";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The credit ledger, newest first, from the real rows (profile action
 * `ledger`). The seeded three-row fixture this replaced was the one piece of
 * invented data left on a money screen.
 */
export default function LedgerHistory({ entries }: { entries: LedgerEntry[] | null }) {
  if (!entries) {
    return (
      <Text style={styles.empty} testID="ledger-unavailable">
        Your history could not be loaded just now.
      </Text>
    );
  }
  if (entries.length === 0) {
    return (
      <Text style={styles.empty} testID="ledger-empty">
        Nothing yet. Your first credits will show up here.
      </Text>
    );
  }
  return (
    <View style={styles.list} testID="ledger">
      {entries.map((entry, index) => (
        <View
          key={entry.id}
          style={[styles.row, index < entries.length - 1 && styles.rowDivided]}
        >
          <View style={styles.text}>
            <Text style={styles.label}>{ledgerLabel(entry.reason, entry.amount)}</Text>
            <Text style={styles.when}>{formatWhen(entry.createdAt)}</Text>
          </View>
          <Text style={[styles.amount, entry.amount >= 0 ? styles.positive : styles.negative]}>
            {entry.amount > 0 ? "+" : ""}
            {entry.amount}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "Sep 8, 2026" from an ISO timestamp; empty when unknown. */
function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  empty: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },
  list: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowDivided: { borderBottomWidth: 1, borderBottomColor: colors.track },
  text: { flex: 1 },
  label: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 15 },
  when: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.muted, fontSize: 12 },
  amount: { fontFamily: fonts.ui, fontSize: 17, fontWeight: "900" },
  positive: { color: colors.success },
  negative: { color: colors.premium },
});
