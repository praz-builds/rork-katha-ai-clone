import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StoryCard } from "@/components/KathaPrimitives";
import { StoryFeedCard } from "@/components/feed/StoryFeedCard";
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import { colors, fonts, spacing } from "@/theme";
import type { Genre, Story } from "@/types/domain";

/**
 * Dev-only review harness for the Katha Originals covers.
 *
 * Reached at `localhost:8090/?preview=originals`. It renders each candidate
 * cover through the components a reader actually sees - the Home rail card,
 * the list card, the compact card and the full story page - so a cover is
 * judged by its crops, not by the full 2:3 image nobody is ever shown.
 *
 * The covers and their manifest are NOT bundled: they are served at runtime
 * from `backend/originals/serve-review.py` on port 8093, because they are
 * candidates under review and must not ship or be committed before they are
 * approved. Titles are real; chapter text is placeholder.
 *
 * Guarded by `__DEV__` and the web check at the App.tsx call site, so it
 * cannot reach a shipped build.
 */
const MANIFEST_URL = "http://localhost:8093/manifest.json";

type ReviewEntry = {
  slug: string;
  title: string;
  genre: Genre;
  logline: string;
  artStyle: string;
  chapters: number;
  cover: string | null;
};

const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet.",
  "Aenean lacinia bibendum nulla sed consectetur. Maecenas faucibus mollis interdum. Donec ullamcorper nulla non metus auctor fringilla.",
  "Cras mattis consectetur purus sit amet fermentum. Nullam quis risus eget urna mollis ornare vel eu leo.",
];

function toStory(entry: ReviewEntry, index: number): Story {
  const id = `originals-review-${entry.slug}`;
  return {
    id,
    title: entry.title,
    authorId: "kathaai",
    genre: entry.genre,
    primaryGenre: entry.genre,
    storyMode: entry.chapters > 1 ? "series" : "standalone",
    synopsis: entry.logline,
    chapters: Array.from({ length: entry.chapters }, (_, n) => ({
      id: `${id}-c${n + 1}`,
      storyId: id,
      title: `Chapter ${n + 1}`,
      paragraphs: LOREM,
      chapterNumber: n + 1,
      isPublished: true,
    })),
    plannedChapterCount: entry.chapters,
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: index,
    isFeatured: true,
    language: "English",
    coverImageUrl: entry.cover ?? undefined,
    coverStatus: entry.cover ? "ready" : "pending",
  };
}

export default function OriginalsCoverPreview() {
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(() => {
    try {
      return new URLSearchParams(globalThis.location?.search ?? "").get("story");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    fetch(MANIFEST_URL)
      .then((response) => response.json())
      .then((data: ReviewEntry[]) => setEntries(data))
      .catch(() => setFailed(true));
  }, []);

  const stories = useMemo(() => (entries ?? []).map(toStory), [entries]);
  const open = stories.find((story) => story.id === `originals-review-${openSlug}`);

  if (open) {
    return (
      <StoryDetailScreen
        story={open}
        onBack={() => setOpenSlug(null)}
        onRead={() => {}}
        onAuthor={() => {}}
        onListen={() => {}}
      />
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Katha Originals — cover review</Text>
      <Text style={styles.note}>
        Dev preview. Real titles, placeholder text. Tap any card to open its
        story page.
      </Text>
      {failed && (
        <Text style={styles.note}>
          Could not load {MANIFEST_URL}. Start backend/originals/serve-review.py.
        </Text>
      )}

      <Text style={styles.section}>Home rail</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {stories.map((story) => (
            <StoryFeedCard
              key={story.id}
              story={story}
              variant="rail"
              onPress={() => setOpenSlug(story.id.replace("originals-review-", ""))}
            />
          ))}
        </View>
      </ScrollView>

      <Text style={styles.section}>List cards and compact cards</Text>
      {stories.map((story, index) => (
        <View key={story.id} style={styles.entry}>
          <Text style={styles.meta}>
            {index + 1}. {entries?.[index]?.genre} · {entries?.[index]?.artStyle} ·{" "}
            {entries?.[index]?.chapters} ch
          </Text>
          <StoryFeedCard
            story={story}
            onPress={() => setOpenSlug(story.id.replace("originals-review-", ""))}
          />
          <StoryCard story={story} compact />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, maxWidth: 430 },
  title: { fontFamily: fonts.display, fontSize: 20, fontWeight: "700", color: colors.ink },
  note: { fontFamily: fonts.ui, fontSize: 13, color: colors.muted },
  section: {
    fontFamily: fonts.ui,
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
    marginTop: spacing.md,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  entry: { gap: spacing.xs, marginBottom: spacing.md },
  meta: { fontFamily: fonts.ui, fontSize: 12, color: colors.muted },
});
