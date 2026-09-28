/**
 * Every genre the app offers, as one horizontally scrollable row.
 *
 * SAME VISUAL LANGUAGE AS THE CREATE BRIEF. The brief's genre chips are an
 * emoji and a label, drawn from `GENRE_EMOJI` in `@/lib/genre-content` and
 * `genreLabels` in the theme, and this row reads from exactly those two maps.
 * A reader who picked 🐉 Fantasy to write with should meet the same 🐉
 * Fantasy when they go looking for something to read; two different chip
 * vocabularies for one taxonomy is how a small app starts feeling like two.
 *
 * ONE GENRE AT A TIME, and tapping the selected one clears it. Multi-select
 * was the alternative and it is wrong here for a reason that is about the
 * query, not the pixels: a multi-genre selection has to mean OR (a reader
 * choosing Horror and Comedy wants either, never the rare story that is
 * both), and an OR across most of a twelve-genre list returns the entire
 * catalogue — a filter that appears to do a great deal while narrowing
 * nothing. Single select always answers a question the reader can see the
 * answer to, and "tap again to clear" costs one tap rather than a Clear
 * button that has to be found. There is no "All" chip for the same reason:
 * no selection already means every genre, and a chip that competes with the
 * absence of a chip is a second way to say one thing.
 *
 * The row is `UI_GENRES` in its fixed catalogue order. Not ranked by
 * popularity, not reordered to put the selection first: a reader learns
 * where Horror is and should find it in the same place tomorrow.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GENRE_EMOJI } from "@/lib/genre-content";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme";
import { UI_GENRES } from "@/types/domain";
import type { Genre } from "@/types/domain";

export function genreChipLabel(genre: Genre): string {
  return `${GENRE_EMOJI[genre]} ${genreLabels[genre]}`;
}

/**
 * A browse category, deliberately separate from `Genre`. Bedtime is an
 * editorial legacy classification, never a synonym for all-ages.
 */
export const BEDTIME_CATEGORY = "bedtime";
export type ExploreCategory = typeof BEDTIME_CATEGORY;
export const BEDTIME_CATEGORY_LABEL = "🌙 Bedtime stories";
export const BEDTIME_CATEGORY_SHORT_LABEL = "Bedtime stories";

/**
 * The shared `Chip` primitive's look, plus the accessibility a FILTER needs.
 *
 * `Chip` renders a bare `Pressable` with no role and no selected state, which
 * is fine for a static label but not for a control whose entire meaning is
 * on/off: a screen reader user tapping down this row would hear twelve genre
 * names and never learn which one is filtering the list. The styles below are
 * deliberately `Chip`'s own values so the two rows stay visually identical -
 * if that primitive gains `accessibilityState`, this collapses back into it.
 */
function FilterChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Bedtime and the genres, in one scrolling row.
 *
 * WHY ONE ROW. Bedtime used to sit in a `View` of its own directly above this
 * one, drawn by the same `FilterChip`, so it looked exactly like a genre chip
 * that had been left on a shelf above the genre chips. Two rows of identical
 * chips read as a layout accident rather than as a distinction; the scroll is
 * what makes this row a row, and a single chip that cannot scroll is not one.
 *
 * WHY THEY ARE STILL TWO SELECTIONS. Bedtime is an editorial classification
 * and a genre is a genre: a reader can want bedtime comedy. They narrow the
 * query independently and always have. Sharing a row is a visual decision and
 * changes nothing about the filter, which is why `category` and `genre` stay
 * separate props rather than collapsing into one selected id.
 *
 * WHAT KEEPS THEM LEGIBLE AS TWO THINGS. A hairline divider after Bedtime.
 * It costs one element, it is what the eye uses to group the rest as a set,
 * and it is `importantForAccessibility="no"` because a screen reader gets the
 * grouping from the chips' own labels and hints instead.
 */
export function GenreStrip({
  selected,
  onSelect,
  category,
  onCategorySelect,
}: {
  selected: Genre | null;
  /** Called with the new selection: the genre, or null when it is cleared. */
  onSelect: (genre: Genre | null) => void;
  category: ExploreCategory | null;
  /** Independent of the genre: a reader can want bedtime comedy. */
  onCategorySelect: (category: ExploreCategory | null) => void;
}) {
  const bedtimeSelected = category === BEDTIME_CATEGORY;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Filter by category and genre"
      keyboardShouldPersistTaps="handled"
    >
      <FilterChip
        label={BEDTIME_CATEGORY_LABEL}
        onPress={() => onCategorySelect(bedtimeSelected ? null : BEDTIME_CATEGORY)}
        selected={bedtimeSelected}
        accessibilityLabel={BEDTIME_CATEGORY_SHORT_LABEL}
        accessibilityHint={bedtimeSelected
          ? "Selected. Tap to show every story again"
          : "Show published bedtime stories"}
      />
      <View style={styles.divider} importantForAccessibility="no" />
      {UI_GENRES.map((genre) => (
        <FilterChip
          key={genre}
          label={genreChipLabel(genre)}
          selected={selected === genre}
          onPress={() => onSelect(selected === genre ? null : genre)}
          accessibilityLabel={genreLabels[genre]}
          accessibilityHint={selected === genre
            ? "Selected. Tap to show every genre again"
            : `Show only ${genreLabels[genre]} stories`}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  // A hairline between Bedtime and the genres. Vertically inset so it reads
  // as a separator between chips rather than as a full-height rule.
  divider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    backgroundColor: colors.border,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipPressed: { opacity: 0.86 },
  chipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
  },
  chipTextSelected: { color: colors.surface },
});
