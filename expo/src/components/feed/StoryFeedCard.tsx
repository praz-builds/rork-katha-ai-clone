import { LinearGradient } from "expo-linear-gradient";
import { BookOpen, ChevronRight, Heart } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { imageAssets } from "@/data/images";
import {
  colors,
  fonts,
  genreGradients,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { Story } from "@/types/domain";

/**
 * The one story card the feed is built from.
 *
 * COVER LEFT, TEXT RIGHT, STATS UNDER. The cover is a fixed square on the
 * leading edge and the body flexes beside it, so every card in a column shares
 * one cover baseline and one text column no matter how long the title runs.
 * That alignment is the whole reason this shape beats the stacked
 * `StoryCard`: a reader scanning a vertical list compares covers down a single
 * edge instead of hunting for them.
 *
 * The cover BLEEDS to the card's edge rather than sitting inset. An inset cover
 * puts two radii and a gap between the image and the page, which reads as a
 * thumbnail pasted onto a card; a flush cover reads as one object whose left
 * half happens to be a picture.
 *
 * VARIANTS. `rail` is the fixed-width card a horizontal row scrolls, sized so
 * the next card peeks past the screen edge and the row is legible as scrollable
 * without a chevron or a scrollbar. `list` fills the column width for the
 * vertical browse list. They are one component because the anatomy is
 * identical; only the width rule differs.
 */
export type StoryFeedCardVariant = "rail" | "list";

/** Peeking width for a rail card. The next card shows ~44px past the edge. */
export const RAIL_CARD_WIDTH = 300;

/**
 * The cover is 3:4 PORTRAIT because that is the aspect the source art is
 * actually in - seed covers are 360x480 and generated ones are 1024x1536
 * (see backend/COVER_IMAGES.md). Cropping that into a square here threw away
 * roughly a third of every image, so the thumbnail in the feed and the
 * full-bleed hero on the story page showed visibly different pictures of the
 * same file. One cover, one crop: the card matches the source, and the hero
 * shows the same frame larger.
 */
const COVER_WIDTH = 116;
const COVER_HEIGHT = 155;

function CardCover({ story }: { story: Story }) {
  const image = story.coverImage ? imageAssets[story.coverImage] : undefined;
  const focalY = Math.max(0, (story.focalY ?? 0.5) - 0.07);

  return (
    <View style={styles.cover}>
      {image
        ? (
          <FocalImage
            source={image}
            focalX={story.focalX ?? 0.5}
            focalY={focalY}
            style={{ width: "100%", height: "100%" }}
          />
        )
        : (
          <LinearGradient
            colors={genreGradients[story.genre]}
            style={StyleSheet.absoluteFill}
          />
        )}
    </View>
  );
}

function Stat(
  { Icon, value, label }: {
    Icon: typeof BookOpen;
    value: number;
    label: string;
  },
) {
  return (
    <View style={styles.stat} accessibilityLabel={`${value} ${label}`}>
      <Icon size={14} color={colors.strong} />
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
    </View>
  );
}

export function StoryFeedCard({
  story,
  onPress,
  variant = "list",
}: {
  story: Story;
  onPress?: () => void;
  variant?: StoryFeedCardVariant;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Read ${story.title}`}
      style={({ pressed }) => [
        styles.card,
        variant === "rail" ? styles.railCard : styles.listCard,
        pressed && styles.pressed,
      ]}
    >
      <CardCover story={story} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>{story.title}</Text>
        <Text numberOfLines={2} style={styles.synopsis}>{story.synopsis}</Text>
        <View style={styles.footer}>
          <View style={styles.stats}>
            <Stat Icon={BookOpen} value={story.views} label="reads" />
            <Stat Icon={Heart} value={story.likes} label="likes" />
          </View>
          {/*
            The read affordance is decorative: the whole card is the pressable,
            so this must not be a second focusable target announcing the same
            action twice to a screen reader.
          */}
          <View style={styles.readAffordance} importantForAccessibility="no">
            <ChevronRight size={18} color={colors.accent} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    boxShadow: shadows.card,
  },
  railCard: { width: RAIL_CARD_WIDTH },
  listCard: { width: "100%" },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  cover: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "space-between",
  },
  title: {
    ...type.headline,
    fontFamily: fonts.display,
    color: colors.ink,
    lineHeight: 21,
  },
  synopsis: {
    ...type.caption,
    color: colors.muted,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  stats: { flexDirection: "row", gap: spacing.md },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statValue: {
    ...type.caption,
    fontWeight: "600",
    color: colors.strong,
  },
  readAffordance: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
});
