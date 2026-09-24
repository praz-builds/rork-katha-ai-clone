import { useEffect } from "react";
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
import { Button } from "@/components/Button";
import {
  FALLBACK_LADDER,
  type OwnProfile,
  type StreakRung,
  streakState,
} from "@/lib/profile";
import {
  FRESH_FOR_MS,
  refreshOwnCalendar,
  refreshOwnProfile,
  useOwnProfileStore,
} from "@/lib/profile-store";
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
 * MILESTONES ARE THE LADDER (D2). Five rungs, at 2, 5, 10, 15 and 21 days,
 * paying 2, 4, 6, 8 and 10 credits once each, and this page lists exactly
 * those with what each pays. The rungs come from `profile.ladder`, which is
 * the server's `streak_ladder()`, so the page cannot promise a rung the
 * server does not pay; `FALLBACK_LADDER` stands in only when a deploy
 * predates it. A reached rung reads "Achieved on Sep 8, 2026" from
 * `profile.milestones`, which is the row the grant was written against.
 */
export default function JourneyScreen({
  profile: handedProfile,
  onBack,
}: {
  /**
   * The profile the opener already had, if any. The app-wide copy wins when it
   * exists; this only fills the first frame when it does not.
   */
  profile?: OwnProfile | null;
  onBack: () => void;
}) {
  const store = useOwnProfileStore();
  const profile = store.profile ?? handedProfile ?? null;
  const days = store.calendar;

  useEffect(() => {
    // Quietly, behind whatever is already drawn. The Profile tab usually
    // started both of these a moment ago, in which case this joins them.
    void refreshOwnProfile({ maxAgeMs: FRESH_FOR_MS });
    void refreshOwnCalendar({ maxAgeMs: FRESH_FOR_MS });
  }, []);

  // Loading is not failing. Only a request that has actually come back empty
  // may say so; before that the page holds its shape instead.
  const profileFailed = !profile && store.profileStatus === "error";
  const calendarState: "loading" | "ready" | "error" = days
    ? "ready"
    : store.calendarStatus === "error"
    ? "error"
    : "loading";

  const streak = profile ? streakState(profile) : null;
  const current = profile?.currentStreak ?? 0;
  const longest = profile?.longestStreak ?? 0;
  const earnedToday = streak?.kind === "today";

  // No profile is not a profile of zeros.
  //
  // Rendering the page with `?? 0` would tell somebody with a 40 day streak
  // that they have none, and lock every milestone they have already reached,
  // because a request failed. That is the specific dishonesty the rest of this
  // surface is built to avoid, so the page says it cannot answer instead --
  // but only once it has actually failed, and with a way to try again. While
  // the profile is still on its way the page shows its own outline.
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
          {profileFailed
            ? (
              <View testID="journey-unavailable">
                <Text style={styles.unavailable}>
                  Your journey could not be loaded just now.
                </Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  testID="journey-retry"
                  style={styles.retry}
                  onPress={() => {
                    void refreshOwnProfile();
                    if (!days) void refreshOwnCalendar();
                  }}
                />
              </View>
            )
            : (
              <View testID="journey-loading" accessibilityLabel="Loading your journey">
                <View style={styles.statRow}>
                  <View style={[styles.statCard, styles.skeletonCard]} />
                  <View style={[styles.statCard, styles.skeletonCard]} />
                </View>
                <Text style={styles.sectionTitle}>Activity</Text>
                <View style={styles.gridCard}>
                  <ActivityGrid days={days} loading={calendarState === "loading"} />
                </View>
              </View>
            )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const ladder: readonly StreakRung[] = profile.ladder.length > 0
    ? profile.ladder
    : FALLBACK_LADDER;
  const rows = ladder.map((rung) => milestoneRow(rung, profile, current, longest));

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

        {profile.memberSince && (
          <View style={styles.memberSince}>
            <CalendarDays size={16} color={colors.muted} />
            <Text style={styles.memberSinceText}>
              Member since {formatDate(profile.memberSince)}
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
          <ActivityGrid days={days} loading={calendarState === "loading"} />
          {calendarState === "error"
            ? (
              // The profile arrived and the calendar did not: the calendar
              // gets its own way to try again rather than a dead end.
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                fullWidth={false}
                testID="journey-calendar-retry"
                style={styles.retry}
                onPress={() => {
                  void refreshOwnCalendar();
                }}
              />
            )
            : null}
        </View>

        <Text style={styles.sectionTitle}>Milestones</Text>
        <View style={styles.milestones}>
          {rows.map((row, index) => (
            <View
              key={row.milestone}
              testID={`milestone-${row.milestone}`}
              style={[
                styles.milestoneRow,
                index < rows.length - 1 && styles.milestoneDivider,
              ]}
            >
              <View
                style={[
                  styles.milestoneIcon,
                  row.achieved ? styles.milestoneIconDone : styles.milestoneIconLocked,
                ]}
              >
                {row.achieved
                  ? <Check size={16} color={colors.accent} strokeWidth={3} />
                  : <Lock size={14} color={colors.tertiary} />}
              </View>
              <View style={styles.milestoneText}>
                <Text style={styles.milestoneTitle}>
                  {row.milestone} day streak
                </Text>
                <Text
                  style={[styles.milestoneCaption, row.achieved && styles.milestoneCaptionDone]}
                >
                  {row.caption}
                </Text>
              </View>
              <Text style={[styles.milestoneCredits, row.achieved && styles.milestoneCreditsDone]}>
                +{row.credits} {row.credits === 1 ? "credit" : "credits"}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type MilestoneRow = {
  milestone: number;
  credits: number;
  achieved: boolean;
  caption: string;
};

/**
 * One rung, as the page describes it.
 *
 * Achieved is read from `profile.milestones` first, which carries the date
 * the rung was reached, and from the LONGEST streak second, for a deploy that
 * has not written those rows yet. Never from the current streak: something
 * reached in March stays reached in June, and a rung that un-achieves itself
 * when a streak breaks punishes the same lapse twice.
 */
function milestoneRow(
  rung: StreakRung,
  profile: OwnProfile,
  current: number,
  longest: number,
): MilestoneRow {
  const reached = profile.milestones.find((row) => row.milestone === rung.milestone);
  const achievedOn = reached?.achievedAt ? formatDate(reached.achievedAt) : "";
  // `achievedAt`, not the row's existence: the server returns a row for EVERY
  // rung on the ladder, reached or not, and reading presence alone lit up all
  // five the moment a brand-new account opened this page.
  const achieved = Boolean(reached?.achievedAt) || longest >= rung.milestone;
  const caption = achieved
    ? achievedOn ? `Achieved on ${achievedOn}` : "Achieved"
    : current > 0
    ? `${rung.milestone - current} to go`
    : "Keep going";
  return { milestone: rung.milestone, credits: rung.credits, achieved, caption };
}

/** "Aug 1, 2026" from an ISO timestamp, read as UTC so it never drifts a day. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
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
    retry: { marginTop: spacing.md, alignSelf: "flex-start" },
    /** A stat card's footprint with nothing in it yet. */
    skeletonCard: { minHeight: 118, backgroundColor: colors.surface2 },
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
    milestoneCaptionDone: { color: colors.accent },
    milestoneCredits: {
      fontFamily: fonts.ui,
      color: colors.tertiary,
      fontWeight: "800",
      fontSize: 13,
    },
    milestoneCreditsDone: { color: colors.ink },
  }),
};
