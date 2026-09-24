import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  fetchActivityCalendar,
  fetchOwnProfile,
  fetchPublicProfile,
  type OwnProfile,
  type PublicProfileResult,
} from "@/lib/profile";
import { getViewerId } from "@/lib/ownership";
import {
  LEGACY_OWN_PROFILE_CACHE_KEYS,
  OWN_PROFILE_CACHE_KEY,
} from "@/lib/profile-cache-key";

/**
 * The reader's own profile and calendar, held once for the whole app.
 *
 * WHY THIS EXISTS. The Profile tab unmounts on every tab switch, and it used to
 * fetch the profile again each time it came back -- after the boot had already
 * fetched the same row and thrown it away. Your journey then fetched the
 * calendar only once it had opened, so its heatmap always arrived late.
 * Every visit waited on the network for rows the app had seen seconds before.
 *
 * Now there is one copy. The boot fills it, the screens draw from it at once,
 * and each visit refreshes it quietly behind what is already on screen
 * (stale-while-revalidate). The last good copy is also kept on the device, so a
 * cold start shows real rows on its first frame instead of a spinner.
 *
 * LOADING IS NOT FAILING. Each value carries a status as well as its data, so a
 * screen can tell "not answered yet" from "could not be answered". Journey used
 * to show "could not be loaded" during every ordinary load because it had only
 * the data to go on, and null meant both.
 */

export type LoadStatus = "idle" | "loading" | "ready" | "error";

type Snapshot = {
  profile: OwnProfile | null;
  profileStatus: LoadStatus;
  calendar: string[] | null;
  calendarStatus: LoadStatus;
};

/** A copy this young is shown without asking the server again. */
export const FRESH_FOR_MS = 30_000;

let snapshot: Snapshot = {
  profile: null,
  profileStatus: "idle",
  calendar: null,
  calendarStatus: "idle",
};
let profileFetchedAt = 0;
let calendarFetchedAt = 0;
let profileInFlight: Promise<OwnProfile | null> | null = null;
let calendarInFlight: Promise<string[] | null> | null = null;
let hydration: Promise<void> | null = null;
/**
 * Bumped whenever the account changes (`clearOwnProfile`, or a profile for a
 * different user arriving), so a request started for the previous account
 * cannot write into the next one.
 */
let epoch = 0;
const listeners = new Set<() => void>();

function update(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

export function getOwnProfile(): OwnProfile | null {
  return snapshot.profile;
}

export function getOwnCalendar(): string[] | null {
  return snapshot.calendar;
}

/** The whole store, re-rendering when any of it moves. */
export function useOwnProfileStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// The device copy
// ---------------------------------------------------------------------------

/**
 * What goes to disk: only what the first frame draws, and whose it is.
 *
 * Not the whole row. The referral code and summary, the entitlement override,
 * and the story counts are not drawn before the server
 * answers, and a copy of them on disk is only something to leak or to trust
 * wrongly. The override in particular must never be restored from a file.
 */
type DiskProfile = Pick<
  OwnProfile,
  | "userId"
  | "username"
  | "displayName"
  | "avatarUrl"
  | "avatarId"
  | "bio"
  | "memberSince"
  | "currentStreak"
  | "longestStreak"
  | "lastActivityDate"
  | "followers"
  | "following"
  | "ladder"
  | "milestones"
>;

type DiskRecord = { userId: string; profile: DiskProfile; calendar: string[] | null };

function project(profile: OwnProfile): DiskProfile {
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    avatarId: profile.avatarId,
    bio: profile.bio,
    memberSince: profile.memberSince,
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    lastActivityDate: profile.lastActivityDate,
    followers: profile.followers,
    following: profile.following,
    ladder: profile.ladder,
    milestones: profile.milestones,
  };
}

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;

