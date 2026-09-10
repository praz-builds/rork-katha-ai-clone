import type { ComponentType } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Bell, ChevronRight, Coins, Flame } from "lucide-react-native";
import { PrimaryButton } from "@/components/KathaPrimitives";
import { FeedRail } from "@/components/feed/FeedRail";
import WriteAnotherCTA from "@/components/feed/WriteAnotherCTA";
import { colors, fonts, genreLabels, radius, shadows, spacing, type } from "@/theme";
import type { Genre, Story } from "@/types/domain";

/**
 * A named row of stories, in the order it should render. `key` is a stable
 * React key that survives a genre's stories emptying out and coming back
 * (an index would not), and it is also the seam a future server-driven feed
 * would key its sections on, so a swap from "compute rows client-side" to
 * "fetch rows from an endpoint" only touches `buildFeedRows`, never the JSX
 * that renders them.
 */
type FeedRow = {
  key: string;
  title: string;
  stories: Story[];
};

/** A row this many stories deep is a scroll, not a browse; longer lists belong on Explore. */
const RAIL_LENGTH = 10;

/**
 * The stories the reader wrote that there is something to open.
 *
 * One complete chapter is the bar, and it is the only bar there is: a chapter
 * is written by a single request and persisted whole, so a story is either
 * finished enough to read or it is not on the client yet. There is no
 * half-written story to represent and no "still writing" card to build.
 *
 * A story CAN be here without its cover -- the art is painted in the
 * background after the prose lands -- which is what the genre-gradient
 * placeholder in `StoryFeedCard` is for.
 *
 * Order is the caller's, which is last-touched first: `fetchMyStories`
 * returns newest-first and a story written this session is prepended. `Story`
 * carries no `updatedAt`, so sorting here would have to invent a key.
 */
export function yourStories(generated: Story[]): Story[] {
  return generated.filter((story) => story.chapters.length > 0);
}

/**
 * The stories there is something to go back to.
 *
 * THERE IS NO READ-PROGRESS MODEL ON THE CLIENT YET, and this function is
 * where one lands when there is. What it replaces was worse than absent: a
 * black hero card at the top of Home that picked `featured[0]` and printed
 * "40% read - Chapter 2 waits" beside it, a claim about the reader that
 * nothing had ever measured. A named rail makes no such claim - it labels a
 * shelf and shows what is on it - so the honest version of this row can exist
 * today and get more accurate later.
 *
 * Until a `lastReadAt` is persisted, "something to continue" means the house
 * picks that actually run past one chapter. A standalone is finished the
 * moment it is opened; there is nothing to come back for.
 */
export function continueReading(stories: Story[]): Story[] {
  // Nothing on the client records that a reader started a story: `Story` has
  // no `lastReadAt`, no chapter cursor, no percentage. This used to stand in
  // featured multi-chapter stories, which put the SAME cards under "Continue
  // reading" and under "Katha Originals", one row apart -- a shelf claiming
  // the reader had begun books they had never opened, directly above the shelf
  // those books actually belong to.
  //
  // An empty row is honest and simply does not render (see `buildFeedRows`).
  // When a read position is persisted, this is the one place it plugs in:
  // filter to stories with a cursor, order by most recently read.
  void stories;
  return [];
}

/**
 * Turns the flat story catalogue into the ordered, named rows Home renders.
 *
 * This is a pure function of its inputs, not a hook or a piece of screen
 * state, specifically so the day this becomes a server-driven "sections"
 * response the only thing that changes is what calls it - the row shape and
 * the JSX that maps over it stay identical. Keeping it pure also makes the
 * curation legible on its own: "what is Home made of" is answerable by
 * reading this one function top to bottom, without tracing render logic.
 *
 * ORDER IS THE PRODUCT OWNER'S, and it runs from the most personal claim to
 * the least:
 *
 * 1. **Your stories** - what the reader made. Nobody else's shelf can outrank it.
 * 2. **Continue reading** - what they already started.
 * 3. **Katha Originals** - the house's own writing.
 * 4. **One rail per genre they chose in onboarding** - and this is where
 *    trending lives now: each genre rail is ordered by reads, so "what is
 *    popular" is answered inside a genre the reader actually asked for rather
 *    than as a global chart they have no stake in.
 *
 * The generic "Trending now" / "Most loved" rails survive only as the
 * fallback for a reader who picked no genres at all: without a genre signal
 * there is no personal shelf to build, and a page that ends at Originals is
 * shorter than the scroll deserves.
 */
