import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-story reader music selection.
 *
 * A single JSON map keyed by story id lives under one AsyncStorage key,
 * following the `katha.reader.*.v1` namespace ReaderScreen already uses for
 * reading preferences. "None" is represented by the story having no entry in
 * the map, so picking "None" removes the key rather than storing a value.
 */
const MUSIC_SELECTION_KEY = "katha.reader.music.v1";

type MusicSelectionMap = Record<string, string>;

async function readSelectionMap(): Promise<MusicSelectionMap> {
  try {
    const raw = await AsyncStorage.getItem(MUSIC_SELECTION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: MusicSelectionMap = {};
    for (const [storyId, trackId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof trackId === "string") map[storyId] = trackId;
    }
    return map;
  } catch {
    return {};
  }
}

/** Reads the saved track id for a story, or null if none is saved. */
export async function getStoryMusicTrackId(storyId: string): Promise<string | null> {
  const map = await readSelectionMap();
  return map[storyId] ?? null;
}

/** Saves (or, with a null trackId, clears) the music selection for a story. */
export async function setStoryMusicTrackId(storyId: string, trackId: string | null): Promise<void> {
  try {
    const map = await readSelectionMap();
    if (trackId) {
      map[storyId] = trackId;
    } else {
      delete map[storyId];
    }
    await AsyncStorage.setItem(MUSIC_SELECTION_KEY, JSON.stringify(map));
  } catch {
    // Silent fail. Music selection persistence is best-effort, matching draft-storage.ts.
  }
}
