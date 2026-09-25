import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { formatNumber, StoryCard } from "@/components/KathaPrimitives";
import { Button } from "@/components/Button";
import FollowButton from "@/components/profile/FollowButton";
import { authorFor } from "@/data/seed";
import { unblockAuthorEverywhere, useBlockedAuthorIds } from "@/lib/blocks";
import {
  fetchProfileComments,
  isRealAuthorId,
  type ProfileComment,
  type PublicProfile,
  type PublicStorySummary,
  writingSince,
} from "@/lib/profile";
import {
  cachedPublicProfile,
  loadPublicProfile,
  markOwnProfileStale,
  patchPublicProfile,
  useOwnProfileStore,
} from "@/lib/profile-store";
import { colors, fonts, radius, spacing } from "@/theme";
import { GENRES, type Genre, type Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

/**
 * Somebody else's profile: reached from a byline or a comment author.
 *
 * WHAT IS ALLOWED ON THIS PAGE. Their handle, their picture, their bio, their
 * public stories, and their follower counts. Nothing else, and the boundary
 * is enforced on the server rather than here -- `public_profile` and the
 * list query in `_shared/profile.ts` share one predicate, so their drafts, their private stories and their credits are
 * not merely hidden by this screen: they never leave the database.
 *
 * NO STREAK CALENDAR. It used to sit under the follow counts. How often
 * somebody opens the app is about them, not about their work, and a visitor
 * came here for the stories -- which the calendar pushed below the fold. The
 * owner still sees theirs on the Journey screen, reached from their own
 * Profile tab; this page no longer asks for anybody's.
 *
 * A visitor cannot tell from this page whether the author has drafts at all.
 * That is the intended property. "3 published, 11 total" would be flattering
 * and would also disclose the existence of eight private stories.
 *
 * SOMEBODY THE READER BLOCKED. The page still opens -- a name has to lead
 * somewhere -- but it shows none of their work, says why, and offers Unblock
 * right there. The server agrees: `profile`'s public read returns no stories
 * for a viewer who blocked the author.
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
  // A page seen earlier this session is drawn at once from what it showed
  // then, and refreshed behind it; see `src/lib/profile-store.ts`.
  const held = real ? cachedPublicProfile(authorId) : null;
  // The reader's own page, opened from the Profile tab: their name and face
  // are already held app-wide and stand in until the public row lands.
  const own = useOwnProfileStore();
  const isOwnPage = real && own.profile?.userId === authorId;
  const [comments, setComments] = useState<ProfileComment[]>([]);
  const [profile, setProfile] = useState<PublicProfile | null>(held?.profile ?? null);
  const [published, setPublished] = useState<PublicStorySummary[] | null>(
    held?.stories ?? null,
  );
  const [profileState, setProfileState] = useState<"loading" | "ready" | "error">(
    held ? "ready" : "loading",
  );
  const blockedIds = useBlockedAuthorIds();
  const isBlocked = real && blockedIds.has(authorId);
  const [unblocking, setUnblocking] = useState(false);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  /**
   * Bumped by an unblock. The page was read while the block stood, so the
   * server answered with no stories; it has to be asked again.
   */
  const [readEpoch, setReadEpoch] = useState(0);

  const unblock = async () => {
    setUnblocking(true);
    setUnblockError(null);
    try {
      await unblockAuthorEverywhere(authorId);
      setReadEpoch((value) => value + 1);
    } catch {
      setUnblockError("That did not save. Check your connection and try again.");
    } finally {
      setUnblocking(false);
    }
  };

  useEffect(() => {
    if (!real) return;
    let alive = true;
    // Cleared on every author change, before anything is fetched. Without this
    // a failed or empty request leaves the PREVIOUS author's comments and
    // stories on screen, attributed to whoever is being looked at now.
    const cached = cachedPublicProfile(authorId);
    setProfile(cached?.profile ?? null);
    setPublished(cached?.stories ?? null);
    setComments([]);
    setProfileState(cached ? "ready" : "loading");
    loadPublicProfile(authorId)
      .then((result) => {
        if (!alive) return;
        if (!result) {
          // A refresh that failed behind a held copy leaves the copy up.
          if (!cached) setProfileState("error");
          return;
        }
        setProfile(result.profile);
        setPublished(result.stories);
        setProfileState("ready");
      })
      .catch(() => {
        if (alive && !cached) setProfileState("error");
      });
    // The comments are independent of the profile: one failing leaves the
    // other on the page rather than taking the whole thing down.
    fetchProfileComments(authorId)
      .then((result) => {
        if (alive && result) setComments(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authorId, real, readEpoch]);

  // On the reader's own page, the name and face they already have stand in
  // until the public row arrives.
  const ownSeed = isOwnPage && !profile ? own.profile : null;
  const username = profile?.username ?? ownSeed?.username ?? null;
  const avatarUrl = profile?.avatarUrl ?? ownSeed?.avatarUrl ?? null;
  // A real author whose row has not arrived yet: hold the name's place rather
  // than calling them "A Katha writer" and then renaming them.
  const nameLoading = real && !username && profileState === "loading";

  const handle = username ?? (real ? null : seeded.username);
  const displayName = username
    ? `@${username}`
    : real
    ? "A Katha writer"
    : seeded.displayName;
  const bio = profile?.bio ?? ownSeed?.bio ?? (real ? null : seeded.bio);
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
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.authorHeader}>
          <View style={styles.authorAvatar}>
            {avatarUrl
              ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatarImage}
                  accessibilityIgnoresInvertColors
                />
              )
              : nameLoading
              ? null
              : (
                <Text style={styles.authorInitial}>
                  {(handle ?? displayName).replace("@", "").charAt(0)
                    .toUpperCase()}
                </Text>
              )}
          </View>
          {nameLoading
            ? (
              <View
                style={styles.nameSkeleton}
                testID="author-name-skeleton"
                accessibilityLabel="Loading profile"
              />
            )
            : <Text style={styles.h1}>{displayName}</Text>}
          {handle && username
            ? null
            : handle
            ? <Text style={styles.profileMeta}>@{handle}</Text>
            : null}
          {bio ? <Text style={styles.authorBio}>{bio}</Text> : null}
          {since
            ? <Text style={styles.since}>Writing since {since}</Text>
            : null}

          {isBlocked
            ? (
              <View style={styles.blockedCard} testID="author-blocked">
                <Text style={styles.blockedTitle}>You blocked this writer</Text>
                <Text style={styles.blockedBody}>
                  Their stories and comments are hidden from you.
                </Text>
                <Button
                  label="Unblock"
                  variant="secondary"
                  size="sm"
                  onPress={() => void unblock()}
                  loading={unblocking}
                  accessibilityLabel={`Unblock ${displayName}`}
                  testID="author-unblock"
                />
                {unblockError
                  ? <Text style={styles.blockedError}>{unblockError}</Text>
                  : null}
              </View>
            )
            : real && profile
            ? (
              <View style={styles.followWrap}>
                <FollowButton
                  authorId={authorId}
                  following={profile.isFollowing}
                  followers={profile.followers}
                  canEngage={canEngage}
                  onRequireSignIn={onRequireSignIn}
                  onChange={(next) => {
                    setProfile((current) =>
                      current
                        ? {
                          ...current,
                          isFollowing: next.following,
                          followers: next.followers,
                        }
                        : current
                    );
                    patchPublicProfile(authorId, {
                      isFollowing: next.following,
                      followers: next.followers,
                    });
                    // The reader's own "following" count just moved.
                    markOwnProfileStale();
                  }}
                />
              </View>
            )
            : null}
        </View>

        {/*
          Two numbers, not four.
          
          Reads and likes were here and are gone. They are a scoreboard: they
          measure how a person has performed rather than describing who they
          are, and putting them at the top of somebody's page invites the
          comparison rather than the reading. Followers and following are what
          is left, because they are the only counts here that describe a
          relationship, and they are the pair a stranger actually uses to
          decide whether this is somebody worth following.
        */}
        {isBlocked
          ? null
          : real && profile
          ? (
            <View style={styles.statsWrap}>
              <View style={styles.followCounts}>
                <View style={styles.followCount}>
                  <Text style={styles.followValue}>
                    {formatNumber(profile.followers)}
                  </Text>
                  <Text style={styles.followLabel}>
                    {profile.followers === 1 ? "Follower" : "Followers"}
                  </Text>
                </View>
                <View style={styles.followDivider} />
                <View style={styles.followCount}>
                  <Text style={styles.followValue}>
                    {formatNumber(profile.following)}
                  </Text>
                  <Text style={styles.followLabel}>Following</Text>
                </View>
              </View>
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

        {/* What they have written: the reason anybody opens this page, so it
            is named, and it answers even when the answer is "nothing yet". */}
        {isBlocked ? null : (
          <Text style={styles.storiesHeading} testID="author-stories-heading">
            Stories
          </Text>
        )}

        <View style={styles.stack}>
          {isBlocked
            ? null
            : real
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

        {!isBlocked && real && published !== null && published.length === 0
          ? (
            <Text style={styles.empty} testID="author-no-stories">
              {isOwnPage
                ? "You have not made a story public yet. Private stories stay in your Library."
                : `${displayName} has not published a story yet.`}
            </Text>
          )
          : null}

        {/* The list could not be read. Said, rather than shown as an empty
            page that would read as "this writer has published nothing". */}
        {!isBlocked && real && published === null && profileState === "error"
          ? (
            <Text style={styles.empty} testID="author-stories-error">
              Stories could not be loaded. Check your connection and try again.
            </Text>
          )
          : null}

        {/*
          What they have said, under what they have written.

          A comment is a thing said TO other people, which is why it belongs on
          the page other people look at rather than on the owner's own. Each
          one names the story it was left on: a remark with no context reads as
          a status update, and these are replies.

          Visibility is the story's, decided on the server -- a comment on a
          private or gated story never reaches here, so this page can never
          become a way to read around a story nobody was meant to see.
        */}
        {!isBlocked && real && comments.length > 0
          ? (
            <View style={styles.commentsSection} testID="author-comments">
              <Text style={styles.commentsHeading}>Comments</Text>
              {comments.map((comment) => (
                <Pressable
                  key={comment.id}
                  onPress={() => onStory(comment.storyId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Comment on ${
                    comment.storyTitle ?? "a story"
                  }`}
                  style={({ pressed }) => [
                    styles.commentCard,
                    pressed && styles.commentPressed,
                  ]}
                >
                  <Text style={styles.commentStory} numberOfLines={1}>
                    {comment.storyTitle ?? "A story"}
                    {comment.chapterNumber
                      ? ` · Chapter ${comment.chapterNumber}`
                      : ""}
                  </Text>
                  <Text style={styles.commentBody} numberOfLines={4}>
                    {comment.content}
                  </Text>
                </Pressable>
              ))}
            </View>
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
    blockedCard: {
      alignSelf: "stretch",
      marginTop: spacing.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      alignItems: "center",
    },
    blockedTitle: {
      fontFamily: fonts.ui,
      fontWeight: "700",
      fontSize: 16,
      color: colors.ink,
    },
    blockedBody: {
      fontFamily: fonts.ui,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
      textAlign: "center",
      marginBottom: spacing.xs,
    },
    blockedError: {
      fontFamily: fonts.ui,
      fontSize: 13,
      color: colors.accentPressed,
      textAlign: "center",
    },
    authorHeader: {
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    /** The `h1` line's footprint (35pt) while the name is on its way. */
    nameSkeleton: {
      marginTop: 3,
      width: 180,
      height: 35,
      borderRadius: radius.sm,
      backgroundColor: colors.surface2,
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
    statsWrap: { marginBottom: spacing.xl, gap: spacing.lg },
    followCounts: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xl,
    },
    followCount: { alignItems: "center" },
    followValue: {
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 24,
    },
    followLabel: {
      marginTop: 2,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    followDivider: {
      width: 1,
      height: 28,
      backgroundColor: colors.border,
    },
    storiesHeading: {
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 22,
    },
    commentsSection: { marginTop: spacing.xl, gap: spacing.sm },
    commentsHeading: {
      marginBottom: spacing.xs,
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 22,
    },
    commentCard: {
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    commentPressed: { opacity: 0.85 },
    commentStory: {
      fontFamily: fonts.ui,
      color: colors.accent,
      fontWeight: "700",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    commentBody: {
      marginTop: 6,
      fontFamily: fonts.ui,
      color: colors.ink,
      fontSize: 15,
      lineHeight: 22,
    },
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
