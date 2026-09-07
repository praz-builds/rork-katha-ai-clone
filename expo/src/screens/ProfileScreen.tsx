import { Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bell, BookOpen, ChevronLeft, ChevronRight, Lock, MessageCircle, Sparkles, Star } from "lucide-react-native";
import { PrimaryButton } from "@/components/KathaPrimitives";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/* ─────────────────────────────── Profile Screen (overlay) ─────────────────────────────── */

export default function ProfileScreen({
  credits,
  onBack,
  onCredits,
  onPaywall,
  onCustomerCenter,
}: {
  credits: number;
  onBack: () => void;
  onCredits: () => void;
  onPaywall: () => void;
  onCustomerCenter: () => void;
}) {
  const settingsRows = [
    ["Notifications", "Chapter alerts and streak nudges", Bell],
    ["Reading preferences", "Theme, font size, language", BookOpen],
    ["Katha Plus", "Subscription, voices, ad-free", Star],
    ["Parental controls", "Kids mode and PIN gate", Lock],
    ["Feedback", "Comments, rating, support", MessageCircle],
  ] as const;

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.pagePad}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with back button */}
        <View style={styles.profileHeader}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={20} color={colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <View style={styles.backButton} />
        </View>

        {/* User card */}
        <View style={styles.profileCard}>
          <Image
            source={require("../../assets/icon.png")}
            style={styles.profileAvatar}
          />
          <Text style={styles.profileName}>Reader Writer</Text>
          <Text style={styles.profileMeta}>@you - 3-day streak</Text>
          <View style={styles.profileActions}>
            <View style={styles.profileButtonRow}>
              <View style={styles.profileButtonHalf}>
                <PrimaryButton variant="secondary" onPress={onPaywall}>
                  See Plus
                </PrimaryButton>
              </View>
              <View style={styles.profileButtonHalf}>
                <PrimaryButton
                  variant="secondary"
                  onPress={() =>
                    Alert.alert(
                      "Coming soon",
                      "Profile editing will be available soon.",
                    )}
                >
                  Edit Profile
                </PrimaryButton>
              </View>
            </View>
          </View>
        </View>

        {/* Credits row */}
        <Pressable onPress={onCredits} style={styles.creditsRow}>
          <View style={styles.settingsIcon}>
            <Sparkles size={20} color={colors.accent} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsTitle}>Credits</Text>
            <Text style={styles.settingsSubtitle}>{credits} available</Text>
          </View>
          <ChevronRight size={20} color={colors.tertiary} />
        </Pressable>

        {/* Settings rows */}
        <View style={styles.settingsList}>
          {settingsRows.map(([title, subtitle, Icon]) => {
            const handler = title === "Katha Plus"
              ? onCustomerCenter
              : () =>
                Alert.alert("Coming soon", `${title} will be available soon.`);
            return (
              <Pressable
                key={title}
                onPress={handler}
                accessibilityRole="button"
                style={styles.settingsRow}
              >
                <View style={styles.settingsIcon}>
                  <Icon size={20} color={colors.accent} />
                </View>
                <View style={styles.settingsText}>
                  <Text style={styles.settingsTitle}>{title}</Text>
                  <Text style={styles.settingsSubtitle}>{subtitle}</Text>
                </View>
                <ChevronRight size={16} color={colors.tertiary} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.legalFooter}>
          Privacy Policy - Terms of Service - v0.1.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  profileHeaderTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 20,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  profileCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  profileName: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 24,
  },
  profileActions: { marginTop: spacing.lg, width: "100%" },
  profileButtonRow: { flexDirection: "row", gap: spacing.md },
  profileButtonHalf: { flex: 1 },
  creditsRow: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  legalFooter: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    textAlign: "center",
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
  },
  settingsList: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  settingsRow: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsText: { flex: 1 },
  }),
};
