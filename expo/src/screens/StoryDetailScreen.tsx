import { useCallback, useEffect, useRef, useState } from "react";
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
  BookOpen,
  ChevronRight,
  Ellipsis,
  Globe,
  Headphones,
  MessageCircle,
  Share2,
  Star,
  X,
} from "lucide-react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { Button } from "@/components/Button";
import { authorFor } from "@/data/seed";
import CommentThread from "@/components/comments/CommentThread";
import type { StoryReportReason } from "@/components/comments/types";
import { blockAuthor, fetchCommentCount, reportContent } from "@/lib/comments";
import { rememberBlocked } from "@/lib/blocks";
import { downloadStoryPdf } from "@/lib/story-pdf";
import { useIsSubscribed } from "@/lib/entitlements";
import { setAuthorFollow, setStoryBookmark } from "@/lib/api";
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
import type { Genre, Story } from "@/types/domain";

type ReadMode = "read" | "listen";
type ReadOptions = { mode?: ReadMode };

/**
 * THE STORY PAGE IS LIGHT, LIKE EVERY OTHER SCREEN.
 *
 * It was briefly the one dark surface in the app, on the argument that the
 * cover needs a dark ground to dissolve into. The edgeless cover was the part
 * worth keeping; the dark ground was not. A single dark page in a warm light
 * app reads as a different product the moment you arrive at it, and the
 * dissolve does not need darkness - it needs the ground and the fade to be the
 * SAME colour, which is as true of `colors.bg` as it was of `#1C1A17`.
 *
 * So: the picture still runs full-bleed off the top with no card, no border
 * and no radius, and its bottom fades to exactly `colors.bg` at 100%. What
 * changed is which colour that is.
 */

/** How much of the window the hero takes. The picture, not a thumbnail of it. */
const HERO_HEIGHT_FRACTION = 0.62;
/** The bottom part of the hero the dissolve covers. */
const HERO_FADE_FRACTION = 0.45;
/**
 * Opacity of the discs behind the floating controls.
 *
 * A cover can be anything: a white snowfield or a night street. The disc is
 * `colors.surface` (pure white) at this alpha, so whatever is behind it, what
 * the glyph actually sits on is within a few points of white - and
 * `colors.strong` on that clears WCAG AA by a wide margin in both directions.
 * `story-detail-controls.test.ts` computes both extremes rather than trusting
 * this comment.
 */
const CONTROL_DISC_ALPHA = 0.92;
/** The comments sheet's height as a share of the window. */
const COMMENTS_SHEET_FRACTION = 0.8;

/**
 * Builds an rgba() string FROM a hex token instead of writing a literal one.
 *
 * The dissolve is an alpha ramp from nothing to the ground, and the control
 * discs are white at partial opacity; both are derived from theme tokens at
 * call time so the page cannot drift from them.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The colour a semi-transparent layer actually presents, once it is composited
 * over a backdrop. Source-over alpha blending, per channel.
 *
 * This is how the control discs are checked against real cover art rather than
 * against the colour they would be if they were opaque.
 */
