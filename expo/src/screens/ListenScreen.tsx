import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import { X } from "lucide-react-native";
import { FocalImage } from "@/components/KathaPrimitives";
import { NarrationLoader } from "@/components/listen/NarrationLoader";
import { PlayerBar, type PlaybackRate } from "@/components/listen/PlayerBar";
import { TranscriptView } from "@/components/listen/TranscriptView";
import { imageAssets } from "@/data/images";
import { getDefaultVoices, type VoiceId } from "@/data/voices";
import { preferredVoiceId } from "@/lib/voices";
import { captureError } from "@/lib/analytics";
import {
  canRetry,
  initialListenState,
  isWaiting,
  listenCopy,
  listenReducer,
  shouldPoll,
} from "@/lib/listen-machine";
import { pollNarration, requestNarration } from "@/lib/narration";
import {
  buildCues,
  buildTranscriptLines,
  cueIndexAt,
  cueStartMs,
} from "@/lib/transcript-sync";
import { colors, fonts, genreGradients, radius, spacing } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

/**
 * The narration player: one full screen, two faces.
 *
 * ## Why this exists
 *
 * Listen used to open a small sheet over the reader with a Play button on it.
 * Pressing it did nothing visible, because narration for a chapter nobody has
 * listened to does not exist yet -- it is generated on first play -- and the
 * sheet had no way to say so. The wait is real and belongs to the UI, so the UI
 * owns a screen for it.
 *
 * ## Face one: preparing
 *
 * Cover art at the top, then the loader on a solid ground with a status line
 * that advances through the *real* stages -- checking, requesting, generating,
 * and (only by the clock, and honestly labelled) taking longer than expected.
 * Every one of those transitions comes from `listenReducer` reacting to a real
 * server answer or to elapsed time; nothing on this screen is a fake progress
 * timer. See `lib/listen-machine.ts`.
 *
 * ## Face two: playing
 *
 * Cover art still at the top, the transcript following the audio with the
 * current line highlighted and the read lines dimmed, and the transport under
 * it. **The line timings are an approximation** derived from the measured file
 * duration and the length of each line -- see the header of
 * `lib/transcript-sync.ts` before treating them as alignment data.
 *
 * ## Leaving
 *
 * **Closing the screen stops the audio.** It is unloaded on unmount, so
 * narration never keeps playing behind the reader, the library or the tab bar.
 * That is the conservative choice while there is no lock-screen transport, no
 * background audio mode configured in `app.json`, and no mini-player anywhere
 * in the app to pause from: audio the user cannot see or stop is worse than
 * audio that ends. When a persistent mini-player exists this is the one place
 * to change.
 */

/** How often to ask `audio-status` how the job is going. */
const POLL_INTERVAL_MS = 2500;

/** How often to re-evaluate elapsed time while waiting. */
const TICK_INTERVAL_MS = 1000;

/**
 * Placeholder flavour copy under the honest status lines.
 *
 * Decorative and replaceable -- the designed message list drops in here. See
 * the seam note in `components/listen/NarrationLoader.tsx`.
 */
const PLACEHOLDER_MESSAGES = [
  "Every chapter is read fresh, once.",
  "After this, listening to it again is instant.",
] as const;

export type ListenScreenProps = {
  story: Story;
  /** Which chapter to open on. */
  initialChapterIndex?: number;
  /** Back to wherever Listen was pressed. */
  onClose: () => void;
};

function chapterParagraphs(chapter: Chapter | undefined): string[] {
  if (!chapter) return [];
  return chapter.paragraphs.filter((paragraph) => paragraph.trim().length > 0);
}

/** Narration already on the chapter row for this voice, if any. */
function existingAudioUrl(
  chapter: Chapter | undefined,
  voiceId: VoiceId,
  femaleVoice: VoiceId,
): string | undefined {
  if (!chapter) return undefined;
  const byGender = voiceId === femaleVoice
    ? chapter.audioUrls?.female
    : chapter.audioUrls?.male;
  return byGender ?? chapter.audioUrl;
}

