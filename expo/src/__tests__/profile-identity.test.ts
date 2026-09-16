/**
 * Handles, avatars and streaks: the three parts of a profile that can be wrong
 * quietly.
 *
 * A username that validates differently from the database, an avatar upload
 * that swallows a permission refusal, and a streak that counts a local
 * midnight instead of a UTC one all fail without an error anywhere -- and the
 * streak in particular is a number somebody may plan their evening around.
 */

/* eslint-disable import/first */
const mockInvoke = jest.fn();
const mockRequestPermission = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockManipulate = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn().mockResolvedValue({ userId: "u1" }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockRequestPermission(),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

import {
  claimUsername,
  FALLBACK_LADDER,
  isRealAuthorId,
  nextMilestone,
  nextRung,
  pickAndUploadAvatar,
  streakState,
  usernameMessage,
  validateUsername,
  writingSince,
} from "@/lib/profile";

beforeEach(() => {
  mockInvoke.mockReset();
  mockRequestPermission.mockReset();
  mockLaunchLibrary.mockReset();
  mockManipulate.mockReset();
});

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

describe("username validation", () => {
  it("accepts the shapes the database accepts", () => {
    for (const good of ["ada", "ada_l", "a1b", "x9_9x", "a".repeat(20)]) {
      expect(validateUsername(good)).toEqual({ ok: true, username: good });
    }
    // Typed with capitals, stored lowercase. The reader should not be told off
    // for holding shift.
    expect(validateUsername("  AdaLovelace ")).toEqual({
      ok: true,
      username: "adalovelace",
    });
  });

  it("says specifically what is wrong, not just that something is", () => {
    expect(validateUsername("")).toEqual({ ok: false, reason: "empty" });
    expect(validateUsername("ab")).toEqual({ ok: false, reason: "short" });
    expect(validateUsername("a".repeat(21))).toEqual({
      ok: false,
      reason: "long",
    });
    expect(validateUsername("ada lovelace")).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(validateUsername("_ada")).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(validateUsername("ada_")).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(validateUsername("admin")).toEqual({
      ok: false,
      reason: "reserved",
    });

    // Every verdict has a sentence. A refusal with no explanation is the
    // failure mode this whole enum exists to avoid.
    for (
      const bad of ["", "ab", "a".repeat(21), "ada lovelace", "admin"]
    ) {
      expect(usernameMessage(validateUsername(bad))).toBeTruthy();
    }
  });
});

describe("claiming a username", () => {
  it("never reaches the network for a handle that cannot be valid", async () => {
    expect(await claimUsername("ada lovelace")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await claimUsername("admin")).toEqual({
      ok: false,
      reason: "reserved",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reports a lost race as taken rather than as a generic failure", async () => {
    // The shape the server returns when `claim_username` caught a unique
    // violation: someone else committed the same handle a moment earlier.
    mockInvoke.mockResolvedValue({ data: { ok: false, reason: "taken" }, error: null });
    expect(await claimUsername("storyteller")).toEqual({
      ok: false,
      reason: "taken",
    });
  });

  it("keeps the server's normalized handle on success", async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, username: "adalovelace" },
      error: null,
    });
    expect(await claimUsername("AdaLovelace")).toEqual({
      ok: true,
      username: "adalovelace",
    });
  });

  it("does not claim a handle when the request failed", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("network") });
    expect(await claimUsername("storyteller")).toEqual({
      ok: false,
      reason: "offline",
    });
  });
});

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

describe("avatar upload", () => {
  it("stops at a refused permission without opening the picker", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: false,
      reason: "permission",
    });
    // The graceful part: no picker, no upload, and nothing thrown for a caller
    // to turn into a crash.
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("treats a cancelled picker as a non-event", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: false,
      reason: "cancelled",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("downscales before uploading, and sends a JPEG data URL", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.heic" }],
    });
    mockManipulate.mockResolvedValue({ base64: "AAAA" });
    mockInvoke.mockResolvedValue({
      data: { avatarUrl: "https://cdn/avatars/u1/avatar-x.jpg" },
      error: null,
    });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: true,
      avatarUrl: "https://cdn/avatars/u1/avatar-x.jpg",
    });

    // A phone photo is megabytes and the endpoint's body limit is 128 KB, so
    // the resize is what makes the upload possible at all rather than a nicety.
    const [, actions, options] = mockManipulate.mock.calls[0];
    expect(actions).toEqual([{ resize: { width: 512, height: 512 } }]);
    expect(options.base64).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("profile", {
      body: { action: "avatar", image: "data:image/jpeg;base64,AAAA" },
    });
  });

  it("steps the size down until the encoded image fits", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///huge.jpg" }],
    });
    const tooBig = "x".repeat(200_000);
    mockManipulate
      .mockResolvedValueOnce({ base64: tooBig })
      .mockResolvedValueOnce({ base64: "small" });
    mockInvoke.mockResolvedValue({
      data: { avatarUrl: "https://cdn/a.jpg" },
      error: null,
    });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: true,
      avatarUrl: "https://cdn/a.jpg",
    });
    expect(mockManipulate.mock.calls[1][1]).toEqual([
      { resize: { width: 256, height: 256 } },
    ]);
  });

  it("gives up honestly when nothing fits", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///huge.jpg" }],
    });
    mockManipulate.mockResolvedValue({ base64: "x".repeat(200_000) });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not claim success when the upload failed", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.jpg" }],
    });
    mockManipulate.mockResolvedValue({ base64: "AAAA" });
    mockInvoke.mockResolvedValue({ data: null, error: new Error("boom") });

    expect(await pickAndUploadAvatar()).toEqual({
      ok: false,
      reason: "offline",
    });
  });
});

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

