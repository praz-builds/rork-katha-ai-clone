import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  feedCardMetrics,
  RAIL_CARD_WIDTH,
  StoryFeedCard,
} from "@/components/feed/StoryFeedCard";
import { colors, fonts, radius, spacing, type, useLayoutWidth } from "@/theme";
import type { Story } from "@/types/domain";

/**
 * A named, horizontally scrolled row of stories.
 *
 * THE ROW IS THE EDITORIAL UNIT. A row's name is a claim about why these
 * stories are together ("Katha Originals", "Trending now", "Romance"), which is
 * what makes a curated home read as curated rather than as an undifferentiated
 * feed. The name is therefore an eyebrow - small, uppercase, tracked - not a
 * title: it labels the row without competing with the story titles inside it,
 * which are the things a reader is actually meant to read.
 *
 * The row scrolls its own horizontal axis and is padded so the first card
 * aligns with the screen gutter while the last one can still scroll clear of
 * it.
 */
export function FeedRail({
  title,
  stories: items,
  onStory,
}: {
  title: string;
  stories: Story[];
  onStory: (id: string) => void;
}) {
  // The snap interval has to be the width the CARD actually drew itself at, not
  // the 390pt reference constant. `feedCardMetrics` narrows a rail card on a
  // window under 390, and a snap interval wider than the card walks the row a
  // little further with every swipe until the "next" card is off screen.
  const { content } = useLayoutWidth();
  const { cardWidth } = feedCardMetrics(content, "rail");

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title.toUpperCase()}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        snapToInterval={(cardWidth ?? RAIL_CARD_WIDTH) + spacing.md}
        decelerationRate="fast"
      >
        {items.map((story) => (
          <StoryFeedCard
            key={story.id}
            story={story}
            variant="rail"
            onPress={() => onStory(story.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.betweenGroups },
  eyebrow: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: colors.muted,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.related,
  },
  row: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    // The shadow on each card is clipped by the row's bounds without this.
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
  },
});
