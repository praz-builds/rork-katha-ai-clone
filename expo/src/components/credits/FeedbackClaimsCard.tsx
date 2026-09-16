import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MessageSquare } from "lucide-react-native";
import {
  claimCommentCredit,
  claimFailureMessage,
  type CreditClaim,
  type CreditClaimsResult,
} from "@/lib/api";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Feedback credits (D9): comment on somebody's story, then claim one credit
 * for it here.
 *
 * Every rule is the server's. The card lists what the server said about each
 * recent comment -- claimable, claimed, or why not -- and the remaining
 * counts against the daily and monthly caps. A refused claim is explained in
 * the server's own words, translated, under the row it belongs to; the list
 * is then re-read so the row settles into whatever the server now says.
 */
export default function FeedbackClaimsCard({
  claims,
  onChanged,
}: {
  /** Null while loading or unavailable; the card then says so. */
  claims: CreditClaimsResult | null;
  /** A claim landed (with the new balance) or was refused; the caller re-reads. */
  onChanged: (balance: number | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  const claim = useCallback(async (item: CreditClaim) => {
    if (busyId) return;
    setBusyId(item.commentId);
    setNotice(null);
    const result = await claimCommentCredit(item.commentId);
    setBusyId(null);
    if (result.ok) {
      setNotice({ id: item.commentId, text: `+${result.credits} credit. Thank you.` });
      onChanged(Number.isFinite(result.balance) ? result.balance : null);
      return;
    }
    setNotice({ id: item.commentId, text: claimFailureMessage(result.reason) });
    if (result.reason !== "offline") onChanged(null);
  }, [busyId, onChanged]);

  const rows = claims?.claims ?? [];

  return (
    <View style={styles.card} testID="credits-feedback">
      <View style={styles.head}>
        <View style={styles.icon}>
          <MessageSquare size={20} color={colors.accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Leave feedback</Text>
          <Text style={styles.sub}>
            Comment on a story you have read, at least 40 characters, and claim 1 credit. One per story, one a day, six a month.
          </Text>
        </View>
      </View>

      {claims
        ? (
          <Text style={styles.caps} testID="credits-feedback-remaining">
            {claims.remaining.today} left today · {claims.remaining.month} left this month
          </Text>
        )
        : null}

      {!claims
        ? <Text style={styles.empty}>Your comments could not be loaded just now.</Text>
        : rows.length === 0
        ? <Text style={styles.empty}>No comments yet. Read something and say what you thought.</Text>
        : (
          <View style={styles.list}>
            {rows.map((item, index) => (
              <View
                key={item.commentId}
                testID={`claim-${item.commentId}`}
                style={[styles.row, index < rows.length - 1 && styles.rowDivided]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.storyTitle || "A story"}
                  </Text>
                  <Text style={styles.rowExcerpt} numberOfLines={2}>{item.excerpt}</Text>
                  {notice?.id === item.commentId
                    ? <Text style={styles.rowNotice}>{notice.text}</Text>
                    : item.status === "ineligible" && item.reason
                    ? <Text style={styles.rowWhy}>{ineligibleLine(item.reason)}</Text>
                    : null}
                </View>
                {item.status === "claimable"
                  ? (
                    <Pressable
                      onPress={() => void claim(item)}
                      disabled={busyId !== null}
                      accessibilityRole="button"
                      accessibilityLabel="Claim"
                      accessibilityState={{ disabled: busyId !== null, busy: busyId === item.commentId }}
                      testID={`claim-button-${item.commentId}`}
                      style={({ pressed }) => [
                        styles.claim,
                        pressed && styles.claimPressed,
                        busyId !== null && styles.claimBusy,
                      ]}
                    >
                      <Text style={styles.claimLabel}>
                        {busyId === item.commentId ? "..." : "Claim"}
                      </Text>
                    </Pressable>
                  )
                  : (
                    <Text style={[styles.status, item.status === "claimed" && styles.statusClaimed]}>
                      {item.status === "claimed" ? "Claimed" : "Not eligible"}
                    </Text>
                  )}
              </View>
            ))}
          </View>
        )}
    </View>
  );
}

/** The server's ineligibility key, as one short line. */
function ineligibleLine(reason: string): string {
  switch (reason) {
    case "too_short":
      return "Under 40 characters.";
    case "own_story":
      return "Your own story.";
    case "not_read":
      return "Read the story first.";
    case "story_cap":
      return "Already claimed on this story.";
    case "deleted":
      return "Comment deleted.";
    case "reported":
      return "Comment reported.";
    case "tester":
      return "Test accounts do not earn credits.";
    default:
      return "";
  }
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
  caps: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 12 },
  empty: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface2, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowDivided: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 14 },
  rowExcerpt: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 17 },
  rowWhy: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.tertiary, fontSize: 12 },
  rowNotice: { marginTop: spacing.tight, fontFamily: fonts.ui, color: colors.accent, fontWeight: "700", fontSize: 12 },
  claim: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  claimPressed: { backgroundColor: colors.accentPressed },
  claimBusy: { opacity: 0.6 },
  claimLabel: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "800", fontSize: 13 },
  status: { fontFamily: fonts.ui, color: colors.tertiary, fontWeight: "700", fontSize: 12 },
  statusClaimed: { color: colors.success },
});
