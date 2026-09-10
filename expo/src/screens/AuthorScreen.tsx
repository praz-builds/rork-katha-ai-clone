import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { formatNumber, StoryCard } from "@/components/KathaPrimitives";
import FollowButton from "@/components/profile/FollowButton";
import StatGrid from "@/components/profile/StatGrid";
import { authorFor } from "@/data/seed";
import {
  fetchPublicProfile,
  isRealAuthorId,
  type PublicProfile,
  type PublicStorySummary,
  writingSince,
} from "@/lib/profile";
import { colors, fonts, spacing } from "@/theme";
import { GENRES, type Genre, type Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

/**
 * Somebody else's profile: reached from a byline or a comment author.
 *
 * WHAT IS ALLOWED ON THIS PAGE. Their handle, their picture, their bio, their
 * public stories, and four counts taken over exactly those public stories.
 * Nothing else, and the boundary is enforced on the server rather than here --
 * `public_profile` and the list query in `_shared/profile.ts` share one
 * predicate, so their drafts, their private stories, the stories the entity
 * gate kept private, their credits, their saved phrases and their own reading
 * streak are not merely hidden by this screen: they never leave the database.
 *
 * A visitor cannot tell from this page whether the author has drafts at all.
 * That is the intended property. "3 published, 11 total" would be flattering
 * and would also disclose the existence of eight private stories.
 *
 * SEEDED AUTHORS. The bundled sample stories have fixture author ids that are
 * not UUIDs and have no row anywhere. `isRealAuthorId` separates them, and they
 * render from the fixture with no follow button, because there is nobody there
 * to follow.
 */
export default function AuthorScreen({
  authorId,
  stories: allStories,
  canEngage = true,
  onBack,
  onStory,
  onRequireSignIn,
}: {
  authorId: string;
  stories: Story[];
  /** False for a guest: Follow becomes a sign-in prompt. */
  canEngage?: boolean;
  onBack: () => void;
  onStory: (id: string) => void;
  onRequireSignIn?: () => void;
}) {
  const real = isRealAuthorId(authorId);
  const seeded = authorFor(authorId);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [published, setPublished] = useState<PublicStorySummary[] | null>(null);

  useEffect(() => {
    if (!real) return;
    let alive = true;
    fetchPublicProfile(authorId)
      .then((result) => {
        if (!alive || !result) return;
        setProfile(result.profile);
        setPublished(result.stories);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authorId, real]);

  const handle = profile?.username ?? (real ? null : seeded.username);
  const displayName = profile?.username
    ? `@${profile.username}`
    : real
    ? "A Katha writer"
    : seeded.displayName;
  const bio = profile?.bio ?? (real ? null : seeded.bio);
  const since = writingSince(profile?.firstPublishedAt ?? null) ??
    writingSince(profile?.memberSince ?? null);

  // Seeded authors keep the fixture stories they have always shown. A real
  // author's list comes from the server and is never filtered client-side:
  // filtering here would mean this screen had to re-derive the private-story
  // rule, and a second copy of that rule is a second place for it to be wrong.
  const seededStories = real
    ? []
    : allStories.filter((story) => story.authorId === seeded.id);

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.authorHeader}>
          <View style={styles.authorAvatar}>
            {profile?.avatarUrl
              ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
                  style={styles.avatarImage}
                  accessibilityIgnoresInvertColors
                />
              )
              : (
                <Text style={styles.authorInitial}>
                  {(handle ?? displayName).replace("@", "").charAt(0)
                    .toUpperCase()}
                </Text>
              )}
          </View>
          <Text style={styles.h1}>{displayName}</Text>
          {handle && profile?.username
            ? null
            : handle
            ? <Text style={styles.profileMeta}>@{handle}</Text>
            : null}
          {bio ? <Text style={styles.authorBio}>{bio}</Text> : null}
          {since
            ? <Text style={styles.since}>Writing since {since}</Text>
            : null}

          {real && profile
            ? (
              <View style={styles.followWrap}>
                <FollowButton
                  authorId={authorId}
                  following={profile.isFollowing}
                  followers={profile.followers}
                  canEngage={canEngage}
                  onRequireSignIn={onRequireSignIn}
                  onChange={(next) =>
                    setProfile((current) =>
                      current
                        ? {
                          ...current,
                          isFollowing: next.following,
                          followers: next.followers,
                        }
                        : current
                    )}
                />
              </View>
            )
            : null}
        </View>

        {/*
          The creator numbers. All four are counts over the public stories
          listed below, so the count above the list and the list itself can
          never disagree.
        */}
        {real && profile
          ? (
            <View style={styles.statsWrap}>
              <StatGrid
                stats={[
                  { label: "Published", value: profile.storiesPublished },
                  { label: "Reads", value: profile.totalReads },
                  { label: "Likes", value: profile.totalLikes },
                  { label: "Followers", value: profile.followers },
                ]}
              />
            </View>
          )
          : !real
          ? (
            <View style={styles.authorStats}>
              <Text style={styles.stat}>
                {formatNumber(seeded.followers)} followers
              </Text>
              <Text style={styles.stat}>{seeded.storyCount} stories</Text>
            </View>
          )
          : null}

        <View style={styles.stack}>
          {real
            ? (published ?? []).map((story) => (
              <StoryCard
                key={story.id}
                story={asCard(story, authorId)}
                compact
                onPress={() => onStory(story.id)}
              />
            ))
            : seededStories.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                compact
                onPress={() => onStory(story.id)}
              />
            ))}
        </View>

        {real && published !== null && published.length === 0
          ? (
            <Text style={styles.empty} testID="author-no-stories">
              Nothing published yet.
            </Text>
          )
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The minimum of a `Story` that `StoryCard` reads, built from a public row.
 *
 * Deliberately not a full hydration: this list needs a title, a genre and a
 * read count, and fetching every author's chapters to render a byline page
 * would be a query per card for text nothing on this screen displays.
 */
function asCard(story: PublicStorySummary, authorId: string): Story {
  const candidate = story.primaryGenre ?? story.genre[0];
  const genre: Genre = (GENRES as readonly string[]).includes(candidate ?? "")
    ? candidate as Genre
    : "adventure";

  return {
    id: story.id,
    title: story.title,
    authorId,
    genre,
    synopsis: "",
    chapters: [],
    likes: story.likeCount,
    bookmarks: 0,
    views: story.readCount,
    tags: story.themes,
    publishedOffset: 0,
    isFeatured: false,
    language: "en",
    coverImageUrl: story.coverImageUrl ?? undefined,
  };
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
      overflow: "hidden",
    },
    avatarImage: { width: "100%", height: "100%" },
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
    since: {
      fontFamily: fonts.ui,
      color: colors.tertiary,
      fontSize: 12,
    },
    followWrap: { marginTop: spacing.md },
    statsWrap: { marginBottom: spacing.xl },
    authorStats: {
      flexDirection: "row",
      gap: spacing.lg,
      justifyContent: "center",
      marginBottom: spacing.xl,
    },
    stat: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
    empty: {
      marginTop: spacing.lg,
      textAlign: "center",
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 14,
    },
  }),
};
