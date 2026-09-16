/**
 * One `OwnProfile` fixture, shared by every suite that needs one.
 *
 * `OwnProfile` grew six fields in the profile/credits/journey work (avatarId,
 * entitlementOverride, referralCode, referral, ladder, milestones) and every
 * test that had hand-written its own literal broke at once. A field added to
 * the type should cost one edit here, not one edit per literal per suite,
 * which is the whole reason this file is not in `__tests__/` — Jest's default
 * `testMatch` treats everything under that directory as a suite.
 *
 * Defaults describe the ordinary case: a signed-in reader, a live streak, no
 * override, the fallback ladder, nothing on it reached yet. Anything a test
 * actually cares about it passes in.
 */
import {
  FALLBACK_LADDER,
  type OwnProfile,
  type StreakMilestone,
} from "@/lib/profile";

/** Today, as the `YYYY-MM-DD` the streak functions compare against. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function ownProfile(over: Partial<OwnProfile> = {}): OwnProfile {
  return {
    userId: "u1",
    username: "ada",
    displayName: "Ada",
    avatarUrl: null,
    bio: null,
    memberSince: "2026-08-01T00:00:00Z",
    deletedAt: null,
    currentStreak: 1,
    longestStreak: 2,
    lastActivityDate: todayIso(),
    storiesWritten: 0,
    chaptersWritten: 0,
    totalReads: 0,
    totalLikes: 0,
    phrasesSaved: 0,
    followers: 0,
    following: 0,
    avatarId: null,
    entitlementOverride: null,
    referralCode: null,
    referral: { invited: 0, credited: 0, monthRemaining: 0 },
    ladder: [...FALLBACK_LADDER],
    milestones: [],
    ...over,
  };
}

/** A reached rung, the shape `profile_overview` returns it in. */
export function reachedMilestone(
  milestone: number,
  credits: number,
  achievedAt: string | null = "2026-09-08T00:00:00Z",
): StreakMilestone {
  return { milestone, credits, achievedAt, credited: true };
}
