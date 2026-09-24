/**
 * The app-wide copy of the reader's own profile, where it can show one
 * account's details to another.
 *
 * Every test here guards a line whose absence puts somebody else's name,
 * picture, streak or calendar on a person's screen, and each was checked to
 * fail with its guard removed.
 */
const mockStorage = new Map<string, string>();
const mockFetchOwnProfile = jest.fn();
const mockFetchActivityCalendar = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (key: string) => Promise.resolve(mockStorage.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  },
}));
jest.mock("@/lib/analytics", () => ({ captureError: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn(),
      signInAnonymously: jest.fn(),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock("@/lib/profile", () => ({
  ...jest.requireActual("@/lib/profile"),
  fetchOwnProfile: (...args: unknown[]) => mockFetchOwnProfile(...args),
  fetchActivityCalendar: (...args: unknown[]) => mockFetchActivityCalendar(...args),
}));

/* eslint-disable import/first */
import { setViewerId } from "@/lib/ownership";
import { OWN_PROFILE_CACHE_KEY } from "@/lib/profile-cache-key";
import {
  clearOwnProfile,
  getOwnCalendar,
  getOwnProfile,
  hydrateOwnProfileCache,
  refreshOwnCalendar,
  refreshOwnProfile,
  resetProfileStoreForTests,
} from "@/lib/profile-store";
import { signOutToSignIn } from "@/lib/session";
import { ownProfile } from "@/test-support/profileFixtures";
/* eslint-enable import/first */

const ada = () =>
  ownProfile({
    userId: "user-a",
    displayName: "Ada",
    referralCode: "ada_invite",
    entitlementOverride: "katha",
    phrasesSaved: 12,
  });
const bo = () => ownProfile({ userId: "user-b", displayName: "Bo" });

/** A promise this test resolves by hand, so it can land after something else. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  mockStorage.clear();
  mockFetchOwnProfile.mockReset();
  mockFetchActivityCalendar.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  setViewerId(null);
  resetProfileStoreForTests();
});

describe("the device copy", () => {
  it("writes only what the first frame draws, and whose it is", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();

    const stored = JSON.parse(mockStorage.get(OWN_PROFILE_CACHE_KEY) ?? "null");
    expect(stored.userId).toBe("user-a");
    expect(stored.profile.displayName).toBe("Ada");
    // Never restored from a file: an override on disk is a plan on disk.
    expect(stored.profile).not.toHaveProperty("entitlementOverride");
    expect(stored.profile).not.toHaveProperty("referralCode");
    expect(stored.profile).not.toHaveProperty("referral");
    expect(stored.profile).not.toHaveProperty("phrasesSaved");
  });

  it("is not shown to a viewer it does not belong to", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    // Ada's copy left on disk, as a sign-out that never finished would leave it.
    const leftBehind = mockStorage.get(OWN_PROFILE_CACHE_KEY)!;
    resetProfileStoreForTests();
    mockStorage.set(OWN_PROFILE_CACHE_KEY, leftBehind);

    setViewerId("user-b");
    await hydrateOwnProfileCache();
    expect(getOwnProfile()).toBeNull();
  });

  it("is shown to the viewer it belongs to", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    const saved = mockStorage.get(OWN_PROFILE_CACHE_KEY)!;
    resetProfileStoreForTests();
    mockStorage.set(OWN_PROFILE_CACHE_KEY, saved);

    setViewerId("user-a");
    await hydrateOwnProfileCache();
    expect(getOwnProfile()?.displayName).toBe("Ada");
    // Restored without the fields that never went to disk.
    expect(getOwnProfile()?.entitlementOverride).toBeNull();
    expect(getOwnProfile()?.referralCode).toBeNull();
  });

  it("is removed from the device on sign-out", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    expect(mockStorage.has(OWN_PROFILE_CACHE_KEY)).toBe(true);

    await signOutToSignIn();
    expect(mockStorage.has(OWN_PROFILE_CACHE_KEY)).toBe(false);
  });
});

describe("changing accounts", () => {
  it("drops a calendar requested for the account that left", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    const late = deferred<string[] | null>();
    mockFetchActivityCalendar.mockReturnValueOnce(late.promise);
    const pending = refreshOwnCalendar();

    clearOwnProfile();
    late.resolve(["2026-09-01"]);
    await pending;
    await flush();

    expect(getOwnProfile()).toBeNull();
    expect(getOwnCalendar()).toBeNull();
  });

  it("does not hand the previous account's in-flight calendar to the next one", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    const adasCalendar = deferred<string[] | null>();
    mockFetchActivityCalendar.mockReturnValueOnce(adasCalendar.promise);
    const pending = refreshOwnCalendar();

    // A different account's profile arrives while Ada's calendar is in flight.
    mockFetchOwnProfile.mockResolvedValue(bo());
    await refreshOwnProfile();
    adasCalendar.resolve(["2026-09-01", "2026-09-02"]);
    await pending;
    await flush();

    expect(getOwnProfile()?.userId).toBe("user-b");
    expect(getOwnCalendar()).toBeNull();
    const stored = JSON.parse(mockStorage.get(OWN_PROFILE_CACHE_KEY) ?? "null");
    expect(stored.calendar).toBeNull();
  });

  it("stops showing another account's copy when the refresh fails", async () => {
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();

    // Now signed in as Bo, and Bo's profile read fails.
    setViewerId("user-b");
    mockFetchOwnProfile.mockResolvedValue(null);
    await refreshOwnProfile();

    expect(getOwnProfile()).toBeNull();
    expect(mockStorage.has(OWN_PROFILE_CACHE_KEY)).toBe(false);
  });

  it("keeps this viewer's own copy when a refresh fails", async () => {
    setViewerId("user-a");
    mockFetchOwnProfile.mockResolvedValue(ada());
    await refreshOwnProfile();
    mockFetchOwnProfile.mockResolvedValue(null);
    await refreshOwnProfile();
    expect(getOwnProfile()?.displayName).toBe("Ada");
  });
});
