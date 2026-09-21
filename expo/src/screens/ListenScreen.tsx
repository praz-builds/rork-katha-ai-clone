import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AppState,
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
  CHUNK_PROGRESS_INTERVAL_MS,
  type ChunkPlayer,
  createChunkPlayer,
} from "@/lib/chunk-player";
import {
  AUTO_ADVANCE_DEFAULT,
  autoAdvanceEnabled,
  setAutoAdvanceEnabled,
} from "@/lib/listen-prefs";
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
 * How far into a chapter to start narrating the next one.
 *
 * Halfway is the point where staying is more likely than leaving, and it leaves
 * roughly a chapter's worth of time for a job that takes about a minute and a
 * half. The floor matters more than the fraction: **every prefetch is a real
 * RunPod job costing real money**, so a short chapter -- where half of it is
 * less than 45 seconds of listening -- never prefetches at all. Whoever is
 * skimming three-minute chapters is not the reader this spend is for.
 */
const PREFETCH_AT_FRACTION = 0.5;
const PREFETCH_MIN_ELAPSED_MS = 45_000;

/**
 * How often a prefetch job is polled.
 *
 * **A prefetch that is never polled is money burned.** Chunk synthesis is
 * driven by the client asking `audio-status` how it is going; a job nobody asks
 * about stalls and is reclaimed as stale at ten minutes, having produced
 * nothing anyone can play. So the prefetch owns its own poll, slow enough to be
 * background noise beside the 2.5s foreground one.
 */
