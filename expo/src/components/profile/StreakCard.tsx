import { StyleSheet, Text, View } from "react-native";
import { Flame } from "lucide-react-native";
import { colors, fonts, radius, spacing } from "@/theme";
import { nextMilestone, type StreakState } from "@/lib/profile";

/**
 * The streak, and the one place in Katha allowed to feel urgent.
 *
 * The product brief asked for numbers that "encourage the user to keep their
 * streak more". The trap in that sentence is a card that shouts every day,
 * because a card that shouts every day is a card nobody reads by Thursday. So
 * the loudness is tied to whether there is genuinely something to lose in the
 * next few hours:
 *
 *   * ALREADY TODAY -- calm. Soft ground, no accent fill. The number is a
 *     record, and the reader has already done the thing. Nothing to ask for.
 *   * ENDS TONIGHT -- the accent. The streak is alive, the reader has not read
 *     or written today, and it is gone at midnight UTC. This is the only state
 *     that gets the orange, and it earns it: the urgency is a fact about the
 *     world, not a nudge we invented.
 *   * BROKEN -- honest and quiet. It says the streak is at zero and shows the
 *     best instead. A zero presented as a streak, or a "best" presented as if
 *     it were current, is exactly the dishonesty this surface must not have.
 *
 * A milestone line appears only within three days of one, and it never
 * promises a reward, because there is no reward: no credit, no badge, no
 * unlock. Naming a number the reader is about to reach is enough, and it is
 * the only claim here that cannot become untrue.
 */
export default function StreakCard({ state }: { state: StreakState }) {
  if (state.kind === "none") {
    return (
      <View style={styles.card} testID="streak-card">
        <View style={styles.iconWrapCalm}>
          <Flame size={22} color={colors.tertiary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.value}>No streak yet</Text>
          <Text style={styles.caption}>
            Read or write today and it starts.
          </Text>
        </View>
      </View>
    );
  }

  if (state.kind === "broken") {
    return (
      <View style={styles.card} testID="streak-card">
        <View style={styles.iconWrapCalm}>
          <Flame size={22} color={colors.tertiary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.value}>Streak at zero</Text>
          <Text style={styles.caption}>
            Your best was {state.best} {state.best === 1 ? "day" : "days"}.
            Today can be day one.
          </Text>
        </View>
      </View>
    );
  }

  const urgent = state.kind === "at_risk";
  const milestone = nextMilestone(state.days);

  return (
    <View
      style={[styles.card, urgent && styles.cardUrgent]}
      testID="streak-card"
    >
      <View style={[styles.iconWrapCalm, urgent && styles.iconWrapUrgent]}>
        <Flame size={22} color={urgent ? colors.surface : colors.accent} />
      </View>
      <View style={styles.body}>
        <Text style={styles.value}>
          {state.days} {state.days === 1 ? "day" : "days"}
        </Text>
        <Text style={[styles.caption, urgent && styles.captionUrgent]}>
          {urgent
            ? "Ends tonight. Read or write to keep it."
            : "Counted today. See you tomorrow."}
        </Text>
        {milestone !== null
          ? (
            <Text style={styles.milestone}>
              {milestone - state.days}{" "}
              more {milestone - state.days === 1 ? "day" : "days"} to{" "}
              {milestone}.
            </Text>
          )
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUrgent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  iconWrapCalm: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  iconWrapUrgent: { backgroundColor: colors.accent },
  body: { flex: 1 },
  value: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
  },
  caption: {
    marginTop: 2,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
  },
  captionUrgent: { color: colors.ink, fontWeight: "700" },
  milestone: {
    marginTop: spacing.xs,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
  },
});