export default function ListenScreen({
  story,
  initialChapterIndex = 0,
  onClose,
}: ListenScreenProps) {
  const insets = useSafeAreaInsets();
  const [chapterIndex, setChapterIndex] = useState(() =>
    Math.min(Math.max(initialChapterIndex, 0), Math.max(0, story.chapters.length - 1))
  );
  const chapter = story.chapters[chapterIndex];
  const [state, dispatch] = useReducer(listenReducer, initialListenState);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(1);

  const soundRef = useRef<Audio.Sound | null>(null);
  /**
   * Bumped whenever the work in flight is no longer wanted -- the chapter
   * changed, the reader retried, or the screen unmounted. Every async
   * continuation compares against it before touching state or assigning a
   * sound, so a late poll or a late load can never resurrect a chapter the
   * listener has already left. Same guard the reader uses for its own loads.
   */
  const runRef = useRef(0);

  const storyLang = story.language === "Spanish" ? "es" : "en";
  const [femaleVoice] = getDefaultVoices(storyLang) as VoiceId[];
  // The reader's chosen voice, from Audiobook voices in the profile, falling
  // back to the language default. Without this the picker was a setting
  // nothing consulted -- it stored a preference and every chapter was still
  // narrated in the default voice, which is worse than not offering the choice.
  //
  // Read asynchronously and applied when it arrives; `null` until then, which
  // is why narration waits for it rather than starting on the fallback and
  // switching. The machinery below is keyed by voice id, so this is the only
  // place that decides.
  const [preferred, setPreferred] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let alive = true;
    void preferredVoiceId().then((id) => {
      if (alive) setPreferred(id);
    });
    return () => {
      alive = false;
    };
  }, []);
  const voiceId: VoiceId = ((preferred ?? femaleVoice) ?? "aria") as VoiceId;

  const coverSource = story.coverImageUrl
    ? { uri: story.coverImageUrl }
    : story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;

  const lines = useMemo(
    () => buildTranscriptLines(chapterParagraphs(chapter)),
    [chapter],
  );
  /**
   * Cues from the MEASURED duration of the loaded file. `buildCues` takes real
   * timings when they exist; nothing produces them today, so this is the
   * proportional estimate documented in `lib/transcript-sync.ts`.
   */
  const cues = useMemo(() => buildCues(lines, durationMs), [durationMs, lines]);
  const activeLine = useMemo(
    () => cueIndexAt(cues, positionMs),
    [cues, positionMs],
  );

  const unloadSound = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // Unloading a sound that already failed to load throws; there is
        // nothing left to clean up and nothing to tell the listener.
      }
    }
  }, []);

  // Closing the screen stops the audio. See the header note.
  useEffect(() => {
    return () => {
      runRef.current += 1;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync();
    };
  }, []);

  const handleClose = useCallback(() => {
    runRef.current += 1;
    void unloadSound();
    onClose();
  }, [onClose, unloadSound]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (chaptersOpen) {
        setChaptersOpen(false);
        return true;
      }
      handleClose();
      return true;
    });
    return () => subscription.remove();
  }, [chaptersOpen, handleClose]);

  /**
   * Acquire narration for the current chapter.
   *
   * Runs on arrival and on every chapter change. The order is the order the
   * status line describes: look for narration that already exists, then ask for
   * it, then hand over to the poll below.
   */
  useEffect(() => {
    if (!chapter) return;
    const run = runRef.current + 1;
    runRef.current = run;
    void unloadSound();
    dispatch({ type: "open", at: Date.now() });

    const cached = existingAudioUrl(chapter, voiceId, femaleVoice ?? "aria");
    if (cached) {
      dispatch({ type: "cached", audioUrl: cached });
      return;
    }

    dispatch({ type: "requesting", at: Date.now() });
    void requestNarration({
      storyId: story.id,
      chapterId: chapter.id,
      voiceId,
    }).then((outcome) => {
      if (runRef.current !== run) return;
      dispatch({ type: "outcome", outcome, at: Date.now() });
    });
    // `state.attempt` is in the dependency list on purpose: Try again bumps it,
    // and that is what re-runs this whole acquisition rather than only nudging
    // the poll.
  }, [chapter, femaleVoice, state.attempt, story.id, unloadSound, voiceId]);

  /** Poll while a job is running. */
  useEffect(() => {
    if (!chapter || !shouldPoll(state.phase)) return;
    const run = runRef.current;
    const timer = setInterval(() => {
      void pollNarration({
        storyId: story.id,
        chapterId: chapter.id,
        voiceId,
      }).then((outcome) => {
        if (runRef.current !== run) return;
        dispatch({ type: "outcome", outcome, at: Date.now() });
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [chapter, state.phase, story.id, voiceId]);

  /** Advance elapsed time so `slow` and `overdue` can fire. */
  useEffect(() => {
    if (!isWaiting(state.phase)) return;
    const timer = setInterval(
      () => dispatch({ type: "tick", at: Date.now() }),
      TICK_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [state.phase]);

  /** Load and start the audio the moment there is a URL for it. */
  useEffect(() => {
    if (state.phase !== "ready" || !state.audioUrl || soundRef.current) return;
    const run = runRef.current;
    let created: Audio.Sound | null = null;

    void Audio.Sound.createAsync(
      { uri: state.audioUrl },
      { shouldPlay: true, rate, shouldCorrectPitch: true },
      (status) => {
        if (!status.isLoaded || runRef.current !== run) return;
        setIsPlaying(status.isPlaying);
        setPositionMs(status.positionMillis ?? 0);
        if (typeof status.durationMillis === "number") {
          setDurationMs(status.durationMillis);
        }
        if (status.didJustFinish) setIsPlaying(false);
      },
    ).then(({ sound }) => {
      created = sound;
      if (runRef.current !== run) {
        // The listener left this chapter while the file was loading. Discard
        // it rather than assigning it as the live sound and playing narration
        // for something they are no longer on.
        void sound.unloadAsync();
        return;
      }
      soundRef.current = sound;
      setIsPlaying(true);
    }).catch((error) => {
      if (runRef.current !== run) return;
      // Identifiers and enums only. Never the chapter's prose.
      captureError({
        bucket: "generation.audio",
        severity: "medium",
        errorCode: error instanceof Error ? error.name : "playback_error",
        error,
        context: {
          story_id: story.id,
          chapter_id: chapter?.id,
          voice_id: voiceId,
        },
      });
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", errorCode: "playback_failed" },
        at: Date.now(),
      });
    });

    return () => {
      // Only tears down a sound this effect itself created and never handed
      // over; the live sound is unloaded by `unloadSound` and by unmount.
      if (created && soundRef.current !== created) {
        void created.unloadAsync();
      }
    };
    // `rate` is deliberately absent: changing speed must not reload the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, state.audioUrl, state.phase, story.id, voiceId]);

  const handleTogglePlay = useCallback(() => {
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlaying) {
      void sound.pauseAsync();
      setIsPlaying(false);
    } else {
      void sound.playAsync();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleSeek = useCallback((nextMs: number) => {
    const clamped = durationMs > 0
      ? Math.min(durationMs, Math.max(0, nextMs))
      : Math.max(0, nextMs);
    // Optimistic, so the scrubber and the highlight move with the finger
    // rather than waiting a status callback behind it.
    setPositionMs(clamped);
    void soundRef.current?.setPositionAsync(clamped);
  }, [durationMs]);

  const handleSeekToLine = useCallback((index: number) => {
    const startMs = cueStartMs(cues, index);
    if (startMs === null) return;
    handleSeek(startMs);
  }, [cues, handleSeek]);

  const handleRateChange = useCallback((next: PlaybackRate) => {
    setRate(next);
    void soundRef.current?.setRateAsync(next, true);
  }, []);

  const goToChapter = useCallback((next: number) => {
    if (next < 0 || next >= story.chapters.length || next === chapterIndex) {
      setChaptersOpen(false);
      return;
    }
    setChaptersOpen(false);
    setChapterIndex(next);
  }, [chapterIndex, story.chapters.length]);

  const hasNextChapter = chapterIndex < story.chapters.length - 1;
  const copy = listenCopy(state.phase);

  /**
   * The way out of a wait that went wrong.
   *
   * `unavailable` never gets Try again -- the entitlement gate answers the same
   * way every time, and a button that cannot succeed is worse than none. It
   * gets the honest alternative instead: go and read it.
   */
  const loaderAction = canRetry(state.phase)
    ? { label: "Try again", onPress: () => dispatch({ type: "retry", at: Date.now() }) }
    : state.phase === "unavailable" || state.phase === "overdue"
    ? { label: "Read it instead", onPress: handleClose }
    : undefined;
  const loaderSecondaryAction = canRetry(state.phase) ||
      state.phase === "overdue"
    ? { label: "Close", onPress: handleClose }
    : undefined;

  if (!chapter) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>This story has no chapters yet.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          style={[styles.closeButton, { top: insets.top + spacing.sm }]}
        >
          <X size={22} color={colors.ink} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="listen-screen">
      <View style={styles.cover}>
        {coverSource
          ? (
            <FocalImage
              source={coverSource}
              focalX={story.focalX ?? 0.5}
              focalY={story.focalY ?? 0.5}
              style={styles.coverFill}
            />
          )
          : (
            <LinearGradient
              colors={genreGradients[story.genre]}
              style={StyleSheet.absoluteFill}
            />
          )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close player"
          onPress={handleClose}
          hitSlop={8}
          style={[styles.closeButton, { top: insets.top + spacing.sm }]}
        >
          <X size={22} color={colors.chromeText} />
        </Pressable>
      </View>

      {state.phase === "ready"
        ? (
          <>
            <TranscriptView
              lines={lines}
              activeIndex={activeLine}
              onSeekToLine={handleSeekToLine}
            />
            <View style={{ paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
              <PlayerBar
                storyTitle={story.title}
                chapterTitle={chapter.title}
                isPlaying={isPlaying}
                positionMs={positionMs}
                durationMs={durationMs}
                rate={rate}
                hasNextChapter={hasNextChapter}
                onTogglePlay={handleTogglePlay}
                onSeek={handleSeek}
                onRateChange={handleRateChange}
                onChapters={() => setChaptersOpen(true)}
                onNextChapter={() => goToChapter(chapterIndex + 1)}
              />
            </View>
          </>
        )
        : (
          <View style={styles.loaderGround}>
            <NarrationLoader
              status={copy.status}
              detail={copy.detail}
              messages={isWaiting(state.phase) ? PLACEHOLDER_MESSAGES : undefined}
              action={loaderAction}
              secondaryAction={loaderSecondaryAction}
            />
          </View>
        )}

      <Modal
        visible={chaptersOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setChaptersOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chapter list"
          onPress={() => setChaptersOpen(false)}
          style={styles.scrim}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.sheetTitle}>Chapters</Text>
          <ScrollView style={styles.sheetScroll}>
            {story.chapters.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Listen to chapter ${index + 1}: ${item.title}`}
                accessibilityState={{ selected: index === chapterIndex }}
                onPress={() => goToChapter(index)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  index === chapterIndex && styles.sheetRowActive,
                  pressed && styles.sheetRowPressed,
                ]}
              >
                <Text style={styles.sheetRowNumber}>{index + 1}</Text>
                <Text style={styles.sheetRowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // `FocalImage` takes explicit dimensions rather than a style sheet id, so
  // the cover fills its wrapper by percentage instead of by `absoluteFill`.
  coverFill: {
    width: "100%",
    height: "100%",
  },
  cover: {
    height: 300,
    backgroundColor: colors.canvas,
    overflow: "hidden",
  },
  /**
   * `top` is supplied INLINE from `insets.top`, never from this object.
   *
   * It used to be `spacing.xxxl` — a flat 32pt — and the reference device's
   * notch is 47pt, so the close button sat underneath it and could not be
   * pressed. The value cannot live here because a safe-area inset is not a
   * design token: it is 0 on a flat display, 47 on one device and 59 on
   * another, and any constant is wrong on all but one of them.
   *
   * The cover behind it no longer carries `paddingTop: insets.top` either. It
   * is a fixed 300pt box and `coverFill` is `height: "100%"`, which resolves
   * against the CONTENT box — so padding for the notch squashed the artwork by
   * the height of the notch and left a canvas-coloured strip above it. A player
   * cover is meant to run full-bleed under the status bar; the button floats
   * over it, and only the button needs to clear the notch.
   */
  closeButton: {
    position: "absolute",
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.scrimHeavy,
    alignItems: "center",
    justifyContent: "center",
  },
  loaderGround: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  emptyText: {
    fontFamily: fonts.ui,
    fontSize: 16,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.huge,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "70%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  sheetRowActive: {
    backgroundColor: colors.accentSoft,
  },
  sheetRowPressed: {
    opacity: 0.7,
  },
  sheetRowNumber: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.tertiary,
    minWidth: 20,
  },
  sheetRowTitle: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.ink,
  },
});
