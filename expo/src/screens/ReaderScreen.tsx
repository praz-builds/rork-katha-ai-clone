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
  Animated as RNAnimated,
  BackHandler,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import { MusicPicker } from "@/components/reader/MusicPicker";
import { EditStoryScreen, type SavedChapterEdit } from "@/components/reader/EditStoryScreen";
import { ReaderChrome } from "@/components/reader/ReaderChrome";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import { ReimagineSheet } from "@/components/reader/ReimagineSheet";
import { startReimagine, type ReimagineRequest, type ReimagineRun } from "@/lib/reimagine-client";
import { FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { imageAssets } from "@/data/images";
import { authorFor } from "@/data/seed";
import { getDefaultVoices, getVoice } from "@/data/voices";
import { captureError } from "@/lib/analytics";
import {
  chapterSaveState,
  dismissChapterSave,
  retryChapterSave,
  subscribeToChapterSaves,
  type ChapterSaveEntry,
} from "@/lib/chapter-save-queue";
import { fetchThread, formatRelativeTime, postComment } from "@/lib/comments";
import { findMusicTrack, MUSIC_TRACKS } from "@/lib/music-catalogue";
import { getStoryMusicTrackId, setStoryMusicTrackId } from "@/lib/music-storage";
import { normalizeText, pageIndexForOffset, paginateChapter, sentenceAnchorForOffset } from "@/lib/paginate";
import { splitWords } from "@/lib/sentence";
import {
  liveChapterFor,
  REFUND_NOTICE,
  retryGeneration,
  useGeneration,
} from "@/lib/generation-session";
import { isOwnStory } from "@/lib/ownership";
import {
  READER_THEMES,
  READING_THEME_ORDER,
  type ReaderTheme,
  type ReadingThemeName,
} from "@/lib/reading-themes";
import { colors, fonts, genreGradients, genreLabels, motion, radius, shadows, spacing, type } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

type ReaderComment = { id: string; user: string; text: string; time: string };

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
  /**
   * Rendered at the end of the last page, with the chapter ON SCREEN.
   *
   * The seam fires at the last page of EVERY chapter, not only the story's
   * newest, so the callback needs the chapter actually being read rather than
   * whatever a navigation-time closure captured.
   *
   * `actions.reimagine` opens THIS screen's Reimagine sheet, and is null while
   * the chapter is still being written. A standalone story's ending is the one
   * place Reimagine is the only thing left to offer -- there is no next chapter
   * -- and the caller has no handle on the sheet, so without this the pill at
   * the end of a standalone was never rendered at all.
   */
  renderChapterEnd?: (
    chapter: Chapter,
    actions: { reimagine: (() => void) | null },
  ) => ReactNode;
  /** Extension point for phrase-level modules that need to replace individual words. */
  renderWord?: (word: string, index: number) => ReactNode;
  /**
   * Fired with the chapter now on screen, on mount and again every time the
   * reader switches chapters from the Chapters sheet. `chapterIndex` is
   * internal state a caller cannot otherwise observe, and phrase capture
   * needs to know which chapter a save belongs to.
   */
  onChapterChange?: (chapter: Chapter, chapterIndex: number) => void;
  /**
   * The reader was opened by Listen rather than Read, so narration starts on
   * arrival. Without it the story page's two buttons did the same thing and
   * Listen was indistinguishable from Read.
   */
  autoplay?: boolean;
  /**
   * The id of a generation session writing a chapter of THIS story, if one is
   * running. Present and the reader is live: settled pages appear behind the
   * reader as prose arrives, the chrome stays shut, and the last available page
   * says the chapter is still being written.
   *
   * The session itself lives in `@/lib/generation-session`, outside React, so
   * leaving this screen does not stop the writing and coming back shows the
   * same pages rather than starting over.
   */
  liveSessionId?: string | null;
  /**
   * Opens the Reimagine sheet.
   *
   * `ReaderChrome` renders a Reimagine control whenever this is supplied, for
   * every reader and not only the author (a reader of someone else's story
   * gets a private copy).
   */
  onReimagine?: () => void;
  /**
   * A Reimagine rewrite has started for the chapter on screen.
   *
   * The run is subscribable: `run.text` is the prose so far, `run.stage` and
   * `run.status` say where it is, and `run.promise` settles with the finished
   * chapter (or the private copy's `storyId`, for a non-author). A host that
   * owns the live-reader generation session takes it from here and re-enters
   * `writing-pages` for this chapter, so pages appear as they settle.
   *
   * When no handler is given this screen owns the wait itself: it covers the
   * reader until the run settles and then swaps the whole chapter in from
   * page 1.
   */
  onReimagineStarted?: (run: ReimagineRun) => void;
  /**
   * Open the full-screen narration player on the chapter being read.
   *
   * Supplied and the chrome's Listen control hands off to `ListenScreen`, which
   * owns the wait while narration is generated. Omitted and the reader keeps
   * its own inline Listen sheet, which can only ever play narration that
   * already exists.
   */
  onListen?: (chapterIndex: number) => void;
  /**
   * The viewer has no account, so anything that writes to somebody else's
   * story is gated.
   *
   * READING IS NEVER GATED. Turning pages, preferences, search, narration and
   * phrase capture all stay open to a guest, because none of them puts the
   * guest's name on anything. Liking, saving, following and commenting do, and
   * a guest who taps one gets the sign-in prompt rather than a local state
   * change that will be silently lost -- or worse, a control that appears to
   * work and does nothing.
   *
   * The control stays VISIBLE and enabled in both cases. A hidden Like is a
   * feature the guest never learns exists; a disabled one is a dead end. A
   * prompt is a door.
   *
   * Supply `onRequireSignIn` to gate. Omitted, nothing is gated -- which is
   * what a signed-in session passes.
   */
  onRequireSignIn?: () => void;
};

const READER_PREFS_KEY = "katha.reader.preferences.v1";
/**
 * The reader opens in a reading mode, not on a white page.
 *
 * `paper` (#FAF7F2) is a near-white surface: on a phone at night it reads as
 * the same bright rectangle as every other screen in the app, which is the
 * specific complaint -- no differentiation, no sense of a page. `sepia` is
 * the warm cream this app's reading surface is supposed to be, so it is what
 * a reader who has never opened Preferences gets. `paper` stays as the
 * near-white option for anyone who prefers it; a stored preference always
 * wins over this default, so nobody's existing choice is overridden.
 */
const DEFAULT_PREFS: ReaderPreferences = { typeSize: 18, lineHeight: 30, theme: "sepia" };
/**
 * How many pages either side of the current one are rendered with real text.
 *
 * Every page of the chapter is mounted so the pager's scroll offsets line up
 * with the page indices, but only this neighbourhood renders words. A word is
 * a `TappableWord` with its own press handlers (phrase capture), so mounting a
 * whole 12-page chapter's worth at once would put roughly a thousand live
 * touch targets on screen to make two of them visible. One page either side
 * is enough for the next page to be drawn before the swipe lands on it.
 */

/**
 * "one", "two", ... for the page label.
 *
 * Spelled out up to twenty because that is where it stops reading as prose
 * and starts reading as data; beyond that the digits are clearer than the
 * words, and a chapter that long is rare enough not to matter.
 */
const PAGE_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
] as const;

function pageWord(page: number): string {
  return PAGE_WORDS[page - 1] ?? String(page);
}

