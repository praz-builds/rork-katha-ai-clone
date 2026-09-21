/**
 * Playing a chapter that does not exist yet.
 *
 * A chunked narration arrives in pieces: chunk 0 is playable at around 45
 * seconds, the rest land while the reader is already listening. expo-av has no
 * notion of a playlist, so this owns one -- two `Audio.Sound` slots, one
 * timeline stitched out of their durations, and the boundary logic that makes
 * a reader hear one continuous chapter rather than thirteen files.
 *
 * ## Not React, on purpose
 *
 * Nothing here imports React or touches component state. The boundary rules
 * are the part that is easy to get wrong -- preload too late and there is a
 * gap, promote the wrong slot and the chapter repeats a piece, forget to unload
 * and three sounds sit in memory -- and all of it is testable against a fake
 * `createAsync` with no renderer, no timers and no act() wrapping. The screen
 * keeps a ref to one of these and forwards its status upward; that is the whole
 * interface.
 *
 * ## Two sounds, never three
 *
 * There is the sound that is playing and the sound that is about to. A third
 * is a leak: on a 13-chunk chapter it is thirteen decoders. Every path that
 * loads into the standby slot checks the slot is empty first, and the promotion
 * unloads the outgoing sound rather than letting it fall out of scope.
 *
 * ## One timeline
 *
 * The reader sees a single scrubber, so positions are global: chunk-local
 * position plus the sum of every earlier chunk's duration. Durations come from
 * the sound itself once loaded (authoritative) and from the server's
 * `duration_ms` before that. The *total* is only knowable once every piece
 * exists; until then the tail is estimated from character counts and the
 * estimate is flagged as provisional, because a total that silently grows under
 * a reader mid-chapter is worse than one labelled as approximate.
 */
import { Audio } from "expo-av";
import type { AVPlaybackStatus } from "expo-av";

/**
 * How far before a chunk ends to start loading the next one.
 *
 * Eight seconds is a deliberate over-provision. The next chunk is a small file
 * already on a CDN, so a second or two would usually do; the cost of being
 * early is one extra decoder held slightly longer, and the cost of being late
 * is an audible gap in the middle of a sentence. Only one of those is something
 * a reader notices.
 */
export const CHUNK_PRELOAD_LEAD_MS = 8_000;

/**
 * How often expo-av reports where the playhead is.
 *
 * expo-av's default is around 500ms, which is the floor on how stale the
 * highlighted transcript line can be -- and that staleness is one-directional,
 * always late. 250ms halves it for the price of twice as many status callbacks,
 * each of which is a `setState` on a screen that renders a memoized list. See
 * `TRANSCRIPT_LEAD_MS` in `lib/transcript-sync.ts` for the other half of this.
 */
export const CHUNK_PROGRESS_INTERVAL_MS = 250;

/**
 * A piece that is not synthesized yet: its index and how much prose it holds.
 *
 * The only thing knowable about a chunk before it exists, and enough to
 * estimate its length -- which is what keeps the provisional total spanning
 * the whole chapter instead of growing under the reader as pieces land.
 */
export type ChunkEstimate = {
  index: number;
  charCount: number;
};

/** A piece of the chapter, as the manifest describes it. */
export type ChunkPart = {
  index: number;
  url: string;
  /** The server's measurement, used until the sound reports its own. */
  durationMs: number | null;
  /** Characters of prose in this piece. Estimates the tail; never zero-safe. */
  charCount: number;
};

export type ChunkPlayerStatus = {
  isPlaying: boolean;
  /** Playhead across the whole chapter, not within the current piece. */
  positionMs: number;
  /** Total across the whole chapter; estimated while pieces are missing. */
  durationMs: number;
  /** True while `durationMs` includes any estimated piece. */
  durationIsProvisional: boolean;
  /**
   * True when playback has reached the end of what exists and stopped there.
   *
   * Not a failure and not the end of the chapter: the next piece is being
   * synthesized and playback resumes by itself when a poll hands it over.
   */
  waitingForChunk: boolean;
};

/** Injected so tests can drive the boundary without expo-av or a device. */
export type CreateSound = typeof Audio.Sound.createAsync;

