/**
 * Two per-genre defaults set in quick succession must not erase each other.
 *
 * Every write read the whole genre map, edited one key and wrote it back. Two
 * of those overlapping meant the second read saw the state from before the
 * first write landed, so the earlier choice vanished with no error anywhere. A
 * reader hits this by setting two genres quickly in Profile, which is exactly
 * what someone auditioning music does.
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
  getGenreTrackId,
  setGenreTrackId,
} from "@/lib/music-storage";

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

it("keeps both defaults when two writes overlap", async () => {
  await Promise.all([
    setGenreTrackId("horror", "horror_01"),
    setGenreTrackId("fantasy", "fantasy_02"),
  ]);

  expect(await getGenreTrackId("horror")).toBe("horror_01");
  expect(await getGenreTrackId("fantasy")).toBe("fantasy_02");
});

it("keeps the last write when the same genre is set twice in a row", async () => {
  await Promise.all([
    setGenreTrackId("horror", "horror_01"),
    setGenreTrackId("horror", "horror_02"),
  ]);

  expect(await getGenreTrackId("horror")).toBe("horror_02");
});

it("a clear is not undone by a concurrent write to another genre", async () => {
  await setGenreTrackId("horror", "horror_01");
  await Promise.all([
    setGenreTrackId("horror", null),
    setGenreTrackId("fantasy", "fantasy_02"),
  ]);

  // Cleared back to "no preference", so the catalogue chooses again.
  expect(await getGenreTrackId("horror")).toBeUndefined();
  expect(await getGenreTrackId("fantasy")).toBe("fantasy_02");
});