/**
 * How many pages either side of the visible one render their prose.
 *
 * Was 1, and that produced the most visible bug in the reader: a blank page
 * with a page number under it. A page outside the window renders an empty
 * `<Text>`, and the window is centred on `visiblePage`, which used to be
 * updated only by `onMomentumScrollEnd`. That event does not fire for a
 * trackpad or mouse wheel at all, and lags a fast swipe on a phone -- so
 * jumping to page 3, whether by flinging or by dragging the page slider,
 * landed on a page whose body had never been asked to render. It said
 * "Page 3 of 9" over nothing.
 *
 * Two changes together fix it: the window now follows the live scroll offset
 * (see `handlePagerScroll`), and it is wider. Two is not expensive -- a page
 * body is one `<Text>` of about 600 characters -- and it means an ordinary
 * swipe always lands on prose that is already mounted.
 */
const PAGE_RENDER_WINDOW = 2;
/**
 * Roughly how tall the chapter opener is: the cover thumbnail (94 wide at 3:4,
 * so ~125), the genre line, the story title, the byline, the "Chapter N"
 * eyebrow, the chapter title, its rule, and the `spacing.sm` gaps the shell
 * puts between all of them.
 *
 * It is an estimate on purpose -- the real height depends on how many lines a
 * particular title wraps to, which is not known until layout. Handing it to
 * the paginator means page one gets a prose budget for the space it actually
 * has left rather than for a whole empty screen, so it fits instead of being
 * the one page the reader has to scroll. The per-page vertical scroller
 * absorbs whatever this estimate gets wrong.
 */
const CHAPTER_OPENER_HEIGHT = 300;
/** Full-volume level for background music when narration is not playing. */
const MUSIC_FULL_VOLUME = 1;
/** Ducked level while narration plays, so the two never compete at equal volume. */
const MUSIC_DUCKED_VOLUME = 0.18;
const TYPE_SIZES = [16, 18, 20, 22];
const LINE_HEIGHTS = [26, 30, 34, 38];



/*
  THERE ARE NO SEEDED COMMENTS. DO NOT ADD ANY.

  This module used to carry three hardcoded comments -- "Mira R.", "Dev S." and
  "Aanya K." discussing a lighthouse metaphor -- and they rendered on the last
  page of EVERY story. A brand-new story about a nurse in Kochi ended with
  three strangers admiring a lighthouse that does not appear in it, while the
  story detail page for the same story correctly said it had none. The reader
  was the only surface lying.

  Comments now come from `lib/comments.ts` (`fetchThread`), the same source the
  detail page reads, and a story with none says so.
*/

/**
 * Chapter text in the canonical, normalized coordinate space (see the
 * module comment above `normalizeText` in `@/lib/paginate`). `paginateChapter`
 * normalizes internally, so page offsets are already in this space; search
 * matches and sentence anchors are computed against this same normalized
 * string so an offset from one is safe to compare against a `PageSlice`
 * from the other. Normalizing here, once, keeps that in sync even when a
 * chapter's raw paragraphs carry leading whitespace or CRLF line endings.
 */
function chapterText(chapter: Chapter): string {
  return normalizeText(chapter.paragraphs.join("\n\n"));
}

/**
 * The exact inverse of `chapterText`'s `join("\n\n")`.
 *
 * A regex split that also drops empty results (the previous implementation
 * used `/\n\s*\n/` plus `.filter(Boolean)`) treats an intentionally blank
 * paragraph as noise to discard, which shifts the index of every paragraph
 * after it. The AI editor addresses paragraphs by that index
 * (`useChapterEditor.regenerate`), so a shifted index silently rewrites the
 * wrong paragraph. Splitting on the exact separator `join` used, with no
 * filtering, round-trips every paragraph - blank ones included - at its
 * original index.
 */