/** A disk record back to a profile, or null when any of it is not what was written. */
function restore(raw: string): { profile: OwnProfile; calendar: string[] | null } | null {
  const parsed = JSON.parse(raw) as Partial<DiskRecord> | null;
  const stored = parsed?.profile as Record<string, unknown> | undefined;
  if (!parsed || !stored || typeof parsed.userId !== "string") return null;
  // The record names its owner twice; a file where they disagree is not one
  // this code wrote.
  if (stored.userId !== parsed.userId) return null;
  const avatarUrl = text(stored.avatarUrl);
  if (avatarUrl !== null && !/^https:\/\//.test(avatarUrl)) return null;

  const ladder = Array.isArray(stored.ladder)
    ? (stored.ladder as unknown[])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => ({ milestone: count(row.milestone), credits: count(row.credits) }))
    : [];
  const milestones = Array.isArray(stored.milestones)
    ? (stored.milestones as unknown[])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => ({
        milestone: count(row.milestone),
        credits: count(row.credits),
        achievedAt: text(row.achievedAt),
        credited: row.credited === true,
      }))
    : [];

  const profile: OwnProfile = {
    userId: parsed.userId,
    username: text(stored.username),
    displayName: text(stored.displayName),
    avatarUrl,
    avatarId: text(stored.avatarId),
    bio: text(stored.bio),
    memberSince: text(stored.memberSince),
    deletedAt: null,
    currentStreak: count(stored.currentStreak),
    longestStreak: count(stored.longestStreak),
    lastActivityDate: text(stored.lastActivityDate),
    followers: count(stored.followers),
    following: count(stored.following),
    ladder,
    milestones,
    // Not on disk, by design; the server's answer fills them in.
    storiesWritten: 0,
    chaptersWritten: 0,
    totalReads: 0,
    totalLikes: 0,
    entitlementOverride: null,
    referralCode: null,
    referral: { invited: 0, credited: 0, monthRemaining: 0 },
  };
  const calendar = Array.isArray(parsed.calendar) &&
      parsed.calendar.every((day) => typeof day === "string")
    ? parsed.calendar
    : null;
  return { profile, calendar };
}

function persist(): void {
  const { profile, calendar } = snapshot;
  if (!profile) return;
  const record: DiskRecord = {
    userId: profile.userId,
    profile: project(profile),
    calendar,
  };
  AsyncStorage.setItem(OWN_PROFILE_CACHE_KEY, JSON.stringify(record)).catch(() => {
    // A cache that cannot write is a cache that misses. Nothing else breaks.
  });
}

/** True when the viewer is known and is not this user. */
function belongsToSomebodyElse(userId: string): boolean {
  const viewer = getViewerId();
  return viewer !== null && viewer !== userId;
}

/**
 * Put the last good copy on screen, if there is one, it is this viewer's, and
 * nothing newer is.
 *
 * An async restore must never overwrite an answer that arrived first (see
 * AGENTS.md): the server may well beat AsyncStorage on a fast network, and
 * the device copy is older by definition.
 *
 * It runs at boot, before the session is known, so ownership is checked here
 * where it can be (the viewer id, if bootstrap has answered) and again by the
 * app once it does (`App.tsx` clears a copy whose user is not the session's).
 */
export function hydrateOwnProfileCache(): Promise<void> {
  if (hydration) return hydration;
  const startedIn = epoch;
  // The v1 record carried no owner and the whole row; it is never read.
  for (const key of LEGACY_OWN_PROFILE_CACHE_KEYS) {
    AsyncStorage.removeItem(key).catch(() => {});
  }
  hydration = AsyncStorage.getItem(OWN_PROFILE_CACHE_KEY)
    .then((raw) => {
      if (!raw || startedIn !== epoch) return;
      const restored = restore(raw);
      if (!restored) return;
      const { profile, calendar } = restored;
      if (belongsToSomebodyElse(profile.userId)) return;
      // The server already answered, for somebody else: nothing here is theirs.
      if (snapshot.profile && snapshot.profile.userId !== profile.userId) return;
      const patch: Partial<Snapshot> = {};
      if (!snapshot.profile) patch.profile = profile;
      if (!snapshot.calendar && calendar) patch.calendar = calendar;
      if (Object.keys(patch).length > 0) update(patch);
    })
    .catch(() => {
      // Unreadable or malformed: the network answer is on its way anyway.
    });
  return hydration;
}

/**
 * Ask the server for the profile, unless the copy held is younger than
 * `maxAgeMs`. Concurrent callers share one request.
 *
 * A failed refresh keeps the copy already on screen -- if it is this viewer's.
 * Only a reader with no copy at all sees the error state.
 */
