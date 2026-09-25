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
import { rememberBlocked } from "@/lib/blocks";
import { setEntitlementOverride } from "@/lib/entitlements";
import { ensurePhotoLibraryAccess } from "@/lib/photo-access";
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
  let allowed = false;
  try {
    allowed = await ensurePhotoLibraryAccess();
  } catch {
    // A permission request that throws (iOS only; Android asks nothing) is a
    // refusal, not a crash on the Profile screen.
  }
  if (!allowed) return { ok: false, reason: "permission" };

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
    // The server clears `avatar_id` on a photo upload (D6): a photo and a
    // creature are never both set, and the caller should drop its creature.
    return { ok: true, avatarUrl: data.avatarUrl };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export type CreatureResult =
  | { ok: true; avatarId: string }
  | { ok: false; reason: "invalid" | "offline" };

/** The creature ids the server accepts: `k01` to `k36`. Mirrors the edge function. */
export const CREATURE_ID_PATTERN = /^k(0[1-9]|[12][0-9]|3[0-6])$/;

/**
 * Choose a creature avatar (D5/D6).
 *
 * Sets `avatar_id` and clears `avatar_url` on the server, so the photo, if
 * there was one, is gone: precedence is photo first, then creature, and a
 * creature that could never show through a photo would be a choice that did
 * nothing. The caller drops its `avatarUrl` on success for the same reason.
 */
export async function chooseCreature(avatarId: string): Promise<CreatureResult> {
  if (!CREATURE_ID_PATTERN.test(avatarId)) return { ok: false, reason: "invalid" };
  if (!isSupabaseConfigured) return { ok: false, reason: "offline" };
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "creature", avatar_id: avatarId },
    });
    if (error) return { ok: false, reason: "offline" };
    return {
      ok: true,
      avatarId: typeof data?.avatarId === "string" ? data.avatarId : avatarId,
    };
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
  followers: number;
  following: number;
  /** The creature avatar, `k01`..`k36`, shown when there is no photo. */
  avatarId: string | null;
  /** `katha` for a tester account holding the plan without a receipt (D11). */
  entitlementOverride: "katha" | null;
  /** The code this reader hands out (D10). Null until the server assigns one. */
  referralCode: string | null;
  referral: ReferralSummary;
  /** The streak ladder the server pays out on. `FALLBACK_LADDER` when absent. */
  ladder: StreakRung[];
  /** What this account has reached on the ladder, one row per rung reached. */
  milestones: StreakMilestone[];
};

export type ReferralSummary = {
  /** People who entered this reader's code. */
  invited: number;
  /** Of those, how many have paid out. */
  credited: number;
  /** Referrer payouts left this month. */
  monthRemaining: number;
};

export type StreakRung = { milestone: number; credits: number };

export type StreakMilestone = {
  milestone: number;
  credits: number;
  achievedAt: string | null;
  credited: boolean;
};

/**
 * The streak ladder as the product decided it (D2): five rungs, 30 credits
 * for the lot, nothing repeats. The server's `streak_ladder()` is the record;
 * this is what the client draws when a deploy predates it or the request
 * failed, so a Journey page never renders an empty milestone list.
 */
export const FALLBACK_LADDER: readonly StreakRung[] = [
  { milestone: 2, credits: 2 },
  { milestone: 5, credits: 4 },
  { milestone: 10, credits: 6 },
  { milestone: 15, credits: 8 },
  { milestone: 21, credits: 10 },
];

const REFERRAL_EMPTY: ReferralSummary = { invited: 0, credited: 0, monthRemaining: 0 };

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseLadder(value: unknown): StreakRung[] {
  if (!Array.isArray(value)) return [...FALLBACK_LADDER];
  const rungs = value
    .map((row): StreakRung | null => {
      const record = row as Record<string, unknown> | null;
      const milestone = num(record?.milestone, NaN);
      const credits = num(record?.credits, NaN);
      if (!Number.isFinite(milestone) || !Number.isFinite(credits)) return null;
      return { milestone, credits };
    })
    .filter((rung): rung is StreakRung => rung !== null)
    .sort((a, b) => a.milestone - b.milestone);
  return rungs.length > 0 ? rungs : [...FALLBACK_LADDER];
}

function parseMilestones(value: unknown): StreakMilestone[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row): StreakMilestone | null => {
      const record = row as Record<string, unknown> | null;
      const milestone = num(record?.milestone, NaN);
      if (!Number.isFinite(milestone)) return null;
      return {
        milestone,
        credits: num(record?.credits),
        achievedAt: str(record?.achievedAt),
        credited: record?.credited === true,
      };
    })
    .filter((row): row is StreakMilestone => row !== null);
}

/**
 * The profile as the server sent it, with every field the contract added on
 * 2026-09-16 defaulted when absent.
 *
 * A deploy older than the contract omits `avatarId`, `entitlementOverride`,
 * `referralCode`, `referral`, `ladder` and `milestones`. Reading them as
 * `undefined` would crash a screen that maps over the ladder, so each one is
 * given the honest empty value: no creature, no override, no code, zero
 * invites, the fallback ladder and no milestones reached.
 */
