import { useCallback, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronRight,
  Ellipsis,
  Heart,
  Share2,
} from "lucide-react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { authorFor } from "@/data/seed";
import CommentThread from "@/components/comments/CommentThread";
import type { ReportReason } from "@/components/comments/types";
import { blockAuthor, reportContent } from "@/lib/comments";
import { isSupabaseConfigured } from "@/lib/supabase";
import StoryActionsSheet from "@/components/moderation/StoryActionsSheet";
import { imageAssets } from "@/data/images";
import {
  colors,
  controls,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import type { Story } from "@/types/domain";

/**
 * Builds an rgba() string FROM a hex token instead of writing a literal one.
 *
 * The hero scrim has to fade smoothly from fully transparent to a solid
 * backing tone so the title stays legible over any cover art, and that is an
 * alpha ramp by definition - a flat colour token cannot express it. This is
 * the one deliberate exception to "no rgba" anywhere else in this file: the
 * opaque end of the ramp is derived from `colors.ink` at call time, so if the
 * ink token ever moves, the scrim moves with it instead of drifting out of
 * sync with a hand-copied hex.
 */
function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function Stat({
  Icon,
  value,
  label,
  active,
  onPress,
}: {
  Icon: typeof BookOpen;
  value: number;
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const glyphColor = active ? colors.heart : colors.strong;
  const body = (
    <View style={styles.stat}>
      <Icon
        size={20}
        color={glyphColor}
        fill={active ? colors.heart : "none"}
      />
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
  if (!onPress) {
    // The read count is informational only - no toggle, so it is not a
    // button and must not announce itself as one to a screen reader.
    return (
      <View accessibilityLabel={`${formatNumber(value)} ${label}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatNumber(value)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.statPressable, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export default function StoryDetailScreen({
  story,
  onBack,
  onRead,
  onAuthor,
}: {
  story: Story;
  onBack: () => void;
  /** Opens the reader at the given chapter index. */
  onRead: (chapterIndex: number) => void;
  onAuthor: (authorId: string) => void;
}) {
  const author = authorFor(story.authorId);
  const hasMultipleChapters = story.chapters.length > 1;

  // Local, optimistic engagement state - there is no backend mutation wired
  // yet, so a tap toggles a locally-held count exactly as ReaderScreen in
  // App.tsx already does for the same fields. When persistence lands this
  // becomes a thin wrapper around the real mutation instead of a rewrite.
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(false);
  const [saveCount, setSaveCount] = useState(story.bookmarks);
  const [isFollowing, setIsFollowing] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  const handleLike = useCallback(() => {
    setIsLiked((prev) => {
      setLikeCount((count) => (prev ? count - 1 : count + 1));
      return !prev;
    });
  }, []);

  const handleSave = useCallback(() => {
    setIsSaved((prev) => {
      setSaveCount((count) => (prev ? count - 1 : count + 1));
      return !prev;
    });
  }, []);

  const handleFollow = useCallback(() => {
    setIsFollowing((prev) => !prev);
  }, []);

  // Mirrors ReaderScreen's handleShare in App.tsx: native Share sheet off the
  // platform, clipboard + a brief toast on web where there is no share sheet.
  const handleShare = useCallback(async () => {
    const text = `${story.title} by ${author.displayName}\n\nRead on Katha AI`;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(text);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      } catch {
        // Clipboard access can be denied by the browser; nothing further to
        // do, the toast just never appears.
      }
    } else {
      try {
        await Share.share({ message: text });
      } catch {
        // User dismissed the native share sheet.
      }
    }
  }, [story.title, author.displayName]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const handleOverflowPress = useCallback(() => setActionsOpen(true), []);
  /**
   * Blocking persists, then leaves the story.
   *
   * The feed applies the block on its next fetch; see the `user_blocks` filter
   * in `backend/supabase/functions/feed/index.ts`.
   */
  const handleBlockAuthor = useCallback(async () => {
    if (isSupabaseConfigured) {
      try {
        await blockAuthor(story.authorId);
      } catch {
        return false;
      }
    }
    setActionsOpen(false);
    onBack();
    return true;
  }, [onBack, story.authorId]);

  const handleReportStory = useCallback((reason: ReportReason) => {
    if (isSupabaseConfigured) {
      reportContent({ storyId: story.id }, reason).catch(() => {});
    }
  }, [story.id]);

  const coverImage = story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const focalX = story.focalX ?? 0.5;
  // The documented hero rule (see ReaderScreen in App.tsx): the raw focal
  // point is tuned for a shorter frame, so a 3:4 crop needs the point nudged
  // up 2% or a face placed near the top of the source art rides slightly too
  // low once the hero has this much more vertical room to show.
  const heroFocalY = Math.max(0, (story.focalY ?? 0.5) - 0.02);

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/*
          THE COVER ART IS 3:4 PORTRAIT (seed covers 360x480, generated ones
          1024x1536 - see backend/COVER_IMAGES.md). A 3:4 hero shows the whole
          frame with no crop, unlike the square `Cover` thumbnail used in the
          feed, which deliberately trades edges for a uniform grid cell.
        */}
        <View style={styles.hero}>
          {coverImage
            ? (
              <FocalImage
                source={coverImage}
                focalX={focalX}
                focalY={heroFocalY}
                style={{ width: "100%", height: "100%" }}
              />
            )
            : (
              <LinearGradient
                colors={genreGradients[story.genre]}
                style={StyleSheet.absoluteFill}
              />
            )}

          <LinearGradient
            colors={[
              "transparent",
              hexToRgba(colors.ink, 0.45),
              hexToRgba(colors.ink, 0.88),
            ]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={styles.heroTitleBlock} pointerEvents="none">
            <Text style={styles.heroGenre}>
              {genreLabels[story.genre].toUpperCase()}
            </Text>
            {/*
              `colors.surface` (pure white) doubles as "ink on a dark ground"
              here - the same reuse `HomeScreen`'s write-CTA card makes for
              title text on `colors.ink`. There is no separate "on-dark" text
              token in the system yet, so the white surface colour is the
              correct token to reach for rather than a one-off hex.
            */}
            <Text style={styles.heroTitle}>{story.title}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            style={({ pressed }) => [
              styles.iconButton,
              styles.heroBackButton,
              pressed && styles.iconButtonPressed,
            ]}
          >
            <ArrowLeft size={20} color={colors.strong} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            onPress={handleOverflowPress}
            style={({ pressed }) => [
              styles.iconButton,
              styles.heroOverflowButton,
              pressed && styles.iconButtonPressed,
            ]}
          >
            <Ellipsis size={20} color={colors.strong} />
          </Pressable>
        </View>

        <View style={styles.content}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasMultipleChapters ? "Continue reading" : "Start reading"}
            onPress={() => onRead(0)}
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <Text style={styles.ctaText}>
              {hasMultipleChapters ? "Continue reading" : "Start reading"}
            </Text>
          </Pressable>

          <View style={styles.statsGroup}>
            <View style={styles.statRow}>
              <Stat Icon={BookOpen} value={story.views} label="reads" />
              <Stat
                Icon={Heart}
                value={likeCount}
                label="likes"
                active={isLiked}
                onPress={handleLike}
              />
              <Stat
                Icon={isSaved ? BookmarkCheck : Bookmark}
                value={saveCount}
                label="saves"
                active={isSaved}
                onPress={handleSave}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share story"
              onPress={handleShare}
              style={({ pressed }) => [styles.shareRow, pressed && styles.pressed]}
            >
              <Share2 size={18} color={colors.strong} />
              <Text style={styles.shareText}>Share</Text>
            </Pressable>
            {shareToast && (
              <View style={styles.shareToast}>
                <Text style={styles.shareToastText}>Copied to clipboard</Text>
              </View>
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.authorGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${author.displayName}'s profile`}
              onPress={() => onAuthor(story.authorId)}
              style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}
            >
              <View style={styles.authorAvatar}>
                <Text style={styles.authorAvatarInitial}>
                  {author.displayName.charAt(0)}
                </Text>
              </View>
              <View style={styles.authorInfo}>
                <Text style={styles.authorName}>{author.displayName}</Text>
                <Text style={styles.authorHandle}>@{author.username}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFollowing ? "Unfollow" : "Follow"}
                onPress={handleFollow}
                style={[styles.followButton, isFollowing && styles.followButtonActive]}
              >
                <Text
                  style={[
                    styles.followButtonText,
                    isFollowing && styles.followButtonTextActive,
                  ]}
                >
                  {isFollowing ? "Following" : "Follow"}
                </Text>
              </Pressable>
            </Pressable>
            <Text style={styles.synopsis}>{story.synopsis}</Text>
          </View>

          {hasMultipleChapters && (
            <>
              <View style={styles.divider} />
              <View style={styles.chapterGroup}>
                <Text style={styles.sectionEyebrow}>CHAPTERS</Text>
                {story.chapters.map((chapter, index) => (
                  <Pressable
                    key={chapter.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Read chapter ${chapter.chapterNumber}: ${chapter.title}`}
                    onPress={() => onRead(index)}
                    style={({ pressed }) => [
                      styles.chapterRow,
                      index > 0 && styles.chapterRowDivider,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.chapterNumberBadge}>
                      <Text style={styles.chapterNumberText}>
                        {chapter.chapterNumber}
                      </Text>
                    </View>
                    <Text style={styles.chapterRowTitle} numberOfLines={1}>
                      {chapter.title}
                    </Text>
                    <ChevronRight size={18} color={colors.strong} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.divider} />

          <View style={styles.metaGroup}>
            <Text style={styles.sectionEyebrow}>ABOUT THIS STORY</Text>
            <MetaRow label="Genre" value={genreLabels[story.genre]} />
            {story.tags.length > 0 && (
              <MetaRow label="Tags" value={story.tags.join(", ")} />
            )}
            <MetaRow label="Language" value={story.language} />
            {story.contentRating && (
              <MetaRow label="Content rating" value={story.contentRating} />
            )}
            <MetaRow label="Chapters" value={String(story.chapters.length)} />
          </View>

          {/*
            COMMENT THREAD MOUNT POINT. Comments are owned by another agent
            (see src/components/comments/**) and are rendered here.
          */}
          <View style={styles.commentsAnchor}>
            <CommentThread
              storyId={story.id}
              authorName={author.displayName}
            />
          </View>
        </View>
      </ScrollView>

      <StoryActionsSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        storyTitle={story.title}
        authorName={author.displayName}
        onBlockAuthor={handleBlockAuthor}
        onSubmitReport={handleReportStory}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
  },

  /* ── Hero ── */
  hero: {
    width: "100%",
    aspectRatio: 3 / 4,
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.surface2,
  },
  heroTitleBlock: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    gap: spacing.related,
  },
  heroGenre: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: colors.tertiary,
  },
  heroTitle: {
    ...type.largeTitle,
    color: colors.surface,
  },
  iconButton: {
    position: "absolute",
    width: controls.iconButton,
    height: controls.iconButton,
    borderRadius: controls.iconButton / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.iconButton,
  },
  iconButtonPressed: {
    boxShadow: shadows.iconButtonPressed,
  },
  heroBackButton: {
    top: spacing.xl,
    left: spacing.xl,
  },
  heroOverflowButton: {
    top: spacing.xl,
    right: spacing.xl,
  },

  /* ── Content ── */
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.huge,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },

  /* Primary CTA. `radius.pill` + `shadows.raised` is the documented recipe
     for "the create CTA" - see the doc comment on `shadows.raised`. */
  cta: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.raised,
  },
  ctaText: {
    ...type.headline,
    fontFamily: fonts.ui,
    fontWeight: "700",
    color: colors.surface,
  },

  /* Stats + share */
  statsGroup: {
    marginTop: spacing.betweenGroups,
    gap: spacing.related,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statPressable: {
    borderRadius: radius.md,
  },
  stat: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  statValue: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
  },
  statLabel: {
    ...type.caption,
    color: colors.muted,
  },
  shareRow: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  shareText: {
    ...type.subhead,
    fontWeight: "600",
    color: colors.strong,
  },
  shareToast: {
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  shareToastText: {
    ...type.caption,
    fontWeight: "600",
    color: colors.surface,
  },

  /* Dividers separate groups; never a border on an elevated surface. */
  divider: {
    height: 1,
    backgroundColor: colors.track,
    marginVertical: spacing.betweenGroups,
  },

  /* Author card */
  authorGroup: {
    gap: spacing.related,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  authorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarInitial: {
    ...type.headline,
    fontFamily: fonts.display,
    color: colors.ink,
  },
  authorInfo: {
    flex: 1,
    gap: 2,
  },
  authorName: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
  },
  authorHandle: {
    ...type.caption,
    color: colors.muted,
  },
  followButton: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  followButtonText: {
    ...type.caption,
    fontWeight: "700",
    color: colors.surface,
  },
  followButtonTextActive: {
    color: colors.accent,
  },
  synopsis: {
    ...type.body,
    color: colors.muted,
  },

  /* Chapter list */
  chapterGroup: {
    gap: 0,
  },
  sectionEyebrow: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  chapterRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.track,
  },
  chapterNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterNumberText: {
    ...type.caption,
    fontWeight: "700",
    color: colors.ink,
  },
  chapterRowTitle: {
    ...type.body,
    flex: 1,
    color: colors.ink,
  },

  /* Metadata */
  metaGroup: {
    gap: spacing.related,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  metaLabel: {
    ...type.subhead,
    color: colors.muted,
  },
  metaValue: {
    ...type.subhead,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },

  /* Comment thread mount point - intentionally empty, see the comment above. */
  commentsAnchor: {
    marginTop: spacing.betweenGroups,
  },
});
