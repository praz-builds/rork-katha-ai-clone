import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { musicTrackUrl, type MusicTrack } from "@/lib/music-catalogue";

/**
 * On-device cache for ambient music.
 *
 * The tracks are not bundled (see music-catalogue.ts), so the first play of a
 * track fetches it. Streaming it every time would spend a megabyte of a
 * reader's data on every story they open, which is indefensible for background
 * music -- so the first fetch is a download to the cache directory and every
 * later play is local.
 *
 * The cache directory is the right home rather than documents: the OS may
 * reclaim it under storage pressure, and the only cost of that is one more
 * download. Nothing here is user data.
 *
 * Two callers share this module deliberately. The reader warms the cache for
 * the track a story opens on, and the Profile music settings warm it for a
 * track the reader previews; whichever happens first spares the other.
 */
const CACHE_DIR = `${FileSystem.cacheDirectory ?? ""}music/`;

/** In-flight downloads, keyed by track id, so two callers share one fetch. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Bumped by every clear.
 *
 * A download that was already in flight when the cache was cleared would
 * otherwise finish afterwards and write its file back into a directory the
 * reader had just emptied -- so "Clear downloaded music" would report success
 * and leave a track behind. A download compares this against the value it
 * started with, and a download from before the clear removes its own file
 * instead of keeping it.
 */
let cacheGeneration = 0;

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/**
 * The URI to hand expo-av for a track: a cached local file when there is one,
 * otherwise the remote URL.
 *
 * Never rejects. Every failure -- no network, no space, a storage 404 -- falls
 * back to the remote URL, which either streams or fails at the player, where
 * the reader already tolerates silence. Music must never be the thing that
 * throws inside opening a story.
 *
 * On web there is no file system to cache into and the browser's own HTTP
 * cache already does this job, so the remote URL is returned unchanged.
 */
export async function resolveMusicUri(track: MusicTrack): Promise<string> {
  const remoteUrl = musicTrackUrl(track);
  if (Platform.OS === "web" || !FileSystem.cacheDirectory) return remoteUrl;

  const existing = inFlight.get(track.id);
  if (existing) return existing;

  const target = `${CACHE_DIR}${track.file}`;
  const startedAt = cacheGeneration;
  const download = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(target);
      // A zero-byte file is a download that died midway. Treating it as a hit
      // would hand the player an empty file and cache the failure forever, so
      // it is re-fetched like a miss.
      if (info.exists && "size" in info && (info.size ?? 0) > 0) {
        // A clear that landed while this read was in flight has already taken
        // the file, so the path is stale even though it existed a moment ago.
        return cacheGeneration === startedAt ? target : remoteUrl;
      }
      await ensureCacheDir();
      const result = await FileSystem.downloadAsync(remoteUrl, target);
      if (result.status !== 200) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        return remoteUrl;
      }
      if (cacheGeneration !== startedAt) {
        // Cleared while this was downloading. Undo it rather than leave a file
        // behind in a cache the reader asked to be empty.
        await FileSystem.deleteAsync(target, { idempotent: true });
        return remoteUrl;
      }
      return result.uri;
    } catch {
      return remoteUrl;
    } finally {
      inFlight.delete(track.id);
    }
  })();

  inFlight.set(track.id, download);
  return download;
}

/**
 * Drops every cached track. Exposed for a "Clear downloaded music" control in
 * the Profile settings; nothing calls it automatically.
 *
 * Resolves only once the cache is genuinely empty. The generation is bumped
 * before the delete so a download already in flight cleans up after itself,
 * and the in-flight set is awaited afterwards so a reader who clears while a
 * story is fetching is not told it is done while a file is still landing.
 */
export async function clearMusicCache(): Promise<void> {
  cacheGeneration += 1;
  const pending = Array.from(inFlight.values());
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch {
    // Best-effort: a cache that would not clear is not worth an error to a
    // reader, and the OS reclaims it under pressure anyway.
  }
  // Never rejects (resolveMusicUri swallows its own failures), but allSettled
  // keeps that true even if that ever changes.
  await Promise.allSettled(pending);
}
