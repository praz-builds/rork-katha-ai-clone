import { useCallback, useRef, useState } from "react";
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
  Headphones,
  Share2,
  Star,
} from "lucide-react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { authorFor } from "@/data/seed";
import CommentThread from "@/components/comments/CommentThread";
import type { ReportReason } from "@/components/comments/types";
import { blockAuthor, reportContent } from "@/lib/comments";
import {
  setAuthorFollow,
  setStoryBookmark,
  setStoryLike,
} from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import StoryActionsSheet from "@/components/moderation/StoryActionsSheet";
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
} from "@/theme";
import type { Story } from "@/types/domain";

type ReadMode = "read" | "listen";
type ReadOptions = { mode?: ReadMode };

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

function storyPublishedDate(story: Story): string {
  const date = new Date();
  date.setDate(date.getDate() - story.publishedOffset);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function chapterWordCount(story: Story): number {
  return story.chapters.reduce((total, chapter) =>
    total + chapter.paragraphs.join(" ").trim().split(/\s+/).filter(Boolean)
      .length, 0);
}

function storyFormatLabel(story: Story): string {
  if (story.storyMode === "series" || (story.plannedChapterCount ?? 0) > 1) {
    return "Series";
  }
  const words = chapterWordCount(story);
  if (words >= 17500) return "Novel";
  if (words >= 7500) return "Novella";
  return "Short story";
}

function storyMetaLine(story: Story): string {
  const parts = [storyPublishedDate(story), storyFormatLabel(story)];
  const planned = story.plannedChapterCount;
  if (planned && planned > 1 && story.chapters.length > 1) {
    parts[1] = `${parts[1]} (${story.chapters.length}/${planned})`;
  }
  return parts.join(" · ");
}

function storyHook(story: Story): string {
  const firstLine = story.chapters[0]?.firstLine?.trim();
  if (firstLine) return firstLine;
  return story.chapters[0]?.paragraphs.join(" ").replace(/\s+/g, " ").trim() ??
    "";
}

function hasNarration(story: Story): boolean {
  return story.chapters.some((chapter) =>
    Boolean(chapter.audioUrl || chapter.audioUrls?.female || chapter.audioUrls?.male)
  );
}

function badgeLabels(story: Story): string[] {
  return [
    story.contentRating?.trim(),
    story.audienceMode === "kids" ? "Kids" : undefined,
  ].filter((label): label is string => Boolean(label));
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
  onRead: (chapterIndex: number, options?: ReadOptions) => void;
  onAuthor: (authorId: string) => void;
}) {
  const author = authorFor(story.authorId);
  const hasMultipleChapters = story.chapters.length > 1;
  const narrationReady = hasNarration(story);
  const badges = badgeLabels(story);
  const [listenNotice, setListenNotice] = useState(false);

  // Seeded from the viewer's own state, not from `false`.
  //
  // Starting every control at `false` meant a reader who had already liked a
  // story saw an unfilled heart, and their next tap sent `on: true` for a like
  // that already existed -- removing nothing, adding nothing, and leaving the
  // UI disagreeing with the server. Absent means not engaged, which is the safe
  // reading while the endpoints supplying these are still rolling out.
  const [isLiked, setIsLiked] = useState(story.viewerHasLiked ?? false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(story.viewerHasBookmarked ?? false);
  const [saveCount, setSaveCount] = useState(story.bookmarks);
  const [isFollowing, setIsFollowing] = useState(
    story.viewerFollowsAuthor ?? false,
  );
  const [shareToast, setShareToast] = useState(false);
  const likeInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const followInFlight = useRef(false);

  const handleLike = useCallback(() => {
    if (likeInFlight.current) return;
    likeInFlight.current = true;
    const previousOn = isLiked;
    const previousCount = likeCount;
    const nextOn = !previousOn;
    const nextCount = Math.max(0, previousCount + (nextOn ? 1 : -1));
    setIsLiked(nextOn);
    setLikeCount(nextCount);
    const rollback = () => {
      setIsLiked(previousOn);
      setLikeCount(previousCount);
    };
    try {
      setStoryLike(story.id, nextOn, nextCount).then((result) => {
        setIsLiked(result.on);
        setLikeCount(result.count);
      }).catch(rollback).finally(() => {
        likeInFlight.current = false;
      });
    } catch {
      rollback();
      likeInFlight.current = false;
    }
  }, [isLiked, likeCount, story.id]);

  const handleSave = useCallback(() => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    const previousOn = isSaved;
    const previousCount = saveCount;
    const nextOn = !previousOn;
    const nextCount = Math.max(0, previousCount + (nextOn ? 1 : -1));
    setIsSaved(nextOn);
    setSaveCount(nextCount);
    const rollback = () => {
      setIsSaved(previousOn);
      setSaveCount(previousCount);
    };
    try {
      setStoryBookmark(story.id, nextOn, nextCount).then((result) => {
        setIsSaved(result.on);
        setSaveCount(result.count);
      }).catch(rollback).finally(() => {
        saveInFlight.current = false;
      });
    } catch {
      rollback();
      saveInFlight.current = false;
    }
  }, [isSaved, saveCount, story.id]);

  const handleFollow = useCallback(() => {
    if (followInFlight.current) return;
    followInFlight.current = true;
    const previousOn = isFollowing;
    const nextOn = !previousOn;
    setIsFollowing(nextOn);
    const rollback = () => setIsFollowing(previousOn);
    try {
      setAuthorFollow(
        story.authorId,
        nextOn,
        Math.max(0, author.followers + (nextOn ? 1 : -1)),
      ).then((result) => {
        setIsFollowing(result.on);
      }).catch(rollback).finally(() => {
        followInFlight.current = false;
      });
    } catch {
      rollback();
      followInFlight.current = false;
    }
  }, [author.followers, isFollowing, story.authorId]);

  const handleRead = useCallback(() => {
    onRead(0, { mode: "read" });
  }, [onRead]);

  const handleListen = useCallback(() => {
    if (!narrationReady) {
      setListenNotice(true);
      return;
    }
    onRead(0, { mode: "listen" });
  }, [narrationReady, onRead]);

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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close story"
            onPress={onBack}
            style={({ pressed }) => [
              styles.iconButton,
              styles.heroBackButton,
              pressed && styles.iconButtonPressed,
            ]}
          >
            <ArrowLeft size={20} color={colors.strong} />
          </Pressable>
          <View style={styles.heroActionCluster}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isSaved ? "Remove saved story" : "Save story"}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
            >
              <Star
                size={20}
                color={isSaved ? colors.accent : colors.strong}
                fill={isSaved ? colors.accent : "none"}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share story"
              onPress={handleShare}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
            >
              <Share2 size={20} color={colors.strong} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More options"
              onPress={handleOverflowPress}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
            >
              <Ellipsis size={20} color={colors.strong} />
            </Pressable>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.storyIntro}>
            <Text style={styles.detailTitle} numberOfLines={3}>
              {story.title}
            </Text>
            <Text style={styles.metaLine}>{storyMetaLine(story)}</Text>
            {story.tags.length > 0 && (
              <Text style={styles.themeLine} numberOfLines={1}>
                {story.tags.join(", ")}
              </Text>
            )}
            {badges.length > 0 && (
              <View style={styles.badgeRow}>
                {badges.map((badge) => (
                  <View key={badge} style={styles.badgeChip}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!storyHook(story) && (
              <Text style={styles.hookText} numberOfLines={3}>
                {storyHook(story)}
              </Text>
            )}
          </View>

          <View style={styles.primaryActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Read story"
              onPress={handleRead}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <BookOpen size={19} color={colors.surface} />
              <Text style={styles.ctaText}>Read</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Listen to story"
              onPress={handleListen}
              style={({ pressed }) => [
                styles.cta,
                styles.listenCta,
                pressed && styles.pressed,
              ]}
            >
              <Headphones size={19} color={colors.accent} />
              <Text style={[styles.ctaText, styles.listenCtaText]}>Listen</Text>
            </Pressable>
          </View>
          {listenNotice && (
            <Text
              accessibilityRole="text"
              style={styles.listenNotice}
            >
              Narration is not ready for this story yet.
            </Text>
          )}

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
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.iconButton,
  },
  iconButtonPressed: {
    boxShadow: shadows.iconButtonPressed,
  },
  heroBackButton: {
    position: "absolute",
    top: spacing.xl,
    left: spacing.xl,
  },
  heroActionCluster: {
    position: "absolute",
    top: spacing.xl,
    right: spacing.xl,
    flexDirection: "row",
    gap: spacing.sm,
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

  storyIntro: {
    gap: spacing.related,
  },
  detailTitle: {
    ...type.largeTitle,
    fontFamily: fonts.display,
    letterSpacing: 0,
    color: colors.ink,
  },
  metaLine: {
    ...type.subhead,
    fontFamily: fonts.ui,
    letterSpacing: 0,
    color: colors.muted,
  },
  themeLine: {
    ...type.subhead,
    fontFamily: fonts.ui,
    letterSpacing: 0,
    color: colors.strong,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  badgeChip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...type.caption,
    fontFamily: fonts.ui,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.accent,
  },
  hookText: {
    ...type.body,
    fontFamily: fonts.readerItalic,
    letterSpacing: 0,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  primaryActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.betweenGroups,
  },

  /* Primary CTA. `radius.pill` + `shadows.raised` is the documented recipe
     for "the create CTA" - see the doc comment on `shadows.raised`. */
  cta: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    boxShadow: shadows.raised,
  },
  listenCta: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    boxShadow: shadows.card,
  },
  ctaText: {
    ...type.headline,
    fontFamily: fonts.ui,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.surface,
  },
  listenCtaText: {
    color: colors.accent,
  },
  listenNotice: {
    ...type.subhead,
    fontFamily: fonts.ui,
    letterSpacing: 0,
    color: colors.muted,
    marginTop: spacing.related,
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
