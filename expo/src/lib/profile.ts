/**
 * The client half of both profiles: the reader's own, and somebody else's.
 *
 * Two rules run through this file.
 *
 * FIRST: never invent a number. Every count that reaches a screen from here
 * came back from `profile_overview` or `public_profile`, which are counts over
 * rows. When the network fails these functions return `null` and the screens
 * show a profile with no numbers rather than a profile with stale or guessed
 * ones. A streak is the one number in the app somebody might arrange their
 * evening around; a wrong one is worse than an absent one.
 *
 * SECOND: the public profile is a different product from the owner's, and this
 * file is where that stops being an intention. `fetchOwnProfile` and
 * `fetchPublicProfile` call different endpoints with different shapes. There
 * is no shared "profile" object that happens to carry more fields when it is
 * yours -- that shape is exactly how a private field ends up rendered on
 * somebody else's page one refactor later.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/**
 * The handle format, matching `profiles_username_shape` in migration 00060 and
 * `USERNAME_PATTERN` in the edge function.
 *
 * Three copies of one rule is two too many in the abstract and exactly right
 * here: this one runs on every keystroke with no network, the server's runs
 * before the write, and the constraint is the one that actually decides. The
 * user should never learn from a round trip that they typed a space.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Handles nobody may take. Mirrors `profiles_username_not_reserved`. */
export const RESERVED_USERNAMES: readonly string[] = [
  "katha",
  "kathaai",
  "katha_ai",
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "staff",
  "team",
  "official",
  "moderator",
  "mod",
  "system",
  "security",
  "billing",
  "about",
  "settings",
  "login",
  "signup",
  "you",
  "null",
  "undefined",
  "anonymous",
  "guest",
];

export type UsernameVerdict =
  | { ok: true; username: string }
  | { ok: false; reason: "empty" | "short" | "long" | "characters" | "reserved" };

/** What to type into the field so it will be accepted. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Judge a handle without asking the server, and say specifically what is wrong.
 *
 * "That username isn't available" is the message every product ships and it is
 * the least useful sentence in the genre: it collapses "too short", "has a
 * space" and "someone already has it" into one dead end. These verdicts are
 * separate because the user's next move is different for each.
 */
export function validateUsername(raw: string): UsernameVerdict {
  const candidate = normalizeUsername(raw);
  if (candidate.length === 0) return { ok: false, reason: "empty" };
  if (candidate.length < USERNAME_MIN_LENGTH) {
    return { ok: false, reason: "short" };
  }
  if (candidate.length > USERNAME_MAX_LENGTH) {
    return { ok: false, reason: "long" };
  }
  if (!USERNAME_PATTERN.test(candidate)) {
    return { ok: false, reason: "characters" };
  }
  if (RESERVED_USERNAMES.includes(candidate)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, username: candidate };
}

/** The sentence shown under the field for each verdict. */
export function usernameMessage(verdict: UsernameVerdict): string | null {
  if (verdict.ok) return null;
  switch (verdict.reason) {
    case "empty":
      return "Pick a handle so people can find you.";
    case "short":
      return `At least ${USERNAME_MIN_LENGTH} characters.`;
    case "long":
      return `At most ${USERNAME_MAX_LENGTH} characters.`;
    case "characters":
      return "Lowercase letters, numbers and underscores, starting and ending with a letter or number.";
    case "reserved":
      return "That one is reserved.";
  }
}

export type ClaimResult =
  | { ok: true; username: string }
  | { ok: false; reason: "taken" | "invalid" | "reserved" | "offline" };

/**
 * Take the handle, or find out why not.
 *
 * `taken` is the answer that cannot be produced locally and is the reason this
 * is a round trip at all. It comes from a caught unique violation on the
 * server, not from an availability check -- see `claim_username` in migration
 * 00060 for why the difference matters. Two people can want the same handle at
 * the same instant, and exactly one of them gets it.
 */
