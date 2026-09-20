import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Genre } from "@/types/domain";

/**
 * Reader music preferences.
 *
 * Two things are stored, both global rather than per-story, under the
 * `katha.reader.*.v1` namespace ReaderScreen already uses:
 *
 * 1. Muted. The reader's mute control in the reader chrome, and the same
 *    switch in Profile. Off by default: a story opens with music.
 * 2. A per-genre default track. Set in Profile ("the music for horror should
 *    be this one"), read here when a story opens.
 *
 * There is deliberately no per-story choice. An earlier build put a track
 * picker in the reader and saved a selection against each story id, which made
 * choosing music a thing you did mid-read, story by story, and left a growing
 * map of dead story ids behind. Music is a setting, not a per-story decision.
 */
const MUSIC_MUTED_KEY = "katha.reader.music-muted.v1";
const GENRE_TRACK_KEY = "katha.reader.music-genre.v1";

/**
 * Whether ambient music is silenced everywhere. False unless the reader muted
 * it; a failed read counts as unmuted, the shipped default.
 */
export async function getMusicMuted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MUSIC_MUTED_KEY)) === "muted";
  } catch {
    return false;
  }
}

export async function setMusicMuted(muted: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(MUSIC_MUTED_KEY, muted ? "muted" : "on");
  } catch {
    // Best-effort, like the genre map below.
  }
}

type GenreTrackMap = Partial<Record<Genre, string>>;

async function readGenreMap(): Promise<GenreTrackMap> {
  try {
    const raw = await AsyncStorage.getItem(GENRE_TRACK_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: GenreTrackMap = {};
    for (const [genre, trackId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof trackId === "string") map[genre as Genre] = trackId;
    }
    return map;
  } catch {
    return {};
  }
}

/** Every per-genre default the reader has set. Genres they have not set are absent. */
export async function getGenreTrackMap(): Promise<GenreTrackMap> {
  return readGenreMap();
}

/**
 * The track id a genre should open on, or undefined to use the catalogue's
 * own choice for the story.
 */
export async function getGenreTrackId(genre: Genre): Promise<string | undefined> {
  return (await readGenreMap())[genre];
}

/**
 * Serialises writes so a read-modify-write cannot be interleaved.
 *
 * Every write reads the whole map, edits one key, and writes it back. Two of
 * those overlapping meant the second read saw the state before the first write
 * landed, so the first selection was silently erased -- which a reader hits by
 * changing two genres quickly in Profile. Chaining on a single promise makes
 * each write see the previous one's result.
 */
let writeQueue: Promise<void> = Promise.resolve();

/** Sets a genre's default track; a null trackId clears it back to the catalogue's choice. */
export function setGenreTrackId(genre: Genre, trackId: string | null): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      const map = await readGenreMap();
      if (trackId === null) delete map[genre];
      else map[genre] = trackId;
      await AsyncStorage.setItem(GENRE_TRACK_KEY, JSON.stringify(map));
    } catch {
      // Silent fail. Music preference persistence is best-effort, matching
      // draft-storage.ts. The queue must survive a failure, so this swallows
      // rather than rejecting: one bad write must not strand every later one.
    }
  });
  return writeQueue;
}