export function parseOwnProfile(raw: unknown, userId: string): OwnProfile {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const referral = (row.referral && typeof row.referral === "object"
    ? row.referral
    : {}) as Record<string, unknown>;
  return {
    userId,
    username: str(row.username),
    displayName: str(row.displayName),
    avatarUrl: str(row.avatarUrl),
    bio: str(row.bio),
    memberSince: str(row.memberSince),
    deletedAt: str(row.deletedAt),
    currentStreak: num(row.currentStreak),
    longestStreak: num(row.longestStreak),
    lastActivityDate: str(row.lastActivityDate),
    storiesWritten: num(row.storiesWritten),
    chaptersWritten: num(row.chaptersWritten),
    totalReads: num(row.totalReads),
    totalLikes: num(row.totalLikes),
    followers: num(row.followers),
    following: num(row.following),
    avatarId: CREATURE_ID_PATTERN.test(String(row.avatarId ?? "")) ? String(row.avatarId) : null,
    entitlementOverride: row.entitlementOverride === "katha" ? "katha" : null,
    referralCode: str(row.referralCode),
    referral: {
      invited: num(referral.invited, REFERRAL_EMPTY.invited),
      credited: num(referral.credited, REFERRAL_EMPTY.credited),
      monthRemaining: num(referral.monthRemaining, REFERRAL_EMPTY.monthRemaining),
    },
    ladder: parseLadder(row.ladder),
    milestones: parseMilestones(row.milestones),
  };
}

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
    const profile = parseOwnProfile(data.profile, user.userId);
    // The one place the client learns it holds the plan without a receipt.
    // Set on every load rather than once, so a revoked override lands on the
    // next fetch instead of surviving the session.
    setEntitlementOverride(profile.entitlementOverride);
    return profile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The credit ledger
// ---------------------------------------------------------------------------

export type LedgerEntry = {
  id: string;
  amount: number;
  reason: string;
  createdAt: string | null;
};

/**
 * The last fifty ledger rows, newest first, or null when they could not be
 * read. Null rather than `[]` for the same reason as the calendar: an empty
 * history is a real answer for a new account and a failed request is not.
 */
export async function fetchLedger(): Promise<LedgerEntry[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("profile", {
      body: { action: "ledger" },
    });
    if (error || !Array.isArray(data?.entries)) return null;
    return (data.entries as unknown[])
      .map((row): LedgerEntry | null => {
        const record = row as Record<string, unknown> | null;
        if (!record || typeof record.id !== "string") return null;
        return {
          id: record.id,
          amount: num(record.amount),
          reason: typeof record.reason === "string" ? record.reason : "",
          createdAt: str(record.createdAt),
        };
      })
      .filter((entry): entry is LedgerEntry => entry !== null);
  } catch {
    return null;
  }
}

/**
 * What a ledger reason means to the person reading it.
 *
 * The reason column is a machine key (`welcome`, `streak`, `feedback`, ...),
 * and some of them carry a suffix the server uses for idempotency. The label
 * is chosen by prefix so a key this table has never seen still reads as
 * something rather than as a slug.
 */
export function ledgerLabel(reason: string, amount: number): string {
  const key = reason.toLowerCase();
  if (key.startsWith("welcome")) return "Welcome bonus";
  if (key.startsWith("streak")) return "Streak milestone";
  if (key.startsWith("feedback")) return "Feedback on a story";
  if (key.startsWith("referral:invitee") || key.startsWith("invitee")) return "Joined with an invite";
  if (key.startsWith("referral")) return "Invited a friend";
  if (key.startsWith("purchase") || key.startsWith("pack")) return "Credit pack";
  if (key.startsWith("subscription") || key.startsWith("plan") || key.startsWith("trial")) {
    return "Plan credits";
  }
  if (key.startsWith("tester")) return "Tester credits";
  if (key.startsWith("refund")) return "Refund";
  if (key.startsWith("audio") || key.startsWith("narration")) return "Unlocked audio";
  if (key.startsWith("cover")) return "Cover art";
  if (key.startsWith("character") || key.startsWith("portrait")) return "Character image";
  if (key.startsWith("reimagine")) return "Reimagined a chapter";
  if (key.startsWith("continuation") || key.startsWith("chapter")) return "Wrote a chapter";
  if (key.startsWith("generation") || key.startsWith("story")) return "Started a story";
  if (key.startsWith("expire") || key.startsWith("lapse")) return "Credits expired";
  return amount >= 0 ? "Credits added" : "Credits spent";
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
    // The server knows this viewer blocked the writer even when the local
    // block list failed to load at boot. Record it, so AuthorScreen shows
    // "You blocked this writer" with Unblock rather than an empty page with
    // a live Follow button.
    if (data.viewerBlocked === true) rememberBlocked(authorId);
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
 * goes -- drafts, library, follows, handle, avatar -- and
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
 * The next rung of the ladder above `days`, or null past the top.
 *
 * Unlike the old sparse milestone list this one is never suppressed for
 * being far away: the Credits screen's streak card names the next rung and
 * what it pays whatever the distance, because that card exists to answer
 * "what do I get for keeping this up" and a card that sometimes goes silent
 * cannot answer it.
 */
export function nextRung(
  days: number,
  ladder: readonly StreakRung[] = FALLBACK_LADDER,
): StreakRung | null {
  const current = Math.max(0, days);
  return ladder.find((rung) => rung.milestone > current) ?? null;
}

/**
 * The next streak milestone worth naming, or null when there is not one near.
 *
 * Kept for the streak card, which only mentions a rung when it is within
 * three days: a target that is always visible is wallpaper; a target three
 * days away is a reason to open the app tomorrow. The rungs come from the
 * server's ladder, or the fallback when there is none.
 */
export function nextMilestone(
  days: number,
  ladder: readonly StreakRung[] = FALLBACK_LADDER,
): number | null {
  if (days <= 0) return null;
  const next = nextRung(days, ladder);
  if (next === null) return null;
  return next.milestone - days <= 3 ? next.milestone : null;
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
