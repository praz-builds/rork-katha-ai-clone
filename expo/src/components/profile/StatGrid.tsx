import { StyleSheet, Text, View } from "react-native";
import { formatNumber } from "@/components/KathaPrimitives";
import { colors, fonts, profileHeading, radius, spacing } from "@/theme";

export type Stat = {
  label: string;
  /**
   * The number, or null when we do not know it.
   *
   * Null renders nothing at all -- the tile is dropped, not shown with a dash
   * or a zero. A zero is a claim ("you have written nothing") and a dash is a
   * shrug; neither is what "the request failed" means.
   */
  value: number | null;
};

/**
 * A grid of counts, and nothing else.
 *
 * There is no "engagement score", no percentile and no week-over-week arrow,
 * because every one of those would have to be computed from data this app does
 * not keep and would read as authoritative anyway. What is here -- stories,
 * chapters, reads, likes, followers -- are all counts of rows, so
 * each one is either right or absent.
 */
export default function StatGrid({ stats }: { stats: Stat[] }) {
  const known = stats.filter((stat) => stat.value !== null);
  if (known.length === 0) return null;

  return (
    <View style={styles.grid} testID="stat-grid">
      {known.map((stat) => (
        <View key={stat.label} style={styles.tile}>
          <Text style={styles.value}>{formatNumber(stat.value as number)}</Text>
          <Text style={styles.label}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: {
    ...profileHeading,
    color: colors.ink,
    fontSize: 20,
  },
  label: {
    marginTop: 2,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
  },
});
