import { memo, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * A year of reading and writing, one dot per day.
 *
 * WHY A GRID AND NOT A NUMBER. "You are on a 4 day streak" says what is true
 * today and nothing about the shape of the habit. The grid says the thing a
 * streak counter structurally cannot: that somebody read most evenings in
 * March, stopped in April, and came back. It is the only surface in the app
 * that shows a person their own pattern.
 *
 * WHY IT IS BINARY, AND WHY THERE IS NO "LESS / MORE" KEY (D3). GitHub shades
 * its squares by volume. This does not: `activity_days` records that a day
 * happened, not how much happened in it, because the streak is defined the
 * same way. A dot is brand orange for an active day and muted otherwise, and
 * there is no intensity ramp, so there is nothing for a legend to explain.
 * The one line under the grid is the count of active days.
 *
 * WHY IT SCROLLS TO THE END. The interesting end of a calendar is today. It
 * opens scrolled fully right so the reader sees this week without doing
 * anything, and can push back through the year if they want to.
 *
 * EMPTY IS A REAL ANSWER, MISSING IS NOT. `days` of `[]` draws an empty year,
 * which is the truth for a new account. `null` draws nothing at all -- a grid
 * of blank dots would tell somebody they had done nothing when what actually
 * happened is that we could not find out.
 */

const CELL = 11;
const GAP = 3;
const WEEKS = 53;
const DAY_MS = 86_400_000;

/** Month labels, placed above the week each month starts in. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function utcDay(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      DAY_MS,
  );
}

/** `YYYY-MM-DD` to a UTC day number, matching how the server stores a day. */
function dayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Math.floor(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS,
  );
}

type Cell = { day: number; active: boolean; future: boolean };

/**
 * The grid for one day and one set of active days.
 *
 * Exported so the memo key can be tested: it depends on the DAY, never on a
 * `Date` instance. The component used to default `now = new Date()`, which is
 * a new object on every render, so its `useMemo` recomputed every time and
 * 371 dots were rebuilt on each keystroke anywhere above it.
 */
export function buildActivityGrid(days: string[], today: number) {
  const active = new Set<number>();
  for (const day of days) {
    const n = dayNumber(day);
    if (n !== null) active.add(n);
  }

  // The last column is the week containing today, so the grid always ends on
  // the current week rather than on a ragged edge.
  const todayWeekday = new Date(today * DAY_MS).getUTCDay();
  const lastColumnStart = today - todayWeekday;
  const firstColumnStart = lastColumnStart - (WEEKS - 1) * 7;

  const columns: Cell[][] = [];
  const monthLabels: { column: number; label: string }[] = [];
  let lastMonth = -1;

  for (let week = 0; week < WEEKS; week += 1) {
    const column: Cell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = firstColumnStart + week * 7 + weekday;
      column.push({
        day,
        active: active.has(day),
        // Days after today are drawn as empty space, not as missed days.
        future: day > today,
      });
    }
    columns.push(column);

    const month = new Date(column[0].day * DAY_MS).getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      // Skip a label that would collide with the previous one.
      const previous = monthLabels[monthLabels.length - 1];
      if (!previous || week - previous.column >= 3) {
        monthLabels.push({ column: week, label: MONTHS[month] });
      }
    }
  }

  return { columns, monthLabels, total: active.size };
}

/**
 * One week. Memoized on a signature of its seven cells, so a calendar that
 * gains one active day re-renders one column rather than fifty-three.
 */
const WeekColumn = memo(
  function WeekColumn({ cells }: { cells: Cell[]; signature: string }) {
    return (
      <View style={styles.column}>
        {cells.map((cell) => (
          <View
            key={cell.day}
            testID={cell.future
              ? undefined
              : cell.active
              ? "activity-dot-active"
              : "activity-dot-idle"}
            style={[
              styles.dot,
              cell.future
                ? styles.dotFuture
                : cell.active
                ? styles.dotActive
                : styles.dotIdle,
            ]}
          />
        ))}
      </View>
    );
  },
  (previous, next) => previous.signature === next.signature,
);

function signatureOf(cells: Cell[]): string {
  let out = `${cells[0].day}:`;
  for (const cell of cells) out += cell.future ? "f" : cell.active ? "a" : "i";
  return out;
}

