import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronRight,
  Crown,
  FileText,
  Flame,
  HelpCircle,
  LogOut,
  Pencil,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react-native";
import { TAB_BAR_CLEARANCE } from "@/components/BottomTabs";
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
import IdentityEditor, { type IdentityEdits } from "@/components/profile/IdentityEditor";
import MemberSheet from "@/components/profile/MemberSheet";
import { creatureSource } from "@/lib/creatures";
import { useIsSubscribed } from "@/lib/entitlements";
import {
  fetchOwnProfile,
  type OwnProfile,
  streakState,
} from "@/lib/profile";
import { revenueCatService } from "@/lib/revenuecat";
import { signOutToGuest } from "@/lib/session";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/** The legal pages (D12). Opened in the system browser, never rendered in-app. */
export const PRIVACY_URL = "https://katha.thetractionlabs.com/privacy";
export const TERMS_URL = "https://katha.thetractionlabs.com/terms";

/**
 * The reader's own profile.
 *
 * THE HEADER (D5). Avatar and username on one row, the pencil on the right.
 * The pencil is the only edit affordance: the separate "Edit profile" button
 * it replaced was a second door to the same sheet. The avatar is the photo if
 * there is one, else the creature the server assigned (every account has
 * one, preassigned and changeable), else a placeholder for a profile that has
 * not loaded.
 *
 * NO GUESTS (D1). Onboarding forces email before Home, so there is nobody
 * anonymous to show a "sign in to keep this" card to, and the card is gone.
 * Signing out routes to the sign-in screen, never to a fresh guest.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER. Katha Plus, then Credits, then Your
 * journey, then everything else. The first two are about what this account
 * can currently do, the third is the only thing here that changes between
 * two visits, and settings are identical every day, so they sit below.
 *
 * KATHA PLUS (D7). A member sees a member state: the Customer Center where it
 * exists, and a sheet of plan facts where it does not (web, or an
 * unconfigured SDK). A free account goes to the paywall. The row never sends
 * a paying customer to a screen that asks them to pay.
 *
 * NO HEADING. The tab bar already says which tab this is, in a word the reader
 * just tapped.
 */
