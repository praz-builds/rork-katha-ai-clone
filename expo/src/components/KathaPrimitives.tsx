import { LinearGradient } from "expo-linear-gradient";
import type { PropsWithChildren } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Bookmark, ChevronRight, Heart, Sparkles } from "lucide-react-native";
import { imageAssets } from "@/data/images";
import { authorFor, storyWordCount } from "@/data/seed";
import { colors, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme/theme";
import type { Genre, Story } from "@/types/domain";

export function ScreenScaffold({ children }: PropsWithChildren) {
  return <View style={styles.screen}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  children,
  onPress,
  variant = "primary"
}: PropsWithChildren<{ onPress?: () => void; variant?: "primary" | "secondary" }>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" ? styles.secondaryButton : styles.primaryButton,
        pressed && styles.pressed
      ]}
    >
      <Text style={[styles.buttonText, variant === "secondary" && styles.secondaryButtonText]}>{children}</Text>
      <ChevronRight size={18} color={variant === "secondary" ? colors.ink : "#FFFFFF"} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Cover({ story, size = "card" }: { story: Story; size?: "card" | "hero" | "mini" }) {
  const image = story.coverImage ? imageAssets[story.coverImage] : undefined;
  const gradient = genreGradients[story.genre];
  return (
    <LinearGradient colors={gradient} style={[styles.cover, styles[`${size}Cover`]]}>
      {image ? <Image source={image} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.62)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.coverTextWrap}>
        <Text numberOfLines={3} style={[styles.coverTitle, size === "mini" && styles.coverMiniTitle]}>
          {story.title}
        </Text>
        {size !== "mini" ? <Text style={styles.coverMeta}>{genreLabels[story.genre]}</Text> : null}
      </View>
    </LinearGradient>
  );
}

export function StoryCard({ story, onPress, compact }: { story: Story; onPress?: () => void; compact?: boolean }) {
  const author = authorFor(story.authorId);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.storyCard, pressed && styles.pressed]}>
      <Cover story={story} size={compact ? "mini" : "card"} />
      <View style={styles.storyBody}>
        <Text style={styles.storyGenre}>{genreLabels[story.genre]}</Text>
        <Text numberOfLines={2} style={styles.storyTitle}>
          {story.title}
        </Text>
        <Text numberOfLines={2} style={styles.storySynopsis}>
          {story.synopsis}
        </Text>
        <Text style={styles.storyAuthor}>by {author.displayName}</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Heart size={14} color={colors.heart} />
            <Text style={styles.metricText}>{formatNumber(story.likes)}</Text>
          </View>
          <View style={styles.metric}>
            <Bookmark size={14} color={colors.muted} />
            <Text style={styles.metricText}>{formatNumber(story.bookmarks)}</Text>
          </View>
          <Text style={styles.metricText}>{Math.max(1, Math.round(storyWordCount(story) / 200))} min</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function CreditPill({ credits }: { credits: number }) {
  return (
    <View style={styles.creditPill}>
      <Sparkles size={16} color={colors.accent} />
      <Text style={styles.creditText}>{credits} credits</Text>
    </View>
  );
}

export function GenreSwatch({ genre }: { genre: Genre }) {
  return <LinearGradient colors={genreGradients[genre]} style={styles.genreSwatch} />;
}

export function formatNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  sectionHeader: {
    marginBottom: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  sectionTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22
  },
  sectionAction: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "700",
    fontSize: 13
  },
  button: {
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm
  },
  primaryButton: {
    backgroundColor: colors.accent
  },
  secondaryButton: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border
  },
  buttonText: {
    fontFamily: fonts.ui,
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15
  },
  secondaryButtonText: {
    color: colors.ink
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }]
  },
  chip: {
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  chipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700"
  },
  chipTextSelected: {
    color: "#FFFFFF"
  },
  cover: {
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: colors.borderStrong
  },
  cardCover: {
    width: 108,
    minHeight: 152,
    borderRadius: radius.md
  },
  heroCover: {
    height: 340,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl
  },
  miniCover: {
    width: 74,
    minHeight: 96,
    borderRadius: radius.md
  },
  coverTextWrap: {
    padding: spacing.md
  },
  coverTitle: {
    fontFamily: fonts.display,
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 21
  },
  coverMiniTitle: {
    fontSize: 12,
    lineHeight: 14
  },
  coverMeta: {
    marginTop: spacing.xs,
    fontFamily: fonts.ui,
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  storyCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    gap: spacing.md,
    shadowColor: "#3D2D1B",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }
  },
  storyBody: {
    flex: 1,
    gap: spacing.xs
  },
  storyGenre: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  storyTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 19,
    lineHeight: 23
  },
  storySynopsis: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  storyAuthor: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
    fontWeight: "700"
  },
  metricsRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  metricText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  creditPill: {
    paddingHorizontal: spacing.md,
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  creditText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13
  },
  genreSwatch: {
    width: 32,
    height: 32,
    borderRadius: 10
  }
});
