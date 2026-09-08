import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { formatNumber, StoryCard } from "@/components/KathaPrimitives";
import { authorFor } from "@/data/seed";
import { colors, fonts, spacing } from "@/theme";
import type { Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

/* ─────────────────────────────── Author Screen ─────────────────────────────── */

export default function AuthorScreen({
  authorId,
  stories: allStories,
  onBack,
  onStory,
}: {
  authorId: string;
  stories: Story[];
  onBack: () => void;
  onStory: (id: string) => void;
}) {
  const author = authorFor(authorId);
  const authorStories = allStories.filter((story) =>
    story.authorId === author.id
  );
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.authorHeader}>
          <View style={styles.authorAvatar}>
            <Text style={styles.authorInitial}>
              {author.displayName.charAt(0)}
            </Text>
          </View>
          <Text style={styles.h1}>{author.displayName}</Text>
          <Text style={styles.profileMeta}>@{author.username}</Text>
          <Text style={styles.authorBio}>{author.bio}</Text>
          <View style={styles.authorStats}>
            <Text style={styles.stat}>
              {formatNumber(author.followers)} followers
            </Text>
            <Text style={styles.stat}>{author.storyCount} stories</Text>
          </View>
        </View>
        <View style={styles.stack}>
          {authorStories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              compact
              onPress={() => onStory(story.id)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
  authorHeader: {
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  authorAvatar: {
    width: 86,
    height: 86,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInitial: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 42,
  },
  authorBio: {
    paddingHorizontal: spacing.lg,
    textAlign: "center",
    fontFamily: fonts.ui,
    color: colors.muted,
    lineHeight: 21,
  },
  authorStats: { flexDirection: "row", gap: spacing.lg },
  stat: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },

  /* ── Tab bar ── */
  }),
};