export default function ProfileScreen({
  credits,
  onCredits,
  onPaywall,
  onJourney,
  onPublicProfile,
  onVoices,
  onSignedOut,
  onDeleted,
}: {
  credits: number;
  onCredits: () => void;
  onPaywall: () => void;
  onJourney: (profile: OwnProfile | null) => void;
  onPublicProfile: (authorId: string) => void;
  onVoices: () => void;
  onSignedOut: () => void;
  onDeleted: (storiesKept: number) => void;
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [memberSheet, setMemberSheet] = useState(false);
  const subscribed = useIsSubscribed();

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

  const applyEdits = useCallback((next: IdentityEdits) => {
    setProfile((current) => (current ? { ...current, ...next } : current));
  }, []);

  const openPlus = useCallback(() => {
    if (!subscribed) {
      onPaywall();
      return;
    }
    revenueCatService
      .presentCustomerCenter()
      .then((presented) => {
        // Unavailable on web, or the SDK never configured: the sheet says
        // what the plan includes rather than leaving the row doing nothing.
        if (!presented) setMemberSheet(true);
      })
      .catch(() => setMemberSheet(true));
  }, [onPaywall, subscribed]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      "Sign out?",
      "Your stories and streak stay with your account. You can sign back in any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            void signOutToGuest().then(onSignedOut).catch(() => {
              Alert.alert(
                "Could not sign out",
                "Something went wrong. Please try again.",
              );
            });
          },
        },
      ],
    );
  }, [onSignedOut]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert("Could not open that page", url);
    });
  }, []);

  const streak = profile ? streakState(profile) : null;
  const streakDays = streak && streak.kind !== "none" && streak.kind !== "broken"
    ? streak.days
    : profile?.currentStreak ?? 0;

  const name = profile?.displayName ?? null;
  const handle = profile?.username ? `@${profile.username}` : null;
  const creature = profile?.avatarUrl ? null : creatureSource(profile?.avatarId);

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.withTabs}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity: avatar, name and handle on one row, the pencil on the
            right. No page title above it; see the note on this component. */}
        <View style={styles.identity} testID="profile-header">
          <View style={styles.avatarWrap} testID="profile-avatar">
            {profile?.avatarUrl
              ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                  testID="profile-avatar-photo"
                />
              )
              : creature
              ? (
                <Image
                  source={creature}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                  testID="profile-avatar-creature"
                />
              )
              : <UserRound size={26} color={colors.tertiary} />}
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {name ?? handle ?? "Your profile"}
            </Text>
            {name && handle
              ? <Text style={styles.meta} numberOfLines={1}>{handle}</Text>
              : null}
          </View>
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile"
            hitSlop={8}
            testID="profile-edit"
            style={({ pressed }) => [styles.pencil, pressed && styles.pressed]}
          >
            <Pencil size={18} color={colors.strong} />
          </Pressable>
        </View>

        {/* 1. Katha Plus. First because it is the answer to "what does this
            account get", which everything below is downstream of. */}
        <Pressable
          onPress={openPlus}
          accessibilityRole="button"
          accessibilityLabel="Katha Plus"
          testID="profile-premium"
          style={({ pressed }) => [styles.card, styles.firstGroup, pressed && styles.pressed]}
        >
          <View style={styles.rowIcon}>
            <Crown size={20} color={colors.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Katha Plus</Text>
            <Text style={styles.rowSubtitle}>
              {subscribed ? "You're a Katha member" : "Subscription, voices, ad-free"}
            </Text>
          </View>
          {subscribed
            ? (
              <View style={styles.memberBadge} testID="profile-member-badge">
                <Text style={styles.memberBadgeLabel}>Member</Text>
              </View>
            )
            : <ChevronRight size={16} color={colors.tertiary} />}
        </Pressable>

        {/* 2. Credits. The number that gates creating anything. */}
        <Pressable
          onPress={onCredits}
          accessibilityRole="button"
          testID="profile-credits"
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.rowIcon}>
            <Sparkles size={20} color={colors.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Credits</Text>
            <Text style={styles.rowSubtitle}>{credits} available</Text>
          </View>
          {/*
            A View, deliberately, not a second Pressable. The whole row already
            navigates to Credits, so an inner button would be a button inside a
            button: invalid HTML, and react-native-web renders exactly that on
            the web build, where it throws a hydration error and the row stops
            responding. The pill is the affordance; the row is the target.
          */}
          <View style={styles.buyButton} testID="profile-buy-credits">
            <Text style={styles.buyLabel}>Get more</Text>
          </View>
        </Pressable>

        {/* 3. Your journey. The streak lives behind this row rather than on
            this screen: the calendar and the milestones need a page, and a
            two-line summary of them here would be a second, worse version of
            the same thing. */}
        <Pressable
          onPress={() => onJourney(profile)}
          accessibilityRole="button"
          accessibilityLabel="Your journey"
          testID="profile-journey"
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.rowIcon}>
            <Flame size={20} color={colors.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Your journey</Text>
            <Text style={styles.rowSubtitle}>
              {streakDays > 0
                ? `${streakDays} day streak, and the days behind it`
                : "Your streak, your calendar and your milestones"}
            </Text>
          </View>
          <ChevronRight size={16} color={colors.tertiary} />
        </Pressable>

        {/* 4. The public page. Opened, not previewed. */}
        {profile && (
          <Pressable
            onPress={() => onPublicProfile(profile.userId)}
            accessibilityRole="button"
            accessibilityLabel="View public profile"
            testID="profile-public"
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.rowIcon}>
              <UserRound size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>View public profile</Text>
              <Text style={styles.rowSubtitle}>
                {profile.followers} {profile.followers === 1
                  ? "follower"
                  : "followers"} · {profile.following} following
              </Text>
            </View>
            <ChevronRight size={16} color={colors.tertiary} />
          </Pressable>
        )}

        {!profile && loaded && (
          <Text style={styles.unavailable} testID="profile-unavailable">
            Your profile could not be loaded just now.
          </Text>
        )}

        {/* Everything below changes rarely or never. */}
        <View style={styles.group}>
          <Row
            icon={Volume2}
            title="Audiobook voices"
            subtitle="Choose the voice chapters are read in"
            onPress={onVoices}
            testID="profile-voices"
            grouped
          />
          <Row
            icon={HelpCircle}
            title="How credits work"
            subtitle="Every price, streaks and invites"
            onPress={onCredits}
            testID="profile-faq"
            grouped
          />
          <Row
            icon={Shield}
            title="Privacy Policy"
            onPress={() => openLink(PRIVACY_URL)}
            testID="profile-privacy"
            grouped
          />
          <Row
            icon={FileText}
            title="Terms of Use"
            onPress={() => openLink(TERMS_URL)}
            testID="profile-terms"
            grouped
            last
          />
        </View>

        {/* The danger zone. Separated by space and by colour. */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerHeading}>Account</Text>
          <Pressable
            onPress={confirmSignOut}
            accessibilityRole="button"
            testID="profile-sign-out"
            style={({ pressed }) => [
              styles.dangerRow,
              pressed && styles.pressed,
            ]}
          >
            <LogOut size={18} color={colors.ink} />
            <Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>
          <Pressable
            onPress={() => setDeleting(true)}
            accessibilityRole="button"
            testID="profile-delete"
            style={({ pressed }) => [
              styles.dangerRow,
              pressed && styles.pressed,
            ]}
          >
            <Trash2 size={18} color={colors.danger} />
            <Text style={styles.deleteLabel}>Delete account</Text>
          </Pressable>
        </View>

        <Text style={styles.version}>v0.1.0</Text>
      </ScrollView>

      <IdentityEditor
        visible={editing}
        username={profile?.username ?? null}
        displayName={profile?.displayName ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
        avatarId={profile?.avatarId ?? null}
        bio={profile?.bio ?? null}
        onClose={() => setEditing(false)}
        onSaved={applyEdits}
      />

      <MemberSheet visible={memberSheet} onClose={() => setMemberSheet(false)} />

      <DeleteAccountSheet
        visible={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={(storiesKept) => {
          setDeleting(false);
          onDeleted(storiesKept);
        }}
      />
    </SafeAreaView>
  );
}