export async function claimUsername(raw: string): Promise<ClaimResult> {
  const local = validateUsername(raw);
  if (!local.ok) {
    return {
      ok: false,
      reason: local.reason === "reserved" ? "reserved" : "invalid",
    };
  }
  if (!isSupabaseConfigured) return { ok: false, reason: "offline" };

  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "username", username: local.username },
    });
    if (error || !data) return { ok: false, reason: "offline" };
    if (data.ok === true) {
      return {
        ok: true,
        username: typeof data.username === "string"
          ? data.username
          : local.username,
      };
    }
    const reason = data.reason;
    if (reason === "taken" || reason === "reserved" || reason === "invalid") {
      return { ok: false, reason };
    }
    return { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * The longest edge we upload, and the JPEG quality at that size.
 *
 * An avatar is drawn at 96pt at its very largest in this app, so 512 is
 * already generous on a 3x screen and 1024 would be paying for pixels nobody
 * sees. The downscale is not a nicety: a modern phone photo is 3-6 MB, the
 * endpoint's body limit is 128 KB, and an upload that was not shrunk would be
 * refused as malformed after the user waited for it.
 */
const AVATAR_STEPS: { size: number; quality: number }[] = [
  { size: 512, quality: 0.72 },
  { size: 256, quality: 0.6 },
  { size: 160, quality: 0.5 },
];

/** Base64 characters we will send. Below the 128 KB body cap with room over. */
const AVATAR_MAX_BASE64 = 96 * 1024;

export type AvatarResult =
  | { ok: true; avatarUrl: string }
  | {
    ok: false;
    reason: "permission" | "cancelled" | "unreadable" | "too_large" | "offline";
  };

/**
 * What the screen says for each way this can not work.
 *
 * `permission` deliberately does not read as an error. Someone who declined
 * the photo prompt made a choice, and the app's job is to tell them where to
 * change it, not to imply they did something wrong.
 */
export function avatarMessage(reason: Exclude<AvatarResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "permission":
      return "Katha needs access to your photos to set a picture. You can turn it on in Settings.";
    case "cancelled":
      return "";
    case "unreadable":
      return "That picture could not be read. Try a JPEG or PNG.";
    case "too_large":
      return "That picture is too large, even shrunk. Try another one.";
    case "offline":
      return "Your picture could not be saved just now. Try again in a moment.";
  }
}

/**
 * Ask for a picture, shrink it, and store it.
 *
 * The permission request comes first and a refusal returns immediately with
 * `permission` -- no picker, no alert, no retry loop. That is the graceful
 * path: the caller shows one line explaining where to change it and the rest
 * of the profile keeps working, because an avatar is the least important thing
 * on this screen.
 */
export async function pickAndUploadAvatar(): Promise<AvatarResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: "permission" };

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (picked.canceled || !picked.assets?.length) {
    return { ok: false, reason: "cancelled" };
  }

  const uri = picked.assets[0].uri;
  if (!uri) return { ok: false, reason: "unreadable" };

  // Step down until it fits. Three attempts rather than one guess, because the
  // ratio between a photo's pixels and its compressed bytes depends entirely
  // on the photo -- a flat wall at 512 is tiny and a crowd at 512 is not.
  let encoded: string | null = null;
  for (const step of AVATAR_STEPS) {
    let attempt: { base64?: string | null };
    try {
      attempt = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: step.size, height: step.size } }],
        {
          compress: step.quality,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!attempt.base64) return { ok: false, reason: "unreadable" };
    if (attempt.base64.length <= AVATAR_MAX_BASE64) {
      encoded = attempt.base64;
      break;
    }
  }
  if (!encoded) return { ok: false, reason: "too_large" };

  if (!isSupabaseConfigured) return { ok: false, reason: "offline" };
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "avatar", image: `data:image/jpeg;base64,${encoded}` },
    });
    if (error || typeof data?.avatarUrl !== "string") {
      return { ok: false, reason: "offline" };
    }
    return { ok: true, avatarUrl: data.avatarUrl };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

// ---------------------------------------------------------------------------
// Reading a profile
// ---------------------------------------------------------------------------

export type OwnProfile = {
  userId: string;
  username: string | null;
  /**
   * What this person is called, from the name onboarding asks for first.
   *
   * Not the handle. `username` is public, unique and lowercase and goes on a
   * byline; this goes on the reader's own home screen, in the greeting, and
   * nowhere a stranger can see. Null for anyone who onboarded before the
   * field was stored, which is why every use of it has a fallback.
   */
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  memberSince: string | null;
  /** Non-null means a deleted account. Nothing should render one. */
  deletedAt: string | null;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  storiesWritten: number;
  chaptersWritten: number;
  totalReads: number;
  totalLikes: number;
  phrasesSaved: number;
  followers: number;
  following: number;
};

export type PublicProfile = {
  authorId: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  memberSince: string | null;
  firstPublishedAt: string | null;
  storiesPublished: number;
  totalReads: number;
  totalLikes: number;
  followers: number;
  /** How many people this author follows. The other half of the pair. */
  following: number;
  isFollowing: boolean;
};

export type PublicStorySummary = {
  id: string;
  title: string;
  genre: string[];
  primaryGenre: string | null;
  themes: string[];
  coverImageUrl: string | null;
  readCount: number;
  likeCount: number;
  wordCount: number | null;
  createdAt: string | null;
};

