import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * A year of reading and writing, one square per day.
 *
 * WHY A GRID AND NOT A NUMBER. "You are on a 4 day streak" says what is true
 * today and nothing about the shape of the habit. The grid says the thing a
 * streak counter structurally cannot: that somebody read most evenings in
 * March, stopped in April, and came back. It is the only surface in the app
 * that shows a person their own pattern, and it is why the profile leads with
 * it.
 *
 * WHY IT IS BINARY. GitHub shades its squares by volume. This does not, and
 * the restraint is deliberate: `activity_days` records that a day happened,
 * not how much happened in it, because the streak is defined the same way.
 * Shading by chapter count would invent a second, louder definition of a good
 * day sitting right next to the first, and would quietly tell somebody who
 * read one chapter that their day counted less. It counted.
 *
 * WHY IT SCROLLS TO THE END. The interesting end of a calendar is today. It
 * opens scrolled fully right so the reader sees this week without doing
 * anything, and can push back through the year if they want to.
 *
 * EMPTY IS A REAL ANSWER, MISSING IS NOT. `days` of `[]` draws an empty year,
 * which is the truth for a new account. `null` draws nothing at all -- a grid
 * of blank squares would tell somebody they had done nothing when what
 * actually happened is that we could not find out.
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

export default function ActivityGrid({
  days,
  now = new Date(),
}: {
  /** Active days as `YYYY-MM-DD`. Empty is a year with nothing in it; null is "unknown". */
  days: string[] | null;
  /** Injectable so the grid's day boundaries can be tested rather than assumed. */
  now?: Date;
}) {
  const grid = useMemo(() => {
    if (!days) return null;

    const active = new Set<number>();
    for (const day of days) {
      const n = dayNumber(day);
      if (n !== null) active.add(n);
    }

    const today = utcDay(now);
    // The last column is the week containing today, so the grid always ends on
    // the current week rather than on a ragged edge.
    const todayWeekday = new Date(today * DAY_MS).getUTCDay();
    const lastColumnStart = today - todayWeekday;
    const firstColumnStart = lastColumnStart - (WEEKS - 1) * 7;

    const columns: { day: number; active: boolean; future: boolean }[][] = [];
    const monthLabels: { column: number; label: string }[] = [];
    let lastMonth = -1;

    for (let week = 0; week < WEEKS; week += 1) {
      const column: { day: number; active: boolean; future: boolean }[] = [];
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
  }, [days, now]);

  if (!grid) {
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
              <View key={index} style={styles.column}>
                {column.map((cell) => (
                  <View
                    key={cell.day}
                    style={[
                      styles.cell,
                      cell.future
                        ? styles.cellFuture
                        : cell.active
                        ? styles.cellActive
                        : styles.cellIdle,
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.legend}>
        <Text style={styles.legendText}>
          {grid.total === 0
            ? "No active days yet"
            : `${grid.total} active ${grid.total === 1 ? "day" : "days"}`}
        </Text>
        <View style={styles.legendKey}>
          <Text style={styles.legendText}>Less</Text>
          <View style={[styles.legendCell, styles.cellIdle]} />
          <View style={[styles.legendCell, styles.cellActive]} />
          <Text style={styles.legendText}>More</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingRight: spacing.lg },
  monthRow: { height: 16, position: "relative" },
  monthLabel: {
    position: "absolute",
    top: 0,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 10,
  },
  columns: { flexDirection: "row", gap: GAP },
  column: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  cellIdle: { backgroundColor: colors.surface2 },
  cellActive: { backgroundColor: colors.accent },
  // Not a missed day: it has not happened yet, so it is drawn as nothing.
  cellFuture: { backgroundColor: "transparent" },
  legend: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  legendKey: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendCell: { width: CELL, height: CELL, borderRadius: 3 },
  legendText: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 11 },
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
