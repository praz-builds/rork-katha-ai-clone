import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  fetchActivityCalendar,
  fetchOwnProfile,
  fetchPublicProfile,
  type OwnProfile,
  type PublicProfileResult,
} from "@/lib/profile";

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

const STORAGE_KEY = "katha.ownProfile.v1";

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
/** Bumped by `clearOwnProfile`, so a request from the account that left cannot write into the next one. */
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

/** The whole store, re-rendering when any of it moves. */
export function useOwnProfileStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function persist(): void {
  const { profile, calendar } = snapshot;
  if (!profile) return;
  AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ profile, calendar }),
  ).catch(() => {
    // A cache that cannot write is a cache that misses. Nothing else breaks.
  });
}

/**
 * Put the last good copy on screen, if there is one and nothing newer is.
 *
 * An async restore must never overwrite an answer that arrived first (see
 * AGENTS.md): the server may well beat AsyncStorage on a fast network, and
 * the device copy is older by definition.
 */
export function hydrateOwnProfileCache(): Promise<void> {
  if (hydration) return hydration;
  const startedIn = epoch;
  hydration = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw || startedIn !== epoch) return;
      const parsed = JSON.parse(raw) as {
        profile?: OwnProfile;
        calendar?: unknown;
      };
      const profile = parsed.profile;
      if (!profile || typeof profile.userId !== "string") return;
      // The server already answered, for somebody else: nothing here is theirs.
      if (snapshot.profile && snapshot.profile.userId !== profile.userId) return;
      const patch: Partial<Snapshot> = {};
      if (!snapshot.profile) patch.profile = profile;
      if (
        !snapshot.calendar &&
        Array.isArray(parsed.calendar) &&
        parsed.calendar.every((day) => typeof day === "string")
      ) {
        patch.calendar = parsed.calendar as string[];
      }
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
 * A failed refresh keeps the copy already on screen. Only a reader with no
 * copy at all sees the error state.
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
        profileFetchedAt = Date.now();
        const sameAccount = snapshot.profile?.userId === profile.userId;
        if (!sameAccount) {
          // A different person than the held copy (a restored cache from
          // another sign-in, a sign-in onto an existing account): their
          // calendar is not this one's.
          calendarFetchedAt = 0;
        }
        update({
          profile,
          profileStatus: "ready",
          ...(sameAccount || !snapshot.profile
            ? {}
            : { calendar: null, calendarStatus: "idle" as const }),
        });
        persist();
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
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
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
