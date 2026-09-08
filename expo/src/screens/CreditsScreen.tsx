import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import { CREDITS_PER_AUDIO_UNLOCK, CREDITS_PER_GENERATION, formatCredits } from "@/lib/pricing";
import { SectionHeader } from "@/components/KathaPrimitives";
import { ledger } from "@/data/seed";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/* ─────────────────────────────── Credits Screen ─────────────────────────────── */

export default function CreditsScreen(
  { credits, onBack }: { credits: number; onBack: () => void },
) {
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>Credits</Text>
        <Text style={styles.h1}>{credits} credits available</Text>
        <View style={styles.creditHero}>
          <Sparkles size={32} color={colors.accent} />
          <Text style={styles.creditHeroTitle}>
            Credits create stories and chapters
          </Text>
          <Text style={styles.creditHeroText}>
            {`Writing a chapter costs ${
              formatCredits(CREDITS_PER_GENERATION)
            }. Unlocking a chapter's audio costs ${
              formatCredits(CREDITS_PER_AUDIO_UNLOCK)
            }, and you can listen again as often as you like, forever. Reading is always free.`}
          </Text>
        </View>
        <SectionHeader title="History" />
        {ledger.map((entry) => (
          <View key={entry.id} style={styles.ledgerRow}>
            <View>
              <Text style={styles.settingsTitle}>{entry.label}</Text>
              <Text style={styles.settingsSubtitle}>{entry.createdAt}</Text>
            </View>
            <Text
              style={[
                styles.ledgerAmount,
                entry.amount > 0 ? styles.positive : styles.negative,
              ]}
            >
              {entry.amount > 0 ? "+" : ""}
              {entry.amount}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
  creditHero: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  creditHeroTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 24,
    lineHeight: 28,
  },
  creditHeroText: { fontFamily: fonts.ui, color: colors.muted, lineHeight: 21 },
  ledgerRow: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  ledgerAmount: { fontFamily: fonts.ui, fontSize: 18, fontWeight: "900" },
  positive: { color: colors.success },
  negative: { color: colors.premium },

  /* ── Author screen ── */
  }),
};
