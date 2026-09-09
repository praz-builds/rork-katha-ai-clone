import { useCallback, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronRight,
  Ellipsis,
  Globe,
  Heart,
  Headphones,
  Share2,
  Star,
  X,
} from "lucide-react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { authorFor } from "@/data/seed";
import CommentThread from "@/components/comments/CommentThread";
import type { ReportReason } from "@/components/comments/types";
import { blockAuthor, reportContent } from "@/lib/comments";
import { downloadStoryPdf } from "@/lib/story-pdf";
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
  spacing,
  type,
} from "@/theme";
import type { Genre, Story } from "@/types/domain";

type ReadMode = "read" | "listen";
type ReadOptions = { mode?: ReadMode };

/**
 * THE ONE DARK PAGE IN THE APP.
 *
 * Every other screen sits on `colors.bg`; this one sits on `colors.chromeSurface`
 * so the cover can dissolve into the ground with no edge. A light page would
 * need a card, a radius or a border under the art to stop it looking pasted
 * on, and every one of those is a line between the picture and the story it
 * belongs to. Dark ground, gradient to 100% of the same colour, no line.
 *
 * `chrome` is the palette the reader's controls already use, promoted to the
 * theme so this page and `ReaderChrome` share one set of values.
 */
const chrome = {
  surface: colors.chromeSurface,
  raised: colors.chromeSurfaceRaised,
  border: colors.chromeBorder,
  text: colors.chromeText,
  muted: colors.chromeMuted,
  track: colors.chromeTrack,
  star: colors.chromeStar,
} as const;

/** How much of the window the hero takes. The picture, not a thumbnail of it. */
const HERO_HEIGHT_FRACTION = 0.62;
/** The bottom part of the hero the dissolve covers. */
const HERO_FADE_FRACTION = 0.45;
/** Opacity of the discs behind the floating controls, so they read on any cover. */
const CONTROL_DISC_ALPHA = 0.55;
/** The comments sheet's height as a share of the window. */
const COMMENTS_SHEET_FRACTION = 0.8;

/**
 * Builds an rgba() string FROM a hex token instead of writing a literal one.
 *
 * The dissolve is an alpha ramp from nothing to the ground, and the control
 * discs are the ground at partial opacity; both are derived from
 * `colors.chromeSurface` at call time so the page cannot drift from the token.
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
  const glyphColor = active ? colors.heart : chrome.text;
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

export function storyPublishedDate(story: Story): string {
  const date = new Date();
  date.setDate(date.getDate() - story.publishedOffset);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * The last item of the meta line: what kind of thing this is and how far
 * along it is.
 *
 * `Standalone` for a one-shot. A series says `{written}/{planned} chapters`
 * when the plan is known, and just `{n} chapters` when it is not - a series
 * whose plan the list query did not select is still a series, and inventing
 * a denominator would be worse than omitting it.
 */
export function storyProgressLabel(story: Story): string {
  const isSeries = story.storyMode === "series" ||
    (story.plannedChapterCount ?? 0) > 1 ||
    story.chapters.length > 1;
  if (!isSeries) return "Standalone";
  const written = story.chapters.length;
  const planned = story.plannedChapterCount;
  if (planned && planned > 1) return `${written}/${planned} chapters`;
  return `${written} ${written === 1 ? "chapter" : "chapters"}`;
}

function storyHook(story: Story): string {
  const firstLine = story.chapters[0]?.firstLine?.trim();
  if (firstLine) return firstLine;
  return story.chapters[0]?.paragraphs.join(" ").replace(/\s+/g, " ").trim() ??
    "";
}

/**
 * Does this story have narration a reader can actually hear right now?
 *
 * This was briefly widened to treat any PUBLISHED chapter as listenable, on the
 * reasoning that narration generates on first play. That was wrong in practice:
 * generation sits behind `canGenerateNarration`, which defaults CLOSED, and the
 * reader has no path that triggers it -- so Listen opened a playback flow that
 * could only ever show an alert. Promising something the product cannot deliver
 * is worse than saying no.
 *
 * So the check is what it was: audio that exists. When it does not, Listen says
 * so plainly rather than opening a dead end. It widens again the day generation
 * is enabled AND the reader can trigger it, and not before.
 */
function hasNarration(story: Story): boolean {
  return story.chapters.some((chapter) =>
    Boolean(chapter.audioUrl || chapter.audioUrls?.female || chapter.audioUrls?.male)
  );
}

