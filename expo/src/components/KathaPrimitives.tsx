import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Sparkles } from "lucide-react-native";
import { imageAssets } from "@/data/images";
import { colors, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme/theme";
import type { Genre, ImageName, Story } from "@/types/domain";

/**
 * Renders an image with focal-point-aware cropping.
 * On web, uses a native <img> with object-fit/object-position (RN Web's
 * Image component ignores objectPosition). On native, falls back to
 * standard RN Image with center crop.
 */
export function FocalImage({
  source,
  focalX = 0.5,
  focalY = 0.5,
  style,
  onLoad,
}: {
  source: number | { uri: string };
  focalX?: number;
  focalY?: number;
  style?: { width: number | string; height: number | string };
  onLoad?: () => void;
}) {
  if (Platform.OS === "web") {
    let uri: string;
    try {
      if (typeof source === "object" && source !== null && "uri" in source) {
        uri = (source as { uri: string }).uri;
      } else if (typeof source === "number") {
        const resolved = Image.resolveAssetSource(source);
        uri = resolved?.uri ?? "";
      } else {
        uri = "";
      }
    } catch {
      uri = "";
    }
    if (!uri) {
      // Fallback to standard RN Image if URI resolution fails
      return (
        <Image source={source as number} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={onLoad} />
      );
    }
    return React.createElement("img", {
      src: uri,
      style: {
        width: style?.width ?? "100%",
        height: style?.height ?? "100%",
        objectFit: "cover",
        objectPosition: `${focalX * 100}% ${focalY * 100}%`,
        display: "block",
      },
      onLoad,
      draggable: false,
    });
  }
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
      onLoad={onLoad}
    />
  );
}

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

export function Cover({ story, size = "card" }: { story: Story; size?: "card" | "mini" }) {
  const image = story.coverImage ? imageAssets[story.coverImage] : undefined;
  const gradient = genreGradients[story.genre];
  const focalX = story.focalX ?? 0.5;
  const focalY = story.focalY ?? 0.5;
  const adjustedY = Math.max(0, focalY - 0.07);

  return (
    <View style={[styles.cover, size === "mini" ? styles.miniCover : styles.cardCover]}>
      {image ? (
        <FocalImage
          source={image}
          focalX={focalX}
          focalY={adjustedY}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />
      )}
    </View>
  );
}

export function StoryCard({ story, onPress, compact }: { story: Story; onPress?: () => void; compact?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.storyCard, pressed && styles.pressed]}>
      <Cover story={story} size={compact ? "mini" : "card"} />
      <Text numberOfLines={2} style={styles.storyCardTitle}>
        {story.title}
      </Text>
      <Text style={styles.storyCardMeta} numberOfLines={1}>
        {genreLabels[story.genre]} {"\u00B7"} {formatNumber(story.views)} reads
      </Text>
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
    backgroundColor: "#e7dcc6"
  },
  cardCover: {
    width: 172,
    aspectRatio: 1,
    borderRadius: 20,
    shadowColor: "rgba(80,50,20,1)",
    shadowOpacity: 0.20,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  miniCover: {
    width: 74,
    aspectRatio: 1,
    borderRadius: radius.md
  },
  storyCard: {
    width: 172,
  },
  storyCardTitle: {
    marginTop: 12,
    fontFamily: fonts.display,
    color: "#3f342b",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 19
  },
  storyCardMeta: {
    marginTop: 4,
    fontFamily: fonts.ui,
    color: "#d9601f",
    fontSize: 13,
    fontWeight: "600"
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