describe("streak state across day boundaries", () => {
  const at = (iso: string) => new Date(iso);

  it("is calm when the day is already counted", () => {
    expect(
      streakState(
        {
          currentStreak: 4,
          longestStreak: 9,
          lastActivityDate: "2026-09-10",
        },
        at("2026-09-10T23:59:00Z"),
      ),
    ).toEqual({ kind: "today", days: 4 });
  });

  it("is urgent, and only urgent, on the day the streak can be lost", () => {
    expect(
      streakState(
        {
          currentStreak: 4,
          longestStreak: 9,
          lastActivityDate: "2026-09-09",
        },
        at("2026-09-10T00:01:00Z"),
      ),
    ).toEqual({ kind: "at_risk", days: 4 });
  });

  it("calls a broken streak broken instead of showing the old number", () => {
    // Two days later. The current streak column may still hold 4 until the
    // next `touch_streak` resets it, and showing that 4 as a live streak would
    // be a lie the reader could act on.
    expect(
      streakState(
        {
          currentStreak: 4,
          longestStreak: 9,
          lastActivityDate: "2026-09-08",
        },
        at("2026-09-10T12:00:00Z"),
      ),
    ).toEqual({ kind: "broken", best: 9 });
  });

  it("counts UTC days, not the device's local ones", () => {
    // 09-11 at 08:00 in UTC+13 is 09-10 at 19:00 UTC. The reader's phone says
    // tomorrow; the server says today, and the server is what the streak is
    // stored in. Both must agree, and UTC is the rule that everybody shares.
    const local = at("2026-09-10T19:00:00Z");
    expect(
      streakState(
        {
          currentStreak: 2,
          longestStreak: 2,
          lastActivityDate: "2026-09-10",
        },
        local,
      ),
    ).toEqual({ kind: "today", days: 2 });
  });

  it("has no streak at all rather than a zero-day one", () => {
    expect(
      streakState({
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
      }),
    ).toEqual({ kind: "none" });
    expect(
      streakState({
        currentStreak: 0,
        longestStreak: 12,
        lastActivityDate: null,
      }),
    ).toEqual({ kind: "broken", best: 12 });
  });
});

describe("milestones", () => {
  // The ladder is D2 now: 2, 5, 10, 15, 21, paying 2/4/6/8/10 once each.
  it("runs the five rungs the server pays out on", () => {
    expect(FALLBACK_LADDER.map((rung) => [rung.milestone, rung.credits])).toEqual([
      [2, 2],
      [5, 4],
      [10, 6],
      [15, 8],
      [21, 10],
    ]);
  });

  it("only names one when it is close enough to act on", () => {
    expect(nextMilestone(3)).toBe(5);
    expect(nextMilestone(7)).toBe(10);
    // Five days out: mentioning it every day would make it wallpaper.
    expect(nextMilestone(5)).toBeNull();
    expect(nextMilestone(0)).toBeNull();
    // Past the last one there is nothing left to promise, so nothing is said.
    expect(nextMilestone(400)).toBeNull();
  });

  // The server's ladder wins; the constant is only the fallback.
  it("uses the ladder it is handed rather than the fallback", () => {
    expect(nextMilestone(3, [{ milestone: 4, credits: 3 }])).toBe(4);
    expect(nextRung(3, [{ milestone: 4, credits: 3 }])).toEqual({
      milestone: 4,
      credits: 3,
    });
  });
});

describe("author identity", () => {
  it("separates real accounts from the bundled sample authors", () => {
    expect(isRealAuthorId("11111111-1111-4111-8111-111111111111")).toBe(true);
    // The fixture authors. Asking the endpoint about these would be a 400 for
    // a person who does not exist.
    expect(isRealAuthorId("kathaai")).toBe(false);
    expect(isRealAuthorId("aarav")).toBe(false);
  });

  it("reads a joining date as a month, or says nothing", () => {
    expect(writingSince("2026-03-04T00:00:00Z")).toContain("2026");
    expect(writingSince(null)).toBeNull();
    expect(writingSince("not a date")).toBeNull();
  });
});