const PREFETCH_POLL_INTERVAL_MS = 15_000;

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
  const [durationIsProvisional, setDurationIsProvisional] = useState(false);
  /**
   * Playback has reached the end of what exists and is holding there.
   *
   * Not a failure and not the end of the chapter -- the next piece is still
   * being synthesized and playback resumes by itself when a poll hands it
   * over. Rendered, because a transport that has stopped and says nothing is
   * indistinguishable from one that has broken.
   */
  const [waitingForChunk, setWaitingForChunk] = useState(false);
  const [rate, setRate] = useState<PlaybackRate>(1);
  /** The chapter finished and there is nowhere to go. See `onFinishRef`. */
  const [ended, setEnded] = useState(false);
  /** Set when this chapter was reached by the previous one ending, not by a tap. */
  const [arrivedByAutoAdvance, setArrivedByAutoAdvance] = useState(false);

  const [autoAdvance, setAutoAdvance] = useState(AUTO_ADVANCE_DEFAULT);
  /**
   * The reader's own press wins over the stored value arriving late.
   *
   * Without it, turning autoplay off in the first moments of a screen is
   * silently undone by the AsyncStorage read resolving afterwards and writing
   * the old preference back over the new one.
   */
  const autoAdvanceChosenByUserRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void autoAdvanceEnabled().then((enabled) => {
      if (alive && !autoAdvanceChosenByUserRef.current) setAutoAdvance(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const soundRef = useRef<Audio.Sound | null>(null);
  /**
   * The playlist controller, for a narration being generated while it plays.
   *
   * Exactly one of `soundRef` and `chunkPlayerRef` is live at a time: a
   * playthrough commits to its source. A cached narration plays the single
   * stitched file through `soundRef` exactly as it always has.
   */
  const chunkPlayerRef = useRef<ChunkPlayer | null>(null);
  /**
   * What to do when the audio ends.
   *
   * A ref rather than a dependency because the status callback that fires it is
   * created once per loaded sound and deliberately does not re-run on `rate`,
   * `autoAdvance` or `chapterIndex` -- its closure is stale by construction.
   * Reaching current state from it is exactly what a ref is for.
   */
  const onFinishRef = useRef<(() => void) | null>(null);
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
  const cues = useMemo(
    () =>
      buildCues(
        lines,
        durationMs,
        undefined,
        // Chunk boundaries bound the estimate's drift to one chunk of prose.
        // Only a progressive playthrough has them; a cached single file keeps
        // the whole-chapter estimate it has always used.
        state.manifest?.entries.map((entry) => ({
          durationMs: entry.durationMs,
          charCount: entry.charCount,
        })),
      ),
    [durationMs, lines, state.manifest],
  );
  const activeLine = useMemo(
    () => cueIndexAt(cues, positionMs),
    [cues, positionMs],
  );

  const unloadSound = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    const player = chunkPlayerRef.current;
    chunkPlayerRef.current = null;
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setDurationIsProvisional(false);
    setWaitingForChunk(false);
    if (player) void player.dispose();
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
      const player = chunkPlayerRef.current;
      chunkPlayerRef.current = null;
      if (player) void player.dispose();
    };
  }, []);

  /** Set once the reader leaves, so no background work outlives the screen. */
  const closedRef = useRef(false);

  const handleClose = useCallback(() => {
    runRef.current += 1;
    closedRef.current = true;
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
    setEnded(false);
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

  /**
   * Poll while a job is running -- and while chunks are still arriving.
   *
   * `shouldPoll` is given the manifest for the second case: a progressive
   * playthrough is already `ready` and playing, and this poll is the only thing
   * that ever learns where the rest of the chapter is.
   */
  useEffect(() => {
    if (!chapter || !shouldPoll(state.phase, state.manifest)) return;
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
  }, [chapter, state.manifest, state.phase, story.id, voiceId]);

  /** Advance elapsed time so `slow` and `overdue` can fire. */
  useEffect(() => {
    if (!isWaiting(state.phase)) return;
    const timer = setInterval(
      () => dispatch({ type: "tick", at: Date.now() }),
      TICK_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [state.phase]);

  /**
   * Load and start the audio the moment there is a URL for it.
   *
   * The single-file path: a cached narration, a completed one, or any client
   * where progressive playback is off. A playthrough that has a manifest is
   * driven by the chunk player below instead, and the two never both run.
   */
  useEffect(() => {
    if (state.phase !== "ready" || !state.audioUrl || soundRef.current) return;
    if (state.manifest) return;
    const run = runRef.current;
    let created: Audio.Sound | null = null;

    void Audio.Sound.createAsync(
      { uri: state.audioUrl },
      {
        shouldPlay: true,
        rate,
        shouldCorrectPitch: true,
        // Halves how stale the reported playhead can be, which is the floor on
        // how late the transcript highlight can arrive. See `TRANSCRIPT_LEAD_MS`.
        progressUpdateIntervalMillis: CHUNK_PROGRESS_INTERVAL_MS,
      },
      (status) => {
        if (!status.isLoaded || runRef.current !== run) return;
        setIsPlaying(status.isPlaying);
        setPositionMs(status.positionMillis ?? 0);
        if (typeof status.durationMillis === "number") {
          setDurationMs(status.durationMillis);
        }
        // The end of a chapter is a decision, not a stop. `onFinishRef` holds
        // the current one; this closure cannot, by design (see the ref).
        if (status.didJustFinish) onFinishRef.current?.();
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
  }, [chapter?.id, state.audioUrl, state.manifest, state.phase, story.id, voiceId]);

  /**
   * Status out of the chunk player, in the one shape the screen understands.
   *
   * Stable: the effect below creates the player once per chapter and must not
   * tear it down because a callback identity changed.
   */
  const handleChunkStatus = useCallback(
    (status: {
      isPlaying: boolean;
      positionMs: number;
      durationMs: number;
      durationIsProvisional: boolean;
      waitingForChunk: boolean;
    }) => {
      setIsPlaying(status.isPlaying);
      setPositionMs(status.positionMs);
      setDurationMs(status.durationMs);
      setDurationIsProvisional(status.durationIsProvisional);
      setWaitingForChunk(status.waitingForChunk);
    },
    [],
  );

  /**
   * A piece that exists but will not load.
   *
   * Reported and dispatched exactly the way the single-file loader's `catch`
   * does, because it is the same event for the reader: audio they were
   * promised is not going to play. Without this the chunked path failed in
   * silence -- the server's own failure path deletes the parts, so a chunk
   * that fails at the provider can remove the object the reader is streaming.
   */
  const handleChunkError = useCallback(
    ({ index, error }: { index: number; error: unknown }) => {
      captureError({
        bucket: "generation.audio",
        severity: "medium",
        errorCode: error instanceof Error ? error.name : "playback_error",
        error,
        context: {
          story_id: story.id,
          chapter_id: chapter?.id,
          voice_id: voiceId,
          chunk: index,
        },
      });
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", errorCode: "playback_failed" },
        at: Date.now(),
      });
    },
    [chapter?.id, story.id, voiceId],
  );

  /**
   * Drive a narration that is still being made.
   *
   * Created once per chapter, on the first manifest; every later poll only
   * hands it more pieces. `setParts` is also what restarts playback when it
   * stopped at a boundary waiting for a chunk that has now landed.
   */
  useEffect(() => {
    const manifest = state.manifest;
    if (state.phase !== "ready" || !manifest) return;
    const existing = chunkPlayerRef.current;
    if (existing) {
      existing.setParts(manifest.entries, manifest.chunks, manifest.pending);
      return;
    }
    const player = createChunkPlayer({
      parts: manifest.entries,
      pending: manifest.pending,
      totalChunks: manifest.chunks,
      rate,
      onStatus: handleChunkStatus,
      onFinish: () => onFinishRef.current?.(),
      onError: handleChunkError,
    });
    chunkPlayerRef.current = player;
    void player.start();
    // `rate` is read once at creation and applied through `setRate` afterwards,
    // for the same reason the single-file loader excludes it: changing speed
    // must not rebuild the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleChunkError, handleChunkStatus, state.manifest, state.phase]);

  /**
   * A terminal answer stops the audio, not just the screen.
   *
   * A progressive playthrough can now fail while chunk 0 is still playing --
   * the chapter's later pieces failed at the provider, and the server has
   * deleted the parts. Leaving the player running would put narration behind a
   * screen that says the narration did not finish, with no transport to stop
   * it: the reader's only way out would be closing the player.
   */
  useEffect(() => {
    if (state.phase !== "failed" && state.phase !== "unavailable") return;
    void unloadSound();
  }, [state.phase, unloadSound]);

  /**
   * What happens when the audio ends.
   *
   * Assigned here, with real dependencies, and read through `onFinishRef` from
   * a status callback whose closure is deliberately stale.
   */
  useEffect(() => {
    onFinishRef.current = () => {
      // The chunk player swaps pieces itself; it only calls this at the real
      // end of the chapter. This guard is for the single-file callback, which
      // cannot know the difference.
      if (chunkPlayerRef.current?.hasNextChunk()) return;
      if (autoAdvance && chapterIndex < story.chapters.length - 1) {
        // Everything else follows on its own: the acquisition effect runs for
        // the new chapter (cached -> request -> poll) and the load effect
        // starts it with `shouldPlay: true`. Nothing here has to play anything.
        setArrivedByAutoAdvance(true);
        setChapterIndex(chapterIndex + 1);
        return;
      }
      setIsPlaying(false);
      // Only the end of the *story* gets an end state. Stopping because
      // autoplay is off is what the reader asked for, and the transcript they
      // just listened to is a better thing to be left looking at than a
      // notice telling them the chapter they chose to stop on has stopped.
      if (chapterIndex >= story.chapters.length - 1) setEnded(true);
    };
  }, [autoAdvance, chapterIndex, story.chapters.length]);

  const handleTogglePlay = useCallback(() => {
    const player = chunkPlayerRef.current;
    if (player) {
      if (isPlaying) {
        void player.pause();
        setIsPlaying(false);
      } else {
        void player.play();
        setIsPlaying(true);
      }
      return;
    }
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
    const player = chunkPlayerRef.current;
    if (player) {
      void player.seek(clamped);
      return;
    }
    void soundRef.current?.setPositionAsync(clamped);
  }, [durationMs]);

  const handleSeekToLine = useCallback((index: number) => {
    const startMs = cueStartMs(cues, index);
    if (startMs === null) return;
    handleSeek(startMs);
  }, [cues, handleSeek]);

  const handleRateChange = useCallback((next: PlaybackRate) => {
    setRate(next);
    void chunkPlayerRef.current?.setRate(next);
    void soundRef.current?.setRateAsync(next, true);
  }, []);

  /**
   * Turn autoplay on or off.
   *
   * **Off does not stop what is playing.** It suppresses the step into the next
   * chapter and nothing else; a reader reaching for the switch mid-chapter is
   * saying "stop after this", not "stop now".
   */
  const handleToggleAutoAdvance = useCallback(() => {
    autoAdvanceChosenByUserRef.current = true;
    setAutoAdvance((enabled) => {
      const next = !enabled;
      void setAutoAdvanceEnabled(next);
      return next;
    });
  }, []);

  const goToChapter = useCallback((next: number) => {
    if (next < 0 || next >= story.chapters.length || next === chapterIndex) {
      setChaptersOpen(false);
      return;
    }
    setChaptersOpen(false);
    // A chapter the reader chose is not a continuation, whatever the last one
    // did, so the loader must not frame it as one.
    setArrivedByAutoAdvance(false);
    setChapterIndex(next);
  }, [chapterIndex, story.chapters.length]);

  const hasNextChapter = chapterIndex < story.chapters.length - 1;
  const nextChapter = hasNextChapter
    ? story.chapters[chapterIndex + 1]
    : undefined;
  const copy = listenCopy(state.phase);

  /**
   * Chapters this session has already asked for ahead of time.
   *
   * The latch that makes a prefetch fire once and only once per
   * (chapter, voice). Scrubbing back over the trigger point must not ask
   * again: a second job is a second charge for the same audio.
   */
  const prefetchedRef = useRef(new Set<string>());
  /** The prefetch currently in flight, if any -- what the background poll polls. */
  const [prefetching, setPrefetching] = useState<
    { chapterId: string; voiceId: VoiceId } | null
  >(null);

  /** Start narrating the next chapter while this one is still playing. */
  useEffect(() => {
    if (closedRef.current) return;
    if (state.phase !== "ready" || !isPlaying || !autoAdvance) return;
    if (!nextChapter) return;
    // Backgrounded is not listening. A prefetch is only worth its cost for a
    // reader who is actually about to arrive at that chapter.
    //
    // Written as "not known to be away" rather than `=== "active"` on purpose:
    // `currentState` is undefined wherever the native module is not present
    // (the test environment, web), and a condition that reads as a foreground
    // check but is really a native-module check would silently switch the
    // whole feature off there.
    if (
      AppState.currentState === "background" ||
      AppState.currentState === "inactive"
    ) {
      return;
    }
    if (existingAudioUrl(nextChapter, voiceId, femaleVoice ?? "aria")) return;
    if (durationMs <= 0) return;
    const key = `${nextChapter.id}:${voiceId}`;
    if (prefetchedRef.current.has(key)) return;
    const trigger = Math.max(
      durationMs * PREFETCH_AT_FRACTION,
      PREFETCH_MIN_ELAPSED_MS,
    );
    if (positionMs < trigger) return;

    prefetchedRef.current.add(key);
    // The same run token the narration loads use, for the same reason. This
    // request outlives a chapter change, and its callback used to restore
    // `prefetching` unconditionally -- after the arrival cleanup below had
    // already cleared it. The background poll then started for a chapter the
    // reader had left and kept running against it: a poll that outlives the
    // thing it was for.
    const run = runRef.current;
    void requestNarration({
      storyId: story.id,
      chapterId: nextChapter.id,
      voiceId,
      purpose: "prefetch",
    }).then((outcome) => {
      if (closedRef.current || runRef.current !== run) return;
      if (outcome.kind === "pending" || outcome.kind === "ready") {
        setPrefetching({ chapterId: nextChapter.id, voiceId });
        return;
      }
      // Everything else -- most often the server's deliberate 503 for a
      // prefetch it is not configured to accept -- is dropped in silence.
      // Auto-advance still works; it just meets the loader at the boundary.
      setPrefetching(null);
    });
  }, [
    autoAdvance,
    durationMs,
    femaleVoice,
    isPlaying,
    nextChapter,
    positionMs,
    state.phase,
    story.id,
    voiceId,
  ]);

  /**
   * Keep a prefetched job moving.
   *
   * Chunk synthesis advances because a client is asking `audio-status` about
   * it. Nobody is on that chapter's screen yet, so this is that client -- on a
   * slow interval, and torn down the moment the job is over, the reader
   * arrives at that chapter, or the screen goes away.
   */
  useEffect(() => {
    if (!prefetching) return;
    const target = prefetching;
    const timer = setInterval(() => {
      if (closedRef.current) return;
      void pollNarration({
        storyId: story.id,
        chapterId: target.chapterId,
        voiceId: target.voiceId,
      }).then((outcome) => {
        if (outcome.kind === "pending") return;
        setPrefetching((current) =>
          current && current.chapterId === target.chapterId ? null : current
        );
      });
    }, PREFETCH_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [prefetching, story.id]);

  /** Arriving at the prefetched chapter hands polling back to the foreground. */
  useEffect(() => {
    setPrefetching((current) =>
      current && current.chapterId === chapter?.id ? null : current
    );
  }, [chapter?.id]);

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

  /**
   * Whose chapter this wait belongs to, when the reader did not ask for it.
   *
   * A wait that arrives on its own -- the previous chapter ended and this one
   * has never been narrated -- reads as a restart unless it names what is being
   * prepared. And a chapter that *failed* always names itself, whether the
   * reader arrived by autoplay or by pressing Listen: a progressive
   * playthrough can now fail mid-chapter, and "the narration did not finish"
   * with no chapter on it is the silent skip this must never be.
   */
  const loaderContext = isWaiting(state.phase)
    ? arrivedByAutoAdvance ? `Next: ${chapter.title}` : undefined
    : `Chapter ${chapterIndex + 1}: ${chapter.title}`;

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

      {state.phase === "ready" && ended
        ? (
          /**
           * The end of the story, said out loud.
           *
           * The alternative is silence after the last sentence, which reads as
           * the player having broken rather than the book having finished.
           */
          <View style={styles.loaderGround}>
            <NarrationLoader
              status={`That's the end of ${story.title}.`}
              detail="There are no more chapters to listen to."
              action={{ label: "Close", onPress: handleClose }}
            />
          </View>
        )
        : state.phase === "ready"
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
                durationIsProvisional={durationIsProvisional}
                waitingForChunk={waitingForChunk}
                rate={rate}
                hasNextChapter={hasNextChapter}
                autoAdvance={autoAdvance}
                onTogglePlay={handleTogglePlay}
                onSeek={handleSeek}
                onRateChange={handleRateChange}
                onChapters={() => setChaptersOpen(true)}
                onNextChapter={() => goToChapter(chapterIndex + 1)}
                onToggleAutoAdvance={handleToggleAutoAdvance}
              />
            </View>
          </>
        )
        : (
          <View style={styles.loaderGround}>
            <NarrationLoader
              contextLabel={loaderContext}
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
