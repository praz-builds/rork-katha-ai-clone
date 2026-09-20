import type { Genre } from "@/types/domain";

/**
 * Ambient background music catalogue for the reader.
 *
 * WHERE THE AUDIO LIVES
 * ---------------------
 * Not in the app binary. The 24 tracks are ~26 MB of HE-AAC, and bundling them
 * put that on every download for a feature most of a session never hears. They
 * live in the public `music` bucket in Supabase Storage (migration 00094),
 * alongside narration audio and covers, and are fetched once and cached on the
 * device by `@/lib/music-cache`. A track is silent only on a cold first play
 * with no network; later opens play from disk, unless the OS has reclaimed the
 * cache directory, in which case it costs one more download.
 *
 * The practical win is release cadence: adding or replacing a track is an
 * upload plus a row here, shippable over OTA, not an app-store release.
 *
 * HOW TO ADD A TRACK
 * -------------------
 * 1. Encode it small. The current set was made on macOS with
 *
 *      afconvert -f m4af -d aach -b 64000 in.mp3 <genre>_<nn>.m4a
 *
 *    (HE-AAC at 64 kbps, about 0.5 MB a minute; a player without HE-AAC
 *    support still plays the AAC core, only duller.)
 * 2. Upload it to the `music` bucket: `scripts/upload-music.sh <file>`.
 * 3. Add one row to MUSIC_TRACKS below.
 *    - `id`: unique, stable, `<genre>_<nn>`. Saved preferences are keyed on
 *      it, so never rename one that has shipped.
 *    - `title` / `artist`: the track's own, shown wherever music is listed.
 *      Do not invent one.
 *    - `genres`: the genres this track is written for. A story in one of them
 *      opens on one of these tracks automatically.
 *    - `file`: the object name in the bucket. Matches `id` plus `.m4a`.
 * 4. Nothing else changes. Auto-play, caching and playback all read this array.
 *
 * Every track is licensed for commercial use in the app (confirmed by the
 * owner on 2026-09-19). The original download names are kept in `from` so a
 * licence can be traced back to its source file.
 */
export type MusicTrack = {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly genres: readonly Genre[];
  /** Object name inside the `music` bucket. */
  readonly file: string;
};

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  // from: alex-morgan-fantasy-adventure-quest-537478.mp3
  { id: "fantasy_01", title: "Adventure Quest", artist: "Alex Morgan", genres: ["fantasy"], file: "fantasy_01.m4a" },
  // from: sonican-wizard-rider-enchanted-fantasy-orchestral-369658.mp3
  { id: "fantasy_02", title: "Wizard Rider", artist: "Sonican", genres: ["fantasy"], file: "fantasy_02.m4a" },
  // from: alex-morgan-romantic-moments-love-emotional-background-587418.mp3
  { id: "romance_01", title: "Romantic Moments", artist: "Alex Morgan", genres: ["romance"], file: "romance_01.m4a" },
  // from: paulyudin-romantic-romantic-music-493488.mp3
  { id: "romance_02", title: "Romantic", artist: "Paul Yudin", genres: ["romance"], file: "romance_02.m4a" },
  // from: atlasaudio-adventure-518065.mp3
  { id: "adventure_01", title: "Adventure", artist: "Atlas Audio", genres: ["adventure"], file: "adventure_01.m4a" },
  // from: leberch-travel-adventure-586187.mp3
  { id: "adventure_02", title: "Travel Adventure", artist: "Leberch", genres: ["adventure"], file: "adventure_02.m4a" },
  // from: the_mountain-comedy-comedy-music-490001.mp3
  { id: "comedy_01", title: "Comedy", artist: "The Mountain", genres: ["comedy"], file: "comedy_01.m4a" },
  // from: andriih-funny-funny-music-599237.mp3
  { id: "comedy_02", title: "Funny", artist: "AndriiH", genres: ["comedy"], file: "comedy_02.m4a" },
  // from: the_mountain-educational-background-167599.mp3
  { id: "educational_01", title: "Educational Background", artist: "The Mountain", genres: ["educational"], file: "educational_01.m4a" },
  // from: tatamusic-educational-education-school-music-377662.mp3
  { id: "educational_02", title: "School Music", artist: "TataMusic", genres: ["educational"], file: "educational_02.m4a" },
  // from: nastelbom-atmospheric-436860.mp3
  { id: "fanfiction_01", title: "Atmospheric", artist: "Nastelbom", genres: ["fanfiction"], file: "fanfiction_01.m4a" },
  // from: jorisvermeer-atmospheric-nature-documentary-558770.mp3
  { id: "fanfiction_02", title: "Nature Documentary", artist: "Joris Vermeer", genres: ["fanfiction"], file: "fanfiction_02.m4a" },
  // from: harumachimusic-dark-meadow-mysterious-ambient-music-170324.mp3
  { id: "folktale_01", title: "Dark Meadow", artist: "Harumachi Music", genres: ["folktale"], file: "folktale_01.m4a" },
  // from: geoffharvey-the-songbirds-135855.mp3
  { id: "folktale_02", title: "The Songbirds", artist: "Geoff Harvey", genres: ["folktale"], file: "folktale_02.m4a" },
  // from: atlasaudio-historical-519440.mp3
  { id: "historical_01", title: "Historical", artist: "Atlas Audio", genres: ["historical"], file: "historical_01.m4a" },
  // from: viacheslavstarostin-historical-history-documentary-music-366065.mp3
  { id: "historical_02", title: "History Documentary", artist: "Viacheslav Starostin", genres: ["historical"], file: "historical_02.m4a" },
  // from: leberch-sci-fi-ambient-589945.mp3
  { id: "scifi_01", title: "Sci-Fi Ambient", artist: "Leberch", genres: ["scifi"], file: "scifi_01.m4a" },
  // from: leberch-sci-fi-documentary-262608.mp3
  { id: "scifi_02", title: "Sci-Fi Documentary", artist: "Leberch", genres: ["scifi"], file: "scifi_02.m4a" },
  // from: leberch-suspense-mystery-375354.mp3
  { id: "mystery_01", title: "Suspense Mystery", artist: "Leberch", genres: ["mystery"], file: "mystery_01.m4a" },
  // from: paulyudin-mystery-atmosphere-ambient-documentary-380714.mp3
  { id: "mystery_02", title: "Mystery Atmosphere", artist: "Paul Yudin", genres: ["mystery"], file: "mystery_02.m4a" },
  // from: kiravale-horror-music-593677.mp3
  { id: "horror_01", title: "Horror", artist: "Kira Vale", genres: ["horror"], file: "horror_01.m4a" },
  // from: alex-morgan-ambient-horror-creepy-atmosphere-dark-587402.mp3
  { id: "horror_02", title: "Creepy Atmosphere", artist: "Alex Morgan", genres: ["horror"], file: "horror_02.m4a" },
  // from: the_mountain-quiet-life-136944.mp3
  { id: "slice_of_life_01", title: "Quiet Life", artist: "The Mountain", genres: ["sliceOfLife"], file: "slice_of_life_01.m4a" },
  // from: the_mountain-life-change-131649.mp3
  { id: "slice_of_life_02", title: "Life Change", artist: "The Mountain", genres: ["sliceOfLife"], file: "slice_of_life_02.m4a" },
];