function splitChapterParagraphs(text: string): string[] {
  return text.split("\n\n");
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
  /**
   * The active reading mode, because a highlight is a pair with the page.
   *
   * The highlight used to be two hardcoded styles: `colors.accentSoft`
   * (#FFEFE2) behind body text that inherits `theme.text`. In Night mode that
   * is #F2EEE8 on #FFEFE2 -- a contrast ratio of 1.03:1, which is to say the
   * word a reader just searched for became invisible at the moment it was
   * found. The active match was 2.85:1, below AA in every mode.
   *
   * `reading-themes.test.ts` did not catch it because it checks the pairs the
   * theme declares (`text`, `muted`, `divider`) and the reader never rendered
   * body text on `theme.highlight` at all.
   */
  theme: ReaderTheme,
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
    const isActive = matchIndex === activeMatch;
    return (
      <Text
        key={`word-${index}`}
        style={[
          styles.searchHighlight,
          {
            backgroundColor: isActive ? theme.activeHighlight : theme.highlight,
            // The text colour is set explicitly on both. Inheriting
            // `theme.text` is what made the Night highlight disappear.
            color: isActive ? theme.activeHighlightText : theme.text,
          },
        ]}
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
  autoplay = false,
  liveSessionId = null,
  onReimagine,
  onReimagineStarted,
  onListen,
  onRequireSignIn,
}: ReaderScreenProps) {
  const author = authorFor(story.authorId);
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 768;
  const session = useGeneration(liveSessionId);
  /**
   * The story with the chapter being written folded into it.
   *
   * The chapter comes from the SESSION, not from the story prop: the prop is a
   * snapshot and the session is the thing that changes. Merged by chapter
   * number rather than appended, so a continuation that has already completed
   * and reached app state replaces the live copy instead of doubling it.
   */
  const chapters = useMemo(() => {
    if (!session) return story.chapters;
    const live = liveChapterFor(session);
    const at = story.chapters.findIndex(
      (item) => item.chapterNumber === live.chapterNumber,
    );
    if (at < 0) return [...story.chapters, live];
    const merged = story.chapters.slice();
    merged[at] = live;
    return merged;
  }, [session, story.chapters]);
  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex);
  const baseChapter = chapters[chapterIndex] ?? chapters[0];
  // A chapter this reading session has edited, keyed by chapter id. Ephemeral:
  // it lives only in this component's state, exactly like the AI editor's
  // one-step revert it is fed by - nothing here is a second source of truth
  // for what the server holds.
  const [chapterEdits, setChapterEdits] = useState<Record<string, string>>({});
  const [chapterTitleEdits, setChapterTitleEdits] = useState<Record<string, string>>({});
  const chapter = useMemo(() => {
    const edited = chapterEdits[baseChapter.id];
    const editedTitle = chapterTitleEdits[baseChapter.id];
    if (edited === undefined && editedTitle === undefined) return baseChapter;
    return {
      ...baseChapter,
      ...(edited === undefined
        ? {}
        : { paragraphs: splitChapterParagraphs(edited) }),
      ...(editedTitle === undefined ? {} : { title: editedTitle }),
    };
  }, [baseChapter, chapterEdits, chapterTitleEdits]);
  const isAuthor = isOwnStory(story);
  const isStandalone = story.storyMode === "standalone";
  /**
   * The live states of the reader, resolved for the chapter ON SCREEN.
   *
   * A session writes exactly one chapter, so a reader who flips back to an
   * earlier chapter of the same story is reading finished prose and gets the
   * whole chrome; only the chapter being written is gated.
   */
  const isWritingHere = session?.phase === "writing"
    && chapter.chapterNumber === session.chapterNumber;
  const hasFailedHere = session?.phase === "error"
    && chapter.chapterNumber === session.chapterNumber;
  /**
   * Edit and Reimagine appear here and nowhere earlier.
   *
   * The session phase is the primary gate, and the prose check behind it is
   * the backstop: a reader can reach a chapter that is still being written
   * from somewhere the session is not in scope -- opening the story from
   * Library while the studio mount is still streaming, say -- and there
   * `isWritingHere` is false even though the chapter is half a chapter. Both
   * controls rewrite prose, so neither may be offered against prose that is
   * not all there yet.
   */
  const chapterComplete = !isWritingHere && !hasFailedHere
    && chapterText(chapter).trim().length > 0;
  /** A bare title page: your own story, or one being written right now. */
  const bareOpener = Boolean(session) || isAuthor;
  const [editOpen, setEditOpen] = useState(false);
  // Reimagine (spec §4): the sheet, the prompt to restore after a failure,
  // the failure itself, and the "Saved to Your stories" toast for a reader
  // whose rewrite landed in a private copy.
  const [reimagineOpen, setReimagineOpen] = useState(false);
  const [reimaginePrompt, setReimaginePrompt] = useState("");
  const [reimagineError, setReimagineError] = useState<string | null>(null);
  const [reimagineWaiting, setReimagineWaiting] = useState(false);
  const [forkToast, setForkToast] = useState(false);
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
  const [musicPickerOpen, setMusicPickerOpen] = useState(false);
  const [musicTrackId, setMusicTrackId] = useState<string | null>(null);
  const musicSoundRef = useRef<Audio.Sound | null>(null);
  const isNarrationPlayingRef = useRef(isPlaying);
  /**
   * Bumped whenever the in-flight audio load is no longer wanted (the
   * chapter changed, or the screen unmounted) so a `createAsync` that
   * resolves late can tell it is stale and unload itself instead of being
   * assigned as the live sound and started.
   */
  const audioGenerationRef = useRef(0);
  const fullText = useMemo(() => chapterText(chapter), [chapter]);
  const theme = READER_THEMES[preferences.theme];
  const pageViewport = useMemo(() => ({
    width: Math.min(width, 680) - spacing.xl * 2,
    height: Math.max(260, height - (isDesktop ? 190 : 230)),
    firstPageOffset: CHAPTER_OPENER_HEIGHT,
  }), [height, isDesktop, width]);
  const allPages = useMemo(
    () => paginateChapter(fullText, pageViewport, {
      fontSize: preferences.typeSize,
      lineHeight: preferences.lineHeight,
    }),
    [fullText, pageViewport.height, pageViewport.width, preferences.lineHeight, preferences.typeSize],
  );
  /**
   * The pages the reader may actually see.
   *
   * While the chapter is being written the LAST page is the one the next
   * chunk lands in: `paginateChapter` absorbs a short trailing remainder into
   * it (`remaining <= target * 1.12`), so it grows and re-wraps as prose
   * arrives. Every page before it ends on a hard boundary and, because the
   * paginator walks greedily forward from character zero, is byte-identical
   * in every longer prefix -- it can never move again.
   *
   * So the rule is simply: while writing, do not draw the page that can still
   * change. That is the whole no-reflow guarantee, enforced in the one place
   * that knows the real page size, and it replaces the "wait for three
   * nominal pages" threshold that used to sit in `generation-session.ts` and
   * cost 16-29 seconds of the reader's wait to approximate the same promise
   * less well.
   *
   * When nothing has settled into a full page yet, the reader shows one empty
   * page -- the opener and the writing tail -- exactly as it did before any of
   * this. That empty page is why the slice below cannot simply return `[]`:
   * the pager, the slider and the search all index `pages`, and an empty array
   * would be a second shape for them all to handle.
   *
   * The `length > 1` guard this replaces was wrong in the one case it existed
   * for. With a single page it fell through to `allPages` and drew that page
   * -- the very page that can still grow -- so a chapter whose settled prose
   * fits one page reflowed under the reader, which is the whole thing this is
   * supposed to prevent.
   */
  const pages = useMemo(() => {
    if (!isWritingHere) return allPages;
    const fixed = allPages.slice(0, -1);
    return fixed.length > 0 ? fixed : [{ text: "", start: 0, end: 0 }];
  }, [allPages, isWritingHere]);
  const searchMatches = useMemo(() => findMatches(fullText, searchQuery), [fullText, searchQuery]);
  // The generated cover first, the bundled seed asset second.
  //
  // Both screens read only `story.coverImage`, which names a bundled asset and
  // by its own documentation "only ever belongs to a seed story". So every
  // story a user actually generated fell through to the genre gradient here and
  // on the story page, while the create studio -- which does read
  // `coverImageUrl` -- showed the real art. The cover appeared during creation
  // and then vanished the moment the writer opened their own story.
  const coverSource = story.coverImageUrl
    ? { uri: story.coverImageUrl }
    : story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const storyLang = story.language === "Spanish" ? "es" : "en";
  const voicePair = getDefaultVoices(storyLang);
  const femaleVoice = getVoice(voicePair[0] ?? "aria");
  const maleVoice = getVoice(voicePair[1] ?? "kai");
  const hasBothVoices = !!(chapter.audioUrls?.female && chapter.audioUrls?.male);

  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(false);
  const [comments, setComments] = useState<ReaderComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  /*
    THE OTHER HALF OF THE OPTIMISTIC SAVE.

    `EditStoryScreen` hands the writer their page back the instant they tap
    Save and lets `lib/chapter-save.ts` finish the request in the background.
    That is only honest if a refusal is shown, and by then the editor is gone --
    so the reader is where it lands. The queue holds the exact text, so Retry
    re-sends what the writer typed rather than what is on the page.

    Only a FAILURE surfaces. A successful background save says nothing, because
    the writer already saw the result: their words, on the page.
  */
  const [saveFailure, setSaveFailure] = useState<ChapterSaveEntry | null>(null);
  useEffect(() => {
    // Read once for the chapter being opened -- a save can fail while the
    // writer is elsewhere in the story -- then follow it.
    const current = chapterSaveState(chapter.id);
    setSaveFailure(current?.state === "failed" ? current : null);
    return subscribeToChapterSaves((entry) => {
      if (entry.chapterId !== chapter.id) return;
      setSaveFailure(entry.state === "failed" ? entry : null);
    });
  }, [chapter.id]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(READER_PREFS_KEY).then((raw) => {
      if (alive) setPreferences(readStoredPrefs(raw));
    });
    return () => {
      alive = false;
      audioGenerationRef.current += 1;
      if (soundRef.current) void soundRef.current.unloadAsync();
      // Leaving the story stops music too. This unmount cleanup is the only
      // place playback is torn down; a chapter or page change never reaches it.
      if (musicSoundRef.current) void musicSoundRef.current.unloadAsync();
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

  /**
   * The reader follows the chapter being written to it.
   *
   * A continuation fired from the end of chapter 3 must land the reader on
   * page 1 of chapter 4 - its opener, with the writing indicator under it -
   * not leave them on the last page of 3 watching nothing happen. Only while
   * the session is actually writing: once it completes, the Chapters sheet is
   * back in charge and forcing an index here would fight it.
   */
  const writingChapterNumber = session?.phase === "writing"
    ? session.chapterNumber
    : null;
  useEffect(() => {
    if (writingChapterNumber === null) return;
    const at = chapters.findIndex(
      (item) => item.chapterNumber === writingChapterNumber,
    );
    if (at < 0) return;
    setChapterIndex((current) => {
      if (current === at) return current;
      setPageIndex(0);
    setVisiblePage(0);
      setVisiblePage(0);
      setAnchorOffset(0);
      return at;
    });
  }, [chapters, writingChapterNumber]);

  // Restores the story's saved music choice (or "None") when the reader opens it.
  //
  // A reader can choose a track before this read resolves, and the restore then
  // overwrote their newer choice with the older saved one -- their music
  // changing under them a moment after they picked it. A choice made by the
  // person beats a value read from disk, always.
  const musicChosenByUserRef = useRef(false);
  useEffect(() => {
    let alive = true;
    musicChosenByUserRef.current = false;
    void getStoryMusicTrackId(story.id).then((trackId) => {
      if (alive && !musicChosenByUserRef.current) setMusicTrackId(trackId);
    });
    return () => {
      alive = false;
    };
  }, [story.id]);

  useEffect(() => {
    isNarrationPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Loads (or clears) the background-music sound whenever the chosen track
  // changes. Deliberately does not depend on chapterIndex or pageIndex, so
  // music keeps looping across page turns and chapter navigation.
  useEffect(() => {
    let cancelled = false;
    async function syncMusicTrack() {
      if (musicSoundRef.current) {
        const previous = musicSoundRef.current;
        musicSoundRef.current = null;
        await previous.unloadAsync();
      }
      const track = findMusicTrack(musicTrackId, MUSIC_TRACKS);
      if (!track) return;
      try {
        const { sound } = await Audio.Sound.createAsync(track.source, {
          shouldPlay: true,
          isLooping: true,
          volume: isNarrationPlayingRef.current ? MUSIC_DUCKED_VOLUME : MUSIC_FULL_VOLUME,
        });
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        musicSoundRef.current = sound;
        // Narration can start while `createAsync` is still pending. The ducking
        // effect keyed on `isPlaying` would have run already and found no sound
        // to duck, so the track then began at full volume over the narration.
        // Re-reading the current state here closes that window.
        const volumeNow = isNarrationPlayingRef.current
          ? MUSIC_DUCKED_VOLUME
          : MUSIC_FULL_VOLUME;
        await sound.setStatusAsync({ volume: volumeNow });
      } catch {
        // A catalogue row without a working asset (development-time state)
        // fails silently rather than breaking the reader.
      }
    }
    void syncMusicTrack();
    return () => {
      cancelled = true;
    };
  }, [musicTrackId]);

  // Ducks music under narration and restores it when narration stops.
  useEffect(() => {
    const music = musicSoundRef.current;
    if (!music) return;
    void music.setStatusAsync({ volume: isPlaying ? MUSIC_DUCKED_VOLUME : MUSIC_FULL_VOLUME });
  }, [isPlaying]);

  const updatePreferences = useCallback((next: ReaderPreferences) => {
    setPreferences(next);
    void AsyncStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
  }, []);

  const goToPage = useCallback((nextPage: number) => {
    const next = clampIndex(nextPage, pages.length);
    setPageIndex(next);
    // The render window moves with the jump rather than waiting for the
    // scroll to report back, so a slider drag lands on prose rather than on
    // an unrendered page.
    setVisiblePage(next);
    setAnchorOffset(pages[next]?.start ?? 0);
  }, [pages]);

  /**
   * The chapter is turned page by page, horizontally, not scrolled.
   *
   * The reader used to render one page inside a vertical `ScrollView`, so a
   * chapter read as a document you scroll to the bottom of and the "Pages"
   * control was the only way to move between pages at all. Now every page of
   * the chapter is laid out side by side in a `pagingEnabled` horizontal
   * scroller, one screen wide each, so a right-to-left swipe advances a page
   * and snaps.
   *
   * `pageIndex` stays the single source of truth for which page the reader is
   * on -- the slider, search jumps and chapter switches all still write to it,
   * and this ref records where the pager has actually been scrolled so the two
   * can be told apart. A swipe settles, reports its offset, and updates
   * `pageIndex`; without the ref the effect below would then treat that as an
   * external jump and animate the pager to where it already is.
   */
  const pagerRef = useRef<ScrollView | null>(null);
  const pagerPageRef = useRef(0);

  useEffect(() => {
    const target = clampIndex(pageIndex, pages.length);
    // Animated only when something other than the pager moved the page --
    // the Pages slider, a search hit, a chapter switch. Re-running for a
    // page the pager already sits on is a deliberate no-op scroll that keeps
    // the offset correct after a re-pagination (a type-size change) has
    // moved every page boundary underneath it.
    const animated = pagerPageRef.current !== target;
    pagerPageRef.current = target;
    pagerRef.current?.scrollTo({ x: target * width, y: 0, animated });
  }, [chapter.id, pageIndex, pages.length, width]);

  /**
   * The page the render window is centred on, updated on every scroll frame.
   *
   * Deliberately separate from `pageIndex`. `pageIndex` is the reader's
   * COMMITTED position -- it drives the slider, the reading anchor and the
   * chapter-end seam, and it should only move when a page turn settles.
   * `visiblePage` is just "what is under the viewport right now", which is
   * what deciding whether to render a page body actually needs. Keeping them
   * apart means the window can follow a finger mid-swipe without the anchor
   * being rewritten on every frame.
   */
  const [visiblePage, setVisiblePage] = useState(0);

  const handlePagerScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const layoutWidth = event.nativeEvent.layoutMeasurement?.width || width;
    if (layoutWidth <= 0) return;
    const next = clampIndex(
      Math.round(event.nativeEvent.contentOffset.x / layoutWidth),
      pages.length,
    );
    setVisiblePage((current) => (current === next ? current : next));
  }, [pages.length, width]);

  const handlePagerMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // The pager's own width, not the window's: they are the same on a phone,
    // but reading the measured value means a rotation or a split-view resize
    // mid-swipe still resolves to the right page instead of an offset
    // divided by a stale width.
    const layoutWidth = event.nativeEvent.layoutMeasurement?.width || width;
    if (layoutWidth <= 0) return;
    const next = clampIndex(Math.round(event.nativeEvent.contentOffset.x / layoutWidth), pages.length);
    pagerPageRef.current = next;
    setVisiblePage(next);
    if (next === pageIndex) return;
    setPageIndex(next);
    // Keeps the anchor in the same coordinate space the slider and search
    // write to, so a type-size change after a swipe re-lands on the sentence
    // the reader had actually reached rather than on page 0.
    setAnchorOffset(pages[next]?.start ?? 0);
  }, [pageIndex, pages, width]);

  /**
   * Android's hardware back dismisses the controls overlay before it leaves
   * the story. A reader who taps to open the controls and then presses back
   * means "put those away", and falling straight through to the navigator
   * threw them out of the chapter instead, costing a trip back in to carry
   * on reading.
   *
   * When nothing is open the press must LEAVE THE READER, not fall through.
   * This returned `false` on the reasoning that the navigator would handle it
   * -- but there is no navigator. Screens are a `useState` switch in
   * `App.tsx`, so `false` runs Android's platform default, which finishes the
   * activity: the reader's back button closed the whole app. That became much
   * easier to hit in the same change that made the chrome start hidden, since
   * the reader now opens with no visible back control at all and the hardware
   * button is the first thing an Android reader reaches for.
   */
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (chromeVisible) {
        setChromeVisible(false);
        return true;
      }
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [chromeVisible, searchOpen, onBack]);

  const switchChapter = useCallback((nextIndex: number) => {
    if (nextIndex === chapterIndex) return;
    audioGenerationRef.current += 1;
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
        const generation = audioGenerationRef.current;
        const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: true }, (status) => {
          if (status.isLoaded && status.didJustFinish) setIsPlaying(false);
        });
        if (generation !== audioGenerationRef.current) {
          // The chapter changed (or the screen unmounted) while this load was
          // in flight. Discard it instead of assigning it as the live sound,
          // so the reader never hears narration for a chapter they left.
          isLoadingAudioRef.current = false;
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setIsPlaying(true);
        isLoadingAudioRef.current = false;
      }
    } catch (error) {
      isLoadingAudioRef.current = false;
      // Identifiers and enums only -- never the story's own text. This is
      // the client-visible half of narration alerting; the harder half (a
      // RunPod job failing or timing out server-side) is reported from the
      // edge functions themselves, since a backend timeout never reaches
      // this catch block at all.
      captureError({
        bucket: "generation.audio",
        severity: "medium",
        errorCode: error instanceof Error ? error.name : "playback_error",
        error,
        context: {
          story_id: story.id,
          chapter_id: chapter.id,
          voice_gender: voiceGender,
        },
      });
      Alert.alert("Playback error", "Could not play audio. Please try again.");
      setIsPlaying(false);
    }
  }, [getAudioUrl, isPlaying, story.id, chapter.id, voiceGender]);


  // Listen opens the reader already playing. Guarded by a ref so it fires once
  // per arrival, and it reuses `handlePlayTap` on purpose so autoplay cannot
  // drift from what the control does, including its honest answer for a story
  // whose narration does not exist yet.
  const autoplayFiredRef = useRef(false);
  useEffect(() => {
    if (!autoplay || autoplayFiredRef.current) return;
    autoplayFiredRef.current = true;
    setListenOpen(true);
    void handlePlayTap();
  }, [autoplay, handlePlayTap]);
  const handleVoiceChange = useCallback(async (gender: "female" | "male") => {
    if (gender === voiceGender || isLoadingAudioRef.current) return;
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setIsPlaying(false);
    setVoiceGender(gender);
  }, [voiceGender]);

  const handleMusicSelect = useCallback((trackId: string | null) => {
    // Marks the choice as the reader's, so a slower restore cannot undo it.
    musicChosenByUserRef.current = true;
    setMusicTrackId(trackId);
    void setStoryMusicTrackId(story.id, trackId);
  }, [story.id]);
  const closeEditor = useCallback((saved: SavedChapterEdit | null) => {
    setEditOpen(false);
    if (!saved) return;
    setChapterEdits((prev) => ({ ...prev, [baseChapter.id]: saved.content }));
    setChapterTitleEdits((prev) => ({ ...prev, [baseChapter.id]: saved.title }));
  }, [baseChapter.id]);

  const handleReimagineSubmit = useCallback((request: ReimagineRequest) => {
    setReimagineOpen(false);
    setReimagineError(null);
    setReimaginePrompt("");
    const run = startReimagine(request);
    if (onReimagineStarted) {
      onReimagineStarted(run);
      return;
    }
    // No host is holding the run, so this screen holds it. It has no
    // page-by-page mechanism of its own, so it covers the reader until the
    // rewrite settles rather than showing prose arriving mid-sentence.
    setReimagineWaiting(true);
    const chapterId = baseChapter.id;
    run.promise.then(
      (result) => {
        setReimagineWaiting(false);
        setChapterEdits((prev) => ({ ...prev, [chapterId]: result.chapter.paragraphs.join("\n\n") }));
        setPageIndex(0);
        setVisiblePage(0);
      setVisiblePage(0);
        if (result.forked) {
          setForkToast(true);
          setTimeout(() => setForkToast(false), 2500);
        }
      },
      (error: unknown) => {
        // The chapter on screen was never replaced, so there is nothing to
        // restore; the sheet reopens with the prompt intact and the reason.
        setReimagineWaiting(false);
        setReimaginePrompt(request.prompt);
        setReimagineError(
          error instanceof Error ? error.message : "The rewrite failed. Please try again.",
        );
        setReimagineOpen(true);
      },
    );
  }, [baseChapter.id, onReimagineStarted]);

  /**
   * Reimagine, as the chapter-end module may offer it.
   *
   * The same control the chrome carries, resolved the same way: the host's
   * handler if it supplied one, otherwise this screen's own sheet. Null while
   * the chapter is unfinished, because there is nothing complete to rewrite.
   */
  const chapterEndReimagine = useMemo(
    () =>
      chapterComplete
        ? (onReimagine ?? (() => setReimagineOpen(true)))
        : null,
    [chapterComplete, onReimagine],
  );

  /*
    The real thread, for THIS story, from the same endpoint the detail page
    reads. A story with no comments gets an empty state saying so rather than
    three seeded strangers.

    A failure is treated as "none yet" on purpose. This is a preview at the foot
    of a page of prose, not the comments product; an error row here would be the
    loudest thing on the page, and the reader loses nothing they were promised.
  */
  useEffect(() => {
    let alive = true;
    setCommentsLoaded(false);
    setComments([]);
    fetchThread(story.id).then(
      (rows) => {
        if (!alive) return;
        const now = Date.now();
        setComments(
          rows
            .filter((row) => !row.deleted)
            .map((row) => ({
              id: row.id,
              user: row.authorName,
              text: row.body,
              time: formatRelativeTime(Date.parse(row.createdAt), now),
            })),
        );
        setCommentsLoaded(true);
      },
      () => {
        if (alive) setCommentsLoaded(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [story.id]);

  /**
   * Every engagement control routes through this.
   *
   * Returns true when the tap was swallowed by the sign-in prompt, so a caller
   * reads as `if (requireSignIn()) return;` -- one line, impossible to leave off
   * half a handler.
   */
  const requireSignIn = useCallback((): boolean => {
    if (!onRequireSignIn) return false;
    onRequireSignIn();
    return true;
  }, [onRequireSignIn]);

  const handleLike = useCallback(() => {
    if (requireSignIn()) return;
    setIsLiked((prev) => {
      setLikeCount((count) => prev ? count - 1 : count + 1);
      return !prev;
    });
  }, [requireSignIn]);

  const handleToggleSaved = useCallback(() => {
    if (requireSignIn()) return;
    setIsSaved((prev) => !prev);
  }, [requireSignIn]);

  const handleToggleFollow = useCallback(() => {
    if (requireSignIn()) return;
    setIsFollowing((prev) => !prev);
  }, [requireSignIn]);

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

  /*
    The comment is POSTED, not just prepended.

    This composer read the real thread from `fetchThread` and then wrote
    nowhere: the comment appeared, an alert explained it was "saved locally",
    and it was gone on the next chapter change -- while `postComment`, the call
    the comments product itself uses, sat in the same module. The row appears
    immediately (optimistic, keyed `local-`) and is replaced by the server's
    own row when it lands; a refusal takes the row back out and says so, rather
    than leaving the reader looking at a comment nobody else will ever see.
  */
  const handleSubmitComment = useCallback(() => {
    if (requireSignIn()) return;
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const localId = `local-${Date.now()}`;
    setComments((prev) => [
      { id: localId, user: "You", text: trimmed, time: "just now" },
      ...prev,
    ]);
    setCommentText("");
    void postComment(story.id, trimmed, undefined, baseChapter.id).then(
      (posted) => {
        if (!posted) return;
        setComments((prev) =>
          prev.map((comment) =>
            comment.id === localId
              ? {
                id: posted.id,
                user: posted.authorName,
                text: posted.body,
                time: formatRelativeTime(Date.parse(posted.createdAt), Date.now()),
              }
              : comment
          )
        );
      },
      () => {
        setComments((prev) => prev.filter((comment) => comment.id !== localId));
        setCommentText(trimmed);
        Alert.alert(
          "Comment not posted",
          "Katha could not save your comment. Check your connection and try again.",
        );
      },
    );
  }, [baseChapter.id, commentText, requireSignIn, story.id]);

  const jumpToMatch = useCallback((direction: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (activeSearchMatch + direction + searchMatches.length) % searchMatches.length;
    setActiveSearchMatch(next);
    const anchor = sentenceAnchorForOffset(fullText, searchMatches[next].start);
    setAnchorOffset(anchor);
    setPageIndex(pageIndexForOffset(pages, searchMatches[next].start));
  }, [activeSearchMatch, fullText, pages, searchMatches]);

  const activeGlobalMatch = searchMatches[activeSearchMatch];

  // Words before each page, so `renderWord` can be handed a chapter-absolute
  // index. Derived from each page's own character offset using the shared
  // tokenizer, so it cannot disagree with how the words are actually split.
  //
  // This is an array rather than a single value because the pager mounts
  // several pages at once: a page-local index would make two simultaneously
  // mounted pages both start their words at 0, and phrase capture keys its
  // saved-word state on that index.
  const pageWordStarts = useMemo(
    () => pages.map((slice) => splitWords(fullText.slice(0, slice.start)).length),
    [fullText, pages],
  );
  const lastPageIndex = pages.length - 1;
  const isLastPage = pageIndex === lastPageIndex;

  const renderPageBody = (index: number) => {
    const slice = pages[index];
    const matchesOnPage = searchMatches.filter((match) => match.start < slice.end && match.end > slice.start);
    const activeOnPage = activeGlobalMatch
      ? matchesOnPage.findIndex((match) => match.start === activeGlobalMatch.start && match.end === activeGlobalMatch.end)
      : -1;
    return renderPageWords(
      slice.text,
      slice.start,
      pageWordStarts[index] ?? 0,
      matchesOnPage,
      activeOnPage,
      renderWord,
      theme,
    );
  };

  return (
    <View style={[styles.reader, { backgroundColor: theme.background }]}>
      {/*
        This wraps the scrollable page instead of floating an absolutely
        positioned layer on top of it. A sibling overlay in front of the
        content would intercept every touch in its bounds before it ever
        reached the text underneath, which broke word-level tap targets and
        native text selection. As the ScrollView's ancestor, this Pressable
        only fires when nothing inside it (a word, a button, a text field)
        has already claimed the touch, so it captures a background tap
        without capturing taps meant for the page.
      */}
      <Pressable
        accessibilityLabel="Toggle reader controls"
        accessibilityRole="button"
        style={styles.readingArea}
        onPress={() => {
          // Nothing in the chrome operates on prose that does not exist yet,
          // so a tap while the chapter is still being written is deliberately
          // inert rather than raising a sheet of controls the writer cannot
          // use. It starts working the instant the chapter lands.
          if (isWritingHere) return;
          setChromeVisible((visible) => !visible);
        }}
      >
        <ScrollView
          ref={pagerRef}
          testID="reader-pager"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handlePagerMomentumEnd}
          onScroll={handlePagerScroll}
          scrollEventThrottle={16}
        >
          {pages.map((slice, index) => {
            // Centred on what is on screen, not on the committed page: see
            // PAGE_RENDER_WINDOW. Either being close enough is sufficient, so
            // a page is mounted whether the reader arrived by swiping, by
            // dragging the slider, or by a jump that has not settled yet.
            const withinWindow =
              Math.abs(index - visiblePage) <= PAGE_RENDER_WINDOW
              || Math.abs(index - pageIndex) <= PAGE_RENDER_WINDOW;
            // The end-of-chapter seam fires on ARRIVAL at the last page, not
            // on the last page merely being mounted. Every page of the chapter
            // is mounted for the pager's benefit, so gating on `index ===
            // lastPageIndex` alone would open the branching module the instant
            // the chapter opened, before the reader had read a word of it.
            const showsChapterEnd = index === lastPageIndex && isLastPage
              && chapterComplete;
            // The writing indicator rides the LAST AVAILABLE page, whichever
            // page that is, not the page the reader happens to be on: it is a
            // statement about where the chapter currently ends, and the reader
            // can see it coming as they turn toward it.
            const showsWritingTail = index === lastPageIndex && isWritingHere;
            const showsFailureTail = index === lastPageIndex && hasFailedHere;
            return (
              <View key={`${chapter.id}-page-${index}`} style={[styles.page, { width }]}>
                {/*
                  Each page keeps a vertical scroller of its own purely as an
                  overflow valve: pagination is an estimate from character
                  counts, and the last page also carries the end-of-chapter
                  module, engagement bar and comments, which cannot fit a
                  single screen. Body text on a normal page is sized to fit,
                  so this never actually scrolls there.
                */}
                {/* `keyboardShouldPersistTaps` so the chapter-end composer's
                  * Continue button takes the first tap. Without it a tap with
                  * the keyboard up is spent dismissing the keyboard, and the
                  * reader has to press a paid button twice. */}
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scrollContent}
                  /*
                    Bounded by the page, so it can actually scroll.

                    Without a height this scroller sized itself to its own
                    content, which means it never had anything to scroll --
                    content simply grew past the bottom of the screen and was
                    clipped. That is why the chapter-end module was cut off:
                    the last page carries "What's next?", the direction chips,
                    the engagement row and the comments, and none of it can
                    fit one screen. `flex: 1` makes the scroller exactly one
                    page tall, which is the whole point of an overflow valve.
                  */
                  style={styles.pageScroll}
                >
                  <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
                    {index === 0 ? (
                      /*
                        Two openers, and the difference is whose story it is.

                        Your own story opens on a bare title page: the story's
                        title, and under it the chapter's. You already know the
                        genre, you already know who wrote it, and you have just
                        watched the cover being made - repeating all three is
                        the app talking about itself on the page where the
                        writing is supposed to start. Somebody ELSE's story is
                        a thing you are deciding to read, so it keeps the
                        cover, the genre and the byline.

                        The "Chapter N" eyebrow is gone from both. The number
                        lives in the chrome and the Chapters sheet, where it is
                        a way to navigate rather than a label on prose.
                      */
                      <>
                        {bareOpener ? null : (
                          <>
                            <View style={styles.coverWrap}>
                              {coverSource ? (
                                <FocalImage source={coverSource} focalX={story.focalX ?? 0.5} focalY={story.focalY ?? 0.5} style={styles.coverImage} />
                              ) : (
                                <LinearGradient colors={genreGradients[story.genre]} style={StyleSheet.absoluteFill} />
                              )}
                            </View>
                            <Text style={[styles.genre, { color: theme.muted }]}>{genreLabels[story.genre]}</Text>
                          </>
                        )}
                        <Text style={[styles.title, { color: theme.text }]}>{story.title}</Text>
                        {bareOpener ? null : (
                          <Text style={[styles.author, { color: theme.muted }]}>by <Text style={{ color: theme.text }}>{author.displayName}</Text></Text>
                        )}
                        {/* One title for a standalone: the story IS the
                            chapter, and printing its name twice reads as a
                            mistake. */}
                        {isStandalone ? null : (
                          <Text style={[styles.chapterTitle, { color: theme.text }]}>
                            {chapter.title || `Chapter ${chapter.chapterNumber}`}
                          </Text>
                        )}
                        <View style={[styles.chapterRule, { backgroundColor: theme.divider }]} />
                      </>
                    ) : null}
                    <View style={styles.pageFrame}>
                      <Text
                        testID={`reader-page-body-${index}`}
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
                        {withinWindow ? renderPageBody(index) : null}
                      </Text>
                      {showsWritingTail ? <WritingTail theme={theme} /> : null}
                      {showsFailureTail ? (
                        <View style={styles.failureTail}>
                          <Text style={[styles.failureText, { color: theme.muted }]}>
                            {REFUND_NOTICE}
                          </Text>
                          <Pressable
                            onPress={() => {
                              if (session) retryGeneration(session.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Retry"
                            hitSlop={8}
                            style={styles.failureRetry}
                          >
                            <Text style={styles.failureRetryText}>Retry</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {showsChapterEnd
                        ? renderChapterEnd?.(chapter, { reimagine: chapterEndReimagine })
                        : null}
                    </View>
                    {/*
                      The page number lives OUTSIDE this scroller -- see the
                      pinned footer below the ScrollView. Keeping it in the
                      content flow put it directly under the last line of
                      prose, so it sat at a different height on every page and
                      the eye had to hunt for it.
                    */}
                    {showsChapterEnd ? (
                      <View>
                      {shareToast ? (
                        <View style={styles.shareToast}>
                          <Text style={styles.shareToastText}>Copied to clipboard!</Text>
                        </View>
                      ) : null}
                      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
                      <View style={styles.engagementRow}>
                        <Pressable onPress={handleLike} accessibilityLabel={`Like, ${formatNumber(likeCount)}`} accessibilityRole="button" testID="reader-like" style={styles.engagementAction}>
                          <Heart size={16} color={isLiked ? colors.heart : theme.text} fill={isLiked ? colors.heart : "none"} />
                          <Text style={[styles.engagementCount, { color: theme.text }]}>{formatNumber(likeCount)}</Text>
                        </Pressable>
                        <View style={styles.engagementAction}>
                          <MessageCircle size={16} color={theme.text} />
                          <Text style={[styles.engagementCount, { color: theme.text }]}>{comments.length}</Text>
                        </View>
                        <Pressable onPress={handleToggleSaved} accessibilityLabel={isSaved ? "Unsave" : "Save"} accessibilityRole="button" testID="reader-save" style={styles.engagementAction}>
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
                        <Pressable onPress={handleToggleFollow} accessibilityLabel={isFollowing ? "Unfollow author" : "Follow author"} accessibilityRole="button" testID="reader-follow" style={styles.followButton}>
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
                          <Pressable onPress={handleSubmitComment} accessibilityLabel="Submit comment" accessibilityRole="button" testID="reader-comment-send" style={styles.commentSendBtn}>
                            <Send size={16} color={colors.surface} />
                          </Pressable>
                        </View>
                        {/* The honest empty state. It waits for the fetch to
                          * settle rather than flashing "No comments yet" at a
                          * story that has forty. */}
                        {commentsLoaded && comments.length === 0 ? (
                          <Text
                            style={[styles.commentsEmpty, { color: theme.muted }]}
                            testID="reader-comments-empty"
                          >
                            No comments yet. Be the first to say something.
                          </Text>
                        ) : null}
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
                {/*
                  The page number, pinned to the page rather than trailing the
                  prose.

                  "Page one", not "Page 1 of 9": the total is a moving number
                  while a chapter is being written, and watching it climb from
                  4 to 9 as you read reads like the book is growing under you.
                  The page you are on is the only part of that a reader needs.
                  The "· writing" suffix is gone for the same reason -- the
                  writing tail already says so, in the one place where it is
                  actually happening.
                */}
                <Text
                  style={[styles.pageFooter, { color: theme.muted }]}
                  testID={`reader-page-label-${index}`}
                >
                  Page {pageWord(index + 1)}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </Pressable>
      <ReaderChrome
        visible={chromeVisible && chapterComplete}
        storyTitle={story.title}
        chapterTitle={isStandalone ? undefined : chapter.title}
        isPlaying={isPlaying}
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
        // `onHistory` is deliberately left unwired, and the control is gone
        // from the chrome: there is no persisted version history to show.
        //
        // Edit is the author's, and only over a chapter that is finished.
        // Reimagine is everyone's - a reader of someone else's story gets a
        // private copy (spec §4) - and is likewise offered only once there is
        // a whole chapter to reimagine. Both are ABSENT rather than disabled
        // before that: a greyed control mid-generation is a question the
        // writer cannot answer.
        onEdit={isAuthor && chapterComplete ? () => setEditOpen(true) : undefined}
        // A host may own the sheet; by default this screen opens its own.
        onReimagine={chapterComplete
          ? (onReimagine ?? (() => setReimagineOpen(true)))
          : undefined}
        onPreferences={() => setPrefsOpen(true)}
        onChapters={() => setChaptersOpen(true)}
        onListen={onListen
          ? () => onListen(chapterIndex)
          : () => setListenOpen(true)}
        onMusic={() => setMusicPickerOpen(true)}
      />
      {/*
        Mounted only while open. The sheet reads the safe-area inset, and a
        reader rendered outside a `SafeAreaProvider` (every reader test, and
        any host that has not wrapped this screen) would throw on a hook it
        never needed to run for a closed sheet.
      */}
      {reimagineOpen ? (
        <ReimagineSheet
          visible
          story={story}
          chapter={chapter}
          isAuthor={isAuthor}
          initialPrompt={reimaginePrompt}
          errorMessage={reimagineError}
          onClose={() => setReimagineOpen(false)}
          onSubmit={handleReimagineSubmit}
        />
      ) : null}
      {/*
        The rewrite takes about a minute and arrives whole. This covers the
        reader for the whole of it - the same wait the create flow shows, so
        "Katha is writing a chapter" looks the same wherever it happens - and
        never implies measurable progress.
      */}
      {reimagineWaiting ? (
        <View style={StyleSheet.absoluteFill} accessibilityLabel="Reimagining this chapter">
          <GeneratingOverlay genre={story.genre} mode="chapter" />
        </View>
      ) : null}
      {forkToast ? (
        <View style={styles.forkToast} accessibilityLiveRegion="polite">
          <Text style={styles.shareToastText}>Saved to Your stories</Text>
        </View>
      ) : null}
      {saveFailure ? (
        <View style={styles.saveFailure} accessibilityRole="alert" testID="reader-save-failed">
          <Text style={styles.saveFailureText}>
            {saveFailure.error ?? "Your edit is on this device but Katha could not save it."}
          </Text>
          <View style={styles.saveFailureActions}>
            <Pressable
              onPress={() => retryChapterSave(saveFailure.chapterId)}
              accessibilityRole="button"
              accessibilityLabel="Retry saving your edit"
              testID="reader-save-retry"
              style={styles.saveFailureAction}
            >
              <Text style={styles.saveFailureRetry}>Retry</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                dismissChapterSave(saveFailure.chapterId);
                setSaveFailure(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss the save failure"
              testID="reader-save-dismiss"
              style={styles.saveFailureAction}
            >
              <Text style={styles.saveFailureDismiss}>Not now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {editOpen ? (
        <EditStoryScreen
          story={story}
          chapter={chapter}
          onClose={closeEditor}
        />
      ) : null}
      <PreferencesSheet
        visible={prefsOpen}
        preferences={preferences}
        onChange={updatePreferences}
        onClose={() => setPrefsOpen(false)}
      />
      <ChaptersSheet
        visible={chaptersOpen}
        chapters={chapters}
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
      <MusicPicker
        visible={musicPickerOpen}
        genre={story.genre}
        selectedTrackId={musicTrackId}
        onSelect={handleMusicSelect}
        onClose={() => setMusicPickerOpen(false)}
      />
      {/*
        REIMAGINE SHEET GOES HERE.

        The chrome's Reimagine control is already wired: it renders whenever the
        `onReimagine` prop is supplied and is offered to every reader, not only
        the author. To land the sheet, the Reimagine agent adds one piece of
        state in this component (`const [reimagineOpen, setReimagineOpen] =
        useState(false)`), passes `() => setReimagineOpen(true)` down as
        `onReimagine` from wherever this screen is rendered - or defaults the
        prop to it - and renders `<ReimagineSheet visible={reimagineOpen}
        story={story} chapter={chapter} onClose={() => setReimagineOpen(false)}
        />` right here, beside the other sheets. Nothing else in this file has
        to move.
      */}
    </View>
  );
}

/**
 * "Still writing..." - three dots and a line, under the last settled paragraph.
 *
 * Deliberately not a spinner, not a progress bar and not a percentage. None of
 * those are knowable - the model does not report how much of a chapter is left
 * - and all three turn reading into waiting. Three pulsing dots say the same
 * true thing a person says when they are mid-sentence, and the reader can go on
 * reading the pages already behind them while it is on screen.
 */
function WritingTail({ theme }: { theme: ReaderTheme }) {
  const pulse = useRef(new RNAnimated.Value(0.35)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, {
          toValue: 1,
          duration: motion.slow,
          useNativeDriver: true,
        }),
        RNAnimated.timing(pulse, {
          toValue: 0.35,
          duration: motion.slow,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.writingTail} accessibilityLabel="Still writing">
      <RNAnimated.View style={[styles.writingDots, { opacity: pulse }]}>
        {[0, 1, 2].map((dot) => (
          <View
            key={dot}
            style={[styles.writingDot, { backgroundColor: theme.muted }]}
          />
        ))}
      </RNAnimated.View>
      <Text style={[styles.writingCaption, { color: theme.muted }]}>
        Still writing...
      </Text>
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
      <Text style={styles.preferenceLabel}>Reading mode</Text>
      {/*
        Each mode shows its own page, not just its name.

        Five equal text buttons in a row would each be about 60pt wide and
        would tell a reader nothing: "Forest" and "Calm" are not words anyone
        can picture. A swatch painted in the mode's real background and text
        colours IS the preview, and it is honest by construction -- it cannot
        drift from what the page looks like, because it is drawn from the same
        two tokens the page is.
      */}
      <View style={styles.themeRow}>
        {READING_THEME_ORDER.map((name) => {
          const theme = READER_THEMES[name];
          const selected = preferences.theme === name;
          return (
            <Pressable
              key={name}
              onPress={() => onChange({ ...preferences, theme: name })}
              accessibilityLabel={`${theme.label} reading mode`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={styles.themeOption}
            >
              <View
                style={[
                  styles.themeSwatch,
                  { backgroundColor: theme.background, borderColor: theme.divider },
                  selected && styles.themeSwatchSelected,
                ]}
              >
                {/* "Aa" in the mode's own text colour: the contrast the reader
                    is choosing, shown rather than described. */}
                <Text style={[styles.themeSwatchSample, { color: theme.text }]}>Aa</Text>
              </View>
              <Text
                numberOfLines={1}
                style={[styles.themeOptionLabel, selected && styles.themeOptionLabelSelected]}
              >
                {theme.label}
              </Text>
            </Pressable>
          );
        })}
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
  readingArea: {
    flex: 1,
  },
  // One screen-wide column per page. The width is applied inline from
  // `useWindowDimensions` rather than `flex: 1`, because a horizontal
  // `pagingEnabled` scroller snaps to its own width and a flexed child would
  // collapse to its content instead of filling a page.
  page: {
    flexGrow: 0,
    flexShrink: 0,
    /* A column: the scroller takes the room that is left, the page label sits
       under it in its own strip. */
    flexDirection: "column",
    height: "100%",
  },
  pageScroll: { flex: 1 },
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
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: 0,
  },
  chapterRule: {
    width: 56,
    height: 2,
    borderRadius: 1,
    marginBottom: spacing.lg,
  },
  pageFrame: {
    minHeight: 280,
  },
  pageText: {
    fontFamily: fonts.reader,
    letterSpacing: 0,
  },
  /*
    Pinned to the bottom of the page box, so it is in the same place on every
    page instead of wherever that page's prose happened to end.
  */
  /*
    A row beneath the scroller, not an overlay on top of it.

    Absolutely positioning it over the page put it in the same place on every
    page -- which was the point -- but prose then slid underneath it as the
    page scrolled, and the last line of a full page sat behind the label. As
    the final child of a column whose scroller is `flex: 1`, it occupies its
    own strip at the foot of the page: same place on every page, and nothing
    can ever be drawn under it.
  */
  pageFooter: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0,
  },
  writingTail: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  writingDots: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  writingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  writingCaption: {
    ...type.caption,
    letterSpacing: 0,
  },
  failureTail: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  failureText: {
    ...type.caption,
    letterSpacing: 0,
    flexShrink: 1,
  },
  failureRetry: {
    minHeight: 44,
    justifyContent: "center",
  },
  failureRetryText: {
    ...type.caption,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0,
  },
  searchHighlight: {
    borderRadius: 3,
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
  saveFailure: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.huge,
    zIndex: 40,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    boxShadow: shadows.overlay,
  },
  saveFailureText: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.surface,
    letterSpacing: 0,
  },
  saveFailureActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  saveFailureAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
  },
  saveFailureRetry: {
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "800",
    color: colors.accent,
    letterSpacing: 0,
  },
  saveFailureDismiss: {
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "700",
    color: colors.tertiary,
    letterSpacing: 0,
  },
  commentsEmpty: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
    paddingVertical: spacing.sm,
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
  forkToast: {
    position: "absolute",
    bottom: spacing.huge,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
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
  themeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  themeOption: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  themeSwatch: {
    width: "100%",
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  themeSwatchSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  themeSwatchSample: {
    fontFamily: fonts.display,
    fontSize: 17,
  },
  themeOptionLabel: {
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0,
  },
  themeOptionLabelSelected: {
    color: colors.accentPressed,
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