export type ChunkPlayerOptions = {
  /** The pieces that are playable now. May grow via `setParts`. */
  parts: readonly ChunkPart[];
  /** What is known about the pieces that are not playable yet. */
  pending?: readonly ChunkEstimate[];
  /** How many pieces the chapter has in total, playable or not. */
  totalChunks: number;
  rate: number;
  onStatus: (status: ChunkPlayerStatus) => void;
  /** The chapter is over: the last piece of the last chunk finished. */
  onFinish: () => void;
  /**
   * A piece that exists could not be loaded, and playback has stopped.
   *
   * The single-file path has always had this: a `createAsync` that rejects
   * there is reported and dispatched as a failure the screen renders. Without
   * the same thing here, a chunked playthrough whose piece 404s (the failure
   * path deletes the parts out from under a reader who is streaming one) would
   * show a player bar whose Play button does nothing, and say nothing at all.
   * Called at most once per failed load, always after the status that stopped
   * playback, so the screen never renders a failure over a `isPlaying: true`.
   */
  onError?: (info: { index: number; error: unknown }) => void;
  createSound?: CreateSound;
};

type Slot = {
  index: number;
  sound: Audio.Sound;
};

/**
 * Swallow a failure from a sound operation without assuming it returned a
 * promise. expo-av's own methods do; a test double may not, and a player that
 * throws on teardown because a mock returned `undefined` is a broken test
 * rather than a broken player.
 */
function settle(result: unknown): Promise<void> {
  return Promise.resolve(result).then(
    () => {},
    () => {},
  );
}

function isLoaded(
  status: AVPlaybackStatus,
): status is Extract<AVPlaybackStatus, { isLoaded: true }> {
  return status.isLoaded;
}

export class ChunkPlayer {
  private parts: ChunkPart[];
  private pending: ChunkEstimate[];
  private totalChunks: number;
  private rate: number;
  private readonly onStatus: (status: ChunkPlayerStatus) => void;
  private readonly onFinish: () => void;
  private readonly onError?: (info: { index: number; error: unknown }) => void;
  private readonly createSound: CreateSound;

  private current: Slot | null = null;
  private standby: Slot | null = null;
  /** Durations expo-av actually reported, which beat the server's numbers. */
  private readonly measured = new Map<number, number>();
  private currentIndex = 0;
  private positionInChunk = 0;
  private playing = false;
  private waiting = false;
  private disposed = false;
  /**
   * Bumped by every operation that invalidates work in flight. An async load
   * that resolves after a seek, a dispose or a chunk switch checks this and
   * unloads what it made instead of installing it -- the same guard shape the
   * Listen screen uses for its own loads.
   */
  private token = 0;
  /**
   * The load that owns the standby slot right now, if one is in flight.
   *
   * One in-flight load per slot, and the boundary ADOPTS it rather than
   * starting a second. A boolean could say "a preload is running" but not
   * "which piece it is for", so `advance` had no way to reuse it: it started
   * its own load of the same chunk, and for as long as both were in flight
   * there were two decoders and two fetches for one piece -- with the handover
   * landing on whichever finished first. `adopted` is how the preload's own
   * continuation knows the sound is no longer its to install or unload.
   */
  private preload:
    | { index: number; promise: Promise<Audio.Sound | null>; adopted: boolean }
    | null = null;

  constructor(options: ChunkPlayerOptions) {
    this.parts = [...options.parts].sort((a, b) => a.index - b.index);
    this.pending = [...(options.pending ?? [])];
    this.totalChunks = options.totalChunks;
    this.rate = options.rate;
    this.onStatus = options.onStatus;
    this.onFinish = options.onFinish;
    this.onError = options.onError;
    this.createSound = options.createSound ?? Audio.Sound.createAsync;
  }

  // ---------------------------------------------------------------- timeline

  private partAt(index: number): ChunkPart | undefined {
    return this.parts.find((part) => part.index === index);
  }

  /** Milliseconds per character, measured off the pieces we actually have. */
  private msPerChar(): number {
    for (const part of this.parts) {
      const duration = this.measured.get(part.index) ?? part.durationMs;
      if (duration && part.charCount > 0) return duration / part.charCount;
    }
    // Nothing measured yet. ~15 characters a second is ordinary narration pace;
    // it only ever shapes a provisional total that is labelled as one.
    return 1000 / 15;
  }

  /** How much prose a piece holds, whether or not it has been synthesized. */
  private charCountOf(index: number): number {
    const part = this.partAt(index);
    if (part) return part.charCount;
    return this.pending.find((entry) => entry.index === index)?.charCount ?? 0;
  }