export type PublicProfileResult = {
  profile: PublicProfile;
  stories: PublicStorySummary[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether this author id names a real account or a seeded one.
 *
 * The bundled sample stories carry human-readable author ids ("kathaai",
 * "aarav") because they were authored in a fixture file, not by a person. The
 * public-profile endpoint takes a UUID and would answer 400 for all of them,
 * so the byline screen checks this first and shows the seeded author from the
 * fixture instead of an error about a person who does not exist.
 */
export function isRealAuthorId(authorId: string): boolean {
  return UUID.test(authorId);
}

/** The reader's own profile, or null when there is nothing trustworthy to show. */
export async function fetchOwnProfile(): Promise<OwnProfile | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const user = await bootstrapUser();
    if (!user) return null;
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "me" },
    });
    if (error || !data?.profile) return null;
    return { ...data.profile as OwnProfile, userId: user.userId };
  } catch {
    return null;
  }
}

/** Somebody else's profile and their public stories, or null. */
export async function fetchPublicProfile(
  authorId: string,
): Promise<PublicProfileResult | null> {
  if (!isSupabaseConfigured || !isRealAuthorId(authorId)) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "public", authorId },
    });
    if (error || !data?.profile) return null;
    return {
      profile: data.profile as PublicProfile,
      stories: Array.isArray(data.stories)
        ? data.stories as PublicStorySummary[]
        : [],
    };
  } catch {
    return null;
  }
}

/** Save the owner's bio. Returns the stored value, or null if it did not save. */
export async function saveBio(bio: string): Promise<string | null | undefined> {
  if (!isSupabaseConfigured) return undefined;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "bio", bio },
    });
    if (error) return undefined;
    return typeof data?.bio === "string" ? data.bio : null;
  } catch {
    return undefined;
  }
}


/**
 * Save what this person is called.
 *
 * Returns the stored value, `null` when it was cleared, and `undefined` when
 * the write did not happen -- the same three-way answer `saveBio` gives, so a
 * caller can tell "now empty" from "we do not know".
 */
export async function saveDisplayName(
  displayName: string,
): Promise<string | null | undefined> {
  if (!isSupabaseConfigured) return undefined;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "name", displayName },
    });
    if (error) return undefined;
    return typeof data?.displayName === "string" ? data.displayName : null;
  } catch {
    return undefined;
  }
}

/**
 * The days this reader was active, as `YYYY-MM-DD` strings.
 *
 * An empty array means "no active days", which is a real answer for a new
 * account. `null` means the request failed, and the calendar renders nothing
 * rather than an empty year -- a grid of blank squares says "you did nothing"
 * to somebody who may well have done something.
 *
 * With no `authorId` this is the caller's own calendar; with one it is that
 * author's, which is what the public profile draws.
 */
export async function fetchActivityCalendar(
  authorId?: string,
): Promise<string[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "calendar", ...(authorId ? { authorId } : {}) },
    });
    if (error || !Array.isArray(data?.days)) return null;
    return (data.days as unknown[]).filter(
      (day): day is string => typeof day === "string",
    );
  } catch {
    return null;
  }
}

export type ProfileComment = {
  id: string;
  storyId: string;
  storyTitle: string | null;
  chapterNumber: number | null;
  content: string;
  score: number;
  createdAt: string | null;
};

/**
 * Comments somebody has left, for their public profile.
 *
 * Visibility is the STORY's, decided on the server: a comment on a private or
 * gated story never appears here, so a profile cannot become a way to read
 * around a story nobody was meant to see.
 */
export async function fetchProfileComments(
  authorId?: string,
): Promise<ProfileComment[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "comments", ...(authorId ? { authorId } : {}) },
    });
    if (error || !Array.isArray(data?.comments)) return null;
    return (data.comments as ProfileComment[]).filter(
      (comment) => typeof comment?.content === "string",
    );
  } catch {
    return null;
  }
}

export type DeleteAccountResult =
  | { ok: true; storiesKept: number }
  | { ok: false };

/**
 * Delete this account.
 *
 * The policy, and what the confirmation screen promises: everything private
 * goes -- drafts, library, saved phrases, follows, handle, avatar -- and
 * published stories and comments stay under an anonymous byline, because a
 * reader who saved one of them should not lose it because the author left.
 * `storiesKept` is how many survive, so the last screen can say so plainly
 * rather than leaving somebody to find out later.
 */
