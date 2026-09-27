import { LinearGradient } from "expo-linear-gradient";
import { BookOpen, ChevronRight, Heart } from "lucide-react-native";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { coverUrl } from "@/lib/cover-url";
import { imageAssets } from "@/data/images";
import {
  colors,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  shadows,
  spacing,
  type,
  useLayoutWidth,
} from "@/theme";
import type { Story } from "@/types/domain";

/**
 * The one story card the feed is built from.
 *
 * COVER LEFT, TEXT RIGHT, STATS UNDER. The cover is a 3:4 portrait on the
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
 * VARIANTS. `rail` is the card a horizontal row scrolls, sized so the next
 * card peeks past the screen edge and the row is legible as scrollable without
 * a chevron or a scrollbar. `list` fills the column width for the vertical
 * browse list. They are one component because the anatomy is identical; only
 * the width rule differs. Both take their measurements from the window rather
 * than from a constant - see `feedCardMetrics`.
 */
export type StoryFeedCardVariant = "rail" | "list";

/**
 * The widest a rail card is drawn, and the width a rail snaps by. The next
 * card shows ~`RAIL_PEEK` past the edge, which is what says "this row
 * scrolls" without a chevron.
 */
export const RAIL_CARD_WIDTH = 300;

/** How much of the next rail card has to show for the row to read as scrollable. */
const RAIL_PEEK = 44;

/** Below this a rail card has no room left for a title and two stats. */
const RAIL_MIN_WIDTH = 236;

/**
 * The cover is 3:4 PORTRAIT because that is the aspect the source art is
 * actually in - seed covers are 360x480 and generated ones are 1024x1536
 * (see backend/COVER_IMAGES.md). Cropping that into a square here threw away
 * roughly a third of every image, so the thumbnail in the feed and the
 * full-bleed hero on the story page showed visibly different pictures of the
 * same file. One cover, one crop: the card matches the source, and the hero
 * shows the same frame larger.
 */
const COVER_ASPECT = 4 / 3;

/**
 * THE CARD IS NO LONGER A FIXED 300 WITH A FIXED 116 COVER.
 *
 * Those two numbers were measured at the 390pt reference frame and written
 * down as constants, which is fine until the window is not 390: at 320 the
 * rail card was wider than the gutters left for it, and at 768 the same card
 * sat in the corner of a tablet with a stamp-sized cover. The ratios below
 * reproduce today's reference geometry EXACTLY at 390 (content 350 -> cover
 * 116 x 155, rail 300) and move off it only where the window makes them.
 *
 * `COVER_SHARE` is read against the CONTENT width rather than the card's, so
 * a rail card and a list card on the same screen ASK for the same cover — the
 * point of this card is that a story looks like itself wherever it is met.
 * `COVER_MAX_CARD_SHARE` is the check that keeps a wide window's larger cover
 * from eating a rail card that is capped at 300, and it is the one thing that
 * can pull the two apart. Through the phone range they agree exactly; at 768
 * the content asks for 140, the list card gives it, and the rail card — still
 * 300 wide — gives 117, because a 140pt cover is 47% of it. That is the
 * intended trade: the rail cover yields rather than the rail card losing its
 * title and byline.
 */
const COVER_SHARE = 0.33;
const COVER_MAX_CARD_SHARE = 0.39;
const COVER_MIN_WIDTH = 96;
const COVER_MAX_WIDTH = 140;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export type FeedCardMetrics = {
  /** `null` means "fill the column" — the list card's width is its parent's. */
  cardWidth: number | null;
  coverWidth: number;
  coverHeight: number;
};

/**
 * Pure, and exported, so the geometry can be asserted at a width rather than
 * inferred from a screenshot.
 */
export function feedCardMetrics(
  content: number,
  variant: StoryFeedCardVariant,
): FeedCardMetrics {
  /*
    The outer `Math.min` is the guard, and it is not theoretical: the clamp's
    JOB is to pull a small number UP to `RAIL_MIN_WIDTH`, so at any content
    below 236 it hands back a card wider than the column it was asked to fit
    in. `useLayoutWidth` no longer feeds this a zero (it falls back to the
    390pt reference frame), but a card that can be wider than its own content
    width is the kind of thing that only has to be true once.
  */
  const railWidth = Math.min(
    clamp(content - RAIL_PEEK, RAIL_MIN_WIDTH, RAIL_CARD_WIDTH),
    content,
  );
  const cardWidth = variant === "rail" ? railWidth : content;
  const coverWidth = Math.round(
    Math.min(
      clamp(content * COVER_SHARE, COVER_MIN_WIDTH, COVER_MAX_WIDTH),
      cardWidth * COVER_MAX_CARD_SHARE,
    ),
  );

  return {
    cardWidth: variant === "rail" ? railWidth : null,
    coverWidth,
    coverHeight: Math.round(coverWidth * COVER_ASPECT),
  };
}