  /** A piece's length, and whether that length is known rather than guessed. */
  private durationOf(index: number): { ms: number; known: boolean } {
    const measured = this.measured.get(index);
    if (measured && measured > 0) return { ms: measured, known: true };
    const part = this.partAt(index);
    if (part?.durationMs) return { ms: part.durationMs, known: true };
    const charCount = this.charCountOf(index);
    if (charCount > 0) {
      return { ms: charCount * this.msPerChar(), known: false };
    }
    return { ms: 0, known: false };
  }

  /** Where a piece begins on the single timeline the reader scrubs. */
  private offsetOf(index: number): number {
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += this.durationOf(i).ms;
    return offset;
  }

  private totalDuration(): { ms: number; provisional: boolean } {
    let ms = 0;
    let provisional = this.parts.length < this.totalChunks;
    for (let i = 0; i < this.totalChunks; i += 1) {
      const { ms: chunkMs, known } = this.durationOf(i);
      // A piece that does not exist yet still contributes: the server sends
      // its character count from the first poll, so the estimate covers the
      // whole chapter and only gets *sharper* as pieces land. It contributes
      // nothing only when even that is missing (an older server), and then the
      // total is short as well as provisional -- which the flag says.
      ms += chunkMs;
      if (!known) provisional = true;
    }
    return { ms, provisional };
  }

  // ------------------------------------------------------------------ status

  private emit(): void {
    if (this.disposed) return;
    const { ms, provisional } = this.totalDuration();
    this.onStatus({
      isPlaying: this.playing,
      positionMs: this.offsetOf(this.currentIndex) + this.positionInChunk,
      durationMs: ms,
      durationIsProvisional: provisional,
      waitingForChunk: this.waiting,
    });
  }

  /**
   * A load that failed, made visible and made honest.
   *
   * Two things have to happen together. The status must stop claiming
   * playback -- the defect this replaces left `currentIndex` advanced while
   * `current` still held the finished sound, so the bar reported playing at a
   * position nothing was playing -- and somebody has to be told, because a
   * silent stop is indistinguishable from the end of a chapter.
   */
  private failLoad(index: number, error: unknown): void {
    if (this.disposed) return;
    const outgoing = this.current;
    this.current = null;
    this.standby = null;
    this.playing = false;
    this.waiting = false;
    this.emit();
    if (outgoing) void settle(outgoing.sound.unloadAsync());
    this.onError?.({ index, error });
  }

  private handleStatus(index: number, status: AVPlaybackStatus): void {
    if (this.disposed || !isLoaded(status)) return;
    // A standby slot reports status too (it is loaded, just not playing). Only
    // the piece that is actually on air moves the playhead.
    if (index !== this.currentIndex) {
      if (typeof status.durationMillis === "number") {
        this.measured.set(index, status.durationMillis);
      }
      return;
    }
    if (typeof status.durationMillis === "number") {
      this.measured.set(index, status.durationMillis);
    }
    this.positionInChunk = status.positionMillis ?? 0;
    this.playing = status.isPlaying;

    if (status.didJustFinish) {
      void this.advance();
      return;
    }

    const duration = this.measured.get(index);
    if (
      this.playing && typeof duration === "number" &&
      duration - this.positionInChunk <= CHUNK_PRELOAD_LEAD_MS
    ) {
      void this.preloadNext();
    }
    this.emit();
  }

  // ------------------------------------------------------------------ slots

  private async load(
    index: number,
    options: { shouldPlay: boolean; positionMs?: number },
  ): Promise<Audio.Sound | null> {
    const part = this.partAt(index);
    if (!part) return null;
    const token = this.token;
    const { sound } = await this.createSound(
      { uri: part.url },
      {
        shouldPlay: options.shouldPlay,
        rate: this.rate,
        shouldCorrectPitch: true,
        positionMillis: options.positionMs ?? 0,
        progressUpdateIntervalMillis: CHUNK_PROGRESS_INTERVAL_MS,
      },
      (status) => this.handleStatus(index, status),
    );
    if (this.disposed || token !== this.token) {
      void settle(sound.unloadAsync());
      return null;
    }
    return sound;
  }

