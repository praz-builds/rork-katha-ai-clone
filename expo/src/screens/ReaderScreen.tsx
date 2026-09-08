import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import {
  Bookmark,
  BookmarkCheck,
  Heart,
  MessageCircle,
  Pause,
  Play,
  Send,
  Share2,
  X,
} from "lucide-react-native";
import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { ReaderChrome } from "@/components/reader/ReaderChrome";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { imageAssets } from "@/data/images";
import { authorFor } from "@/data/seed";
import { getDefaultVoices, getVoice } from "@/data/voices";
import { pageIndexForOffset, paginateChapter, sentenceAnchorForOffset } from "@/lib/paginate";
import { splitWords } from "@/lib/sentence";
import { colors, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

type ReaderComment = { id: number; user: string; text: string; time: string };
type ReadingThemeName = "paper" | "sepia" | "night";
type ReaderPreferences = {
  typeSize: number;
  lineHeight: number;
  theme: ReadingThemeName;
};

export type ReaderScreenProps = {
  story: Story;
  onBack: () => void;
  /** Which chapter the story page sent the reader to. */
  initialChapterIndex?: number;
  /** Extension point for branching or end-of-chapter modules on the final page. */
  renderChapterEnd?: () => ReactNode;
  /** Extension point for phrase-level modules that need to replace individual words. */
  renderWord?: (word: string, index: number) => ReactNode;
  /**
   * Fired with the chapter now on screen, on mount and again every time the
   * reader switches chapters from the Chapters sheet. `chapterIndex` is
   * internal state a caller cannot otherwise observe, and phrase capture
   * needs to know which chapter a save belongs to.
   */
  onChapterChange?: (chapter: Chapter, chapterIndex: number) => void;
};

type ReaderTheme = {
  name: ReadingThemeName;
  label: string;
  background: string;
  text: string;
  muted: string;
  divider: string;
  highlight: string;
};

const READER_PREFS_KEY = "katha.reader.preferences.v1";
const DEFAULT_PREFS: ReaderPreferences = { typeSize: 18, lineHeight: 30, theme: "paper" };
const TYPE_SIZES = [16, 18, 20, 22];
const LINE_HEIGHTS = [26, 30, 34, 38];

const READER_THEMES: Record<ReadingThemeName, ReaderTheme> = {
  paper: {
    name: "paper",
    label: "Paper",
    background: "#FAF7F2",
    text: colors.ink,
    muted: colors.muted,
    divider: colors.border,
    highlight: colors.accentSoft,
  },
  sepia: {
    name: "sepia",
    label: "Sepia",
    background: colors.sepia,
    text: colors.sepiaText,
    muted: colors.sepiaMuted,
    divider: colors.sepiaPlaceholder,
    highlight: colors.accentSoft,
  },
  night: {
    name: "night",
    label: "Night",
    background: "#171512",
    text: "#F2EEE8",
    muted: "#B8AEA3",
    divider: "#3A3632",
    highlight: "#5C351F",
  },
};

const INITIAL_COMMENTS: ReaderComment[] = [
  {
    id: 1,
    user: "Mira R.",
    text: "This story had me hooked from the first line. The lighthouse metaphor is beautiful.",
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

function chapterText(chapter: Chapter): string {
  return chapter.paragraphs.join("\n\n");
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}

function findMatches(text: string, query: string): { start: number; end: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const matches: { start: number; end: number }[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

function readStoredPrefs(raw: string | null): ReaderPreferences {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    const typeSize = TYPE_SIZES.includes(parsed.typeSize ?? 0) ? parsed.typeSize! : DEFAULT_PREFS.typeSize;
    const lineHeight = LINE_HEIGHTS.includes(parsed.lineHeight ?? 0) ? parsed.lineHeight! : DEFAULT_PREFS.lineHeight;
    const theme = parsed.theme && parsed.theme in READER_THEMES ? parsed.theme : DEFAULT_PREFS.theme;
    return { typeSize, lineHeight, theme };
  } catch {
    return DEFAULT_PREFS;
  }
}

function renderPageWords(
  text: string,
  pageStart: number,
  /**
   * How many words of the chapter precede this page.
   *
   * `renderWord` receives a CHAPTER-absolute index, not a page-local one. A
   * page-local index cannot tell phrase capture which occurrence of a word was
   * tapped, so a sentence spanning a page break was truncated at the boundary.
   */
  pageWordStart: number,
  matches: readonly { start: number; end: number }[],
  activeMatch: number,
  renderWord: (word: string, index: number) => ReactNode,
) {
  let wordIndex = 0;
  let cursor = 0;
  return text.split(/(\s+)/).map((word, index) => {
    if (!word) return null;
    const absoluteStart = pageStart + cursor;
    cursor += word.length;
    if (/^\s+$/.test(word)) return <Text key={`space-${index}`}>{word}</Text>;
    const currentWordIndex = wordIndex;
    wordIndex += 1;
    const matchIndex = matches.findIndex((match) => absoluteStart < match.end && absoluteStart + word.length > match.start);
    const content = renderWord(word, pageWordStart + currentWordIndex);
    if (matchIndex < 0) return <Text key={`word-${index}`}>{content}</Text>;
    return (
      <Text
        key={`word-${index}`}
        style={matchIndex === activeMatch ? styles.activeSearchHighlight : styles.searchHighlight}
      >
        {content}
      </Text>
    );
  });
}

export default function ReaderScreen({
  story,
  onBack,
  initialChapterIndex = 0,
  renderChapterEnd,
  renderWord = (word) => word,
  onChapterChange,
}: ReaderScreenProps) {
  const author = authorFor(story.authorId);
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex);
  const chapter = story.chapters[chapterIndex] ?? story.chapters[0];
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_PREFS);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [listenOpen, setListenOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [anchorOffset, setAnchorOffset] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isLoadingAudioRef = useRef(false);
  const fullText = useMemo(() => chapterText(chapter), [chapter]);
  const theme = READER_THEMES[preferences.theme];
  const pageViewport = useMemo(() => ({
    width: Math.min(width, 680) - spacing.xl * 2,
    height: Math.max(260, height - (isDesktop ? 190 : 230)),
  }), [height, isDesktop, width]);
  const pages = useMemo(
    () => paginateChapter(fullText, pageViewport, {
      fontSize: preferences.typeSize,
      lineHeight: preferences.lineHeight,
    }),
    [fullText, pageViewport.height, pageViewport.width, preferences.lineHeight, preferences.typeSize],
  );
  const page = pages[clampIndex(pageIndex, pages.length)] ?? pages[0];
  const searchMatches = useMemo(() => findMatches(fullText, searchQuery), [fullText, searchQuery]);
  const pageMatches = searchMatches.filter((match) => match.start < page.end && match.end > page.start);
  const coverImage = story.coverImage ? imageAssets[story.coverImage] : undefined;
  const storyLang = story.language === "Spanish" ? "es" : "en";
  const voicePair = getDefaultVoices(storyLang);
  const femaleVoice = getVoice(voicePair[0] ?? "aria");
  const maleVoice = getVoice(voicePair[1] ?? "kai");
  const hasBothVoices = !!(chapter.audioUrls?.female && chapter.audioUrls?.male);

  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(false);
  const [comments, setComments] = useState<ReaderComment[]>(INITIAL_COMMENTS);
  const [commentText, setCommentText] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(READER_PREFS_KEY).then((raw) => {
      if (alive) setPreferences(readStoredPrefs(raw));
    });
    return () => {
      alive = false;
      if (soundRef.current) void soundRef.current.unloadAsync();
    };
  }, []);

  useEffect(() => {
    const nextPageIndex = pageIndexForOffset(pages, anchorOffset);
    setPageIndex((current) => current === nextPageIndex ? current : nextPageIndex);
  }, [anchorOffset, pages]);

  useEffect(() => {
    setActiveSearchMatch(0);
  }, [searchQuery]);

  useEffect(() => {
    onChapterChange?.(chapter, chapterIndex);
  }, [chapter, chapterIndex, onChapterChange]);

  const updatePreferences = useCallback((next: ReaderPreferences) => {
    setPreferences(next);
    void AsyncStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
  }, []);

  const goToPage = useCallback((nextPage: number) => {
    const next = clampIndex(nextPage, pages.length);
    setPageIndex(next);
    setAnchorOffset(pages[next]?.start ?? 0);
  }, [pages]);

  const switchChapter = useCallback((nextIndex: number) => {
    if (nextIndex === chapterIndex) return;
    if (soundRef.current) {
      void soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setIsPlaying(false);
    setChapterIndex(nextIndex);
    setPageIndex(0);
    setAnchorOffset(0);
    setChaptersOpen(false);
  }, [chapterIndex]);

  const getAudioUrl = useCallback((): string | undefined => {
    const genderUrl = voiceGender === "male" ? chapter.audioUrls?.male : chapter.audioUrls?.female;
    return genderUrl ?? chapter.audioUrl;
  }, [chapter.audioUrl, chapter.audioUrls, voiceGender]);

  const handlePlayTap = useCallback(async () => {
    if (isLoadingAudioRef.current) return;
    const audioUrl = getAudioUrl();
    if (!audioUrl) {
      Alert.alert("Audio narration", "Audio narration will be generated when this story is published.");
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
        const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: true }, (status) => {
          if (status.isLoaded && status.didJustFinish) setIsPlaying(false);
        });
        soundRef.current = sound;
        setIsPlaying(true);
        isLoadingAudioRef.current = false;
      }
    } catch {
      isLoadingAudioRef.current = false;
      Alert.alert("Playback error", "Could not play audio. Please try again.");
      setIsPlaying(false);
    }
  }, [getAudioUrl, isPlaying]);

  const handleVoiceChange = useCallback(async (gender: "female" | "male") => {
    if (gender === voiceGender || isLoadingAudioRef.current) return;
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
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
      } catch {}
    }
  }, [author.displayName, story.title]);

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    setComments((prev) => [{ id: Date.now(), user: "You", text: trimmed, time: "just now" }, ...prev]);
    setCommentText("");
    Alert.alert("Comment added", "Your comment is saved locally. Comments will persist after authentication is connected.");
  }, [commentText]);

  const jumpToMatch = useCallback((direction: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (activeSearchMatch + direction + searchMatches.length) % searchMatches.length;
    setActiveSearchMatch(next);
    const anchor = sentenceAnchorForOffset(fullText, searchMatches[next].start);
    setAnchorOffset(anchor);
    setPageIndex(pageIndexForOffset(pages, searchMatches[next].start));
  }, [activeSearchMatch, fullText, pages, searchMatches]);

  const activeGlobalMatch = searchMatches[activeSearchMatch];
  const activePageMatch = activeGlobalMatch
    ? pageMatches.findIndex((match) => match.start === activeGlobalMatch.start && match.end === activeGlobalMatch.end)
    : -1;

  // Words before this page, so `renderWord` can be handed a chapter-absolute
  // index. Derived from the page's own character offset using the shared
  // tokenizer, so it cannot disagree with how the words are actually split.
  const pageWordStart = useMemo(
    () => splitWords(fullText.slice(0, page.start)).length,
    [fullText, page.start],
  );
  const renderedWords = renderPageWords(page.text, page.start, pageWordStart, pageMatches, activePageMatch, renderWord);
  const isLastPage = pageIndex === pages.length - 1;

  return (
    <View style={[styles.reader, { backgroundColor: theme.background }]}>
      <Pressable
        accessibilityLabel="Toggle reader controls"
        accessibilityRole="button"
        style={styles.centerTapZone}
        onPress={() => setChromeVisible((visible) => !visible)}
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
          <View style={styles.coverWrap}>
            {coverImage ? (
              <FocalImage source={coverImage} focalX={story.focalX ?? 0.5} focalY={story.focalY ?? 0.5} style={styles.coverImage} />
            ) : (
              <LinearGradient colors={genreGradients[story.genre]} style={StyleSheet.absoluteFill} />
            )}
          </View>
          <Text style={[styles.genre, { color: theme.muted }]}>{genreLabels[story.genre]}</Text>
          <Text style={[styles.title, { color: theme.text }]}>{story.title}</Text>
          <Text style={[styles.author, { color: theme.muted }]}>by <Text style={{ color: theme.text }}>{author.displayName}</Text></Text>
          <Text style={[styles.chapterTitle, { color: theme.text }]}>{chapter.title}</Text>
          <View style={styles.pageFrame}>
            <Text
              selectable
              style={[
                styles.pageText,
                {
                  color: theme.text,
                  fontSize: preferences.typeSize,
                  lineHeight: preferences.lineHeight,
                },
              ]}
            >
              {renderedWords}
            </Text>
            {isLastPage ? renderChapterEnd?.() : null}
          </View>
          <Text style={[styles.pageFooter, { color: theme.muted }]}>Page {pageIndex + 1} of {pages.length}</Text>
          {isLastPage ? (
            <View>
              {shareToast ? (
                <View style={styles.shareToast}>
                  <Text style={styles.shareToastText}>Copied to clipboard!</Text>
                </View>
              ) : null}
              <View style={[styles.divider, { backgroundColor: theme.divider }]} />
              <View style={styles.engagementRow}>
                <Pressable onPress={handleLike} accessibilityLabel={`Like, ${formatNumber(likeCount)}`} accessibilityRole="button" style={styles.engagementAction}>
                  <Heart size={16} color={isLiked ? colors.heart : theme.text} fill={isLiked ? colors.heart : "none"} />
                  <Text style={[styles.engagementCount, { color: theme.text }]}>{formatNumber(likeCount)}</Text>
                </Pressable>
                <View style={styles.engagementAction}>
                  <MessageCircle size={16} color={theme.text} />
                  <Text style={[styles.engagementCount, { color: theme.text }]}>{comments.length}</Text>
                </View>
                <Pressable onPress={() => setIsSaved((prev) => !prev)} accessibilityLabel={isSaved ? "Unsave" : "Save"} accessibilityRole="button" style={styles.engagementAction}>
                  {isSaved ? <BookmarkCheck size={16} color={theme.text} /> : <Bookmark size={16} color={theme.text} />}
                </Pressable>
                <Pressable onPress={handleShare} accessibilityLabel="Share" accessibilityRole="button" style={styles.engagementAction}>
                  <Share2 size={16} color={theme.text} />
                </Pressable>
              </View>
              <View style={[styles.divider, { backgroundColor: theme.divider }]} />
              <View style={styles.authorCard}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{author.displayName.charAt(0)}</Text></View>
                <View style={styles.authorInfo}>
                  <Text style={[styles.authorName, { color: theme.text }]}>{author.displayName}</Text>
                  <Text style={[styles.authorBio, { color: theme.muted }]} numberOfLines={2}>{author.bio}</Text>
                </View>
                <Pressable onPress={() => setIsFollowing((prev) => !prev)} accessibilityLabel={isFollowing ? "Unfollow author" : "Follow author"} accessibilityRole="button" style={styles.followButton}>
                  <Text style={styles.followText}>{isFollowing ? "Following" : "Follow"}</Text>
                </Pressable>
              </View>
              <View style={[styles.divider, { backgroundColor: theme.divider }]} />
              <View style={styles.commentsSection}>
                <Text style={[styles.commentsTitle, { color: theme.text }]}>Comments ({comments.length})</Text>
                <View style={styles.commentInputRow}>
                  <TextInput
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="Add a comment..."
                    placeholderTextColor={theme.muted}
                    style={[styles.commentInput, { color: theme.text, borderColor: theme.divider }]}
                    multiline
                    maxLength={500}
                    accessibilityLabel="Add a comment"
                  />
                  <Pressable onPress={handleSubmitComment} accessibilityLabel="Submit comment" accessibilityRole="button" style={styles.commentSendBtn}>
                    <Send size={16} color={colors.surface} />
                  </Pressable>
                </View>
                {comments.map((comment) => (
                  <View key={comment.id} style={[styles.commentItem, { borderTopColor: theme.divider }]}>
                    <Text style={[styles.commentUser, { color: theme.text }]}>{comment.user}</Text>
                    <Text style={[styles.commentTime, { color: theme.muted }]}>{comment.time}</Text>
                    <Text style={[styles.commentText, { color: theme.text }]}>{comment.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <ReaderChrome
        visible={chromeVisible}
        storyTitle={story.title}
        pageIndex={pageIndex}
        pageCount={pages.length}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchMatchCount={searchMatches.length}
        activeSearchMatch={activeSearchMatch}
        onBack={onBack}
        onSearchOpen={() => {
          setChromeVisible(true);
          setSearchOpen(true);
        }}
        onSearchClose={() => setSearchOpen(false)}
        onSearchQueryChange={setSearchQuery}
        onSearchNext={() => jumpToMatch(1)}
        onSearchPrevious={() => jumpToMatch(-1)}
        onPageChange={goToPage}
        onPreferences={() => setPrefsOpen(true)}
        onChapters={() => setChaptersOpen(true)}
        onListen={() => setListenOpen(true)}
      />
      <PreferencesSheet
        visible={prefsOpen}
        preferences={preferences}
        onChange={updatePreferences}
        onClose={() => setPrefsOpen(false)}
      />
      <ChaptersSheet
        visible={chaptersOpen}
        chapters={story.chapters}
        currentIndex={chapterIndex}
        onSelect={switchChapter}
        onClose={() => setChaptersOpen(false)}
      />
      <ListenSheet
        visible={listenOpen}
        isPlaying={isPlaying}
        hasBothVoices={hasBothVoices}
        femaleVoiceName={femaleVoice.name}
        maleVoiceName={maleVoice.name}
        voiceGender={voiceGender}
        onVoiceChange={handleVoiceChange}
        onPlay={handlePlayTap}
        onClose={() => setListenOpen(false)}
      />
    </View>
  );
}

function SheetFrame({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalScrim}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel={`Close ${title}`} accessibilityRole="button" hitSlop={8} style={styles.modalClose}>
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PreferencesSheet({ visible, preferences, onChange, onClose }: { visible: boolean; preferences: ReaderPreferences; onChange: (prefs: ReaderPreferences) => void; onClose: () => void }) {
  return (
    <SheetFrame visible={visible} title="Preferences" onClose={onClose}>
      <PreferenceRow label="Type size" values={TYPE_SIZES} value={preferences.typeSize} format={(value) => `${value}`} onChange={(typeSize) => onChange({ ...preferences, typeSize })} />
      <PreferenceRow label="Line height" values={LINE_HEIGHTS} value={preferences.lineHeight} format={(value) => `${value}`} onChange={(lineHeight) => onChange({ ...preferences, lineHeight })} />
      <Text style={styles.preferenceLabel}>Reading theme</Text>
      <View style={styles.segmentRow}>
        {Object.values(READER_THEMES).map((theme) => (
          <Pressable
            key={theme.name}
            onPress={() => onChange({ ...preferences, theme: theme.name })}
            accessibilityLabel={`Use ${theme.label} reading theme`}
            accessibilityRole="button"
            style={[styles.segmentButton, preferences.theme === theme.name && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentText, preferences.theme === theme.name && styles.segmentTextActive]}>{theme.label}</Text>
          </Pressable>
        ))}
      </View>
    </SheetFrame>
  );
}

function PreferenceRow({ label, values, value, format, onChange }: { label: string; values: readonly number[]; value: number; format: (value: number) => string; onChange: (value: number) => void }) {
  const index = Math.max(0, values.indexOf(value));
  return (
    <View style={styles.preferenceGroup}>
      <View style={styles.preferenceHeader}>
        <Text style={styles.preferenceLabel}>{label}</Text>
        <Text style={styles.preferenceValue}>{format(value)}</Text>
      </View>
      <View style={styles.stepperRow}>
        <Pressable onPress={() => onChange(values[Math.max(0, index - 1)] ?? value)} accessibilityLabel={`Decrease ${label}`} accessibilityRole="button" style={styles.stepperButton}>
          <Text style={styles.stepperText}>-</Text>
        </Pressable>
        <View style={styles.stepperTrack}>
          <View style={[styles.stepperFill, { width: `${(index / Math.max(1, values.length - 1)) * 100}%` }]} />
        </View>
        <Pressable onPress={() => onChange(values[Math.min(values.length - 1, index + 1)] ?? value)} accessibilityLabel={`Increase ${label}`} accessibilityRole="button" style={styles.stepperButton}>
          <Text style={styles.stepperText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChaptersSheet({ visible, chapters, currentIndex, onSelect, onClose }: { visible: boolean; chapters: readonly Chapter[]; currentIndex: number; onSelect: (index: number) => void; onClose: () => void }) {
  return (
    <SheetFrame visible={visible} title="Chapters" onClose={onClose}>
      {chapters.map((chapter, index) => (
        <Pressable
          key={chapter.id}
          onPress={() => onSelect(index)}
          accessibilityLabel={`Open chapter ${chapter.chapterNumber}: ${chapter.title}`}
          accessibilityRole="button"
          style={[styles.chapterRow, index === currentIndex && styles.chapterRowActive]}
        >
          <Text style={[styles.chapterNumber, index === currentIndex && styles.chapterRowTextActive]}>Chapter {chapter.chapterNumber}</Text>
          <Text style={[styles.chapterRowTitle, index === currentIndex && styles.chapterRowTextActive]}>{chapter.title}</Text>
          {index === currentIndex ? <Text style={styles.currentBadge}>Current</Text> : null}
        </Pressable>
      ))}
    </SheetFrame>
  );
}

function ListenSheet({ visible, isPlaying, hasBothVoices, femaleVoiceName, maleVoiceName, voiceGender, onVoiceChange, onPlay, onClose }: { visible: boolean; isPlaying: boolean; hasBothVoices: boolean; femaleVoiceName: string; maleVoiceName: string; voiceGender: "female" | "male"; onVoiceChange: (gender: "female" | "male") => void; onPlay: () => void; onClose: () => void }) {
  return (
    <SheetFrame visible={visible} title="Listen" onClose={onClose}>
      <Pressable onPress={onPlay} accessibilityLabel={isPlaying ? "Pause narration" : "Play narration"} accessibilityRole="button" style={styles.listenButton}>
        {isPlaying ? <Pause size={18} color={colors.surface} /> : <Play size={18} color={colors.surface} />}
        <Text style={styles.listenButtonText}>{isPlaying ? "Pause" : "Play"}</Text>
      </Pressable>
      {hasBothVoices ? (
        <View style={styles.segmentRow}>
          <Pressable onPress={() => onVoiceChange("female")} accessibilityLabel={`Use ${femaleVoiceName} voice`} accessibilityRole="button" style={[styles.segmentButton, voiceGender === "female" && styles.segmentButtonActive]}>
            <Text style={[styles.segmentText, voiceGender === "female" && styles.segmentTextActive]}>{femaleVoiceName}</Text>
          </Pressable>
          <Pressable onPress={() => onVoiceChange("male")} accessibilityLabel={`Use ${maleVoiceName} voice`} accessibilityRole="button" style={[styles.segmentButton, voiceGender === "male" && styles.segmentButtonActive]}>
            <Text style={[styles.segmentText, voiceGender === "male" && styles.segmentTextActive]}>{maleVoiceName}</Text>
          </Pressable>
        </View>
      ) : null}
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  reader: { flex: 1 },
  centerTapZone: {
    position: "absolute",
    top: "22%",
    bottom: "22%",
    left: "24%",
    right: "24%",
    zIndex: 10,
  },
  scrollContent: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.huge * 2,
  },
  shell: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  shellDesktop: {
    paddingTop: spacing.xl,
  },
  coverWrap: {
    width: 94,
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    overflow: "hidden",
    alignSelf: "center",
    backgroundColor: colors.surface2,
  },
  coverImage: { width: "100%", height: "100%" },
  genre: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,
    textAlign: "center",
    letterSpacing: 0,
  },
  author: {
    fontFamily: fonts.ui,
    fontSize: 14,
    textAlign: "center",
    letterSpacing: 0,
  },
  chapterTitle: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: 0,
  },
  pageFrame: {
    minHeight: 280,
  },
  pageText: {
    fontFamily: fonts.reader,
    letterSpacing: 0,
  },
  pageFooter: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0,
  },
  searchHighlight: {
    backgroundColor: colors.accentSoft,
  },
  activeSearchHighlight: {
    backgroundColor: colors.accent,
    color: colors.surface,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  engagementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  engagementAction: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  engagementCount: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  authorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 20,
    letterSpacing: 0,
  },
  authorInfo: { flex: 1 },
  authorName: {
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: 0,
  },
  authorBio: {
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  followButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  followText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  commentsSection: {
    gap: spacing.md,
  },
  commentsTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 0,
  },
  commentInputRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  commentInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
  },
  commentSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  commentItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  commentUser: {
    fontFamily: fonts.ui,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  commentTime: {
    fontFamily: fonts.ui,
    fontSize: 12,
    letterSpacing: 0,
  },
  commentText: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
  },
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
    letterSpacing: 0,
  },
  modalScrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,14,12,0.26)",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    letterSpacing: 0,
  },
  modalClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  preferenceGroup: {
    gap: spacing.sm,
  },
  preferenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preferenceLabel: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  preferenceValue: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    letterSpacing: 0,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0,
  },
  stepperTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.track,
  },
  stepperFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  segmentRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  segmentButtonActive: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  segmentText: {
    fontFamily: fonts.ui,
    color: colors.strong,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  segmentTextActive: {
    color: colors.accentPressed,
  },
  chapterRow: {
    minHeight: 58,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  chapterRowActive: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  chapterNumber: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  chapterRowTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 17,
    letterSpacing: 0,
  },
  chapterRowTextActive: {
    color: colors.accentPressed,
  },
  currentBadge: {
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
    fontFamily: fonts.ui,
    color: colors.accentPressed,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  listenButton: {
    minHeight: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  listenButtonText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
  },
});
