import type { AVPlaybackSource } from "expo-av";
import type { Genre } from "@/types/domain";

/**
 * Ambient background music catalogue for the reader.
 *
 * HOW TO ADD A TRACK
 * -------------------
 * 1. Get the licensed go-ahead first. Then drop the audio file (a short,
 *    seamlessly-looping mp3 or m4a) into `expo/assets/music/`. Create that
 *    folder if it does not exist yet.
 * 2. Add one entry to MUSIC_TRACKS below, for example:
 *
 *      {
 *        id: "rain-on-glass",
 *        title: "Rain on Glass",
 *        genres: ["mystery", "thriller"],
 *        source: require("../../assets/music/rain-on-glass.mp3"),
 *      }
 *
 *    - `id`: unique, kebab-case, stable (it is what per-story selections are
 *      saved against, so do not rename it once it has shipped).
 *    - `title`: shown in the reader's Music picker.
 *    - `genres`: one or more of Katha's genres, used to sort this track to
 *      the top of the picker for stories in a matching genre. The full list
 *      is Genre from `@/types/domain`: romance, romantasy, darkRomance,
 *      fantasy, scifi, thriller, mystery, horror, contemporary, historical,
 *      adventure, comedy, poetry.
 *    - `source`: a static `require(...)` of the file from step 1. Metro
 *      needs this call to be literal (not built from a variable) so it can
 *      find and bundle the asset.
 *
 * 3. Nothing else changes. The picker, per-story persistence and playback
 *    all read this array; a track becomes selectable and playable the
 *    moment its row exists here.
 *
 * This list ships EMPTY on purpose: no licensed audio exists in this repo
 * yet. Do not add binary audio assets to source control without a legal
 * go-ahead, and do not synthesize placeholder audio either. Every surface
 * that reads MUSIC_TRACKS (see `components/reader/MusicPicker.tsx` and
 * `screens/ReaderScreen.tsx`) treats an empty catalogue as a normal, honest
 * state rather than an error.
 */
export type MusicTrack = {
  readonly id: string;
  readonly title: string;
  readonly genres: readonly Genre[];
  readonly source: AVPlaybackSource;
};

export const MUSIC_TRACKS: readonly MusicTrack[] = [];

/**
 * Looks up a track by id. Returns undefined for a null/undefined/unknown id.
 * Takes the track list as a parameter (defaulting to the real catalogue) so
 * this is directly unit-testable against a fixture list.
 */
export function findMusicTrack(
  trackId: string | null | undefined,
  tracks: readonly MusicTrack[] = MUSIC_TRACKS,
): MusicTrack | undefined {
  if (!trackId) return undefined;
  return tracks.find((track) => track.id === trackId);
}

/**
 * Orders a track list for a given story genre: tracks tagged with that
 * genre first (in catalogue order), then every other track (also in
 * catalogue order). Pure and catalogue-agnostic so it is easy to test with a
 * fixture list.
 */
export function orderTracksForGenre(
  tracks: readonly MusicTrack[],
  genre: Genre,
): MusicTrack[] {
  const matching: MusicTrack[] = [];
  const rest: MusicTrack[] = [];
  for (const track of tracks) {
    if (track.genres.includes(genre)) {
      matching.push(track);
    } else {
      rest.push(track);
    }
  }
  return [...matching, ...rest];
}