  private async preloadNext(): Promise<void> {
    if (this.preload || this.standby || this.disposed) return;
    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.totalChunks || !this.partAt(nextIndex)) return;
    const entry = {
      index: nextIndex,
      promise: this.load(nextIndex, { shouldPlay: false }),
      adopted: false,
    };
    this.preload = entry;
    let sound: Audio.Sound | null = null;
    try {
      sound = await entry.promise;
    } catch {
      // A preload that fails is retried at the boundary, where a failure is
      // visible as a wait rather than as nothing at all.
    } finally {
      if (this.preload === entry) this.preload = null;
    }
    if (!sound) return;
    // The boundary took this load over while it was in flight: the sound is
    // playing (or about to), and unloading it here would cut the chapter off
    // mid-handover.
    if (entry.adopted) return;
    if (this.disposed || this.standby || this.currentIndex !== nextIndex - 1) {
      // Something moved under the load -- a seek, a dispose, or a slot that
      // filled another way. Never keep a third sound around.
      void settle(sound.unloadAsync());
      return;
    }
    this.standby = { index: nextIndex, sound };
  }

  /** The end of a piece: promote the standby, load the next, or stop. */
  private async advance(): Promise<void> {
    if (this.disposed) return;
    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.totalChunks) {
      this.playing = false;
      this.positionInChunk = this.durationOf(this.currentIndex).ms;
      this.emit();
      this.onFinish();
      return;
    }
    if (!this.partAt(nextIndex)) {
      // The chapter is not over; the next piece simply is not synthesized yet.
      // Hold here and say so. `setParts` resumes when a poll fills it in.
      this.playing = false;
      this.waiting = true;
      this.emit();
      return;
    }

    const outgoing = this.current;
    const promoted = this.standby && this.standby.index === nextIndex
      ? this.standby
      : null;
    this.standby = null;
    this.currentIndex = nextIndex;
    this.positionInChunk = 0;

    if (promoted) {
      this.current = promoted;
      this.playing = true;
      this.emit();
      await settle(promoted.sound.playAsync());
    } else {
      // Not preloaded (a short chunk, a failed preload, a seek). Load it now;
      // there is a gap, but a gap is better than stopping.
      //
      // Unless a preload for this exact piece is still in flight, in which
      // case it is adopted rather than raced: starting a second load of the
      // same chunk here is two fetches and two decoders for one piece, and the
      // handover then depends on which of them resolves first.
      const token = this.token;
      const inFlight = this.preload && this.preload.index === nextIndex
        ? this.preload
        : null;
      if (inFlight) {
        inFlight.adopted = true;
        this.preload = null;
      }
      let sound: Audio.Sound | null;
      try {
        sound = inFlight
          ? await inFlight.promise
          : await this.load(nextIndex, { shouldPlay: true });
      } catch (error) {
        // The piece is in the manifest and will not load: a part deleted by
        // the server's own failure path, or an expired url. Stopping is
        // correct; stopping silently is not. `failLoad` unloads what is still
        // in the current slot, which is the outgoing sound.
        this.failLoad(nextIndex, error);
        return;
      }
      if (!sound) {
        if (this.disposed || token !== this.token) {
          // A seek (or a dispose) happened under this load and has already
          // written its own state -- including unloading the sound this
          // boundary was leaving. Touching `playing`/`waiting` here would
          // stamp a boundary wait over where the reader just asked to be, and
          // the next `setParts` would then yank them to the next chunk.
          return;
        }
        this.playing = false;
        this.waiting = true;
        this.emit();
        return;
      }
      this.current = { index: nextIndex, sound };
      this.playing = true;
      this.emit();
      // An adopted preload was loaded paused, the way the standby slot always
      // is, so it needs the same nudge the promoted branch gives.
      if (inFlight) await settle(sound.playAsync());
    }
    if (outgoing) void settle(outgoing.sound.unloadAsync());
  }

  // -------------------------------------------------------------- public API

  /** Load the first piece and play it. */
  async start(index = 0): Promise<void> {
    if (this.disposed) return;
    this.currentIndex = index;
    this.positionInChunk = 0;
    let sound: Audio.Sound | null;
    try {
      sound = await this.load(index, { shouldPlay: true });
    } catch (error) {
      // The screen starts this with `void player.start()`. An uncaught
      // rejection here was an unhandled promise and, worse, silence: no
      // failure was dispatched, so the reader got a transport that did
      // nothing when pressed.
      this.failLoad(index, error);
      return;
    }
    if (!sound) return;
    this.current = { index, sound };
    this.playing = true;
    this.emit();
  }

  /**
   * A later poll brought more pieces.
   *
   * The only way a chunked playthrough ever learns anything, which is why the
   * screen must keep polling after it reaches `ready`. If playback stopped at a
   * boundary waiting for exactly this piece, it restarts itself here -- the
   * reader does not press play again to hear the rest of a chapter.
   */
  setParts(
    parts: readonly ChunkPart[],
    totalChunks?: number,
    pending?: readonly ChunkEstimate[],
  ): void {
    if (this.disposed) return;
    this.parts = [...parts].sort((a, b) => a.index - b.index);
    if (pending) this.pending = [...pending];
    if (typeof totalChunks === "number" && totalChunks > 0) {
      this.totalChunks = totalChunks;
    }
    if (this.waiting && this.partAt(this.currentIndex + 1)) {
      this.waiting = false;
      void this.advance();
      return;
    }
    this.emit();
  }

  /** Is there another piece after the one playing, loaded or not? */
  hasNextChunk(): boolean {
    return this.currentIndex + 1 < this.totalChunks;
  }

  async play(): Promise<void> {
    if (this.disposed || !this.current) return;
    this.playing = true;
    this.emit();
    await settle(this.current.sound.playAsync());
  }

  async pause(): Promise<void> {
    if (this.disposed || !this.current) return;
    this.playing = false;
    this.emit();
    await settle(this.current.sound.pauseAsync());
  }

  /**
   * Seek on the single timeline.
   *
   * Walks the offsets to find which piece `globalMs` lands in and seeks within
   * it. Landing in a piece that is not synthesized yet is not an error the
   * reader can act on, so it clamps to the last piece that exists rather than
   * refusing.
   */
  async seek(globalMs: number): Promise<void> {
    if (this.disposed) return;
    const target = Math.max(0, globalMs);
    let index = 0;
    let offset = 0;
    for (let i = 0; i < this.totalChunks; i += 1) {
      const { ms } = this.durationOf(i);
      if (target < offset + ms || i === this.totalChunks - 1) {
        index = i;
        break;
      }
      offset += ms;
      index = i + 1;
    }
    while (index > 0 && !this.partAt(index)) {
      index -= 1;
      offset -= this.durationOf(index).ms;
    }
    const local = Math.max(0, target - offset);

    if (this.current && index === this.currentIndex) {
      this.positionInChunk = local;
      this.emit();
      await settle(this.current.sound.setPositionAsync(local));
      return;
    }

    // A different piece: everything in flight is now wrong.
    this.token += 1;
    // Including a preload of the piece we are leaving behind: its load checks
    // the token and unloads itself, and dropping the entry here stops a later
    // boundary adopting a promise that can now only resolve to null.
    this.preload = null;
    const wasPlaying = this.playing;
    const outgoing = this.current;
    const standby = this.standby;
    this.current = null;
    this.standby = null;
    this.waiting = false;
    this.currentIndex = index;
    this.positionInChunk = local;
    if (outgoing) void settle(outgoing.sound.unloadAsync());
    if (standby) void settle(standby.sound.unloadAsync());

    let sound: Audio.Sound | null;
    try {
      sound = await this.load(index, {
        shouldPlay: wasPlaying,
        positionMs: local,
      });
    } catch (error) {
      this.failLoad(index, error);
      return;
    }
    if (!sound) return;
    this.current = { index, sound };
    this.playing = wasPlaying;
    this.emit();
  }

  /** Speed applies to both slots, or the next piece would revert to 1x. */
  async setRate(rate: number): Promise<void> {
    this.rate = rate;
    if (this.disposed) return;
    await Promise.all([
      settle(this.current?.sound.setRateAsync(rate, true)),
      settle(this.standby?.sound.setRateAsync(rate, true)),
    ]);
  }

  /** Unload everything. The player is finished after this. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.token += 1;
    this.preload = null;
    const sounds = [this.current?.sound, this.standby?.sound];
    this.current = null;
    this.standby = null;
    this.playing = false;
    await Promise.all(
      sounds.map((sound) => settle(sound?.unloadAsync())),
    );
  }
}

export function createChunkPlayer(options: ChunkPlayerOptions): ChunkPlayer {
  return new ChunkPlayer(options);
}
