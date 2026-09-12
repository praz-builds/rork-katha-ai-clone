import type { ComponentType } from "react";
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { Bell, ChevronRight, Flame, Sparkles } from "lucide-react-native";
import { FeedRail } from "@/components/feed/FeedRail";
import WriteAnotherCTA from "@/components/feed/WriteAnotherCTA";
import { greetingName } from "@/lib/profile";
import { homeCtaCopy, resolveHomeCta } from "@/lib/home-cta";
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
  tint,
  fill,
  iconSize = 20,
}: {
  icon: ComponentType<{ size?: number; color?: string; fill?: string }>;
  value?: string;
  label: string;
  onPress: () => void;
  /** An unread marker. Drawn only for something the reader has not seen. */
  dot?: boolean;
  /**
   * The icon's colour, when it should be one.
   *
   * All three of these were `colors.strong` -- one grey row of glyphs, in
   * which the streak and the credit balance, the two numbers on Home that are
   * about the reader and that they check every day, looked exactly as
   * important as the bell. Colour is what separates a standing you are proud
   * of from a control. The bell keeps the neutral: it earns attention with
   * its dot when it has something, and it should not compete before then.
   */
  tint?: string;
  /** Fills the glyph, so the flame reads as lit rather than outlined. */
  fill?: string;
  /**
   * Glyph size. The default matches the bell, which is a plain outline; a
   * FILLED glyph at the same nominal size reads noticeably heavier, so the
   * credit spark is set smaller to sit level with the others rather than
   * looming over them.
   */
  iconSize?: number;
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
      {/* The glyph carries the colour; the NUMBER stays ink.
          Tinting both made the credit balance a gold number on a warm ground,
          which is the least legible thing in the header and also the one
          thing there you actually read. Colour marks what the row is about;
          black is what makes the value readable. */}
      <Icon size={iconSize} color={tint ?? colors.strong} fill={fill ?? "none"} />
      {value !== undefined && (
        <Text style={styles.headerActionValue}>{value}</Text>
      )}
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
  displayName = null,
  shelfLoaded = false,
  writingStoryId = null,
  liveStoryIds = [],
  savedDraftGenre,
  onContinueStory,
  writingChapterIndex,
  onPaywall,
  creditsPillRef,
  creditsBump,
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
  /**
   * What to call this reader, from the name onboarding asks for first.
   *
   * Undefined while it is still being read and null when they never gave one;
   * the greeting treats both the same way and simply says the time of day.
   */
  displayName?: string | null;
  /**
   * Has the writer's own shelf actually come back?
   *
   * `fetchMyStories` turns every failure into an empty array, so without this
   * a writer with three stories and a bad connection is told to start their
   * first one. "First story" is a claim; it is only made when the shelf is
   * known to be empty.
   */
  shelfLoaded?: boolean;
  /** The story being written right now, if any. */
  writingStoryId?: string | null;
  /**
   * Stories a live session is writing. Excluded from the "finish this series"
   * search: a provisional row is inserted into the shelf as soon as the first
   * prose reveals, carrying a planned count and one chapter -- exactly the
   * shape of a part-written series, for a story you are watching being written.
   */
  liveStoryIds?: readonly string[];
  /** The saved brief's genre, `null` if none, `undefined` while unknown. */
  savedDraftGenre?: string | null;
  onContinueStory?: (storyId: string, chapterIndex: number) => void;
  /** Zero-based index of the chapter being written, for the `writing` card. */
  writingChapterIndex?: number;
  onPaywall?: () => void;
  /**
   * The credits pill's outer view, for the welcome credits flight.
   *
   * Onboarding's last screen throws three coins at this pill
   * (`src/components/onboarding/WelcomeCreditsFlight.tsx`), and to aim it has
   * to measure where the pill actually is on THIS window — the corner moves
   * with the safe-area inset, the streak pill's presence and the width of the
   * credit number. A ref is the only way to ask; a guessed rectangle is wrong
   * on the first Android device with a display cutout.
   *
   * Optional and inert when absent: Home is a shared screen and every other
   * caller mounts it without knowing this exists.
   */
  creditsPillRef?: React.RefObject<View | null>;
  /**
   * Scale of the credits pill, 1 at rest, driven by the flight.
   *
   * A SHARED VALUE rather than a boolean prop or an imperative handle, because
   * the bump has to run on the UI runtime: the coins land while Home is doing
   * its first render and its first feed fetch, and a state-driven bump would
   * queue behind that and fire late, after the coin it was acknowledging had
   * already faded. Write to it with `bumpCredits` from the flight module.
   */
  creditsBump?: SharedValue<number>;
}) {
  // A local shared value stands in when no caller supplies one: hooks cannot be
  // called conditionally, and the alternative — two JSX branches for the same
  // pill — is how the credits pill ends up with two slightly different layouts.
  // At rest both are 1, so the pill is pixel-identical either way.
  const ownCreditsBump = useSharedValue(1);
  const creditsBumpValue = creditsBump ?? ownCreditsBump;
  const creditsBumpStyle = useAnimatedStyle(() => ({
    transform: [{ scale: creditsBumpValue.get() }],
  }));

  const hour = new Date().getHours();
  const timeOfDay = hour < 12
    ? "Good morning"
    : hour < 17
    ? "Good afternoon"
    : "Good evening";
  // The name is the point of the line, so it is not decoration around a
  // second heading -- it IS the heading. Onboarding asks for it on the first
  // screen, which is the only reason greeting somebody by name is honest here
  // rather than a guess dressed up as familiarity.
  //
  // No name is a real state, not an error: anyone who onboarded before the
  // field was stored has none, and a guest may never give one. The greeting
  // simply stops after the time of day rather than falling back to "there",
  // which reads as a form letter that failed to merge.
  const firstName = greetingName(displayName ?? null);
  const greeting = firstName
    ? `${timeOfDay}, ${firstName} \u{1F44B}\u{1F3FC}`
    : timeOfDay;

  const rows = buildFeedRows(stories, preferredGenres, generatedStories);

  const ctaState = resolveHomeCta({
    stories: generatedStories,
    credits,
    shelfLoaded,
    writingStoryId,
    liveStoryIds,
    savedDraftGenre,
  });
  const ctaCopy = homeCtaCopy(ctaState);
  const ctaAction = () => {
    switch (ctaState.kind) {
      case "writing":
        /*
          STRAIGHT INTO THE READER, NOT THE STORY PAGE.

          `onStory` sends a series to `StoryDetailScreen`, and a story that is
          being written IS a series by then -- the provisional row carries a
          planned chapter count from the moment the first prose reveals. So the
          one card on Home that says "Katha is writing" opened a static detail
          page and hid the live generation behind it, which is the opposite of
          what it offers.

          Routed at the chapter actually being written, for the same reason
          `finish` is routed at the last written one: the reader resolves the
          live session for whatever story it opens, so it is the only surface
          that can show prose arriving.
        */
        return onContinueStory
          ? onContinueStory(ctaState.storyId, writingChapterIndex ?? 0)
          : onStory(ctaState.storyId);
      case "finish":
        // Straight into the reader at the last written chapter. The story
        // page has no write-next control -- the only continuation UI is the
        // chapter-end module inside the reader -- so routing through it would
        // be a dead end.
        return onContinueStory
          ? onContinueStory(ctaState.storyId, ctaState.written - 1)
          : onStory(ctaState.storyId);
      case "paywall":
        return (onPaywall ?? onCredits ?? onProfile)();
      default:
        return onCreate();
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
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
            <Text style={styles.h1} numberOfLines={2}>{greeting}</Text>
          </View>
          <View style={styles.headerActions}>
            {streakDays !== null && streakDays > 0 && (
              <HeaderAction
                icon={Flame}
                tint={colors.accent}
                fill={colors.accent}
                value={String(streakDays)}
                label={`Reading streak: ${streakDays} ${
                  streakDays === 1 ? "day" : "days"
                }`}
                onPress={onProfile}
              />
            )}
            {/* Not `Coins`: a stack of discs reads as money, and credits are
                not money -- they are the thing you spend to make a story, and
                the app already draws that idea as a spark everywhere else
                (the Create button, the cost card, the credits row on the
                profile). One idea, one glyph, and it is the warm gold the
                palette already keeps for a mark of value. */}
            {/* The wrapper exists for onboarding's credits flight: it is what
                the coins are measured against and what bumps when one lands.
                `collapsable={false}` is load-bearing — Android collapses a
                layout-only View out of the native tree, and `measureInWindow`
                on a collapsed view hands back zeros, which the flight reads as
                "no target" and falls back to a fade in the middle of the
                screen. */}
            <View ref={creditsPillRef} collapsable={false}>
              <Animated.View style={creditsBumpStyle}>
                <HeaderAction
                  icon={Sparkles}
                  tint={colors.chromeStar}
                  fill={colors.chromeStar}
                  iconSize={16}
                  value={String(credits)}
                  label={`${credits} credits`}
                  onPress={onCredits ?? onProfile}
                />
              </Animated.View>
            </View>
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

        {/*
          ONE CARD, FIVE STATES.

          There used to be two components here -- a bespoke first-run block and
          the CTA -- rendering the same invitation into the same slot, which is
          why the copy could never move together. Now it is one card whose
          words come from `resolveHomeCta`: what Katha is writing right now, a
          series left half-finished, a brief saved and never generated, a
          balance too small to start, or the plain invitation. See
          `lib/home-cta.ts` for the ordering and why it is that order.

          It stays above the shelves. The top of the scroll is where an
          invitation reads as an offer rather than as the footer of whatever
          section preceded it.
        */}
        <WriteAnotherCTA
          onPress={ctaAction}
          heading={ctaCopy.heading}
          support={ctaCopy.support}
          tone={ctaCopy.tone}
        />

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