export function buildFeedRows(
  stories: Story[],
  preferredGenres: Genre[],
  generatedStories: Story[] = [],
  /**
   * Stories the reader has actually begun, newest first.
   *
   * Injected rather than derived, because the client has no read position to
   * derive it from yet (see `continueReading`). Passing nothing is the honest
   * production case today and simply omits the row; the ordering rule the row
   * obeys is still exercised by passing a list here.
   */
  inProgress: Story[] = continueReading(stories),
): FeedRow[] {
  const rows: FeedRow[] = [];

  // The writer's own work leads once there is any. A reader who has written
  // something opens the app to find it, not to be shown the house picks first;
  // before they have, the row simply does not exist rather than sitting empty.
  const yours = yourStories(generatedStories);
  if (yours.length > 0) {
    rows.push({ key: "yours", title: "Your stories", stories: yours });
  }

  const unfinished = inProgress;
  if (unfinished.length > 0) {
    rows.push({ key: "continue", title: "Continue reading", stories: unfinished });
  }

  const originals = stories.filter((story) => story.isFeatured);
  if (originals.length > 0) {
    rows.push({ key: "originals", title: "Katha Originals", stories: originals });
  }

  if (preferredGenres.length > 0) {
    // Deduplicated: onboarding stores display labels and two of them can map
    // to one `Genre`, which would otherwise render the same shelf twice.
    for (const genre of Array.from(new Set(preferredGenres))) {
      const genreStories = stories
        .filter((story) => story.genre === genre)
        .sort((a, b) => b.views - a.views)
        .slice(0, RAIL_LENGTH);
      // A row with nothing in it is worse than no row: it teaches the reader
      // that scrolling further sometimes wastes their time.
      if (genreStories.length > 0) {
        rows.push({
          key: `genre-${genre}`,
          title: genreLabels[genre],
          stories: genreStories,
        });
      }
    }
    return rows;
  }

  const trending = [...stories]
    .sort((a, b) => b.views - a.views)
    .slice(0, RAIL_LENGTH);
  if (trending.length > 0) {
    rows.push({ key: "trending", title: "Trending now", stories: trending });
  }

  const mostLoved = [...stories]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, RAIL_LENGTH);
  if (mostLoved.length > 0) {
    rows.push({ key: "loved", title: "Most loved", stories: mostLoved });
  }

  return rows;
}

/**
 * One header action: a 44x44 target, a glyph, and an optional value beside it.
 *
 * 44x44 is the floor Apple's HIG and WCAG 2.2 both land on, and it is a
 * MINIMUM on the touch target rather than on the ink: the flame and the bell
 * draw at 20pt inside a 44pt box. Three of these sit shoulder to shoulder in
 * the top-right corner, which is exactly where a too-small target hurts most
 * — the thumb arrives there at an angle, at the edge of its reach.
 *
 * `value` is rendered only when there is one, so the same component draws a
 * bare bell and a flame carrying a day count without a second variant.
 */
function HeaderAction({
  icon: Icon,
  value,
  label,
  onPress,
  dot = false,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  value?: string;
  label: string;
  onPress: () => void;
  /** An unread marker. Drawn only for something the reader has not seen. */
  dot?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.headerAction,
        value !== undefined && styles.headerActionWide,
        pressed && styles.headerActionPressed,
      ]}
    >
      <Icon size={20} color={colors.strong} />
      {value !== undefined && <Text style={styles.headerActionValue}>{value}</Text>}
      {dot && <View style={styles.headerActionDot} />}
    </Pressable>
  );
}

