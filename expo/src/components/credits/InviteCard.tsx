import { useCallback, useState } from "react";
import { Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Gift } from "lucide-react-native";
import { claimReferralCode, referralFailureMessage } from "@/lib/api";
import type { ReferralSummary } from "@/lib/profile";
import { colors, fonts, radius, spacing } from "@/theme";

/** What the share sheet carries. Exported so the test can hold it to the code. */
export function inviteMessage(code: string): string {
  return `Join me on Katha AI. Use my invite code ${code} and we both get credits once you make your first story.`;
}

/**
 * Invite & earn (D10), code-based.
 *
 * The reader's code with a Share button, the counts the server keeps, and a
 * field for a code somebody gave THEM. The payout is the server's business:
 * 10 to the referrer and 5 to the invitee, once the invitee has generated
 * something and is a day old, and never twice. The card states the terms
 * and relays the verdict; it promises nothing the server does not.
 */
export default function InviteCard({
  code,
  referral,
  onClaimed,
}: {
  /** Null until the server assigns one, or when the profile is unavailable. */
  code: string | null;
  referral: ReferralSummary | null;
  /** The reader entered somebody's code and the server accepted it. */
  onClaimed: () => void;
}) {
  const [entered, setEntered] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const share = useCallback(async () => {
    if (!code) return;
    try {
      await Share.share({ message: inviteMessage(code) });
    } catch {
      // A dismissed share sheet is not an error.
    }
  }, [code]);

  const submit = useCallback(async () => {
    if (busy || entered.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    const result = await claimReferralCode(entered);
    setBusy(false);
    if (result.ok) {
      setAccepted(true);
      setNotice("Code accepted. Your credits land after your first story.");
      onClaimed();
      return;
    }
    setNotice(referralFailureMessage(result.reason));
  }, [busy, entered, onClaimed]);

  return (
    <View style={styles.card} testID="credits-invite">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Gift size={20} color={colors.accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Invite & earn</Text>
          <Text style={styles.sub}>
            10 credits for you and 5 for them, once they make their first story. Up to 3 friends a month, 10 in all.
          </Text>
        </View>
      </View>

      <View style={styles.codeRow}>
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Your code</Text>
          <Text style={styles.code} testID="credits-invite-code" selectable>
            {code ?? "—"}
          </Text>
        </View>
        <Pressable
          onPress={() => void share()}
          disabled={!code}
          accessibilityRole="button"
          accessibilityLabel="Share invite code"
          accessibilityState={{ disabled: !code }}
          testID="credits-invite-share"
          style={({ pressed }) => [
            styles.share,
            pressed && styles.sharePressed,
            !code && styles.shareDisabled,
          ]}
        >
          <Text style={styles.shareLabel}>Share</Text>
        </Pressable>
      </View>

      {referral
        ? (
          <Text style={styles.counts} testID="credits-invite-counts">
            {referral.invited} invited · {referral.credited} credited · {referral.monthRemaining} left this month
          </Text>
        )
        : null}

      <View style={styles.enter}>
        <Text style={styles.enterLabel}>Have an invite code?</Text>
        <View style={styles.enterRow}>
          <TextInput
            value={entered}
            onChangeText={(next) => {
              setNotice(null);
              setEntered(next.trim().toLowerCase().slice(0, 32));
            }}
            editable={!accepted}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="friend_code"
            placeholderTextColor={colors.tertiary}
            accessibilityLabel="Invite code"
            testID="credits-invite-input"
            style={styles.input}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={busy || accepted || entered.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Apply invite code"
            accessibilityState={{ disabled: busy || accepted || entered.trim().length === 0 }}
            testID="credits-invite-apply"
            style={({ pressed }) => [
              styles.apply,
              pressed && styles.applyPressed,
              (busy || accepted || entered.trim().length === 0) && styles.applyDisabled,
            ]}
          >
            <Text style={styles.applyLabel}>{busy ? "..." : "Apply"}</Text>
          </Pressable>
        </View>
        {notice ? <Text style={styles.notice} testID="credits-invite-notice">{notice}</Text> : null}
        <Text style={styles.fine}>Codes work on accounts less than a week old.</Text>
      </View>
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
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  codeBox: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  codeLabel: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  code: { fontFamily: fonts.display, color: colors.ink, fontSize: 20 },
  share: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sharePressed: { backgroundColor: colors.accentPressed },
  shareDisabled: { backgroundColor: colors.borderStrong },
  shareLabel: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "800", fontSize: 14 },
  counts: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 12 },
  enter: { gap: spacing.related, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.track },
  enterLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 14 },
  enterRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
  },
  apply: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  applyPressed: { opacity: 0.85 },
  applyDisabled: { backgroundColor: colors.borderStrong },
  applyLabel: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "800", fontSize: 14 },
  notice: { fontFamily: fonts.ui, color: colors.accent, fontWeight: "700", fontSize: 13 },
  fine: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 12 },
});
