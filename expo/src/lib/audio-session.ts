/**
 * The one audio mode the whole app plays under.
 *
 * expo-av's audio mode is process-wide: every `Audio.Sound` -- the Listen
 * screen's narration, the reader's narration and the genre music -- plays
 * under whatever `Audio.setAudioModeAsync` last set. Nothing set it, so the
 * platform defaults applied: on a phone, narration and music stopped the
 * moment the screen locked or the reader switched app, and iOS's silent
 * switch muted them outright. None of that shows on the web preview.
 *
 * `configureAudioSession()` is called once, from `App.tsx`'s start-up effect,
 * before any sound can be created. The iOS half also needs
 * `UIBackgroundModes: ["audio"]` in `app.json`; without it iOS suspends the
 * app on lock regardless of this mode.
 *
 * It never throws. A failure here costs background playback, not the app, so
 * it is reported and swallowed. Web is skipped: expo-av's web module has no
 * audio session to configure.
 */
import { Platform } from "react-native";
import { Audio } from "expo-av";
import type { AudioMode, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

// The enums' values, not the enums: a dozen suites mock expo-av as
// `{ Audio: { Sound } }`, and reading `InterruptionModeIOS.DoNotMix` at module
// load would take every one of them down through `App.tsx`.
const IOS_DUCK_OTHERS = 2 as InterruptionModeIOS; // InterruptionModeIOS.DuckOthers
const ANDROID_DUCK_OTHERS = 2 as InterruptionModeAndroid; // InterruptionModeAndroid.DuckOthers

export const APP_AUDIO_MODE: Partial<AudioMode> = {
  // Keep narration and music going when the phone locks or the app is left.
  staysActiveInBackground: true,
  // A story is the thing the reader chose to hear: play through the silent switch.
  playsInSilentModeIOS: true,
  // When another app briefly speaks over the story (a navigation prompt), the
  // story lowers under it instead of pausing.
  shouldDuckAndroid: true,
  // Katha's sound lowers whatever else is playing rather than stopping it.
  // Genre music starts on its own when a story opens, so pausing the reader's
  // own podcast for it (DoNotMix) would be a step too far.
  interruptionModeIOS: IOS_DUCK_OTHERS,
  interruptionModeAndroid: ANDROID_DUCK_OTHERS,
  // Playback only. The app never records, and RECORD_AUDIO is blocked.
  allowsRecordingIOS: false,
  playThroughEarpieceAndroid: false,
};

let configured: Promise<boolean> | null = null;

export function configureAudioSession(): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(false);
  if (configured) return configured;
  configured = (async () => {
    try {
      if (typeof Audio?.setAudioModeAsync !== "function") return false;
      await Audio.setAudioModeAsync(APP_AUDIO_MODE);
      return true;
    } catch (error) {
      // Background playback is lost, the app is not.
      console.warn("[audio] could not set the audio mode", error);
      configured = null;
      return false;
    }
  })();
  return configured;
}

/** Tests only: forget that the mode was set. */
export function resetAudioSessionForTests(): void {
  configured = null;
}