export default function HomeScreen({
  credits,
  generatedStories,
  stories,
  onStory,
  onProfile,
  onCreate,
  onSeeAll,
  onCredits,
  onNotifications,
  streakDays = null,
  unreadNotifications = 0,
  preferredGenres = [],
}: {
  credits: number;
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onProfile: () => void;
  onCreate: () => void;
  /** Jumps to the Explore tab. */
  onSeeAll: () => void;
  /** Opens the credits screen. Falls back to the profile tab. */
  onCredits?: () => void;
  /** Opens where notifications are managed. Falls back to the profile tab. */
  onNotifications?: () => void;
  /**
   * The reader's current streak in days, or null when there is no true value.
   *
   * NULL IS A REAL ANSWER and the header honours it by drawing nothing. See
   * `src/lib/streak.ts`: the count comes from the `streaks` row that
   * `touch_streak` writes when a read is recorded, and every other case —
   * no session, no row, a failed request, a lapsed streak — arrives here as
   * null rather than as a placeholder. A flame that invents a number is a
   * daily lie to the one person who knows whether it is true.
   */
  streakDays?: number | null;
  /**
   * Unread notifications. Nothing feeds this yet: there is no notifications
   * table and no inbox, only push tokens and follows, so the dot is
   * unreachable today by construction rather than by accident. It is a prop
   * and not a hardcoded `false` so that the day an inbox lands, the header
   * needs no change — and until then the bell is honestly quiet.
   */
  unreadNotifications?: number;
  preferredGenres?: Genre[];
}) {
  const isNewUser = generatedStories.length === 0;
  const hour = new Date().getHours();
  const greeting = hour < 12
    ? "Good morning"
    : hour < 17
    ? "Good afternoon"
    : "Good evening";

  const rows = buildFeedRows(stories, preferredGenres, generatedStories);

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.withTabs}
        showsVerticalScrollIndicator={false}
      >
        {/* Header. NO SEARCH FIELD AND NO MAGNIFIER: search is Explore's, and
            a second entry point on Home only teaches the reader that the two
            surfaces do the same thing. What sits here instead is the reader's
            own standing — streak, credits, notifications — because those are
            the three facts about THEM that change between one morning and the
            next, and this corner is the only place on Home that is about the
            person rather than about the stories.

            Order is left to right by how often it changes and how much it is
            worth interrupting for: the streak is the day's first thing to
            check, credits is the number that gates creating, and the bell is
            the one that only speaks when it has something. The avatar is
            gone; the "You" tab is a permanent door to the profile and the
            header does not need a second one. */}
        <View style={styles.header}>
          <View style={styles.headerGreeting}>
            <Text style={styles.eyebrow}>{greeting}</Text>
            <Text style={styles.h1}>Stories for you</Text>
          </View>
          <View style={styles.headerActions}>
            {streakDays !== null && streakDays > 0 && (
              <HeaderAction
                icon={Flame}
                value={String(streakDays)}
                label={`Reading streak: ${streakDays} ${
                  streakDays === 1 ? "day" : "days"
                }`}
                onPress={onProfile}
              />
            )}
            <HeaderAction
              icon={Coins}
              value={String(credits)}
              label={`${credits} credits`}
              onPress={onCredits ?? onProfile}
            />
            <HeaderAction
              icon={Bell}
              label={unreadNotifications > 0
                ? `Notifications, ${unreadNotifications} unread`
                : "Notifications"}
              onPress={onNotifications ?? onProfile}
              dot={unreadNotifications > 0}
            />
          </View>
        </View>

        {isNewUser
          ? (
            // A reader with nothing generated yet has no "continue" to offer,
            // so the CTA is the biggest thing on the screen instead of a band
            // competing with it.
            <View style={styles.writeCTACard}>
              <Text style={styles.writeCTATitle}>Start your first story</Text>
              <Text style={styles.writeCTASubtitle}>
                Genre, characters, your idea. Katha brings it to life
              </Text>
              <View style={styles.writeCTAButtonWrap}>
                <PrimaryButton onPress={onCreate}>
                  Create a story
                </PrimaryButton>
              </View>
            </View>
          )
          // The invitation sits above the shelves, not between them: the top
          // of the scroll is where it reads as an offer rather than as the
          // footer of whatever section preceded it. It also holds the visual
          // weight the removed "Continue reading" hero card used to carry, so
          // the page still opens on something rather than on a rail eyebrow.
          : <WriteAnotherCTA onPress={onCreate} />}

        {/* The editorial stack. Every row is named, every row scrolls its own
            axis, and a row that would render empty was already filtered out
            by buildFeedRows - this loop never has to guard against that. */}
        {rows.map((row) => (
          <FeedRail
            key={row.key}
            title={row.title}
            stories={row.stories}
            onStory={onStory}
          />
        ))}

        {/* Home's one exit into the full, filterable catalogue. Everything
            above this is curation; this is where curation ends and browsing
            begins. */}
        <Pressable
          onPress={onSeeAll}
          style={styles.seeEverythingRow}
          accessibilityRole="button"
        >
          <Text style={styles.seeEverythingText}>See everything</Text>
          <ChevronRight size={18} color={colors.accent} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  withTabs: { paddingBottom: 116 },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  h1: {
    marginTop: 3,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35,
  },

  /* ── Header actions: streak, credits, notifications ──
     Three targets in a row, each at least 44x44. `headerGreeting` takes the
     flex so a long greeting wraps instead of squeezing the actions below
     their minimum - the targets are the part that must not shrink. */
  headerGreeting: { flexShrink: 1, paddingRight: spacing.sm },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerAction: {
    position: "relative",
    minWidth: 44,
    height: 44,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  /** A value beside the glyph needs the room the bare glyph does not. */
  headerActionWide: { paddingHorizontal: spacing.related },
  headerActionPressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  headerActionValue: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  headerActionDot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },

  /* ── Write CTA (new user) ── */
  writeCTACard: {
    marginHorizontal: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
    boxShadow: shadows.raised,
  },
  writeCTATitle: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 24,
    lineHeight: 28,
  },
  writeCTASubtitle: {
    marginTop: spacing.related,
    fontFamily: fonts.ui,
    // `tertiary` reads as muted body copy on the light ground it was tuned
    // for, and does the same job here: on `colors.ink` it is the lightest
    // neutral in the ramp, so it still lands as "quieter than the title"
    // without inventing a one-off white-at-70%-opacity that isn't a token.
    color: colors.tertiary,
    fontWeight: "700",
    fontSize: 15,
    lineHeight: 21,
  },
  writeCTAButtonWrap: { marginTop: spacing.betweenGroups },

  /* ── See everything (bottom exit into Explore) ── */
  seeEverythingRow: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.betweenGroups,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  seeEverythingText: {
    ...type.headline,
    fontFamily: fonts.display,
    color: colors.ink,
  },
});
