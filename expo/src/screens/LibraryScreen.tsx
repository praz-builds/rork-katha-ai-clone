import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bookmark, MessageCircle } from "lucide-react-native";
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
}: {
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onCreate: () => void;
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