/**
 * Genres with no tracks of their own borrow the closest genre's music, so no
 * story opens in silence just because its genre was not scored.
 *
 * Fantasy and romance used to borrow and no longer do: they are the two
 * genres most picked on the Create screen, and they now have their own tracks.
 * The rest live on older and seed stories.
 */
// Every member of Genre must end up with a track, its own or borrowed: a
// story reaches the reader carrying one of the 17 in GENRES, not one of the 12
// Create offers, and a genre missing from here opens in silence with no error.
// A test walks all of GENRES so adding one without music fails there.
const BORROWED_MUSIC_GENRE: Partial<Record<Genre, Genre>> = {
  romantasy: "fantasy",
  contemporary: "sliceOfLife",
  poetry: "sliceOfLife",
  darkRomance: "mystery",
  thriller: "mystery",
};

/** The genre whose music a story in `genre` plays: its own, or the one it borrows. */
export function musicGenreFor(genre: Genre): Genre {
  return BORROWED_MUSIC_GENRE[genre] ?? genre;
}

/**
 * The public URL a track streams and caches from.
 *
 * Built from the same Supabase URL the client already uses, so a project swap
 * moves the music with it and there is no second base URL to keep in step.
 */
export function musicTrackUrl(track: MusicTrack): string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/music/${track.file}`;
}

function tracksForGenre(tracks: readonly MusicTrack[], genre: Genre): MusicTrack[] {
  const musicGenre = musicGenreFor(genre);
  return tracks.filter((track) => track.genres.includes(genre) || track.genres.includes(musicGenre));
}

/**
 * The track a story starts on when its reader has not chosen one.
 *
 * Picked from the story id rather than at random, so the same story always
 * opens to the same music while two stories in one genre can differ. Returns
 * undefined when the genre has no music, own or borrowed.
 */
export function defaultTrackForStory(
  storyId: string,
  genre: Genre,
  tracks: readonly MusicTrack[] = MUSIC_TRACKS,
): MusicTrack | undefined {
  const candidates = tracksForGenre(tracks, genre);
  if (candidates.length === 0) return undefined;
  let hash = 0;
  for (let i = 0; i < storyId.length; i += 1) {
    hash = (hash * 31 + storyId.charCodeAt(i)) >>> 0;
  }
  return candidates[hash % candidates.length];
}

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
 * Orders a track list for a given story genre: tracks for that genre (or the
 * genre it borrows music from) first, in catalogue order, then every other
 * track, also in catalogue order. Pure and catalogue-agnostic so it is easy
 * to test with a fixture list.
 *
 * Used by the Profile music settings, where a reader browses and previews the
 * whole catalogue and sets a per-genre default.
 */
export function orderTracksForGenre(
  tracks: readonly MusicTrack[],
  genre: Genre,
): MusicTrack[] {
  const matching = tracksForGenre(tracks, genre);
  return [...matching, ...tracks.filter((track) => !matching.includes(track))];
}