export function compositeOver(
  layerHex: string,
  alpha: number,
  backdropHex: string,
): string {
  const parse = (hex: string) => {
    const v = hex.replace("#", "");
    return [
      parseInt(v.substring(0, 2), 16),
      parseInt(v.substring(2, 4), 16),
      parseInt(v.substring(4, 6), 16),
    ];
  };
  const layer = parse(layerHex);
  const backdrop = parse(backdropHex);
  const mixed = layer.map((channel, index) =>
    Math.round(channel * alpha + backdrop[index] * (1 - alpha))
  );
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The colour a floating control's glyph is actually drawn against, over `coverHex`. */
export function controlDiscBackdrop(coverHex: string): string {
  return compositeOver(colors.surface, CONTROL_DISC_ALPHA, coverHex);
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
 * The chips under the meta line: GENRES ONLY.
 *
 * They used to carry the story's themes and its spice level too, so a romance
 * shelved itself as `Romance · premonition · duty · compassion · fear · sweet`.
 * Four of those are notes the generator left about the plot and the fifth is a
 * content setting; none of them is a shelf anyone browses, and together they
 * buried the one word in the row that told a reader what they were looking at.
 *
 * The primary genre first, then any genre the story's tags also name. A tag
 * that is not a genre is not shown here at all.
 */
export function chipLabels(story: Story): string[] {
  const primary: Genre = story.primaryGenre ?? story.genre;
  const genreByLabel = new Map(
    Object.values(genreLabels).map((label) => [label.toLowerCase(), label]),
  );
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
  // A tag survives only if it names a genre. `genreLabels` is the whole list
  // of genres this product has, so membership in it IS the test.
  story.tags.forEach((tag) => {
    const asGenre = genreByLabel.get(tag.trim().toLowerCase()) ??
      genreLabels[tag.trim() as Genre];
    if (asGenre) push(asGenre);
  });
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
  canEngage = true,
  onSignIn,
  onPaywall,
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
  /**
   * May this viewer engage? False for an anonymous session.
   *
   * READING STAYS OPEN TO EVERYONE. Saving, following, commenting, replying
   * and voting do not: each of them writes a row against a user id, and an
   * anonymous guest has one that will not survive the day. Every gated control
   * stays visible and pressing it asks for a sign-in, rather than failing
   * quietly or - worse - updating on screen and losing the write.
   */
  canEngage?: boolean;
  /** Opens the app's sign-in flow. Called by every gated control. */
  onSignIn?: () => void;
  /** Opens the plan screen for the paid PDF export. */
  onPaywall?: () => void;
}) {
  const author = authorFor(story.authorId);
  const { height: windowHeight } = useWindowDimensions();
  const hasMultipleChapters = story.chapters.length > 1;
  const narrationReady = hasNarration(story);
  const subscribed = useIsSubscribed();
  const chips = chipLabels(story);
  const [listenNotice, setListenNotice] = useState(false);

  // Seeded from the viewer's own state, not from `false`.
  //
  // Starting every control at `false` meant a reader who had already saved a
  // story saw an empty star, and their next tap sent `on: true` for a save
  // that already existed -- removing nothing, adding nothing, and leaving the
  // UI disagreeing with the server. Absent means not engaged, which is the safe
  // reading while the endpoints supplying these are still rolling out.
  const [isSaved, setIsSaved] = useState(story.viewerHasBookmarked ?? false);
  const [saveCount, setSaveCount] = useState(story.bookmarks);
  const [isFollowing, setIsFollowing] = useState(
    story.viewerFollowsAuthor ?? false,
  );
  const [shareToast, setShareToast] = useState(false);
  const [pdfToast, setPdfToast] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const followInFlight = useRef(false);

  /**
   * The sign-in wall.
   *
   * One function, called by every gated control, so there is exactly one way
   * an anonymous viewer can be told and no control can forget. It returns
   * true when it handled the press, which reads at the call site as "stop
   * here".
   */
  const requireSignIn = useCallback((action: string): boolean => {
    if (canEngage) return false;
    setSignInPrompt(action);
    return true;
  }, [canEngage]);

  /**
   * The count on the comments icon, without mounting the thread.
   *
   * The thread now lives entirely in the sheet, so the page has no other way
   * to know the number - and a comments icon with no count is a door with
   * nothing written on it. The GET already returns an exact total; this asks
   * for one row to read it.
   */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let live = true;
    fetchCommentCount(story.id)
      .then((count) => {
        if (live) setCommentCount(count);
      })
      // A count that could not be fetched is shown as no count at all, which
      // is honest; the icon still opens the sheet.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [story.id]);

  const handleSave = useCallback(() => {
    if (requireSignIn("save this story")) return;
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
  }, [isSaved, requireSignIn, saveCount, story.id]);

  const handleFollow = useCallback(() => {
    if (requireSignIn(`follow ${author.displayName}`)) return;
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
  }, [
    author.displayName,
    author.followers,
    isFollowing,
    requireSignIn,
    story.authorId,
  ]);

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
   * Leaving comes first and hiding second: the moment the block is recorded
   * this story drops out of every list the app draws (`lib/blocks.ts`), and
   * the page must already be on its way out when it does. The server applies
   * the same block to every later read (`user_blocks` in `comments`, `feed`,
   * `library`, `profile` and Explore's search).
   */
  const handleBlockAuthor = useCallback(async () => {
    if (requireSignIn(`block ${author.displayName}`)) {
      setActionsOpen(false);
      return false;
    }
    try {
      if (isSupabaseConfigured) await blockAuthor(story.authorId);
    } catch {
      return false;
    }
    setActionsOpen(false);
    onBack();
    rememberBlocked(story.authorId);
    return true;
  }, [author.displayName, onBack, requireSignIn, story.authorId]);

  /**
   * Report the story. Details are optional for a story report; whatever the
   * reporter wrote is passed straight through and `reportContent` omits an
   * empty one. The sheet shows its confirmation only when the write landed.
   */
  const handleReportStory = useCallback(
    async (reason: StoryReportReason, details: string) => {
      if (requireSignIn("report this story")) {
        throw new Error("Sign in to report a story.");
      }
      if (!isSupabaseConfigured) return;
      await reportContent({ storyId: story.id }, reason, details);
    },
    [requireSignIn, story.id],
  );

  /**
   * The PDF is handed to the platform's own dialog; the only outcome this
   * screen reports is the one it can know - that the dialog could not open.
   * A dismissed dialog is not a failure and says nothing.
   */
  const handleDownloadPdf = useCallback(() => {
    // The server will remain the final authority when export moves off-device;
    // this guard keeps the current local action honest for active clients too.
    if (!subscribed) {
      onPaywall?.();
      return;
    }
    downloadStoryPdf({
      story,
      authorName: author.displayName,
      dateLabel: storyPublishedDate(story),
    }).catch(() => {
      setPdfToast("Couldn't prepare the PDF on this device.");
      setTimeout(() => setPdfToast(null), 2500);
    });
  }, [author.displayName, onPaywall, story, subscribed]);

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
      <StatusBar style="dark" />
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
            ground for a beat, and a hero-sized rectangle of nothing at the top
            of the page reads as a broken screen rather than as a picture on
            its way.
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

          {/*
            A soft light haze at the very top. The discs below carry their own
            contrast and are proven independently of this, but the status bar
            glyphs are the platform's and are drawn dark on a light page - this
            is what keeps them readable over a night-time cover.
          */}
          <LinearGradient
            colors={[hexToRgba(colors.surface, 0.55), hexToRgba(colors.surface, 0)]}
            locations={[0, 1]}
            style={styles.heroTopScrim}
            pointerEvents="none"
          />

          <LinearGradient
            colors={[hexToRgba(colors.bg, 0), colors.bg]}
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
            <X size={20} color={colors.strong} />
          </Pressable>
          <View style={styles.heroActionCluster}>
            {/*
              COMMENTS LIVE UP HERE NOW, beside save and share, the way every
              reading app puts the speech bubble next to the heart. The thread
              used to be a slab at the bottom of the page that a reader had to
              scroll the whole story past to reach; as an icon it is one tap
              from the top and the count says whether it is worth the tap.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={commentCount === null
                ? "Open comments"
                : `Open comments, ${commentsLabel}`}
              onPress={openComments}
              style={({ pressed }) => [
                styles.controlDisc,
                commentCount !== null && styles.controlPill,
                pressed && styles.controlDiscPressed,
              ]}
            >
              <MessageCircle size={20} color={colors.strong} />
              {commentCount !== null && (
                <Text style={styles.controlCount}>{formatNumber(commentCount)}</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isSaved ? "Remove saved story" : "Save story"}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.controlDisc,
                pressed && styles.controlDiscPressed,
              ]}
            >
              {/*
                `accentPressed`, not `accent`, for the filled state. The disc
                is near-white over any cover, and #FF6B1A on white is 2.85:1 -
                under the 3:1 WCAG floor for a graphical object, which for a
                filled star means the "saved" state is the state hardest to
                see. The darker step of the same orange clears it.
              */}
              <Star
                size={20}
                color={isSaved ? colors.accentPressed : colors.strong}
                fill={isSaved ? colors.accentPressed : "none"}
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
              <Share2 size={20} color={colors.strong} />
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
              <Ellipsis size={20} color={colors.strong} />
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
              {storyProgressLabel(story)}
              {showsPublic ? " · Public" : ""}
            </Text>

            {/*
              GENRES ONLY. Themes and the spice level used to ride in this row
              and drowned the one word that told a reader what they had opened.
            */}
            <View style={styles.chipRow}>
              {chips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
              {showsPublic && (
                <View style={[styles.chip, styles.publicChip]} accessibilityLabel="Public story">
                  <Globe size={14} color={colors.strong} />
                  <Text style={styles.chipText}>Public</Text>
                </View>
              )}
            </View>

            {!!storyHook(story) && (
              <Text style={styles.summary}>
                {storyHook(story)}
              </Text>
            )}

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

                It survived the strip-down of this page while the "About this
                story" block around it did not, because it is the one line here
                that a reader needs BEFORE they decide to read.
              */
              <Text style={styles.educationalNote} accessibilityRole="text">
                This story is fiction written by AI. Facts in it are not
                verified — check anything you plan to rely on.
              </Text>
            )}
          </View>

          <View style={styles.primaryActions}>
            {/* The two buttons the owner sees first, and for a long time the
                two that were furthest from the documented recipe: a local
                56pt pill with an 18/700 label. They are `Button` now, so
                Read here and Continue with email in sign-in are the same
                control. `cta` carries the `flex: 1` that splits the row and
                nothing else. */}
            <Button
              label="Read"
              accessibilityLabel="Read story"
              onPress={handleRead}
              icon={<BookOpen size={19} color={colors.surface} />}
              style={styles.cta}
            />
            <Button
              label="Listen"
              accessibilityLabel="Listen to story"
              onPress={handleListen}
              icon={<Headphones size={19} color={colors.surface} />}
              style={styles.cta}
            />
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
          {shareToast && (
            <View style={styles.toast}>
              <Text style={styles.toastText}>Copied to clipboard</Text>
            </View>
          )}

          {/*
            THE STAT ROW IS GONE. Reads / likes / saves sat here as three big
            numbers under the CTAs. The star at the top of the page already
            means "save", so two of them were the same control twice; and a
            read count on a product with no readers yet is a number that can
            only ever argue against opening the story.
          */}

          <View style={styles.divider} />

          {/*
            Follow is a SIBLING of the author row, not a child of it.

            Nested, it was a button inside a button: on the web build a press
            on Follow bubbles to the row's handler and the reader is followed
            AND navigated away to the author's profile in one tap, and a
            screen reader is read a button containing a button. The row and
            the button are two controls, so they are two Pressables side by
            side, and the row keeps the space the button does not use.
          */}
          <View style={styles.authorGroup}>
            <View style={styles.authorRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${author.displayName}'s profile`}
                onPress={() => onAuthor(story.authorId)}
                style={({ pressed }) => [styles.authorIdentity, pressed && styles.pressed]}
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
              </Pressable>
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
            </View>
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
                    <ChevronRight size={18} color={colors.tertiary} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/*
            "About this story", the prompt block and the inline comment thread
            all used to sit below here. The first two restated the chips and
            the summary in a two-column table; the third put a whole thread at
            the bottom of a page whose job is to get someone into the story.
            The comments icon at the top is the door now.
          */}
        </View>
      </ScrollView>

      <StoryActionsSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        storyTitle={story.title}
        authorName={author.displayName}
        onBlockAuthor={handleBlockAuthor}
        onSubmitReport={handleReportStory}
        onDownloadPdf={subscribed ? handleDownloadPdf : undefined}
        onRequireSubscription={subscribed ? undefined : onPaywall}
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
          unconditionally meant every story page fetched a thread nobody had
          asked to see.
        */}
        {commentsOpen && (
          <CommentThread
            storyId={story.id}
            authorName={author.displayName}
            composerPosition="bottom"
            onCountChange={setCommentCount}
            canEngage={canEngage}
            onRequireSignIn={() => {
              setCommentsOpen(false);
              setSignInPrompt("join the conversation");
            }}
            onAuthorPress={onAuthor}
          />
        )}
      </CommentsSheet>

      <SignInPrompt
        action={signInPrompt}
        onClose={() => setSignInPrompt(null)}
        onSignIn={() => {
          setSignInPrompt(null);
          onSignIn?.();
        }}
      />
    </View>
  );
}