/**
 * The cover, or the genre gradient standing in for it.
 *
 * THE PLACEHOLDER IS SILENT. A story whose cover is still being painted, or
 * whose painting failed, shows its genre's gradient and nothing else: no
 * spinner, no "Painting..." copy, no retry. A feed card is a reader's glance
 * at a story, and a progress report on its artwork is not something they
 * asked for. When the art arrives the picture cross-fades in over the
 * gradient, so the swap reads as the art arriving rather than the card
 * flickering.
 *
 * The generated cover (`coverImageUrl`) is read first and the bundled seed
 * asset (`coverImage`) second. Reading only the bundled one meant a story the
 * user wrote showed its art in the studio and a gradient everywhere else.
 *
 * THE CARD IS NEVER WITHHELD UNTIL THE COVER LOADS, and this is deliberate
 * rather than unfinished. Gating the row on its picture turns a feed that
 * paints in 80ms into a blank screen for as long as the slowest cover takes,
 * on the slowest connection, and a story whose cover generation failed would
 * then never appear at all — the catalogue would silently shrink. The
 * gradient IS the card until the art arrives.
 *
 * WHY THERE IS NO FADE STATE HERE ANY MORE, and it is worth knowing what was
 * removed. The reveal used to be an `Animated.Value` driven from `onLoad`,
 * and it was wrong in both directions before it was right. First it revealed
 * too LATE: the value was reset to 0 in a mount effect, and a cover that
 * resolves fast — a warm cache, an already-decoded image — fires `onLoad`
 * BEFORE that effect runs, so the fade started and the effect put it straight
 * back to 0 with nothing to fire `onLoad` again. That was "the top of the list
 * is broken and the rest is fine". Then, once the value was keyed to the
 * source, a REGENERATED cover reused the old value of 1 and appeared at full
 * strength instead of fading up.
 *
 * Both bugs are the same bug: a fade whose correctness depends on the order of
 * a callback and an effect. `expo-image`'s `transition` does the cross-fade
 * itself, with no state to sequence, so the ordering question no longer
 * exists. `FocalImage` owns it now.
 *
 * THE COVER IS ALSO FETCHED SMALL. See `lib/cover-url.ts`: the full-size PNG
 * this box used to download is ~2 MB and the box is 116x155pt.
 */
function CardCover(
  { story, width, height }: { story: Story; width: number; height: number },
) {
  // Ask Supabase for the cover at roughly the size this box draws it. A
  // published cover is a full-size PNG -- one sampled from production is
  // 1,978,908 bytes -- and this box is about 116x155pt. See `lib/cover-url.ts`
  // for the measurements, and for why the `Accept` header is the other half of
  // the saving.
  const coverUri = coverUrl(story.coverImageUrl, "card");
  const image = coverUri
    ? { uri: coverUri }
    : story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const focalY = Math.max(0, (story.focalY ?? 0.5) - 0.07);

  return (
    <View testID="story-feed-cover-frame" style={[styles.cover, { width, height }]}>
      <LinearGradient
        colors={genreGradients[story.genre]}
        style={StyleSheet.absoluteFill}
      />
      {/*
        NO HAND-ROLLED FADE ANY MORE. This was an `Animated.View` whose opacity
        was keyed to the source and driven from `onLoad`, and it existed
        because RN's `Image` pops in. It was subtly wrong twice: once revealing
        too LATE -- a fast `onLoad` beat the mount effect that zeroed the
        opacity, so the first screenful of Explore stayed invisible -- and once
        too EARLY, when a regenerated cover reused the previous value of 1 and
        appeared at full strength instead of fading up from the gradient.
        `expo-image`'s `transition` is the same cross-fade with no state to
        sequence, so neither bug has anywhere left to live.
      */}
      {image
        ? (
          <View testID="story-feed-cover" style={StyleSheet.absoluteFill}>
            <FocalImage
              source={image}
              focalX={story.focalX ?? 0.5}
              focalY={focalY}
              style={{ width: "100%", height: "100%" }}
              // The story id, not the URL. A regenerated cover keeps the same
              // card and should cross-fade; a RECYCLED row is a different
              // story and must never show the previous one's art.
              recyclingKey={story.id}
            />
          </View>
        )
        : null}
      {/*
        The genre, on the art. A story whose cover is still being painted is a
        bare gradient, and a gradient alone does not say what kind of story it
        is; with a painted cover it is the one-word answer to "what is this"
        before the title is read. Decorative to a screen reader: the card's
        hint carries the same word.
      */}
      <View
        style={styles.genrePill}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Text style={styles.genrePillText} numberOfLines={1}>
          {genreLabels[story.genre] ?? story.genre}
        </Text>
      </View>
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

function StoryFeedCardComponent({
  story,
  onPress,
  variant = "list",
}: {
  story: Story;
  onPress?: () => void;
  variant?: StoryFeedCardVariant;
}) {
  // The card sizes itself from the window rather than from two constants; see
  // `feedCardMetrics`. A list card still fills its column, so only the rail
  // gets an explicit width.
  const { content } = useLayoutWidth();
  const { cardWidth, coverWidth, coverHeight } = feedCardMetrics(
    content,
    variant,
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Read ${story.title}`}
      // The genre only: a hint is read on every focus, and a synopsis there
      // makes each card in a list several seconds long to move past.
      accessibilityHint={genreLabels[story.genre]}
      style={({ pressed }) => [
        styles.card,
        cardWidth === null ? styles.listCard : { width: cardWidth },
        pressed && styles.pressed,
      ]}
    >
      <CardCover story={story} width={coverWidth} height={coverHeight} />
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

/**
 * Memoised because a Home rail holds a dozen of these and Home re-renders on
 * anything App does -- a credits tick, a generation publishing, a tab switch.
 * Each card owns a cover image that decodes and cross-fades, so re-rendering
 * one of them for a change none of them shows is work that makes a rail
 * stutter under the thumb. It only holds if `onPress` is stable: see
 * `RailCard` in `FeedRail`.
 */
export const StoryFeedCard = memo(StoryFeedCardComponent);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    boxShadow: shadows.card,
  },
  listCard: { width: "100%" },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  cover: {
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder,
  },
  genrePill: {
    position: "absolute",
    left: spacing.xs,
    bottom: spacing.xs,
    maxWidth: "90%",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    // Solid ink, not a scrim: over pale artwork a translucent pill let the
    // label fall under 4.5:1.
    backgroundColor: colors.ink,
  },
  genrePillText: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700",
    color: colors.surface,
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