/**
 * The chips under the meta line: the primary genre first, then the shelf
 * tags, then the two audience flags when they apply. One row, one style, so
 * the reader scans "what is this" left to right without decoding two kinds
 * of pill.
 */
function chipLabels(story: Story): string[] {
  const primary: Genre = story.primaryGenre ?? story.genre;
  const seen = new Set<string>();
  const labels: string[] = [];
  const push = (label: string | undefined) => {
    const trimmed = label?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(trimmed);
  };
  push(genreLabels[primary]);
  story.tags.forEach((tag) => push(tag));
  push(story.contentRating);
  if (story.audienceMode === "kids") push("Kids");
  return labels;
}

/**
 * Is this story shelved as Educational?
 *
 * `primaryGenre` is the authoritative single genre and is what the picker
 * sets; `genre` is the legacy array a seeded or older row may carry instead.
 * Checking only one of them would miss whichever kind of row the reader
 * happened to open, and a disclosure that appears on some educational stories
 * and not others is worse than none -- its absence would read as a statement.
 */
function isEducational(story: { primaryGenre?: string; genre?: string }): boolean {
  return story.primaryGenre === "educational" || story.genre === "educational";
}

export default function StoryDetailScreen({
  story,
  onBack,
  onRead,
  onAuthor,
  onListen,
  isOwn = false,
}: {
  story: Story;
  onBack: () => void;
  /** Opens the reader at the given chapter index. */
  onRead: (chapterIndex: number, options?: ReadOptions) => void;
  onAuthor: (authorId: string) => void;
  /**
   * Opens the full-screen narration player at chapter 1.
   *
   * Supplied and Listen hands off to `ListenScreen`, which owns the wait while
   * narration is generated for a story that has none. Omitted and Listen keeps
   * its old behaviour: open the reader when audio already exists, and say so
   * plainly when it does not.
   */
  onListen?: () => void;
  /**
   * The viewer wrote this story. Their own page does not offer "Block
   * author", and it is the only page allowed to say "Public" - a reader of
   * someone else's story is, by definition, already looking at a public one.
   */
  isOwn?: boolean;
}) {
  const author = authorFor(story.authorId);
  const { height: windowHeight } = useWindowDimensions();
  const hasMultipleChapters = story.chapters.length > 1;
  const narrationReady = hasNarration(story);
  const chips = chipLabels(story);
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
  const [pdfToast, setPdfToast] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
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
    // The narration player owns the wait, so Listen no longer has to check
    // whether audio already exists: a story with none opens on the preparing
    // screen and generation starts there. The old `narrationReady` refusal is
    // kept only as the fallback for a host that has not wired `onListen`.
    if (onListen) {
      onListen();
      return;
    }
    if (!narrationReady) {
      setListenNotice(true);
      return;
    }
    onRead(0, { mode: "listen" });
  }, [narrationReady, onListen, onRead]);

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

  /**
   * The PDF is handed to the platform's own dialog; the only outcome this
   * screen reports is the one it can know - that the dialog could not open.
   * A dismissed dialog is not a failure and says nothing.
   */
  const handleDownloadPdf = useCallback(() => {
    downloadStoryPdf({
      story,
      authorName: author.displayName,
      dateLabel: storyPublishedDate(story),
    }).catch(() => {
      setPdfToast("Couldn't prepare the PDF on this device.");
      setTimeout(() => setPdfToast(null), 2500);
    });
  }, [author.displayName, story]);

  const openComments = useCallback(() => setCommentsOpen(true), []);
  const closeComments = useCallback(() => setCommentsOpen(false), []);

  // The generated cover first, the bundled seed asset second. See the note in
  // ReaderScreen: reading only `coverImage` meant a story the user generated
  // showed its art in the studio and lost it everywhere else.
  const coverImage = story.coverImageUrl
    ? { uri: story.coverImageUrl }
    : story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const focalX = story.focalX ?? 0.5;
  // The documented hero rule (see ReaderScreen in App.tsx): the raw focal
  // point is tuned for a shorter frame, so a tall crop needs the point nudged
  // up 2% or a face placed near the top of the source art rides slightly too
  // low once the hero has this much more vertical room to show.
  const heroFocalY = Math.max(0, (story.focalY ?? 0.5) - 0.02);
  const heroHeight = Math.round(windowHeight * HERO_HEIGHT_FRACTION);
  const showsPublic = isOwn && story.isPublic === true;
  const commentsLabel = commentCount === null
    ? "Comments"
    : `${formatNumber(commentCount)} ${commentCount === 1 ? "comment" : "comments"}`;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/*
          THE HERO IS THE PICTURE, NOT A CARD OF IT. Full width, most of the
          window, and the bottom of it dissolves into the page ground at 100%
          of the same colour - no border, no radius, no edge for the eye to
          catch. The genre gradient stands in while the cover is still being
          painted or was never made, and stands in silently: no spinner and no
          copy over it, because a reader deciding whether to open a story does
          not need a progress report on its artwork.
        */}
        <View style={[styles.hero, { height: heroHeight }]}>
          {/*
            The gradient is always under the art, not only instead of it. A
            cover that is still downloading would otherwise leave the bare
            dark ground for a beat, and a hero-sized rectangle of nothing at
            the top of the page reads as a broken screen rather than as a
            picture on its way.
          */}
          <LinearGradient
            colors={genreGradients[story.genre]}
            style={StyleSheet.absoluteFill}
          />
          {coverImage
            ? (
              <FocalImage
                source={coverImage}
                focalX={focalX}
                focalY={heroFocalY}
                style={{ width: "100%", height: "100%" }}
              />
            )
            : null}

          <LinearGradient
            colors={[hexToRgba(chrome.surface, 0), chrome.surface]}
            locations={[0, 1]}
            style={[styles.heroFade, { height: Math.round(heroHeight * HERO_FADE_FRACTION) }]}
            pointerEvents="none"
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close story"
            onPress={onBack}
            style={({ pressed }) => [
              styles.controlDisc,
              styles.heroCloseButton,
              pressed && styles.controlDiscPressed,
            ]}
          >
            <X size={20} color={chrome.text} />
          </Pressable>
          <View style={styles.heroActionCluster}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isSaved ? "Remove saved story" : "Save story"}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.controlDisc,
                pressed && styles.controlDiscPressed,
              ]}
            >
              <Star
                size={20}
                color={isSaved ? chrome.star : chrome.text}
                fill={isSaved ? chrome.star : "none"}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share story"
              onPress={handleShare}
              style={({ pressed }) => [
                styles.controlDisc,
                pressed && styles.controlDiscPressed,
              ]}
            >
              <Share2 size={20} color={chrome.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More options"
              onPress={handleOverflowPress}
              style={({ pressed }) => [
                styles.controlDisc,
                pressed && styles.controlDiscPressed,
              ]}
            >
              <Ellipsis size={20} color={chrome.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.storyIntro}>
            <Text style={styles.detailTitle} numberOfLines={3}>
              {story.title}
            </Text>

            {/*
              One wrapping line, not a table. The pieces a reader uses to
              place a story - who, when, how loved, how long - read as a
              sentence, and the two that go somewhere are underlined so
              they read as links inside it rather than as buttons beside it.
            */}
            <Text style={styles.metaLine} accessibilityRole="text">
              <Text
                style={styles.metaLink}
                accessibilityRole="link"
                accessibilityLabel={`View ${author.displayName}'s profile`}
                onPress={() => onAuthor(story.authorId)}
              >
                @{author.username}
              </Text>
              {" · "}
              {storyPublishedDate(story)}
              {" · "}
              {/*
                One string, not a number and a noun side by side. Split across
                two children it renders as two text nodes with a space between
                them, which a screen reader may pause inside and which no
                assertion about the sentence can match.
              */}
              {`${formatNumber(likeCount)} ${likeCount === 1 ? "like" : "likes"}`}
              {" · "}
              <Text
                style={styles.metaLink}
                accessibilityRole="link"
                accessibilityLabel="Open comments"
                onPress={openComments}
              >
                {commentsLabel}
              </Text>
              {" · "}
              {storyProgressLabel(story)}
              {showsPublic ? " · Public" : ""}
            </Text>

            <View style={styles.chipRow}>
              {chips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
              {showsPublic && (
                <View style={[styles.chip, styles.publicChip]} accessibilityLabel="Public story">
                  <Globe size={14} color={chrome.text} />
                  <Text style={styles.chipText}>Public</Text>
                </View>
              )}
            </View>

            {!!storyHook(story) && (
              <Text style={styles.summary}>
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
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <Headphones size={19} color={colors.surface} />
              <Text style={styles.ctaText}>Listen</Text>
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
          {pdfToast && (
            <Text accessibilityRole="text" style={styles.listenNotice}>
              {pdfToast}
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
            {shareToast && (
              <View style={styles.toast}>
                <Text style={styles.toastText}>Copied to clipboard</Text>
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
              {!isOwn && (
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
              )}
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
                    <ChevronRight size={18} color={chrome.muted} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.divider} />

          <View style={styles.metaGroup}>
            <Text style={styles.sectionEyebrow}>ABOUT THIS STORY</Text>
            <MetaRow label="Genre" value={genreLabels[story.primaryGenre ?? story.genre]} />
            {story.tags.length > 0 && (
              <MetaRow label="Tags" value={story.tags.join(", ")} />
            )}
            <MetaRow label="Language" value={story.language} />
            {story.contentRating && (
              <MetaRow label="Content rating" value={story.contentRating} />
            )}
            <MetaRow label="Chapters" value={String(story.chapters.length)} />
            {isEducational(story) && (
              /*
                An Educational story is fiction, and says so.

                The genre's prompt module works hard at accuracy -- it tells the
                model to state a mechanism only when it is certain and to choose
                the plainer true version over the impressive specific one -- but
                that is guidance to a generator, not a fact check, and nothing
                in the pipeline verifies a single claim. A confident wrong date
                or mechanism reaches a reader through the ordinary publication
                path looking exactly like a correct one.

                Prompt guidance cannot close that gap; only a reader who knows
                what they are holding can. So the one thing the product can
                honestly promise -- that this was written by a model and is not
                checked -- is stated where the reader decides whether to read
                it, rather than left for them to assume.
              */
              <Text style={styles.educationalNote} accessibilityRole="text">
                This story is fiction written by AI. Facts in it are not
                verified — check anything you plan to rely on.
              </Text>
            )}
          </View>

          <View style={styles.divider} />

          {/*
            The inline preview. The full thread lives in the sheet (below);
            this instance is what keeps the count on the meta line honest and
            gives a reader who scrolled this far a place to comment without a
            second tap.
          */}
          <View style={styles.commentsAnchor}>
            <CommentThread
              storyId={story.id}
              authorName={author.displayName}
              tone="dark"
              onCountChange={setCommentCount}
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
        onDownloadPdf={handleDownloadPdf}
        canBlockAuthor={!isOwn}
      />

      <CommentsSheet
        visible={commentsOpen}
        onClose={closeComments}
        count={commentCount}
        windowHeight={windowHeight}
      >
        {/*
          Mounted only while the sheet is open. A `Modal` keeps its children
          mounted whether or not it is visible, so rendering the thread
          unconditionally meant every story page fetched the same comments
          twice - once for the preview the reader can see, once for a sheet
          they had not opened.
        */}
        {commentsOpen && (
          <CommentThread
            storyId={story.id}
            authorName={author.displayName}
            tone="dark"
            composerPosition="bottom"
            onCountChange={setCommentCount}
          />
        )}
      </CommentsSheet>
    </View>
  );
}

/**
 * The comments sheet: the thread on a raised dark surface over the page.
 *
 * A `Modal` rather than an in-page panel so it sits above the hero and the
 * status bar and dismisses with the hardware back. The header carries the
 * count the meta line already showed, so opening the sheet confirms the tap
 * rather than restating it in a new shape.
 */
function CommentsSheet({
  visible,
  onClose,
  count,
  windowHeight,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  count: number | null;
  windowHeight: number;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss comments"
        />
        <View
          style={[styles.sheet, { height: Math.round(windowHeight * COMMENTS_SHEET_FRACTION) }]}
          accessibilityViewIsModal
        >
          <View style={styles.sheetHandle} />
          {/*
            The header carries the way out.

            The backdrop closes the sheet too, but it is not an affordance a
            reader can see, and it is outside the modal's accessibility scope
            once `accessibilityViewIsModal` walls the sheet off - so a screen
            reader, and a web viewer with no hardware back button, would have
            had no reachable close at all. The X is the one that is always
            there; the backdrop and the hardware back stay as shortcuts.
          */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {count === null ? "Comments" : `Comments (${formatNumber(count)})`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close comments"
              onPress={onClose}
              style={({ pressed }) => [
                styles.sheetClose,
                pressed && styles.pressed,
              ]}
            >
              <X size={20} color={chrome.muted} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: chrome.surface,
  },
  scrollContent: {
    flexGrow: 1,
  },

  /* ── Hero ── */
  hero: {
    width: "100%",
    overflow: "hidden",
    position: "relative",
    backgroundColor: chrome.surface,
  },
  heroFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  controlDisc: {
    width: 40,
    height: 40,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: hexToRgba(chrome.surface, CONTROL_DISC_ALPHA),
    alignItems: "center",
    justifyContent: "center",
  },
  controlDiscPressed: {
    backgroundColor: hexToRgba(chrome.surface, 0.8),
  },
  heroCloseButton: {
    position: "absolute",
    top: spacing.huge,
    left: spacing.lg,
  },
  heroActionCluster: {
    position: "absolute",
    top: spacing.huge,
    right: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },

  /* ── Content ── */
  content: {
    paddingHorizontal: spacing.xl,
    // Pulled up into the dissolve so the title starts over the last of the
    // picture rather than under a band of empty ground.
    marginTop: -spacing.xxl,
    paddingBottom: spacing.huge,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },

  storyIntro: {
    gap: spacing.md,
  },
  detailTitle: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: 0,
    color: chrome.text,
  },
  metaLine: {
    ...type.subhead,
    lineHeight: 22,
    letterSpacing: 0,
    color: chrome.muted,
  },
  metaLink: {
    color: chrome.text,
    textDecorationLine: "underline",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: chrome.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  publicChip: {
    borderColor: chrome.muted,
  },
  chipText: {
    ...type.subhead,
    letterSpacing: 0,
    color: chrome.text,
  },
  summary: {
    ...type.body,
    lineHeight: 24,
    letterSpacing: 0,
    color: chrome.text,
  },
  primaryActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.betweenGroups,
  },

  /* Primary CTAs. Both solid: on a dark ground an outlined twin reads as
     disabled, and Listen is not. */
  cta: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  ctaText: {
    ...type.headline,
    fontWeight: "700",
    letterSpacing: 0,
    color: colors.surface,
  },
  listenNotice: {
    ...type.subhead,
    letterSpacing: 0,
    color: chrome.muted,
    marginTop: spacing.related,
  },

  /* Stats */
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
    color: chrome.text,
  },
  statLabel: {
    ...type.caption,
    color: chrome.muted,
  },
  toast: {
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: chrome.text,
  },
  toastText: {
    ...type.caption,
    fontWeight: "600",
    color: chrome.surface,
  },

  /* Hairlines part groups on one surface; never a border on a box. */
  divider: {
    height: 1,
    backgroundColor: chrome.border,
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
    backgroundColor: chrome.track,
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarInitial: {
    ...type.headline,
    fontFamily: fonts.display,
    color: chrome.text,
  },
  authorInfo: {
    flex: 1,
    gap: 2,
  },
  authorName: {
    ...type.subhead,
    fontWeight: "700",
    color: chrome.text,
  },
  authorHandle: {
    ...type.caption,
    color: chrome.muted,
  },
  followButton: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: chrome.text,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonActive: {
    backgroundColor: chrome.track,
  },
  followButtonText: {
    ...type.caption,
    fontWeight: "700",
    color: chrome.surface,
  },
  followButtonTextActive: {
    color: chrome.text,
  },
  synopsis: {
    ...type.body,
    color: chrome.muted,
  },

  /* Chapter list */
  chapterGroup: {
    gap: 0,
  },
  educationalNote: {
    ...type.caption,
    color: chrome.muted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  sectionEyebrow: {
    ...type.caption,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: chrome.muted,
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
    borderTopColor: chrome.border,
  },
  chapterNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: chrome.track,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterNumberText: {
    ...type.caption,
    fontWeight: "700",
    color: chrome.text,
  },
  chapterRowTitle: {
    ...type.body,
    flex: 1,
    color: chrome.text,
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
    color: chrome.muted,
  },
  metaValue: {
    ...type.subhead,
    fontWeight: "600",
    color: chrome.text,
    flexShrink: 1,
    textAlign: "right",
  },

  commentsAnchor: {
    marginTop: 0,
  },

  /* ── Comments sheet ── */
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  sheet: {
    backgroundColor: chrome.raised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: chrome.border,
    marginBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "600",
    color: chrome.text,
  },
  sheetClose: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -spacing.sm,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: spacing.huge,
  },
});