/**
 * The sign-in wall.
 *
 * It names the thing the reader was trying to do, because "Sign in to
 * continue" over a story page tells them nothing about why they were stopped.
 * Dismissing it returns them to the story: reading never needed an account and
 * this must not read as a gate on the story itself.
 */
export function SignInPrompt({
  action,
  onClose,
  onSignIn,
}: {
  action: string | null;
  onClose: () => void;
  onSignIn: () => void;
}) {
  return (
    <Modal
      visible={action !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.promptRoot}>
        <Pressable
          style={styles.promptBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.promptCard} accessibilityRole="alert">
          <Text style={styles.promptTitle}>Sign in to {action}</Text>
          <Text style={styles.promptBody}>
            Reading is open to everyone. Saving, following and commenting need
            an account, so your library and your words are still here next time.
          </Text>
          <Button label="Sign in" onPress={onSignIn} />
          {/* "Keep reading" is the way out of the sheet, not a second offer,
              so it is a ghost: the label and a 44pt target, no plate. */}
          <Button
            label="Keep reading"
            onPress={onClose}
            variant="ghost"
            size="sm"
            style={styles.promptSecondary}
          />
        </View>
      </View>
    </Modal>
  );
}

/**
 * The comments sheet: the thread on a raised surface over the page.
 *
 * A `Modal` rather than an in-page panel so it sits above the hero and the
 * status bar and dismisses with the hardware back. The header carries the
 * count the icon already showed, so opening the sheet confirms the tap rather
 * than restating it in a new shape.
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
              <X size={20} color={colors.muted} />
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
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
  },

  /* ── Hero ── */
  hero: {
    width: "100%",
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.bg,
  },
  heroFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroTopScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 120,
  },
  controlDisc: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: hexToRgba(colors.surface, CONTROL_DISC_ALPHA),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    boxShadow: shadows.card,
  },
  /* Widens when it carries a number beside the glyph. */
  controlPill: {
    paddingHorizontal: spacing.md,
  },
  controlCount: {
    ...type.caption,
    fontWeight: "700",
    color: colors.strong,
  },
  controlDiscPressed: {
    backgroundColor: colors.surface,
    opacity: 0.9,
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
    color: colors.ink,
  },
  metaLine: {
    ...type.subhead,
    lineHeight: 22,
    letterSpacing: 0,
    color: colors.muted,
  },
  metaLink: {
    color: colors.ink,
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
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  publicChip: {
    borderColor: colors.borderStrong,
  },
  chipText: {
    ...type.subhead,
    letterSpacing: 0,
    color: colors.ink,
  },
  summary: {
    ...type.body,
    lineHeight: 24,
    letterSpacing: 0,
    color: colors.ink,
  },
  primaryActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.betweenGroups,
  },

  /** Layout only. The button's own recipe lives in `Button`. */
  cta: { flex: 1 },
  listenNotice: {
    ...type.subhead,
    letterSpacing: 0,
    color: colors.muted,
    marginTop: spacing.related,
  },
  toast: {
    alignSelf: "center",
    marginTop: spacing.related,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  toastText: {
    ...type.caption,
    fontWeight: "600",
    color: colors.surface,
  },

  /* Hairlines part groups on one surface; never a border on a box. */
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
  // The tappable half of the row: avatar and name, taking every pixel Follow
  // leaves, so the target is the whole identity rather than only the text.
  authorIdentity: {
    flex: 1,
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
    backgroundColor: colors.surface2,
  },
  followButtonText: {
    ...type.caption,
    fontWeight: "700",
    color: colors.surface,
  },
  followButtonTextActive: {
    color: colors.ink,
  },

  /* Chapter list */
  chapterGroup: {
    gap: 0,
  },
  educationalNote: {
    ...type.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  sectionEyebrow: {
    ...type.caption,
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

  /* ── Sign-in wall ── */
  promptRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  promptBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  promptCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.related,
    boxShadow: shadows.overlay,
  },
  promptTitle: {
    ...type.headline,
    color: colors.ink,
  },
  promptBody: {
    ...type.subhead,
    color: colors.muted,
    marginBottom: spacing.related,
  },
  /** Layout only; see `cta`. */
  promptSecondary: { marginTop: spacing.xs },

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
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    boxShadow: shadows.overlay,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
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
    color: colors.ink,
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
