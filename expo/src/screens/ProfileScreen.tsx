import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
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
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react-native";
import { TAB_BAR_CLEARANCE } from "@/components/BottomTabs";
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
import IdentityEditor from "@/components/profile/IdentityEditor";
import {
  fetchOwnProfile,
  type OwnProfile,
  streakState,
} from "@/lib/profile";
import { signOutToGuest } from "@/lib/session";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * The reader's own profile.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER. Premium, then Credits, then Your
 * journey, then everything else. The first two are about what this account
 * can currently do — the two facts a reader opens this screen to check — and
 * the third is the only thing here that changes between two visits. Settings
 * are a list of things that are identical every day, so they sit below all of
 * it.
 *
 * NO HEADING. The tab bar already says which tab this is, in a word the reader
 * just tapped. Home is the one screen that keeps a heading, because it says
 * something the tab bar cannot: the reader's name.
 *
 * NO STATS GRID. Reads, likes, stories, chapters and saved phrases were all
 * here in an eight-cell grid. They are gone. Reads and likes are a scoreboard
 * and belong to nobody but the writer; the story counts already exist in
 * Library, next to the stories they count. What is left on the public side is
 * followers and following, which are the only two numbers here that describe a
 * relationship rather than a performance.
 *
 * WHAT OTHERS SEE IS A SEPARATE DOOR. "View public profile" opens the actual
 * public page rather than a preview of it, so there is exactly one description
 * of what a stranger sees and no second implementation to drift from it.
 */
export default function ProfileScreen({
  credits,
  isAnonymous,
  onCredits,
  onPaywall,
  onCustomerCenter,
  onSignIn,
  onJourney,
  onPublicProfile,
  onVoices,
  onSignedOut,
  onDeleted,
}: {
  credits: number;
  /** True for a guest. Almost nothing on this screen means anything to one. */
  isAnonymous?: boolean;
  onCredits: () => void;
  onPaywall: () => void;
  onCustomerCenter: () => void;
  onSignIn?: () => void;
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
    (
      next: {
        username?: string;
        displayName?: string | null;
        avatarUrl?: string;
        bio?: string | null;
      },
    ) => {
      setProfile((current) => (current ? { ...current, ...next } : current));
    },
    [],
  );

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

  const streak = profile ? streakState(profile) : null;
  const streakDays = streak && streak.kind !== "none" && streak.kind !== "broken"
    ? streak.days
    : profile?.currentStreak ?? 0;

  const name = profile?.displayName ?? null;
  const handle = profile?.username ? `@${profile.username}` : null;

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.withTabs}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity. No page title above it — see the note on this component. */}
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
            <Text style={styles.name} numberOfLines={1}>
              {name ?? handle ?? "Your profile"}
            </Text>
            {name && handle
              ? <Text style={styles.meta}>{handle}</Text>
              : profile?.bio
              ? <Text style={styles.meta} numberOfLines={2}>{profile.bio}</Text>
              : null}
          </View>
        </View>

        {isAnonymous
          ? (
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

        {/* 1. Premium. First because it is the answer to "what does this
            account get", which everything below is downstream of. */}
        <Row
          icon={Crown}
          title="Katha Plus"
          subtitle="Subscription, voices, ad-free"
          onPress={onCustomerCenter}
          testID="profile-premium"
          style={styles.firstGroup}
        />

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
        {!isAnonymous && profile && (
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

        {!profile && loaded && !isAnonymous && (
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
            title="FAQ"
            subtitle="How credits, streaks and stories work"
            onPress={() => Alert.alert("Coming soon", "The FAQ is on its way.")}
            testID="profile-faq"
            grouped
          />
          <Row
            icon={Shield}
            title="Privacy Policy"
            onPress={() =>
              Alert.alert("Coming soon", "The privacy policy is on its way.")}
            testID="profile-privacy"
            grouped
          />
          <Row
            icon={FileText}
            title="Terms of Use"
            onPress={() =>
              Alert.alert("Coming soon", "The terms are on their way.")}
            testID="profile-terms"
            grouped
            last
          />
        </View>

        {/* The danger zone. Separated by space and by colour, and only ever
            shown to somebody who has an account to lose — a guest signing out
            of a session they never claimed is a button with no meaning. */}
        {!isAnonymous && (
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
                styles.dangerRowLast,
                pressed && styles.pressed,
              ]}
            >
              <Trash2 size={18} color={colors.danger} />
              <Text style={styles.deleteLabel}>Delete account</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.version}>v0.1.0</Text>
      </ScrollView>

      <IdentityEditor
        visible={editing}
        username={profile?.username ?? null}
        displayName={profile?.displayName ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
        bio={profile?.bio ?? null}
        onClose={() => setEditing(false)}
        onSaved={applyEdits}
      />

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
    // 20 (`type.titleSmall`), not the 19 this was. A single off-ramp point is
    // invisible on its own and is how a ramp stops being one.
    guestTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 20 },
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
    dangerRowLast: {},
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