/** One settings row. Grouped rows share a card; a lone row is its own card. */
function Row({
  icon: Icon,
  title,
  subtitle,
  onPress,
  testID,
  grouped,
  last,
  style,
}: {
  icon: typeof Crown;
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
  grouped?: boolean;
  last?: boolean;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      style={({ pressed }) => [
        grouped ? styles.groupedRow : styles.card,
        grouped && !last && styles.groupedDivider,
        style,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon size={20} color={colors.accent} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <ChevronRight size={16} color={colors.tertiary} />
    </Pressable>
  );
}

const AVATAR = 56;

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    /* Room for the tab bar: the profile is a tab, so the last row must not sit
       under it. */
    withTabs: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: TAB_BAR_CLEARANCE,
    },
    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    avatarWrap: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      backgroundColor: colors.surface2,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    avatar: { width: "100%", height: "100%" },
    identityText: { flex: 1, minWidth: 0 },
    name: { fontFamily: fonts.display, color: colors.ink, fontSize: 22 },
    meta: {
      marginTop: spacing.tight,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    pencil: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.85 },
    firstGroup: { marginTop: spacing.betweenGroups },
    card: {
      marginTop: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    group: {
      marginTop: spacing.betweenGroups,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    groupedRow: {
      padding: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    groupedDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    rowIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1 },
    rowTitle: {
      fontFamily: fonts.ui,
      color: colors.ink,
      fontWeight: "700",
      fontSize: 16,
    },
    rowSubtitle: {
      marginTop: 2,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    memberBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    memberBadgeLabel: {
      fontFamily: fonts.ui,
      color: colors.accent,
      fontWeight: "800",
      fontSize: 12,
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
    unavailable: {
      marginTop: spacing.lg,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    dangerZone: {
      marginTop: spacing.betweenGroups,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    dangerHeading: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      fontFamily: fonts.ui,
      color: colors.tertiary,
      fontWeight: "800",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    dangerRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    signOutLabel: {
      fontFamily: fonts.ui,
      color: colors.ink,
      fontWeight: "700",
      fontSize: 15,
    },
    deleteLabel: {
      fontFamily: fonts.ui,
      color: colors.danger,
      fontWeight: "700",
      fontSize: 15,
    },
    version: {
      marginTop: spacing.xl,
      marginBottom: spacing.lg,
      textAlign: "center",
      fontFamily: fonts.ui,
      color: colors.tertiary,
      fontSize: 12,
    },
  }),
};
