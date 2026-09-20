/**
 * The music cache is the reason tracks can live outside the app binary: the
 * first play of a track fetches it, every later one reads it off the device.
 * These tests hold the two properties that make that safe -- a reader never
 * pays for the same megabyte twice, and nothing here can throw into the act of
 * opening a story.
 */
const mockFs = {
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(async () => {}),
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(async () => {}),
};

jest.mock("expo-file-system/legacy", () => mockFs);
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const track = {
  id: "horror_01",
  title: "Horror",
  genres: ["horror"] as const,
  file: "horror_01.m4a",
};

const REMOTE = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/music/horror_01.m4a`;
const LOCAL = "file:///cache/music/horror_01.m4a";

let resolveMusicUri: typeof import("@/lib/music-cache").resolveMusicUri;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockFs.getInfoAsync.mockResolvedValue({ exists: false });
  mockFs.downloadAsync.mockResolvedValue({ status: 200, uri: LOCAL });
  ({ resolveMusicUri } = require("@/lib/music-cache"));
});

it("downloads a track the first time and returns the local file", async () => {
  await expect(resolveMusicUri(track)).resolves.toBe(LOCAL);
  expect(mockFs.downloadAsync).toHaveBeenCalledWith(REMOTE, LOCAL);
});

it("returns the cached file without downloading it again", async () => {
  mockFs.getInfoAsync.mockResolvedValue({ exists: true, size: 1024 });

  await expect(resolveMusicUri(track)).resolves.toBe(LOCAL);
  expect(mockFs.downloadAsync).not.toHaveBeenCalled();
});

it("re-fetches a zero-byte file rather than handing the player an empty one", async () => {
  // A download killed midway leaves the file behind. Trusting `exists` alone
  // would cache that failure forever and the genre would be silent for good.
  mockFs.getInfoAsync.mockResolvedValue({ exists: true, size: 0 });

  await expect(resolveMusicUri(track)).resolves.toBe(LOCAL);
  expect(mockFs.downloadAsync).toHaveBeenCalled();
});

it("shares one download between two callers asking at once", async () => {
  // The reader opens a story while Profile is previewing the same track.
  const [first, second] = await Promise.all([resolveMusicUri(track), resolveMusicUri(track)]);

  expect(first).toBe(LOCAL);
  expect(second).toBe(LOCAL);
  expect(mockFs.downloadAsync).toHaveBeenCalledTimes(1);
});

describe("when the fetch cannot be cached", () => {
  it("falls back to the remote URL when the download throws", async () => {
    mockFs.downloadAsync.mockRejectedValue(new Error("offline"));

    await expect(resolveMusicUri(track)).resolves.toBe(REMOTE);
  });

  it("falls back, and cleans up, on a non-200 response", async () => {
    mockFs.downloadAsync.mockResolvedValue({ status: 404, uri: LOCAL });

    await expect(resolveMusicUri(track)).resolves.toBe(REMOTE);
    // The 404 body must not be left behind to be served as audio next time.
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(LOCAL, { idempotent: true });
  });

  it("retries on the next play rather than caching the failure", async () => {
    mockFs.downloadAsync.mockRejectedValueOnce(new Error("offline"));

    await expect(resolveMusicUri(track)).resolves.toBe(REMOTE);
    await expect(resolveMusicUri(track)).resolves.toBe(LOCAL);
  });
});
