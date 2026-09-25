import { useCallback, useEffect, useRef, useState } from "react";
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
  Ban,
  ChevronRight,
  Crown,
  FileText,
  Flame,
  Globe2,
  HelpCircle,
  Languages,
  LogOut,
  MessageSquare,
  Music,
  Pencil,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
  Vote,
} from "lucide-react-native";
import { TAB_BAR_CLEARANCE } from "@/components/BottomTabs";
import BlockedAccountsSheet from "@/components/profile/BlockedAccountsSheet";
import Constants from "expo-constants";
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
import FeedbackSheet from "@/components/profile/FeedbackSheet";
import FeatureVoteSheet from "@/components/profile/FeatureVoteSheet";
import StoryWorldSheet from "@/components/profile/StoryWorldSheet";
import ReaderContextSheet from "@/components/profile/ReaderContextSheet";
import IdentityEditor, { type IdentityEdits } from "@/components/profile/IdentityEditor";
import MemberSheet from "@/components/profile/MemberSheet";
import { Toggle } from "@/components/Toggle";
import i18n from "@/i18n";
import { creatureSource } from "@/lib/creatures";
import { useIsSubscribed } from "@/lib/entitlements";
import { getMusicMuted, setMusicMuted } from "@/lib/music-storage";
import {
  setStoryWorld,
  storyWorldLabel,
  useStoryWorld,
} from "@/lib/story-world";
import {
  EMPTY_READER_PREFERENCES,
  fetchReaderPreferences,
  type ReaderPreferences,
  readerPreferencesSummary,
} from "@/lib/reader-preferences";
import { streakState } from "@/lib/profile";
import {
  FRESH_FOR_MS,
  patchOwnProfile,
  refreshOwnCalendar,
  refreshOwnProfile,
  useOwnProfileStore,
} from "@/lib/profile-store";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
import { revenueCatService } from "@/lib/revenuecat";
import { signOutToSignIn } from "@/lib/session";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/** The legal pages (D12), shared with the paywall. Re-exported for existing callers. */
export { PRIVACY_URL, TERMS_URL };

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
  onJourney: () => void;
  onPublicProfile: (authorId: string) => void;
  onVoices: () => void;
  onSignedOut: () => void;
  onDeleted: (storiesKept: number) => void;
}) {
  // The app's one copy of the profile, drawn at once and refreshed behind it.
  // It used to be fetched from scratch on every visit to this tab, after the
  // boot had already fetched it; see `src/lib/profile-store.ts`.
  const { profile, profileStatus } = useOwnProfileStore();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [memberSheet, setMemberSheet] = useState(false);
  const [blockedSheet, setBlockedSheet] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [votesOpen, setVotesOpen] = useState(false);
  const [storyWorldOpen, setStoryWorldOpen] = useState(false);
  const storyWorld = useStoryWorld();
  const subscribed = useIsSubscribed();

  // Background music. The SAME stored preference the reader's mute control
  // writes (`katha.reader.music-muted.v1`), so a mute in the reader shows here
  // as off, and off here opens the next story silent. The switch reads "on"
  // for music playing, which is the inverse of the stored "muted".
  //
  // On until the read lands, because unmuted is the shipped default and a
  // failed read counts as unmuted. `musicChosenByUserRef` stops a slow read
  // overwriting a flip the person made in the meantime (AGENTS.md, "An async
  // restore must never overwrite a choice already made").
  const [musicOn, setMusicOn] = useState(true);
  const musicChosenByUserRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void getMusicMuted().then((muted) => {
      if (alive && !musicChosenByUserRef.current) setMusicOn(!muted);
    });
    return () => {
      alive = false;
    };
  }, []);
  const changeMusic = useCallback((next: boolean) => {
    musicChosenByUserRef.current = true;
    setMusicOn(next);
    void setMusicMuted(!next);
  }, []);

  // Languages and home, from the account. The same rule as the music switch:
  // a save made while the first read is still in flight must not be undone
  // when that read lands with the older value.
  const [readerPrefs, setReaderPrefs] = useState<ReaderPreferences>(
    EMPTY_READER_PREFERENCES,
  );
  const [readerContextOpen, setReaderContextOpen] = useState(false);
  // The sheet saves BOTH fields, so it may only be edited once the saved
  // value is known: an edit started from an empty stand-in after a failed
  // read would erase the city and languages the reader already had.
  const [readerPrefsStatus, setReaderPrefsStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const readerPrefsChosenByUserRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const loadReaderPrefs = useCallback(() => {
    setReaderPrefsStatus("loading");
    void fetchReaderPreferences().then((prefs) => {
      if (!aliveRef.current || readerPrefsChosenByUserRef.current) return;
      if (prefs) setReaderPrefs(prefs);
      setReaderPrefsStatus(prefs ? "ready" : "failed");
    });
  }, []);
  useEffect(() => {
    loadReaderPrefs();
  }, [loadReaderPrefs]);
  const saveReaderPrefs = useCallback((next: ReaderPreferences) => {
    readerPrefsChosenByUserRef.current = true;
    setReaderPrefs(next);
    setReaderPrefsStatus("ready");
  }, []);

  useEffect(() => {
    void refreshOwnProfile({ maxAgeMs: FRESH_FOR_MS });
    // Journey is one tap away and its heatmap is the slow part. Asked for now,
    // it is usually there by the time the row is tapped.
    void refreshOwnCalendar({ maxAgeMs: FRESH_FOR_MS });
  }, []);

  const applyEdits = useCallback((next: IdentityEdits) => {
    patchOwnProfile(next);
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
            void signOutToSignIn().then(onSignedOut).catch(() => {
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
            {profile || profileStatus === "error"
              ? (
                <>
                  <Text style={styles.name} numberOfLines={1}>
                    {name ?? handle ?? "Your profile"}
                  </Text>
                  {name && handle
                    ? <Text style={styles.meta} numberOfLines={1}>{handle}</Text>
                    : null}
                </>
              )
              : (
                // Not "Your profile" while the name is on its way: that line
                // then swapped for the real name, which read as a glitch. Two
                // bars the size of the text hold the row still instead.
                <View
                  testID="profile-name-skeleton"
                  accessibilityLabel="Loading your profile"
                >
                  <View style={styles.skeletonName} />
                  <View style={styles.skeletonHandle} />
                </View>
              )}
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
            {/* Gold and filled, as on Home, Get credits and the Create brief.
                It was hollow accent-orange here, which made the credits row
                the one place in the app where the spark meant something
                slightly different. */}
            <Sparkles size={20} color={colors.chromeStar} fill={colors.chromeStar} />
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
          onPress={onJourney}
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
        {/* The same row's footprint while the profile loads, so the rows
            below it do not jump down when it arrives. */}
        {!profile && profileStatus !== "error" && (
          <View style={styles.card} testID="profile-public-placeholder">
            <View style={styles.rowIcon}>
              <UserRound size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>View public profile</Text>
              <View style={styles.skeletonSubtitle} />
            </View>
          </View>
        )}

        {!profile && profileStatus === "error" && (
          <Text style={styles.unavailable} testID="profile-unavailable">
            Your profile could not be loaded just now.
          </Text>
        )}

        {/* Everything below changes rarely or never. */}
        {/* Global preferences: how stories sound and where they are rooted,
            for every story rather than one. Named as a section because the
            four rows answer one question -- "how do you like your stories?" --
            and read as unrelated settings when mixed in with the rest. */}
        <View style={styles.group} testID="profile-global-preferences">
          <Text style={styles.groupHeading} accessibilityRole="header">
            Global preferences
          </Text>
          <Row
            icon={Volume2}
            title="Audiobook voices"
            subtitle="Choose the voice chapters are read in"
            onPress={onVoices}
            testID="profile-voices"
            grouped
          />
          {/* Not a Pressable: the Toggle is the control, and a switch inside
              a button is the nested-button trap noted on the credits row. */}
          <View
            style={[styles.groupedRow, styles.groupedDivider]}
            testID="profile-music"
          >
            <View style={styles.rowIcon}>
              <Music size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{i18n.t("profile.music.title")}</Text>
              <Text style={styles.rowSubtitle}>{i18n.t("profile.music.desc")}</Text>
            </View>
            <Toggle
              value={musicOn}
              onValueChange={changeMusic}
              accessibilityLabel={i18n.t("profile.music.toggle")}
              testID="profile-music-toggle"
            />
          </View>
          <Row
            icon={Globe2}
            title="Story world"
            subtitle={storyWorld === "global"
              ? "Anywhere — Katha follows each story's own cues"
              : `${storyWorldLabel(storyWorld)} — where new stories are rooted`}
            onPress={() => setStoryWorldOpen(true)}
            testID="profile-story-world"
            grouped
          />
          <Row
            icon={Languages}
            title="Languages and home"
            subtitle={readerPreferencesSummary(readerPrefs)}
            onPress={() => setReaderContextOpen(true)}
            testID="profile-reader-context"
            grouped
            last
          />
        </View>

        <View style={styles.group}>
          <Row
            icon={MessageSquare}
            title={i18n.t("profile.feedbackSheet.row")}
            subtitle={i18n.t("profile.feedbackSheet.rowDesc")}
            onPress={() => setFeedbackOpen(true)}
            testID="profile-feedback"
            grouped
          />
          <Row
            icon={Vote}
            title="Vote on what's next"
            subtitle="Tell the team which ideas matter most to you"
            onPress={() => setVotesOpen(true)}
            testID="profile-feature-votes"
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
            icon={Ban}
            title="Blocked accounts"
            subtitle="People whose stories and comments you don't see"
            onPress={() => setBlockedSheet(true)}
            testID="profile-blocked"
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

        <Text style={styles.version}>v{APP_VERSION}</Text>
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

      <BlockedAccountsSheet
        visible={blockedSheet}
        onClose={() => setBlockedSheet(false)}
      />
      <FeedbackSheet
        visible={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        screen="profile"
      />

      <StoryWorldSheet
        visible={storyWorldOpen}
        value={storyWorld}
        onChange={(next) => void setStoryWorld(next)}
        onClose={() => setStoryWorldOpen(false)}
      />

      <ReaderContextSheet
        visible={readerContextOpen}
        value={readerPrefs}
        status={readerPrefsStatus}
        onRetry={loadReaderPrefs}
        onSaved={saveReaderPrefs}
        onClose={() => setReaderContextOpen(false)}
      />

      <FeatureVoteSheet visible={votesOpen} onClose={() => setVotesOpen(false)} />

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

/**
 * The version the build was made with. It read a literal "v0.1.0" long after
 * the app became 1.0.0, which is the one number a bug report most needs right.
 */
const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

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
    // Sized to the 22pt name and the 13pt handle they stand in for.
    skeletonName: {
      width: 140,
      height: 20,
      borderRadius: radius.sm,
      backgroundColor: colors.surface2,
    },
    skeletonHandle: {
      marginTop: spacing.sm,
      width: 90,
      height: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.surface2,
    },
    skeletonSubtitle: {
      marginTop: spacing.xs,
      width: 120,
      height: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.surface2,
    },
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
    /*
      No disc. Every other credits affordance in the app lost its plate, and a
      peach capsule at the right end of a white row was the last one left --
      it read as a second card inside the card. The label alone is the
      affordance; the row is the target.
    */
    buyButton: {
      minHeight: 36,
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
    /* The section name at the top of a grouped card: the danger zone's
       heading, for the same job. */
    groupHeading: {
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
