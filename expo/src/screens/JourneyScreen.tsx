import { useEffect, useState } from "react";
import {
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
  CalendarDays,
  Check,
  ChevronLeft,
  Flame,
  Lock,
  Trophy,
} from "lucide-react-native";
import ActivityGrid from "@/components/profile/ActivityGrid";
import {
  fetchActivityCalendar,
  type OwnProfile,
  STREAK_MILESTONES,
  streakState,
} from "@/lib/profile";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * Your journey — the reader's own record, and the only screen in Katha whose
 * whole job is to be about them rather than about a story.
 *
 * WHAT IT SHOWS AND IN WHAT ORDER. Member since, then the two numbers, then
 * whether today is safe, then the calendar, then the milestones. That is
 * deliberately from most settled to least: the join date never changes, the
 * streak changes daily, and the milestone list is the only part that is about
 * something that has not happened yet. A screen that opens with an unclaimed
 * reward is a screen that opens by asking for something.
 *
 * WHAT IT DOES NOT SHOW. No reads, no likes, no chapter counts. Those were
 * here and are gone: they are the writer's business, they live in Library
 * where the stories are, and putting a "likes" total on the same surface as a
 * streak turns a private record of a habit into a scoreboard. The owner's
 * decision, and the right one.
 *
 * NO COMMENTS EITHER. They were considered for this screen and belong on the
 * public profile instead, under the activity and the follower counts, because
 * a comment is a thing said to other people and this page is not for them.
 *
 * MILESTONES ARE NOT REWARDS. Reaching one grants nothing — no credit, no
 * badge, no unlock — because none of those exist, and inventing them here
 * would be the dishonest gamification the rest of the streak surface has
 * carefully avoided. A milestone is a name for a number, which is enough.
 */
export default function JourneyScreen({
  profile,
  onBack,
}: {
  /** Null while loading or when the profile could not be read. */
  profile: OwnProfile | null;
  onBack: () => void;
}) {
  const [days, setDays] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetchActivityCalendar()
      .then((next) => {
        if (alive) setDays(next);
      })
      .catch(() => {
        if (alive) setDays(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const streak = profile ? streakState(profile) : null;
  const current = profile?.currentStreak ?? 0;
  const longest = profile?.longestStreak ?? 0;
  const earnedToday = streak?.kind === "today";

  // No profile is not a profile of zeros.
  //
  // Rendering the page with `?? 0` would tell somebody with a 40 day streak
  // that they have none, and lock every milestone they have already reached,
  // because a request failed. That is the specific dishonesty the rest of this
  // surface is built to avoid, so the page says it cannot answer instead.
  if (!profile) {
    return (
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.pagePad}>
          <View style={styles.topBar}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={styles.backButton}
            >
              <ChevronLeft size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.title}>Your journey</Text>
          </View>
          <Text style={styles.unavailable} testID="journey-unavailable">
            Your journey could not be loaded just now.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.pagePad}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.backButton}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>Your journey</Text>
        </View>

        {profile?.memberSince && (
          <View style={styles.memberSince}>
            <CalendarDays size={16} color={colors.muted} />
            <Text style={styles.memberSinceText}>
              Member since {formatJoined(profile.memberSince)}
            </Text>
          </View>
        )}

        {/* The two numbers, side by side. Current first: it is the one with a
            deadline. */}
        <View style={styles.statRow}>
          <View style={styles.statCard} testID="journey-current-streak">
            <Flame size={26} color={colors.accent} />
            <Text style={styles.statValue}>{current}</Text>
            <Text style={styles.statLabel}>Current streak</Text>
          </View>
          <View style={styles.statCard} testID="journey-longest-streak">
            <Trophy size={26} color={colors.chromeStar} />
            <Text style={styles.statValue}>{longest}</Text>
            <Text style={styles.statLabel}>Longest streak</Text>
          </View>
        </View>

        {/* One line about today, and it is the only line here allowed to be
            urgent — because it is the only one where something is genuinely
            about to be lost. */}
        {streak && (
          <View style={styles.todayRow}>
            {earnedToday
              ? (
                <>
                  <View style={styles.todayTick}>
                    <Check size={12} color={colors.surface} strokeWidth={3} />
                  </View>
                  <Text style={styles.todayEarned}>Today's streak earned</Text>
                </>
              )
              : (
                <Text style={styles.todayPending}>
                  {streak.kind === "at_risk"
                    ? "Read or write today to keep it"
                    : "Read or write today and it starts"}
                </Text>
              )}
          </View>
        )}

        <Text style={styles.sectionTitle}>Activity</Text>
        <View style={styles.gridCard}>
          <ActivityGrid days={days === undefined ? null : days} />
        </View>

        <Text style={styles.sectionTitle}>Milestones</Text>
        <View style={styles.milestones}>
          {STREAK_MILESTONES.map((milestone, index) => {
            // Achieved is measured against the LONGEST streak, not the current
            // one. Something reached in March stays reached in June; a
            // milestone that un-achieves itself when a streak breaks would
            // punish the same lapse twice.
            const achieved = longest >= milestone;
            return (
              <View
                key={milestone}
                testID={`milestone-${milestone}`}
                style={[
                  styles.milestoneRow,
                  index < STREAK_MILESTONES.length - 1 && styles.milestoneDivider,
                ]}
              >
                <View
                  style={[
                    styles.milestoneIcon,
                    achieved ? styles.milestoneIconDone : styles.milestoneIconLocked,
                  ]}
                >
                  {achieved
                    ? <Check size={16} color={colors.accent} strokeWidth={3} />
                    : <Lock size={14} color={colors.tertiary} />}
                </View>
                <View style={styles.milestoneText}>
                  <Text style={styles.milestoneTitle}>
                    {milestone} day streak
                  </Text>
                  <Text style={styles.milestoneCaption}>
                    {achieved
                      ? "Reached"
                      : current > 0
                      ? `${milestone - current} to go`
                      : "Keep going"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** "Aug 1, 2026" from an ISO timestamp, read as UTC so it never drifts a day. */
function formatJoined(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -8,
    },
    title: { fontFamily: fonts.display, color: colors.ink, fontSize: 26 },
    memberSince: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.lg,
    },
    unavailable: {
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 14,
    },
    memberSinceText: {
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 14,
    },
    statRow: { flexDirection: "row", gap: spacing.md },
    statCard: {
      flex: 1,
      paddingVertical: spacing.xl,
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statValue: {
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 40,
      lineHeight: 46,
    },
    statLabel: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },
    todayRow: {
      marginTop: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    todayTick: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    todayEarned: {
      fontFamily: fonts.ui,
      color: colors.accent,
      fontWeight: "700",
      fontSize: 14,
    },
    todayPending: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14 },
    sectionTitle: {
      marginTop: spacing.betweenGroups,
      marginBottom: spacing.md,
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 22,
    },
    gridCard: {
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    milestones: {
      marginBottom: spacing.xl,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    milestoneRow: {
      padding: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    milestoneDivider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    milestoneIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
    },
    milestoneIconDone: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    milestoneIconLocked: {
      backgroundColor: colors.surface2,
      borderColor: colors.borderStrong,
    },
    milestoneText: { flex: 1 },
    milestoneTitle: {
      fontFamily: fonts.ui,
      color: colors.ink,
      fontWeight: "700",
      fontSize: 16,
    },
    milestoneCaption: {
      marginTop: 2,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
  }),
};
