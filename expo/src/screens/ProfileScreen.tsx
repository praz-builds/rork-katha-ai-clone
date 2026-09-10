import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react-native";
import IdentityEditor from "@/components/profile/IdentityEditor";
import StatGrid from "@/components/profile/StatGrid";
import StreakCard from "@/components/profile/StreakCard";
import {
  fetchOwnProfile,
  type OwnProfile,
  streakState,
  writingSince,
} from "@/lib/profile";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * The reader's own profile.
 *
 * THE SHAPE OF THE SCREEN, AND WHY. The competitor's screen this was modelled
 * on leads with a settings list. This one leads with the streak, because the
 * streak is the only thing here that changes between two visits and the only
 * thing that has a deadline. Settings are below the fold, where a list of
 * things that are the same every day belongs.
 *
 * NO PARENTAL CONTROLS. The row existed, opened an alert saying "coming soon",
 * and the owner's decision is that the product does not need them for now.
 * A settings row for a feature nobody is building is a promise, so it is gone
 * rather than disabled.
 *
 * EVERY NUMBER OR NONE. `fetchOwnProfile` returns null when the request fails,
 * and this screen then shows the identity and the settings with no statistics
 * at all. The alternative -- zeros, or the last values we happened to have --
 * would tell a writer with forty published chapters that they have written
 * nothing, which is a worse outcome than an incomplete screen.
 */
export default function ProfileScreen({
  credits,
  isAnonymous,
  onBack,
  onCredits,
  onPaywall,
  onCustomerCenter,
  onSignIn,
}: {
  credits: number;
  /** True for a guest. Almost nothing on this screen means anything to one. */
  isAnonymous?: boolean;
  onBack: () => void;
  onCredits: () => void;
  onPaywall: () => void;
  onCustomerCenter: () => void;
  onSignIn?: () => void;
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOwnProfile()
      .then((next) => {
        if (!alive) return;
        setProfile(next);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const applyEdits = useCallback(
    (next: { username?: string; avatarUrl?: string; bio?: string | null }) => {
      setProfile((current) => (current ? { ...current, ...next } : current));
    },
    [],
  );

  const settingsRows = [
    ["Notifications", "Chapter alerts and streak nudges", Bell],
    ["Reading preferences", "Theme, font size, language", BookOpen],
    ["Katha Plus", "Subscription, voices, ad-free", Star],
    ["Feedback", "Comments, rating, support", MessageCircle],
  ] as const;

  const streak = profile ? streakState(profile) : null;
  const since = profile ? writingSince(profile.memberSince) : null;

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.pagePad}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHeader}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={20} color={colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <View style={styles.backButton} />
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatarWrap}>
            {profile?.avatarUrl
              ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                />
              )
              : <UserRound size={30} color={colors.tertiary} />}
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name}>
              {profile?.username ? `@${profile.username}` : "Your profile"}
            </Text>
            <Text style={styles.meta}>
              {profile?.bio ?? (since ? `Reading since ${since}` : "")}
            </Text>
          </View>
        </View>

        {isAnonymous
          ? (
            /*
             * A guest has no handle, no followers and no stories, and the
             * numbers below would all read zero -- which would be true and
             * useless. Rather than a profile full of nothing, say plainly what
             * an account is for and offer it.
             */
            <View style={styles.guestCard} testID="profile-guest">
              <Text style={styles.guestTitle}>Sign in to keep all of this</Text>
              <Text style={styles.guestBody}>
                Your handle, your streak, the stories you write and the people
                who follow you all live with your account. Reading stays open
                either way.
              </Text>
              <Pressable
                onPress={onSignIn}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                testID="profile-sign-in"
                style={({ pressed }) => [
                  styles.guestButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.guestButtonLabel}>Sign in</Text>
              </Pressable>
            </View>
          )
          : (
            <Pressable
              onPress={() => setEditing(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit your profile"
              testID="profile-edit"
              style={({ pressed }) => [
                styles.editButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.editLabel}>Edit profile</Text>
            </Pressable>
          )}

        {/* Streak and the counts. Absent entirely when nothing came back. */}
        {streak
          ? (
            <View style={styles.numbers}>
              <StreakCard state={streak} />
              <StatGrid
                stats={[
                  { label: "Best streak", value: profile?.longestStreak ?? null },
                  { label: "Stories", value: profile?.storiesWritten ?? null },
                  { label: "Chapters", value: profile?.chaptersWritten ?? null },
                  { label: "Reads", value: profile?.totalReads ?? null },
                  { label: "Likes", value: profile?.totalLikes ?? null },
                  { label: "Phrases", value: profile?.phrasesSaved ?? null },
                  { label: "Followers", value: profile?.followers ?? null },
                  { label: "Following", value: profile?.following ?? null },
                ]}
              />
            </View>
          )
          : loaded && !isAnonymous
          ? (
            <Text style={styles.unavailable} testID="profile-stats-unavailable">
              Your numbers could not be loaded just now.
            </Text>
          )
          : null}

        {/* Credits */}
        <Pressable onPress={onCredits} style={styles.creditsRow}>
          <View style={styles.settingsIcon}>
            <Sparkles size={20} color={colors.accent} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsTitle}>Credits</Text>
            <Text style={styles.settingsSubtitle}>{credits} available</Text>
          </View>
          <Pressable
            onPress={onPaywall}
            accessibilityRole="button"
            accessibilityLabel="Buy credits"
            testID="profile-buy-credits"
            style={({ pressed }) => [
              styles.buyButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buyLabel}>Get more</Text>
          </Pressable>
        </Pressable>

        {/* Settings */}
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

      <IdentityEditor
        visible={editing}
        username={profile?.username ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
        bio={profile?.bio ?? null}
        onClose={() => setEditing(false)}
        onSaved={applyEdits}
      />
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
    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    avatarWrap: {
      width: 72,
      height: 72,
      borderRadius: radius.xl,
      backgroundColor: colors.surface2,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    avatar: { width: "100%", height: "100%" },
    identityText: { flex: 1 },
    name: { fontFamily: fonts.display, color: colors.ink, fontSize: 24 },
    meta: {
      marginTop: 2,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    editButton: {
      marginTop: spacing.md,
      alignSelf: "flex-start",
      minHeight: 40,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    editLabel: {
      fontFamily: fonts.ui,
      color: colors.ink,
      fontWeight: "800",
      fontSize: 14,
    },
    pressed: { opacity: 0.85 },
    guestCard: {
      marginTop: spacing.lg,
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.related,
    },
    guestTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 19 },
    guestBody: {
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    guestButton: {
      marginTop: spacing.sm,
      minHeight: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    guestButtonLabel: {
      fontFamily: fonts.ui,
      color: colors.surface,
      fontWeight: "800",
      fontSize: 15,
    },
    numbers: { marginTop: spacing.betweenGroups, gap: spacing.md },
    unavailable: {
      marginTop: spacing.betweenGroups,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    creditsRow: {
      marginTop: spacing.betweenGroups,
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
    buyButton: {
      minHeight: 36,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    buyLabel: {
      fontFamily: fonts.ui,
      color: colors.accent,
      fontWeight: "800",
      fontSize: 13,
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
