import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gift, HelpCircle } from "lucide-react-native";
import type { CreditClaimsResult } from "@/lib/api";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The two quiet ways off the paid options: earn instead, or find out what a
 * credit buys before spending money on one.
 *
 * WHY THEY ARE HERE AND NOT BURIED. Paid options lead this screen because a
 * plan is the best price per credit and the screen should say so first. But
 * the free ways are further down than most people scroll, and the explanation
 * moved to its own screen when Profile's two credit rows were split. Without
 * this row, the person who does not want to pay sees only prices.
 *
 * WHY TWO SIBLINGS RATHER THAN ONE ROW WITH A LINK IN IT. A Pressable inside
 * a Pressable renders as a button inside a button on react-native-web, which
 * throws a hydration error and leaves the outer row dead. Profile learned that
 * the hard way with its "Get more" pill. These are two separate buttons.
 */
export default function SecondaryActions({
  claims,
  onFreeCredits,
  onHowCredits,
}: {
  /** Null while loading or unavailable; the sub-line then says nothing exact. */
  claims: CreditClaimsResult | null;
  /** Jumps to the Free credits section further down this screen. */
  onFreeCredits: () => void;
  /** Opens the prices, with nothing to buy. */
  onHowCredits: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onFreeCredits}
        accessibilityRole="button"
        // The sub-line is IN the label, not only under it. A `Pressable` is
        // one accessibility element and an explicit label replaces its
        // children rather than prefixing them, so labelling this "Get free
        // credits" alone meant a screen reader spoke none of the counts --
        // the whole of what `freeCreditsSubtitle` exists to say.
        accessibilityLabel={`Get free credits. ${freeCreditsSubtitle(claims)}`}
        testID="credits-free-cta"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Gift size={18} color={colors.accent} />
        <View style={styles.text}>
          <Text style={styles.label}>Get free credits</Text>
          <Text style={styles.sub} testID="credits-free-cta-sub">
            {freeCreditsSubtitle(claims)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onHowCredits}
        accessibilityRole="button"
        // Same rule as the button above: an explicit label replaces the
        // children, and these two buttons are told apart by their sub-lines.
        // Without this one a screen reader hears "How credits work" and "Get
        // free credits" with no idea that one of them explains prices.
        accessibilityLabel="How credits work. What each thing costs"
        testID="credits-how-cta"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <HelpCircle size={18} color={colors.accent} />
        <View style={styles.text}>
          <Text style={styles.label}>How credits work</Text>
          <Text style={styles.sub}>What each thing costs</Text>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * What the earn button says underneath itself.
 *
 * Only the server's numbers are quoted. `remaining.month` is the authoritative
 * count from `comment_credit_claims`; the ledger is not used, because it is
 * the last fifty rows rather than a lifetime total and would quietly undercount
 * an established account. When there is nothing exact to say, the line
 * describes the ways rather than inventing a figure.
 *
 * Exported for the test: this is the only place on the screen that turns two
 * server numbers into a sentence.
 */
export function freeCreditsSubtitle(claims: CreditClaimsResult | null): string {
  // Null claims is "could not be read"; null `remaining` is "the server
  // answered but did not count". Both are the same thing to a reader -- there
  // is no number worth quoting -- and both must reach the neutral line rather
  // than a confident zero.
  if (!claims || !claims.remaining) return "Comment, keep a streak, invite a friend";
  const left = claims.remaining.month;
  // Claimable comments, but never more than the caps will actually pay out
  // today. Three qualifying comments with the daily cap already spent is not
  // "3 ready to claim" -- the second tap comes back `daily_cap`, and a button
  // that promises three and pays one is worse than one that promises nothing.
  // `remaining.today` and `remaining.month` are both the server's.
  const claimable = claims.claims.filter((claim) => claim.status === "claimable").length;
  const ready = Math.min(claimable, claims.remaining.today, left);
  if (ready > 0) {
    return `${ready} ready to claim · ${left} left this month`;
  }
  if (left > 0) {
    return `${left} left to claim this month`;
  }
  return "Claimed every one this month";
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md },
  // Ghost cards: a border and the page ground, against the paid options'
  // filled surface directly above. Secondary has to look secondary.
  button: {
    flex: 1,
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  text: { flex: 1 },
  label: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 14 },
  sub: {
    marginTop: 2,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
});
