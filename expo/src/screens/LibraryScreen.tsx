import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bookmark, ChevronRight, GraduationCap, MessageCircle } from "lucide-react-native";
import { StoryCard } from "@/components/KathaPrimitives";
import { colors, fonts, radius, spacing } from "@/theme";
import type { Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

type LibrarySegment = "saved" | "history" | "myStories" | "comments";

/* ─────────────────────────────── Library Screen ─────────────────────────────── */

export default function LibraryScreen({
  generatedStories,
  stories: allStories,
  onStory,
  onCreate,
  onPractice,
}: {
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onCreate: () => void;
  /**
   * Opens the Practice surface. A dedicated screen rather than a fifth
   * segment here: the segmented control is four equal-width labels in a
   * 342pt row on a 390pt phone, and "Practice" alongside "My Stories" left
   * two labels wrapping onto a second line. Practice also does not behave
   * like the other tabs - it runs a session, not just a list - so it reads
   * better as its own place than as a cramped fifth tab.
   */
  onPractice: () => void;
}) {
  const [segment, setSegment] = useState<LibrarySegment>("saved");
  const saved = allStories.filter((story) => story.bookmarks > 100);
  const history = allStories.slice(0, 5);

  const segments: { key: LibrarySegment; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "history", label: "History" },
    { key: "myStories", label: "My Stories" },
    { key: "comments", label: "Comments" },
  ];

  const renderSegmentContent = () => {
    switch (segment) {
      case "saved":
        return saved.length > 0
          ? (
            <View style={styles.stack}>
              {saved.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onPress={() => onStory(story.id)}
                  compact
                />
              ))}
            </View>
          )
          : (
            <View style={styles.emptyState}>
              <Bookmark size={32} color={colors.tertiary} />
              <Text style={styles.emptyStateText}>
                Bookmark stories you love
              </Text>
            </View>
          );
      case "history":
        return history.length > 0
          ? (
            <View style={styles.stack}>
              {history.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onPress={() => onStory(story.id)}
                  compact
                />
              ))}
            </View>
          )
          : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                Stories you read will appear here
              </Text>
            </View>
          );
      case "myStories":
        return generatedStories.length > 0
          ? (
            <View style={styles.stack}>
              {generatedStories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onPress={() => onStory(story.id)}
                  compact
                />
              ))}
            </View>
          )
          : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                No stories yet.{" "}
                <Text style={styles.accentLink} onPress={onCreate}>
                  Create your first!
                </Text>
              </Text>
            </View>
          );
      case "comments":
        return (
          <View style={styles.emptyState}>
            <MessageCircle size={32} color={colors.tertiary} />
            <Text style={styles.emptyStateText}>
              Your comments on stories will appear here
            </Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.withTabs}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Library</Text>
            <Text style={styles.h1}>Your collection</Text>
          </View>
          <Bookmark size={28} color={colors.accent} />
        </View>

        <Pressable
          onPress={onPractice}
          accessibilityLabel="Practice your saved phrases"
          accessibilityRole="button"
          style={({ pressed }) => [styles.practiceBanner, pressed && styles.pressed]}
        >
          <View style={styles.practiceIcon}>
            <GraduationCap size={20} color={colors.accent} />
          </View>
          <View style={styles.practiceBannerBody}>
            <Text style={styles.practiceBannerTitle}>Practice</Text>
            <Text style={styles.practiceBannerSubtitle}>
              Review the phrases you saved while reading
            </Text>
          </View>
          <ChevronRight size={18} color={colors.tertiary} />
        </Pressable>

        {/* Segment selector */}
        <View style={styles.segmented}>
          {segments.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setSegment(key)}
              style={[
                styles.segment,
                segment === key && styles.segmentSelected,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  segment === key && styles.segmentTextSelected,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.segmentContent}>
          {renderSegmentContent()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
  withTabs: { paddingBottom: 116 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accentLink: { color: colors.accent, fontWeight: "800" },
  pressed: { opacity: 0.7 },

  /* ── Practice entry point ── */
  practiceBanner: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  practiceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  practiceBannerBody: { flex: 1 },
  practiceBannerTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 16,
    letterSpacing: 0,
  },
  practiceBannerSubtitle: {
    marginTop: 2,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12.5,
    letterSpacing: 0,
  },

  /* ── Library ── */
  segmented: {
    marginHorizontal: spacing.xl,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    flexDirection: "row",
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  segmentTextSelected: { color: colors.ink },
  segmentContent: { marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  emptyState: {
    paddingVertical: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  emptyStateText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },

  /* ── Profile screen ── */
  }),
};
