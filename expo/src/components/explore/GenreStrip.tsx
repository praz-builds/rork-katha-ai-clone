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

export function GenreStrip({
  selected,
  onSelect,
}: {
  selected: Genre | null;
  /** Called with the new selection: the genre, or null when it is cleared. */
  onSelect: (genre: Genre | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Filter by genre"
      keyboardShouldPersistTaps="handled"
    >
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

/** A composable category row. Genre remains independently selectable below. */
export function ExploreCategoryStrip({
  selected,
  onSelect,
}: {
  selected: ExploreCategory | null;
  onSelect: (category: ExploreCategory | null) => void;
}) {
  const bedtimeSelected = selected === BEDTIME_CATEGORY;
  return (
    <View
      style={styles.categoryRow}
      accessibilityLabel="Filter by category"
    >
      <FilterChip
        label={BEDTIME_CATEGORY_LABEL}
        onPress={() => onSelect(bedtimeSelected ? null : BEDTIME_CATEGORY)}
        selected={bedtimeSelected}
        accessibilityLabel={BEDTIME_CATEGORY_SHORT_LABEL}
        accessibilityHint={bedtimeSelected
          ? "Selected. Tap to show every story again"
          : "Show published bedtime stories"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  categoryRow: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
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
