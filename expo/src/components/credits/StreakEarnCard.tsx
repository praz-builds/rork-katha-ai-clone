import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Flame } from "lucide-react-native";
import { FALLBACK_LADDER, nextRung, type OwnProfile } from "@/lib/profile";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The streak as a way to earn (D2): the current run, the next rung and what
 * it pays, and the door to the journey page where the whole ladder is.
 *
 * The rung is always named, however far away: this card exists to answer
 * "what do I get for keeping this up", and the answer is a number of days
 * and a number of credits, both from the server's own ladder.
 */
export default function StreakEarnCard({
  profile,
  onJourney,
}: {
  /** Null while loading or unavailable; the card then says so. */
  profile: OwnProfile | null;
  onJourney: () => void;
}) {
  const current = profile?.currentStreak ?? 0;
  const ladder = profile?.ladder.length ? profile.ladder : FALLBACK_LADDER;
  const rung = nextRung(current, ladder);
  const total = ladder.reduce((sum, step) => sum + step.credits, 0);

  return (
    <View style={styles.card} testID="credits-streak">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Flame size={20} color={colors.accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Keep a streak</Text>
          <Text style={styles.sub}>
            Read or write every day. Up to {total} credits across the ladder.
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {profile ? current : "—"}
          </Text>
          <Text style={styles.statLabel}>{current === 1 ? "day streak" : "day streak"}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          {rung
            ? (
              <>
                <Text style={styles.statValue} testID="credits-next-rung">
                  +{rung.credits}
                </Text>
                <Text style={styles.statLabel}>
                  {`credits at day ${rung.milestone}`}
                </Text>
              </>
            )
            : (
              <>
                <Text style={styles.statValue}>{"✓"}</Text>
                <Text style={styles.statLabel}>ladder complete</Text>
              </>
            )}
        </View>
      </View>

      <Pressable
        onPress={onJourney}
        accessibilityRole="button"
        accessibilityLabel="View journey"
        testID="credits-view-journey"
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.linkLabel}>View journey</Text>
        <ChevronRight size={16} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 16 },
  sub: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },
  statValue: { fontFamily: fonts.display, color: colors.ink, fontSize: 24, lineHeight: 28 },
  statLabel: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.muted, fontSize: 12 },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start" },
  linkLabel: { fontFamily: fonts.ui, color: colors.accent, fontWeight: "800", fontSize: 14 },
  pressed: { opacity: 0.7 },
});