export async function deleteAccount(
  reason: string,
  detail?: string,
): Promise<DeleteAccountResult> {
  if (!isSupabaseConfigured) return { ok: false };
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "delete", reason, detail: detail ?? "" },
    });
    if (error || data?.deleted !== true) return { ok: false };
    return {
      ok: true,
      storiesKept: typeof data.storiesKept === "number" ? data.storiesKept : 0,
    };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Streaks, as the interface talks about them
// ---------------------------------------------------------------------------

export type StreakState =
  | { kind: "none" }
  | { kind: "today"; days: number }
  | { kind: "at_risk"; days: number }
  | { kind: "broken"; best: number };

/**
 * What the streak means right now, in UTC days.
 *
 * Three states, and the middle one is the whole reason this function exists.
 *
 *   * `today` -- already read or written today. Nothing is urgent; the number
 *     is a record of something done, and it is shown calmly.
 *   * `at_risk` -- the last active day was yesterday. The streak is real and
 *     alive and will be gone after midnight UTC. This is the only state the
 *     interface is allowed to make urgent, because it is the only one where
 *     urgency is TRUE: there is a thing to lose and an action that keeps it.
 *   * `broken` -- longer ago than yesterday. The current streak is zero. It
 *     says so, and shows the best instead, because a zero dressed up as a
 *     "streak" is the dishonest gamification this surface is supposed to
 *     avoid.
 *
 * `now` is injectable so the day-boundary behaviour can be tested rather than
 * asserted about.
 */
export function streakState(
  profile: Pick<
    OwnProfile,
    "currentStreak" | "longestStreak" | "lastActivityDate"
  >,
  now: Date = new Date(),
): StreakState {
  const { currentStreak, longestStreak, lastActivityDate } = profile;
  if (!lastActivityDate || currentStreak <= 0) {
    return longestStreak > 0
      ? { kind: "broken", best: longestStreak }
      : { kind: "none" };
  }

  const today = utcDayNumber(now);
  const last = utcDayNumberFromDate(lastActivityDate);
  if (last === null) return { kind: "none" };

  if (last >= today) return { kind: "today", days: currentStreak };
  if (last === today - 1) return { kind: "at_risk", days: currentStreak };
  return { kind: "broken", best: Math.max(longestStreak, currentStreak) };
}

function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      86_400_000,
  );
}

/** `YYYY-MM-DD` from Postgres, read as a UTC day rather than a local one. */
function utcDayNumberFromDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Math.floor(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
      86_400_000,
  );
}

/**
 * The next streak milestone worth naming, or null when there is not one near.
 *
 * Milestones are sparse on purpose -- a week, a fortnight, a month, a hundred
 * days, a year -- and the screen only mentions one when it is within three
 * days. A target that is always visible is wallpaper; a target three days away
 * is a reason to open the app tomorrow. Nothing is awarded for reaching one:
 * there is no credit, no badge and no unlock, because none of those exist and
 * promising them would be the dishonest kind of gamification.
 */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365] as const;

export function nextMilestone(days: number): number | null {
  if (days <= 0) return null;
  const next = STREAK_MILESTONES.find((milestone) => milestone > days);
  if (next === undefined) return null;
  return next - days <= 3 ? next : null;
}

/** "Writing since March 2026", from an ISO timestamp. Null when unknown. */
export function writingSince(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// The greeting name, cached on the device
// ---------------------------------------------------------------------------

const DISPLAY_NAME_KEY = "katha.displayName.v1";

/**
 * Remember the name locally as well as on the server.
 *
 * Home greets the reader by name in its first line. Waiting for
 * `profile_overview` to come back means that line renders once without a name
 * and then again with one, which reads as a glitch on every cold start. The
 * cache is the answer to "what were they called last time", the server is the
 * answer to "what are they called", and the second overwrites the first as
 * soon as it arrives.
 *
 * Device-local by design: it is a copy, never the record. Losing it costs one
 * render of a nameless greeting.
 */
export async function cacheDisplayName(name: string | null): Promise<void> {
  try {
    if (name && name.trim().length > 0) {
      await AsyncStorage.setItem(DISPLAY_NAME_KEY, name.trim());
    } else {
      await AsyncStorage.removeItem(DISPLAY_NAME_KEY);
    }
  } catch {
    // A cache that cannot write is a cache that misses. Nothing else breaks.
  }
}

export async function cachedDisplayName(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The first name to greet somebody by, from whatever they gave us.
 *
 * Onboarding asks for a first name, but people type what they like -- a full
 * name, a name with a title, an empty string with a stray space. The greeting
 * has one line to work with, so it takes the first word and caps it, and
 * returns null rather than greeting somebody as "" or as their whole legal
 * name.
 */
export function greetingName(displayName: string | null): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  if (first.length === 0 || first.length > 20) return null;
  return first;
}
