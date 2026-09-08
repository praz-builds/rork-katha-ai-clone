/**
 * Two selections in quick succession must not erase each other.
 *
 * Every write read the whole selection map, edited one key and wrote it back.
 * Two of those overlapping meant the second read saw the state from before the
 * first write landed, so the earlier choice vanished with no error anywhere. A
 * reader hits this by changing track twice quickly, which is exactly what
 * someone auditioning music does.
 *
 * This lives in its own file because it needs AsyncStorage mocked with real
 * await boundaries -- without them the interleaving the bug depends on cannot
 * happen, and the test would pass against the broken code.
 */
const store: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    await Promise.resolve();
    return store[key] ?? null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    await Promise.resolve();
    store[key] = value;
  }),
  removeItem: jest.fn(async () => {}),
}));

import {
  getStoryMusicTrackId,
  setStoryMusicTrackId,
} from "@/lib/music-storage";

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

it("keeps both selections when two writes overlap", async () => {
  await Promise.all([
    setStoryMusicTrackId("story-a", "track-a"),
    setStoryMusicTrackId("story-b", "track-b"),
  ]);

  expect(await getStoryMusicTrackId("story-a")).toBe("track-a");
  expect(await getStoryMusicTrackId("story-b")).toBe("track-b");
});

it("keeps the last write when the same story is set twice in a row", async () => {
  await Promise.all([
    setStoryMusicTrackId("story-a", "track-a"),
    setStoryMusicTrackId("story-a", "track-b"),
  ]);

  expect(await getStoryMusicTrackId("story-a")).toBe("track-b");
});

it("a clear is not undone by a concurrent write to another story", async () => {
  await setStoryMusicTrackId("story-a", "track-a");
  await Promise.all([
    setStoryMusicTrackId("story-a", null),
    setStoryMusicTrackId("story-b", "track-b"),
  ]);

  expect(await getStoryMusicTrackId("story-a")).toBeNull();
  expect(await getStoryMusicTrackId("story-b")).toBe("track-b");
});
