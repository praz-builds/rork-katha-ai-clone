import { useCallback, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import type { AVPlaybackStatus } from "expo-av";

/**
 * Hearing a voice before choosing it, on the Voices screen.
 *
 * THE CONTRACT IS THE SERVER'S. `voices` returns a `preview_url` per voice: a
 * public object in the `audio` bucket that `seed-voice-previews` writes once
 * per voice and nothing ever writes on a read path. So a preview here is one
 * GET of a static file -- no provider job, no credit, nothing per story -- and
 * this module never asks for one to be made.
 *
 * LISTENING IS NOT CHOOSING. Nothing here reads or writes the preferred
 * voice. A reader who plays Kai's sample to compare it with Aria has not
 * picked Kai, and a preview that quietly saved the choice would change the
 * voice their next chapter is read in without them ever pressing the row.
 *
 * ONE SAMPLE AT A TIME. Starting a second stops the first, pressing the one
 * playing stops it, and leaving the screen stops whatever is left. Every load
 * carries a token; a load that resolves after it was superseded -- a slow
 * network and a quick second tap -- unloads its sound instead of playing over
 * the one the reader asked for last.
 */

export type VoicePreviewStatus = "idle" | "loading" | "playing" | "error";

export type VoicePreviewState = {
  /** The voice the status is about, or null when nothing has been tried. */
  voiceId: string | null;
  status: VoicePreviewStatus;
};

/**
 * How long a sample may take to start before it is called failed. A clip is a
 * few seconds of MP3; past this the reader has stopped waiting, and a spinner
 * that never resolves is worse than an error they can retry.
 */
export const PREVIEW_LOAD_TIMEOUT_MS = 12_000;

const IDLE: VoicePreviewState = { voiceId: null, status: "idle" };

export function useVoicePreview(options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? PREVIEW_LOAD_TIMEOUT_MS;
  const [state, setState] = useState<VoicePreviewState>(IDLE);
  const soundRef = useRef<Audio.Sound | null>(null);
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Stop and release whatever is loaded, and invalidate any load in flight. */
  const release = useCallback(() => {
    tokenRef.current += 1;
    clearTimer();
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      sound.setOnPlaybackStatusUpdate(null);
      void sound.unloadAsync().catch(() => undefined);
    }
  }, []);

  const stop = useCallback(() => {
    release();
    setState(IDLE);
  }, [release]);

  const toggle = useCallback(
    // `url` is non-nullable: VoicesScreen renders the preview button only for
    // a voice whose `previewUrl` is truthy, so this was never called without
    // one. The old `if (!url)` arm here was unreachable, and a type is a
    // better guard than a branch no test can reach.
    (voiceId: string, url: string) => {
      const active = state.voiceId === voiceId &&
        (state.status === "loading" || state.status === "playing");
      release();
      if (active) {
        setState(IDLE);
        return;
      }

      const token = tokenRef.current;
      const current = () => token === tokenRef.current;
      const fail = () => {
        if (!current()) return;
        release();
        setState({ voiceId, status: "error" });
      };

      setState({ voiceId, status: "loading" });
      timerRef.current = setTimeout(fail, timeoutMs);

      const onStatus = (status: AVPlaybackStatus) => {
        if (!current()) return;
        if (!status.isLoaded) {
          if (status.error) fail();
          return;
        }
        if (status.didJustFinish) {
          release();
          setState(IDLE);
          return;
        }
        if (status.isPlaying) {
          clearTimer();
          setState((prev) =>
            prev.voiceId === voiceId && prev.status === "playing"
              ? prev
              : { voiceId, status: "playing" }
          );
        }
      };

      Audio.Sound.createAsync({ uri: url }, { shouldPlay: true }, onStatus)
        .then(({ sound }) => {
          if (!current()) {
            // Superseded while loading: never let it play over the newer one.
            void sound.unloadAsync().catch(() => undefined);
            return;
          }
          soundRef.current = sound;
        })
        .catch(fail);
    },
    [release, state.status, state.voiceId, timeoutMs],
  );

  // Leaving the screen stops the sample. Without this it keeps talking over
  // whatever the reader opened next, with no control left on screen to stop it.
  useEffect(() => release, [release]);

  return { state, toggle, stop };
}