export function refreshOwnProfile(
  options: { maxAgeMs?: number } = {},
): Promise<OwnProfile | null> {
  const maxAgeMs = options.maxAgeMs ?? 0;
  if (
    snapshot.profile &&
    snapshot.profileStatus === "ready" &&
    Date.now() - profileFetchedAt < maxAgeMs
  ) {
    return Promise.resolve(snapshot.profile);
  }
  if (profileInFlight) return profileInFlight;

  const startedIn = epoch;
  update({ profileStatus: "loading" });
  const request = fetchOwnProfile()
    .catch(() => null)
    .then((profile) => {
      if (startedIn !== epoch) return null;
      if (profile) {
        const switched = snapshot.profile !== null &&
          snapshot.profile.userId !== profile.userId;
        if (switched) {
          // A different person than the held copy (a restored cache from
          // another sign-in, a sign-in onto an existing account). Everything
          // held or in flight for the previous one is theirs, not this one's:
          // a new epoch makes an old calendar request land nowhere.
          epoch += 1;
          calendarInFlight = null;
          calendarFetchedAt = 0;
          publicProfiles.clear();
        }
        profileFetchedAt = Date.now();
        update({
          profile,
          profileStatus: "ready",
          ...(switched ? { calendar: null, calendarStatus: "idle" as const } : {}),
        });
        persist();
      } else if (snapshot.profile && belongsToSomebodyElse(snapshot.profile.userId)) {
        // The refresh failed and what is held is another account's: showing
        // it with an error badge would still be showing it.
        update({
          profile: null,
          profileStatus: "error",
          calendar: null,
          calendarStatus: "idle",
        });
        AsyncStorage.removeItem(OWN_PROFILE_CACHE_KEY).catch(() => {});
      } else {
        update({ profileStatus: "error" });
      }
      return profile;
    })
    .finally(() => {
      if (profileInFlight === request) profileInFlight = null;
    });
  profileInFlight = request;
  return request;
}

/** The same, for the activity calendar. Started early so Journey opens on it. */
export function refreshOwnCalendar(
  options: { maxAgeMs?: number } = {},
): Promise<string[] | null> {
  const maxAgeMs = options.maxAgeMs ?? 0;
  if (
    snapshot.calendar &&
    snapshot.calendarStatus === "ready" &&
    Date.now() - calendarFetchedAt < maxAgeMs
  ) {
    return Promise.resolve(snapshot.calendar);
  }
  if (calendarInFlight) return calendarInFlight;

  const startedIn = epoch;
  update({ calendarStatus: "loading" });
  const request = fetchActivityCalendar()
    .catch(() => null)
    .then((days) => {
      if (startedIn !== epoch) return null;
      if (days) {
        calendarFetchedAt = Date.now();
        update({ calendar: days, calendarStatus: "ready" });
        persist();
      } else {
        update({ calendarStatus: "error" });
      }
      return days;
    })
    .finally(() => {
      if (calendarInFlight === request) calendarInFlight = null;
    });
  calendarInFlight = request;
  return request;
}

/**
 * Apply a change the client already knows about (a new name, a new picture),
 * and make the next visit re-read the record.
 */
export function patchOwnProfile(patch: Partial<OwnProfile>): void {
  if (!snapshot.profile) return;
  update({ profile: { ...snapshot.profile, ...patch } });
  markOwnProfileStale();
  persist();
}

/**
 * The held copy is out of date: the next refresh goes to the server whatever
 * its age. For changes the client cannot compute itself -- a follow, credits
 * moving, a streak ticking over.
 */
export function markOwnProfileStale(): void {
  profileFetchedAt = 0;
  calendarFetchedAt = 0;
}

/** Everything belonged to the account that just left. */
export function clearOwnProfile(): void {
  epoch += 1;
  profileFetchedAt = 0;
  calendarFetchedAt = 0;
  profileInFlight = null;
  calendarInFlight = null;
  hydration = null;
  publicProfiles.clear();
  update({
    profile: null,
    profileStatus: "idle",
    calendar: null,
    calendarStatus: "idle",
  });
  AsyncStorage.removeItem(OWN_PROFILE_CACHE_KEY).catch(() => {});
}

// ---------------------------------------------------------------------------
// Other people's pages
// ---------------------------------------------------------------------------

/**
 * Public profiles seen this session, so going back to one draws it at once
 * while it refreshes. Memory only: they are other people's rows, and a device
 * copy of them would outlive their edits and their deletions.
 */
const publicProfiles = new Map<string, PublicProfileResult>();

export function cachedPublicProfile(authorId: string): PublicProfileResult | null {
  return publicProfiles.get(authorId) ?? null;
}

export async function loadPublicProfile(
  authorId: string,
): Promise<PublicProfileResult | null> {
  const startedIn = epoch;
  const result = await fetchPublicProfile(authorId).catch(() => null);
  if (result && startedIn === epoch) publicProfiles.set(authorId, result);
  return result;
}

/** A follow changed the counts; keep the held copy in step with the screen. */
export function patchPublicProfile(
  authorId: string,
  patch: Partial<PublicProfileResult["profile"]>,
): void {
  const held = publicProfiles.get(authorId);
  if (!held) return;
  publicProfiles.set(authorId, { ...held, profile: { ...held.profile, ...patch } });
}

/** Test seam: back to a cold start. */
export function resetProfileStoreForTests(): void {
  clearOwnProfile();
}