/** Every day in `days`, joined: equal lists give equal keys whatever their identity. */
function daysKey(days: string[] | null): string | null {
  return days ? days.join(",") : null;
}

function ActivityGrid({
  days,
  now,
  loading = false,
}: {
  /** Active days as `YYYY-MM-DD`. Empty is a year with nothing in it; null is "unknown". */
  days: string[] | null;
  /** Injectable so the grid's day boundaries can be tested rather than assumed. */
  now?: Date;
  /**
   * The calendar has not answered yet. Draws a quiet placeholder of the
   * grid's size instead of the "could not be loaded" line, which is for a
   * request that has actually come back empty-handed.
   */
  loading?: boolean;
}) {
  // A number, not a Date: two renders on the same day share it, and the memo
  // below only recomputes when the day or the active days actually change.
  const today = utcDay(now ?? new Date());
  const key = daysKey(days);
  // `days` is read through `key`: equal lists are the same grid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => (days ? buildActivityGrid(days, today) : null), [key, today]);

  if (!grid) {
    if (loading) {
      return (
        <View
          style={styles.placeholder}
          testID="activity-grid-loading"
          accessibilityLabel="Loading your calendar"
        />
      );
    }
    return (
      <View style={styles.unavailable} testID="activity-grid-unavailable">
        <Text style={styles.unavailableText}>
          Your calendar could not be loaded just now.
        </Text>
      </View>
    );
  }

  return (
    <View testID="activity-grid">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Opens on today. The recent end is the one anybody looks at first.
        contentOffset={{ x: WEEKS * (CELL + GAP), y: 0 }}
        contentContainerStyle={styles.scroll}
      >
        <View>
          <View style={styles.monthRow}>
            {grid.monthLabels.map(({ column, label }) => (
              <Text
                key={`${label}-${column}`}
                style={[styles.monthLabel, { left: column * (CELL + GAP) }]}
              >
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.columns}>
            {grid.columns.map((column, index) => (
              <WeekColumn key={index} cells={column} signature={signatureOf(column)} />
            ))}
          </View>
        </View>
      </ScrollView>

      <Text style={styles.count}>
        {grid.total === 0
          ? "No active days yet"
          : `${grid.total} active ${grid.total === 1 ? "day" : "days"}`}
      </Text>
    </View>
  );
}

type GridProps = Parameters<typeof ActivityGrid>[0];

/**
 * Equal when the grid would draw the same thing: the same days (whatever the
 * array's identity), the same loading state, and the same calendar day for
 * `now` (whatever the Date's identity). Exported for the test that keeps
 * this memo from silently missing again.
 */
export function sameGridProps(previous: GridProps, next: GridProps): boolean {
  return daysKey(previous.days) === daysKey(next.days) &&
    (previous.loading ?? false) === (next.loading ?? false) &&
    (previous.now ? utcDay(previous.now) : null) ===
      (next.now ? utcDay(next.now) : null);
}

/**
 * Memoized on what it draws. A parent re-rendering with an equal list and the
 * same day (a store tick, a streak update) skips the whole grid.
 */
export default memo(ActivityGrid, sameGridProps);

const styles = StyleSheet.create({
  scroll: { paddingRight: spacing.lg },
  monthRow: { height: 16, position: "relative" },
  monthLabel: {
    position: "absolute",
    top: 0,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    // The ramp's floor. `monthRow` is 16pt tall, which holds 11 without change.
    fontSize: 11,
  },
  columns: { flexDirection: "row", gap: GAP },
  column: { gap: GAP },
  /** A circle, not a rounded square: a dot is a mark on a calendar, not a tile. */
  dot: { width: CELL, height: CELL, borderRadius: CELL / 2 },
  dotIdle: { backgroundColor: colors.surface2 },
  dotActive: { backgroundColor: colors.accent },
  // Not a missed day: it has not happened yet, so it is drawn as nothing.
  dotFuture: { backgroundColor: "transparent" },
  count: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 11,
  },
  /** The grid's footprint, empty, while the calendar is on its way. */
  placeholder: {
    height: 16 + 7 * CELL + 6 * GAP + spacing.sm + 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    opacity: 0.6,
  },
  unavailable: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  unavailableText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
  },
});
