import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import { Bookmark, BookmarkCheck, ChevronLeft, Heart, MessageCircle, Pause, Play, Send, Share2 } from "lucide-react-native";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { authorFor } from "@/data/seed";
import { imageAssets } from "@/data/images";
import { getDefaultVoices, getVoice } from "@/data/voices";
import { colors, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme";
import type { Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

/* ─────────────────────────────── Reader Screen ─────────────────────────────── */

type ReaderComment = { id: number; user: string; text: string; time: string };

const INITIAL_COMMENTS: ReaderComment[] = [
  {
    id: 1,
    user: "Mira R.",
    text:
      "This story had me hooked from the first line. The lighthouse metaphor is beautiful.",
    time: "2h ago",
  },
  {
    id: 2,
    user: "Dev S.",
    text: "Beautiful writing. The ending was unexpected but satisfying.",
    time: "5h ago",
  },
  {
    id: 3,
    user: "Aanya K.",
    text: "I want a sequel to this. What happens to the lighthouse?",
    time: "1d ago",
  },
];

export default function ReaderScreen(
  { story, onBack, initialChapterIndex = 0, autoplay = false }: {
    story: Story;
    onBack: () => void;
    /** Which chapter the story page sent the reader to. */
    initialChapterIndex?: number;
    /**
     * The reader was opened by Listen rather than Read, so narration should
     * start on arrival. Without this the two buttons did the same thing and
     * Listen was indistinguishable from Read.
     */
    autoplay?: boolean;
  },
) {
  const author = authorFor(story.authorId);
  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex);
  const chapter = story.chapters[chapterIndex] ?? story.chapters[0];
  const hasMultipleChapters = story.chapters.length > 1;
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [isPlaying, setIsPlaying] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 768;

  // Derive the language code from the story's language field
  const storyLang = story.language === "Spanish" ? "es" : "en";
  const voicePair = getDefaultVoices(storyLang);
  const femaleVoice = getVoice(voicePair[0] ?? "aria");
  const maleVoice = getVoice(voicePair[1] ?? "kai");

  // Audio player state (expo-av)
  const soundRef = useRef<Audio.Sound | null>(null);

  // Local interaction state
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(false);
  const [comments, setComments] = useState<ReaderComment[]>(INITIAL_COMMENTS);
  const [commentText, setCommentText] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const isLoadingAudioRef = useRef(false);

  const getAudioUrl = useCallback((): string | undefined => {
    // Prefer gender-specific audio, fallback to single audioUrl
    const genderUrl = voiceGender === "male"
      ? chapter.audioUrls?.male
      : chapter.audioUrls?.female;
    return genderUrl ?? chapter.audioUrl;
  }, [chapter.audioUrl, chapter.audioUrls, voiceGender]);

  const handlePlayTap = useCallback(async () => {
    if (isLoadingAudioRef.current) return;
    const audioUrl = getAudioUrl();
    if (!audioUrl) {
      Alert.alert(
        "Audio narration",
        "Audio narration will be generated when this story is published.",
      );
      return;
    }
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      } else {
        isLoadingAudioRef.current = true;
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          (status) => {
            if (status.isLoaded && status.didJustFinish) {
              setIsPlaying(false);
            }
          },
        );
        soundRef.current = sound;
        setIsPlaying(true);
        isLoadingAudioRef.current = false;
      }
    } catch {
      isLoadingAudioRef.current = false;
      Alert.alert("Playback error", "Could not play audio. Please try again.");
      setIsPlaying(false);
    }
  }, [isPlaying, getAudioUrl]);

  // Listen opens the reader already playing. Guarded so it fires once per
  // arrival rather than on every re-render, and it deliberately reuses
  // `handlePlayTap` so autoplay cannot drift from what the button does --
  // including its "narration will be generated when this story is published"
  // path, which is still the honest answer for a story with no audio.
  const autoplayFiredRef = useRef(false);
  useEffect(() => {
    if (!autoplay || autoplayFiredRef.current) return;
    autoplayFiredRef.current = true;
    void handlePlayTap();
  }, [autoplay, handlePlayTap]);

  const handleVoiceChange = useCallback(async (gender: "female" | "male") => {
    if (gender === voiceGender || isLoadingAudioRef.current) return;
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
    setIsPlaying(false);
    setVoiceGender(gender);
  }, [voiceGender]);

  const handleLike = useCallback(() => {
    setIsLiked((prev) => {
      setLikeCount((count) => prev ? count - 1 : count + 1);
      return !prev;
    });
  }, []);

  const handleSave = useCallback(() => {
    setIsSaved((prev) => !prev);
  }, []);

  const handleShare = useCallback(async () => {
    const text = `${story.title} by ${author.displayName}\n\nRead on Katha AI`;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(text);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      } catch {
        Alert.alert("Share", text);
      }
    } else {
      try {
        await Share.share({ message: text });
      } catch {
        // User cancelled share
      }
    }
  }, [story.title, author.displayName]);

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const newComment: ReaderComment = {
      id: Date.now(),
      user: "You",
      text: trimmed,
      time: "just now",
    };
    setComments((prev) => [newComment, ...prev]);
    setCommentText("");
    Alert.alert(
      "Comment added",
      "Your comment is saved locally. Comments will persist after authentication is connected.",
    );
  }, [commentText]);

  const handleFollow = useCallback(() => {
    setIsFollowing((prev) => !prev);
  }, []);

  const coverImage = story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const focalX = story.focalX ?? 0.5;
  const focalY = story.focalY ?? 0.5;

  // Only show voice toggle when both voices have audio
  const hasBothVoices =
    !!(chapter.audioUrls?.female && chapter.audioUrls?.male);

  // Shared content blocks
  const renderToolbar = (centered: boolean) => (
    <View
      style={[styles.readerToolbar, centered && styles.readerToolbarCentered]}
    >
      <Pressable onPress={handlePlayTap} style={styles.audioPill}>
        {isPlaying
          ? <Pause size={16} color={colors.surface} />
          : <Play size={16} color={colors.surface} />}
        <Text style={styles.audioText}>{isPlaying ? "Playing" : "Listen"}</Text>
      </Pressable>
      {hasBothVoices && (
        <View style={styles.voiceToggle}>
          <Pressable
            onPress={() => handleVoiceChange("female")}
            style={[
              styles.voiceToggleBtn,
              voiceGender === "female" && styles.voiceToggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.voiceToggleText,
                voiceGender === "female" && styles.voiceToggleTextActive,
              ]}
            >
              {femaleVoice.name}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleVoiceChange("male")}
            style={[
              styles.voiceToggleBtn,
              voiceGender === "male" && styles.voiceToggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.voiceToggleText,
                voiceGender === "male" && styles.voiceToggleTextActive,
              ]}
            >
              {maleVoice.name}
            </Text>
          </Pressable>
        </View>
      )}
      <Pressable
        onPress={handleSave}
        accessibilityLabel={isSaved ? "Unsave story" : "Save story"}
        accessibilityRole="button"
      >
        {isSaved
          ? <BookmarkCheck size={18} color={colors.sepiaSecondary} />
          : <Bookmark size={18} color={colors.sepiaSecondary} />}
      </Pressable>
      <Pressable
        onPress={handleShare}
        accessibilityLabel="Share story"
        accessibilityRole="button"
      >
        <Share2 size={18} color={colors.sepiaSecondary} />
      </Pressable>
    </View>
  );

  const renderBody = () => (
    <>
      {/* Share toast */}
      {shareToast && (
        <View style={styles.shareToast}>
          <Text style={styles.shareToastText}>Copied to clipboard!</Text>
        </View>
      )}

      {/* Chapter navigation */}
      {hasMultipleChapters && (
        <View style={styles.chapterNav}>
          {story.chapters.map((ch, i) => (
            <Pressable
              key={ch.id}
              onPress={() => {
                if (i !== chapterIndex) {
                  if (soundRef.current) {
                    soundRef.current.unloadAsync();
                    soundRef.current = null;
                  }
                  setIsPlaying(false);
                  setChapterIndex(i);
                }
              }}
              style={[
                styles.chapterNavBtn,
                i === chapterIndex && styles.chapterNavBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.chapterNavText,
                  i === chapterIndex && styles.chapterNavTextActive,
                ]}
              >
                Ch {ch.chapterNumber}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.chapterTitle}>{chapter.title}</Text>
      {chapter.paragraphs.map((paragraph, index) => (
        <Text
          key={`${chapter.id}-${index}`}
          style={[styles.paragraph, isDesktop && styles.paragraphDesktop]}
        >
          {paragraph}
        </Text>
      ))}

      {/* Engagement bar (Substack-style) */}
      <View style={styles.engagementDivider} />
      <View style={styles.engagementRow}>
        <Pressable
          onPress={handleLike}
          accessibilityLabel={`Like, ${formatNumber(likeCount)}`}
          accessibilityRole="button"
          style={styles.engagementAction}
        >
          <Heart
            size={16}
            color={isLiked ? colors.heart : colors.sepiaText}
            fill={isLiked ? colors.heart : "none"}
          />
          <Text style={styles.engagementCount}>{formatNumber(likeCount)}</Text>
        </Pressable>
        <View style={styles.engagementAction}>
          <MessageCircle size={16} color={colors.sepiaText} />
          <Text style={styles.engagementCount}>{comments.length}</Text>
        </View>
        <Pressable
          onPress={handleSave}
          accessibilityLabel={isSaved ? "Unsave" : "Save"}
          accessibilityRole="button"
          style={styles.engagementAction}
        >
          {isSaved
            ? <BookmarkCheck size={16} color={colors.sepiaText} />
            : <Bookmark size={16} color={colors.sepiaText} />}
        </Pressable>
        <Pressable
          onPress={handleShare}
          accessibilityLabel="Share"
          accessibilityRole="button"
          style={styles.engagementAction}
        >
          <Share2 size={16} color={colors.sepiaText} />
        </Pressable>
      </View>

      {/* Author section */}
      <View style={styles.authorDivider} />
      <View style={styles.readerAuthorCard}>
        <View style={styles.readerAuthorCardTop}>
          <View style={styles.authorAvatarSmall}>
            <Text style={styles.authorInitialSmall}>
              {author.displayName.charAt(0)}
            </Text>
          </View>
          <View style={styles.readerAuthorInfo}>
            <Text style={styles.readerAuthorName}>{author.displayName}</Text>
            <Text style={styles.readerAuthorBio} numberOfLines={2}>
              {author.bio}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={handleFollow}
          style={[
            styles.followButton,
            isFollowing && styles.followButtonFollowing,
          ]}
        >
          <Text
            style={[
              styles.followButtonText,
              isFollowing && styles.followButtonTextFollowing,
            ]}
          >
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </Pressable>
      </View>

      {/* Comments section */}
      <View style={styles.authorDivider} />
      <View style={styles.commentsSection}>
        <Text style={styles.commentsSectionTitle}>
          Comments ({comments.length})
        </Text>

        {/* Comment input */}
        <View style={styles.commentInputRow}>
          <View style={styles.commentInputAvatar}>
            <Text style={styles.commentInputAvatarText}>Y</Text>
          </View>
          <View style={styles.commentInputWrap}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor={colors.tertiary}
              style={styles.commentInput}
              multiline
              maxLength={500}
            />
          </View>
          {commentText.trim().length > 0 && (
            <Pressable
              onPress={handleSubmitComment}
              accessibilityLabel="Submit comment"
              accessibilityRole="button"
              style={styles.commentSendBtn}
            >
              <Send size={16} color={colors.surface} />
            </Pressable>
          )}
        </View>

        {/* Comment list */}
        {comments.map((comment) => (
          <View key={comment.id} style={styles.commentItem}>
            <View style={styles.commentItemAvatar}>
              <Text style={styles.commentItemAvatarText}>
                {comment.user.charAt(0)}
              </Text>
            </View>
            <View style={styles.commentItemContent}>
              <View style={styles.commentItemMeta}>
                <Text style={styles.commentItemUser}>{comment.user}</Text>
                <Text style={styles.commentItemTime}>{comment.time}</Text>
              </View>
              <Text style={styles.commentItemText}>{comment.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  const heroFocalY = Math.max(0, focalY - 0.02);
  const desktopStickyStyle = Platform.OS === "web"
    ? ({ position: "sticky", top: 20 } as unknown as {
      position: "relative";
      top: number;
    })
    : {};

  if (isDesktop) {
    // ── Desktop: two-column layout ──
    return (
      <View style={styles.reader}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.desktopContainer}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <ChevronLeft size={18} color={colors.ink} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            <View style={styles.desktopTwoCol}>
              {/* Left column: cover */}
              <View style={[styles.desktopCoverCol, desktopStickyStyle]}>
                <View style={styles.desktopCoverWrap}>
                  {coverImage
                    ? (
                      <FocalImage
                        source={coverImage}
                        focalX={focalX}
                        focalY={focalY}
                        style={{ width: "100%", height: "100%" }}
                      />
                    )
                    : (
                      <LinearGradient
                        colors={genreGradients[story.genre]}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                </View>
              </View>

              {/* Right column: text */}
              <View style={styles.desktopTextCol}>
                <Text style={styles.readerGenre}>
                  {genreLabels[story.genre]}
                </Text>
                <Text style={styles.desktopTitle}>{story.title}</Text>
                <Text style={styles.desktopAuthor}>
                  by{" "}
                  <Text style={styles.desktopAuthorName}>
                    {author.displayName}
                  </Text>
                </Text>
                {renderToolbar(false)}
                {renderBody()}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Mobile: full-bleed hero layout ──
  return (
    <View style={styles.reader}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Full-bleed hero image */}
        <View style={styles.mobileHeroWrap}>
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
          {/* Fade overlay */}
          <LinearGradient
            colors={[
              "rgba(241,232,214,0)",
              "rgba(241,232,214,0)",
              colors.sepia,
            ]}
            locations={[0, 0.66, 0.98]}
            style={StyleSheet.absoluteFill}
          />
          {/* Floating back button */}
          <Pressable onPress={onBack} style={styles.mobileHeroBackBtn}>
            <ChevronLeft size={16} color="#2c241d" />
            <Text style={styles.mobileHeroBackText}>Back</Text>
          </Pressable>
        </View>

        {/* Title block below hero */}
        <View style={styles.mobileMetaBlock}>
          <Text style={styles.mobileGenre}>
            {genreLabels[story.genre].toUpperCase()}
          </Text>
          <Text style={styles.mobileTitle}>{story.title}</Text>
          <Text style={styles.mobileAuthor}>
            by <Text style={styles.mobileAuthorName}>{author.displayName}</Text>
          </Text>
          {renderToolbar(true)}
        </View>

        {/* Body content */}
        <View style={styles.mobileBodyPad}>
          {renderBody()}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
  reader: { flex: 1, backgroundColor: colors.sepia },

  /* ── Mobile hero layout ── */
  mobileHeroWrap: {
    width: "100%",
    aspectRatio: 3 / 4,
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.sepiaPlaceholder,
  },
  mobileHeroBackBtn: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 14,
    shadowColor: "rgba(60,40,15,1)",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    zIndex: 2,
  },
  mobileHeroBackText: {
    fontFamily: fonts.ui,
    color: colors.sepiaHeading,
    fontSize: 13,
    fontWeight: "600",
  },
  mobileMetaBlock: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    marginTop: -4,
    alignItems: "center",
  },
  mobileGenre: {
    fontFamily: fonts.ui,
    color: colors.sepiaAccent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  mobileTitle: {
    marginTop: 8,
    fontFamily: fonts.display,
    color: colors.sepiaHeading,
    fontSize: 24,
    lineHeight: 28,
    textAlign: "center",
  },
  mobileAuthor: {
    marginTop: 7,
    fontFamily: fonts.ui,
    color: colors.sepiaMuted,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
  mobileAuthorName: {
    color: colors.sepiaSecondary,
    fontWeight: "600",
  },
  mobileBodyPad: {
    paddingHorizontal: 20,
    paddingBottom: spacing.huge,
  },

  /* ── Desktop two-column layout ── */
  desktopContainer: {
    padding: 34,
    paddingBottom: spacing.huge,
    maxWidth: 700,
    alignSelf: "center",
    width: "100%",
  },
  desktopTwoCol: {
    flexDirection: "row",
    gap: 32,
    alignItems: "flex-start",
  },
  desktopCoverCol: {
    width: 200,
    flexShrink: 0,
  },
  desktopCoverWrap: {
    width: 200,
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder,
    shadowColor: "rgba(60,40,15,1)",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  desktopTextCol: {
    flex: 1,
    minWidth: 0,
  },
  desktopTitle: {
    marginTop: 8,
    fontFamily: fonts.display,
    color: colors.sepiaHeading,
    fontSize: 26,
    lineHeight: 30,
  },
  desktopAuthor: {
    marginTop: 7,
    fontFamily: fonts.ui,
    color: colors.sepiaMuted,
    fontSize: 14,
    fontWeight: "500",
  },
  desktopAuthorName: {
    color: colors.sepiaSecondary,
    fontWeight: "600",
  },

  /* ── Shared reader styles ── */
  readerGenre: {
    fontFamily: fonts.ui,
    color: colors.sepiaAccent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  readerToolbar: {
    marginVertical: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 1,
  },
  readerToolbarCentered: { justifyContent: "center" },
  audioPill: {
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.sepiaButton,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  audioText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "700",
    fontSize: 13,
  },
  chapterNav: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  chapterNavBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.sepiaPlaceholder,
  },
  chapterNavBtnActive: {
    backgroundColor: colors.sepiaButton,
  },
  chapterNavText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.sepiaSecondary,
  },
  chapterNavTextActive: {
    color: colors.surface,
  },
  chapterTitle: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 25,
    marginBottom: spacing.lg,
  },
  paragraph: {
    fontFamily: fonts.reader,
    color: colors.sepiaBody,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.lg,
  },
  paragraphDesktop: { fontSize: 16, lineHeight: 26 },

  /* ── Reader engagement ── */
  engagementDivider: {
    height: 1,
    backgroundColor: "rgba(74,59,42,0.12)",
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  engagementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    marginBottom: spacing.lg,
  },
  engagementAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.xs,
  },
  engagementCount: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 13,
    fontWeight: "700",
  },

  /* ── Reader author card ── */
  authorDivider: {
    height: 1,
    backgroundColor: "rgba(74,59,42,0.12)",
    marginBottom: spacing.lg,
  },
  readerAuthorCard: {
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  readerAuthorCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  authorAvatarSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInitialSmall: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 20,
  },
  readerAuthorInfo: { flex: 1 },
  readerAuthorName: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 17,
  },
  readerAuthorBio: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    opacity: 0.6,
    fontSize: 13,
    lineHeight: 18,
  },
  followButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonFollowing: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "rgba(74,59,42,0.25)",
  },
  followButtonText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14,
  },
  followButtonTextFollowing: {
    color: colors.sepiaText,
  },

  /* ── Reader comments ── */
  commentsSection: {
    gap: 0,
  },
  commentsSectionTitle: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 20,
    marginBottom: spacing.lg,
  },
  /* Comment input */
  commentInputRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  commentInputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  commentInputAvatarText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
  commentInputWrap: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: "rgba(74,59,42,0.06)",
    borderWidth: 1,
    borderColor: "rgba(74,59,42,0.12)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  commentInput: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
    margin: 0,
  },
  commentSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  /* Comment items */
  commentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(74,59,42,0.08)",
  },
  commentItemAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  commentItemAvatarText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 12,
    fontWeight: "800",
  },
  commentItemContent: {
    flex: 1,
  },
  commentItemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 2,
  },
  commentItemUser: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 12,
    fontWeight: "800",
  },
  commentItemTime: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    opacity: 0.5,
    fontSize: 12,
  },
  commentItemText: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 14,
    lineHeight: 20,
  },
  /* Share toast */
  shareToast: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    marginBottom: spacing.md,
  },
  shareToastText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
  },

  /* ── Credits screen ── */
  voiceToggle: {
    flexDirection: "row",
    borderRadius: radius.pill,
    backgroundColor: colors.sepiaToggleTrack,
    padding: 3,
  },
  voiceToggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  voiceToggleBtnActive: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  voiceToggleText: {
    fontFamily: fonts.ui,
    color: colors.sepiaSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  voiceToggleTextActive: {
    color: colors.sepiaHeading,
    fontWeight: "600",
  },

  }),
};
