/**
 * The profile endpoint: one surface for the reader's own profile, and one for
 * somebody else's.
 *
 * These are two different products sharing a file because they share exactly
 * one thing -- a `profiles` row -- and disagree about everything else. The
 * owner's view is allowed to know about drafts and streaks. The
 * public view is not allowed to know that any of those exist. Keeping the two
 * next to each other is how that boundary stays legible: `readOwnProfile`
 * calls `profile_overview`, `readPublicProfile` calls `public_profile`, and
 * neither function has the other's query anywhere in it.
 *
 * Every number returned from here is a count or a sum over rows that exist.
 * There is no estimate, no projection and no "engagement score". A profile
 * whose numbers cannot be trusted is worse than one with fewer numbers,
 * because the streak is the one that is supposed to make somebody come back.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "./cors.ts";
import { logError } from "./errors.ts";
import { parseUuid, readJsonObject } from "./operations.ts";
import {
  normalizeReaderPreferences,
  readerContextFromRow,
} from "./reader-preferences.ts";

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/**
 * The handle format, identical to the CHECK constraint in migration 00060.
 *
 * Duplicated deliberately rather than shared: this copy exists to give a fast,
 * specific answer while somebody is typing. The database's copy is the one that
 * decides. If they ever disagree the database wins and the user sees a generic
 * refusal, which is a bad message but never a wrong outcome.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/;

/**
 * Handles nobody may take. Mirrors `profiles_username_not_reserved` exactly.
 *
 * The constraint is the reservation; this list is here so the endpoint can say
 * "that one is reserved" instead of relaying a check violation.
 *
 * Every entry is at least three characters, because the shape rule runs first
 * in both this file and the database. A shorter word listed here would be
 * refused as "invalid" and the two answers would silently disagree about why.
 */
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

export type UsernameProblem = "invalid" | "reserved" | null;

/** Lowercase and trim, the way `claim_username` does before it validates. */
export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Why this handle cannot be claimed, or null if nothing local objects. */
export function usernameProblem(raw: unknown): UsernameProblem {
  const candidate = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(candidate)) return "invalid";
  if (RESERVED_USERNAMES.includes(candidate)) return "reserved";
  return null;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * The 36 creature avatars, `k01`..`k36`.
 *
 * The same expression as `profiles_avatar_id_shape` in migration 00089 and as
 * `CREATURE_ID_PATTERN` in the client. Three copies of one rule, for the same
 * reason the username pattern has three: this one answers without a round
 * trip, the constraint is the one that decides, and a disagreement can only
 * ever produce a refusal, never a bad write.
 */
export const CREATURE_ID_PATTERN = /^k(0[1-9]|[12][0-9]|3[0-6])$/;

export const AVATAR_BUCKET = "avatars";

/** What the bucket's `allowed_mime_types` says, restated where it is checked. */
export const AVATAR_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The ceiling on decoded avatar bytes.
 *
 * Well under the bucket's 2 MB limit, and well under `MAX_REQUEST_BYTES`
 * (128 KB) once base64's 4/3 inflation is accounted for -- which is the real
 * constraint, because a body that exceeds the request cap is refused before
 * this function ever runs and the user would be told their photo was
 * "malformed". The client downscales to fit; this is what makes that
 * downscale mandatory rather than polite.
 */
export const AVATAR_MAX_BYTES = 80 * 1024;

export type DecodedAvatar = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

export type AvatarDecodeFailure = { error: "malformed" | "type" | "size" };

/**
 * Turn the client's data URL into bytes we are willing to store.
 *
 * The declared MIME type is checked against the allow-list *and* the bytes are
 * sniffed, because the declaration comes from the client and the bucket's
 * `allowed_mime_types` is enforced against the header we send, not against
 * what is actually in the file. Without the sniff, "image/png" is all it takes
 * to put arbitrary bytes behind a public URL on our own domain.
 */
export function decodeAvatarDataUrl(
  value: unknown,
): DecodedAvatar | AvatarDecodeFailure {
  if (typeof value !== "string") return { error: "malformed" };
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    value,
  );
  if (!match) return { error: "malformed" };

  const declared = match[1].toLowerCase();
  const extension = AVATAR_MIME_TYPES[declared];
  if (!extension) return { error: "type" };

  let bytes: Uint8Array;
  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { error: "malformed" };
  }

  if (bytes.byteLength === 0) return { error: "malformed" };
  if (bytes.byteLength > AVATAR_MAX_BYTES) return { error: "size" };

  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: "type" };
  // The bytes decide, not the label. A JPEG announced as a PNG is stored as
  // what it is; anything that is not one of the three is refused.
  return {
    bytes,
    contentType: sniffed.contentType,
    extension: sniffed.extension,
  };
}

function sniffImage(
  bytes: Uint8Array,
): { contentType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * Where this person's avatar lives, and why the name changes every time.
 *
 * A fixed key overwritten in place leaves every CDN edge and every client image
 * cache holding the old picture behind the URL the row still points at -- the
 * exact defect migration 00044 fixed for covers. A new key per upload means the
 * row's URL changes, so nothing is cached under it yet and the new photo is
 * visible immediately.
 *
 * The first segment is the owner's id because that is what `set_avatar` and the
 * bucket's RLS policies both key on.
 *
 * AND WHY THERE IS A RANDOM SUFFIX AS WELL AS A TIMESTAMP. The timestamp alone
 * is not a unique name: `Date.now()` has millisecond resolution, and two
 * uploads for the same person landing in the same millisecond -- a double tap
 * on the picker, a retried request the client already resent -- produce the
 * same key. The upload is an `upsert`, so the second silently overwrites the
 * first while `set_avatar` records whichever URL returns last. That is one
 * person's picture replaced by another attempt of their own, which is
 * confusing rather than dangerous, but it is also free to rule out. The
 * timestamp keeps the name sortable and human-readable; the suffix makes it
 * unique.
 */
export function avatarStoragePath(
  userId: string,
  extension: string,
  now: number = Date.now(),
  nonce: string = crypto.randomUUID().slice(0, 8),
): string {
  return `${userId}/avatar-${now.toString(36)}-${nonce}.${extension}`;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type OwnProfile = {
  userId: string;
  username: string | null;
  /**
   * What this person is called, from the onboarding name field.
   *
   * Distinct from `username` on purpose: a handle is public, unique and
   * lowercase; this is "Priya" and appears on the reader's OWN home screen,
   * never on a byline a stranger sees.
   */
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * The creature standing in for a photo: `k01`..`k36`, or null.
   *
   * Mutually exclusive with `avatarUrl` in the database, not merely in
   * practice -- `set_creature_avatar` clears the photo and `set_avatar`
   * clears this -- so the client's precedence rule (photo, then creature,
   * then placeholder) can never have to choose between two live values.
   */
  avatarId: string | null;
  bio: string | null;
  memberSince: string | null;
  /** Non-null means a deleted account: a tombstone, not a reachable user. */
  deletedAt: string | null;
  /**
   * A plan this account holds without a receipt: `'katha'` or null.
   *
   * The two test accounts the store review needs (D11). It is reported rather
   * than applied because the server has no paid-tier gate to apply it to --
   * every entitlement decision in Katha is the client's, and this is what the
   * client reads. It must never reach an operational kill switch such as
   * `NARRATION_GENERATION_ENABLED`: that flag says whether the provider is
   * open for business, which is not a thing any account can be entitled to.
   */
  entitlementOverride: "katha" | null;
  /** The code this person shares, from `ensure_identity`. */
  referralCode: string | null;
  referral: { invited: number; credited: number; monthRemaining: number };
  /** The five rungs and what each pays, straight from SQL `streak_ladder()`. */
  ladder: { milestone: number; credits: number }[];
  /** The same five, each with whether and when it was reached, and paid. */
  milestones: {
    milestone: number;
    credits: number;
    achievedAt: string | null;
    credited: boolean;
  }[];
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  storiesWritten: number;
  chaptersWritten: number;
  totalReads: number;
  totalLikes: number;
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
  following: number;
  isFollowing: boolean;
};

export type PublicStory = {
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

type RpcClient = {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<
    { data: unknown; error: unknown }
  >;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          eq(column: string, value: unknown): {
            neq(column: string, value: unknown): {
              order(column: string, options: { ascending: boolean }): {
                limit(count: number): PromiseLike<
                  { data: unknown; error: unknown }
                >;
              };
            };
          };
        };
      };
    };
  };
};

function first(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The ladder and the milestones arrive as jsonb, which the client library
 * hands back already parsed -- except when the driver returns it as a string,
 * which PostgREST does for some jsonb shapes. Both are read, and anything
 * else becomes an empty list rather than a crash on a profile screen.
 */
function jsonArray(value: unknown): Record<string, unknown>[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((row): row is Record<string, unknown> =>
    row !== null && typeof row === "object"
  );
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseLadder(value: unknown): { milestone: number; credits: number }[] {
  return jsonArray(value)
    .filter((row) => typeof row.milestone === "number")
    .map((row) => ({
      milestone: count(row.milestone),
      credits: count(row.credits),
    }));
}

function parseMilestones(value: unknown): {
  milestone: number;
  credits: number;
  achievedAt: string | null;
  credited: boolean;
}[] {
  return jsonArray(value)
    .filter((row) => typeof row.milestone === "number")
    .map((row) => ({
      milestone: count(row.milestone),
      credits: count(row.credits),
      achievedAt: text(row.achieved_at),
      credited: row.credited === true,
    }));
}

export async function readOwnProfile(
  client: RpcClient,
  userId: string,
): Promise<OwnProfile | null> {
  const { data, error } = await client.rpc("profile_overview", {
    p_user_id: userId,
  });
  if (error) throw error;
  const row = first(data);
  if (!row) return null;

  return {
    userId,
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    avatarId: CREATURE_ID_PATTERN.test(String(row.avatar_id ?? ""))
      ? String(row.avatar_id)
      : null,
    bio: text(row.bio),
    memberSince: text(row.member_since),
    deletedAt: text(row.deleted_at),
    entitlementOverride: row.entitlement_override === "katha" ? "katha" : null,
    referralCode: text(row.referral_code),
    referral: {
      invited: count(row.referral_invited),
      credited: count(row.referral_credited),
      monthRemaining: count(row.referral_month_remaining),
    },
    ladder: parseLadder(row.ladder),
    milestones: parseMilestones(row.milestones),
    currentStreak: count(row.current_streak),
    longestStreak: count(row.longest_streak),
    lastActivityDate: text(row.last_activity_date),
    storiesWritten: count(row.stories_written),
    chaptersWritten: count(row.chapters_written),
    totalReads: count(row.total_reads),
    totalLikes: count(row.total_likes),
    followers: count(row.followers),
    following: count(row.following),
  };
}

export async function readPublicProfile(
  client: RpcClient,
  authorId: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  const { data, error } = await client.rpc("public_profile", {
    p_author_id: authorId,
    p_viewer_id: viewerId,
  });
  if (error) throw error;
  const row = first(data);
  if (!row) return null;

  return {
    authorId,
    username: text(row.username),
    avatarUrl: text(row.avatar_url),
    bio: text(row.bio),
    memberSince: text(row.member_since),
    firstPublishedAt: text(row.first_published_at),
    storiesPublished: count(row.stories_published),
    totalReads: count(row.total_reads),
    totalLikes: count(row.total_likes),
    followers: count(row.followers),
    following: count(row.following),
    isFollowing: row.is_following === true,
  };
}

/**
 * The stories a stranger may see on this byline.
 *
 * The predicate is character-for-character the one inside `public_profile`'s
 * counts, and that is not an accident that can be allowed to drift: a list
 * that is narrower than its own count reads as censorship, and a list that is
 * wider than its count is a leak. Migration 00091 took the entity-gate clause
 * out of `public_profile` when the gate was removed, and out of this list in
 * the same commit, for exactly that reason: `is_public = true` is the
 * writer's own decision and the only visibility rule left.
 */
export async function readPublicStories(
  client: RpcClient,
  authorId: string,
  limit = 40,
): Promise<PublicStory[]> {
  const { data, error } = await client
    .from("stories")
    .select(
      "id, title, genre, primary_genre, themes, cover_image_url, read_count, like_count, word_count, created_at",
    )
    .eq("author_id", authorId)
    .eq("is_public", true)
    .eq("status", "complete")
    .neq("content_rating", "explicit")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  return rows.map((row) => ({
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "Untitled",
    genre: Array.isArray(row.genre) ? row.genre.map(String) : [],
    primaryGenre: text(row.primary_genre),
    themes: Array.isArray(row.themes) ? row.themes.map(String) : [],
    coverImageUrl: text(row.cover_image_url),
    readCount: count(row.read_count),
    likeCount: count(row.like_count),
    wordCount: typeof row.word_count === "number" ? row.word_count : null,
    createdAt: text(row.created_at),
  }));
}

/**
 * The block read's own chain, typed as narrowly as the public-stories one:
 * two filters and a limit, nothing else.
 */
export type BlockReader = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

/**
 * Has this viewer blocked this author?
 *
 * A byline is a way into somebody's work, so a public profile honours a block
 * the same way the thread, the feed, the library and search do: the page
 * still answers (a name has to lead somewhere) but lists none of their
 * stories. A signed-out visitor has no block list. A failed read throws,
 * because showing a blocked writer's stories is worse than an error page.
 */
export async function viewerHasBlocked(
  client: BlockReader,
  viewerId: string | null,
  authorId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === authorId) return false;
  const { data, error } = await client
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", viewerId)
    .eq("blocked_id", authorId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

/**
 * The ledger read's own chain, typed separately.
 *
 * `RpcClient.from` is hand-typed to exactly the public-stories query and
 * nothing else, which is a deliberate statement about how much of PostgREST
 * this file is entitled to. The ledger needs a different chain (one filter,
 * two orders, a limit), so it gets its own narrow shape rather than widening
 * that one into something that would accept any query at all.
 */
type LedgerReader = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        order(column: string, options: { ascending: boolean }): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): PromiseLike<
              { data: unknown; error: unknown }
            >;
          };
        };
      };
    };
  };
};

type ServiceClient = RpcClient & {
  /**
   * The admin surface, narrowed to the one call account deletion makes.
   *
   * Typed by hand like the rest of this shim: the generated client type is
   * too deep for the compiler here, and naming exactly one method is also a
   * statement about how much of the admin API this file is entitled to.
   */
  auth: {
    admin: {
      deleteUser(id: string): PromiseLike<{ error: unknown }>;
    };
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): PromiseLike<{ error: unknown }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      /** Account deletion removes the avatar object, not just the row pointing at it. */
      list(prefix: string): PromiseLike<
        { data: { name: string }[] | null; error: unknown }
      >;
      remove(
        paths: string[],
      ): PromiseLike<{ error: unknown }>;
    };
  };
};

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function environment() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Supabase environment is not configured");
  }
  return { url, anonKey, serviceKey };
}

function serviceClient(): ServiceClient {
  const { url, serviceKey } = environment();
  return createClient(url, serviceKey) as unknown as ServiceClient;
}

/** The caller's id, or null when the request carries no usable session. */
async function viewerFor(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const { url, anonKey } = environment();
  const authed = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authed.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export async function handleProfile(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  let action = "";
  let viewerId: string | null = null;

  try {
    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON body" }, 400);
    action = typeof body.action === "string" ? body.action : "";
    viewerId = await viewerFor(req);

    // Somebody else's profile is readable without an account. Reading has
    // never needed one anywhere else in Katha and a byline is a reading
    // surface; the follow button is where the account starts to matter.
    if (action === "public") {
      const authorId = parseUuid(body.authorId);
      if (!authorId) {
        return respond({ error: "authorId must be a valid UUID" }, 400);
      }
      const service = serviceClient();
      // Together, not one after the other: the story list does not depend on
      // the profile row, and a visitor was waiting on both round trips in a
      // row. A missing author costs one wasted list query, which is rare and
      // cheap next to making every visit pay twice.
      //
      // The profile is awaited first so a missing author is still a 404: a
      // story-list failure only matters once there is somebody to list for.
      const storiesRequest = readPublicStories(service, authorId);
      // The block check rides alongside for the same reason.
      const blockedRequest = viewerHasBlocked(
        service as unknown as BlockReader,
        viewerId,
        authorId,
      );
      // Handled here so an unawaited rejection (on the 404 path) is not
      // reported as unhandled; the await below still sees it.
      storiesRequest.catch(() => {});
      blockedRequest.catch(() => {});
      const profile = await readPublicProfile(service, authorId, viewerId);
      if (!profile) return respond({ error: "Not found" }, 404);
      const [stories, viewerBlocked] = await Promise.all([
        storiesRequest,
        blockedRequest,
      ]);
      // Somebody the viewer blocked: the profile answers, their work does not.
      if (viewerBlocked) {
        return respond({ profile, stories: [], viewerBlocked: true });
      }
      return respond({ profile, stories });
    }

    // Everything below is the caller's own profile and needs a session.
    if (!viewerId) return respond({ error: "Unauthorized" }, 401);

    const service = serviceClient();

    if (action === "me") {
      // Settle before reading, so the numbers the screen shows are the ones
      // the settle just produced.
      //
      // DELIBERATELY SEQUENTIAL. `profile_overview` reads
      // `referral_summary(p.id)`, whose `credited` and `month_remaining` count
      // `referrals.credited_at` -- the column `settle_referrals` writes. Run
      // side by side, the overview can read the row a moment before the
      // settle pays it, and the referral card shows an invite as unpaid right
      // after it was paid. Checked 2026-09-24 when the rest of the profile
      // path went parallel; leave this pair in order.
      //
      // A referral payout waits on two conditions: the invitee has generated
      // something, and their account is 24 hours old. The generation path
      // settles on the first condition, but nothing at all happens when the
      // second one comes true -- there is no event for "a day passed". So the
      // profile fetch tries again. `settle_referrals` is idempotent and does
      // nothing when there is nothing to pay, which is the case on
      // essentially every call; it is one indexed read against `referrals`
      // for a user who has none.
      //
      // Swallowed on failure. A referral that cannot be settled is worth a
      // log; it is not worth an unreadable profile.
      const { error: settleError } = await service.rpc("settle_referrals", {
        p_user_id: viewerId,
      });
      if (settleError) {
        await logError({
          bucket: "credits",
          severity: "low",
          errorCode: "settle_referrals_failed",
          error: settleError,
          context: { action },
          userId: viewerId,
        });
      }

      const profile = await readOwnProfile(service, viewerId);
      if (!profile) return respond({ error: "Not found" }, 404);
      return respond({ profile });
    }

    if (action === "creature") {
      // Shape first, and specifically: the RPC raises on a bad id and a raise
      // becomes a 500, which would tell the client "we are broken" for what
      // is really "that is not one of the 36".
      const avatarId = typeof body.avatar_id === "string"
        ? body.avatar_id.trim()
        : "";
      if (!CREATURE_ID_PATTERN.test(avatarId)) {
        return respond({ error: "avatar_id must be k01..k36" }, 400);
      }

      const { error } = await service.rpc("set_creature_avatar", {
        p_user_id: viewerId,
        p_avatar_id: avatarId,
      });
      if (error) throw error;

      // The photo is gone: `set_creature_avatar` clears `avatar_url`. Said
      // here as well as in SQL because the client drops its own cached URL on
      // this response.
      return respond({ avatarId, avatarUrl: null });
    }

    if (action === "ledger") {
      // The real history, and the only place the client gets one. `credit_
      // ledger` has no policy for `authenticated`, so this read is the
      // service role's, narrowed to the caller's own rows by the filter
      // below and by the fact that `viewerId` came from a verified token and
      // never from the body.
      //
      // Fifty rows, newest first, with `ledger_sequence` as the tiebreaker
      // (00040): two rows written in the same millisecond have the same
      // `created_at`, and ordering on the timestamp alone would show a grant
      // before the spend that preceded it.
      const { data, error } = await (service as unknown as LedgerReader)
        .from("credit_ledger")
        .select("id, amount, reason, created_at")
        .eq("user_id", viewerId)
        .order("created_at", { ascending: false })
        .order("ledger_sequence", { ascending: false })
        .limit(50);
      if (error) throw error;

      const entries = (Array.isArray(data) ? data : []).map(
        (row: Record<string, unknown>) => ({
          id: String(row.id),
          amount: typeof row.amount === "number" ? row.amount : 0,
          reason: typeof row.reason === "string" ? row.reason : "",
          createdAt: text(row.created_at),
        }),
      );
      return respond({ entries });
    }

    if (action === "username") {
      const local = usernameProblem(body.username);
      if (local) return respond({ ok: false, reason: local });

      const { data, error } = await service.rpc("claim_username", {
        p_user_id: viewerId,
        p_username: normalizeUsername(body.username),
      });
      if (error) throw error;
      const row = first(data);
      return respond({
        ok: row?.ok === true,
        reason: text(row?.reason),
        username: text(row?.username),
      });
    }

    if (action === "bio") {
      const raw = typeof body.bio === "string" ? body.bio.trim() : "";
      if (raw.length > 200) return respond({ error: "Bio is too long" }, 400);
      const { error } = await service.rpc("set_profile_bio", {
        p_user_id: viewerId,
        p_bio: raw.length === 0 ? null : raw,
      });
      if (error) throw error;
      return respond({ bio: raw.length === 0 ? null : raw });
    }

    if (action === "avatar") {
      const decoded = decodeAvatarDataUrl(body.image);
      if ("error" in decoded) {
        const message = decoded.error === "size"
          ? "That picture is too large. Try a smaller one."
          : decoded.error === "type"
          ? "Avatars must be a JPEG, PNG or WebP image."
          : "That picture could not be read.";
        return respond({ error: message, reason: decoded.error }, 400);
      }

      const path = avatarStoragePath(viewerId, decoded.extension);
      const { error: uploadError } = await service.storage
        .from(AVATAR_BUCKET)
        .upload(path, decoded.bytes, {
          contentType: decoded.contentType,
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = service.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(path);

      // `set_avatar` re-checks that the path is under this user's folder and
      // that the URL addresses it. The endpoint built both, so this can only
      // fire on a bug here -- which is exactly when a second lock earns its
      // keep.
      const { error } = await service.rpc("set_avatar", {
        p_user_id: viewerId,
        p_storage_path: path,
        p_public_url: urlData.publicUrl,
      });
      if (error) throw error;

      return respond({ avatarUrl: urlData.publicUrl });
    }

    if (action === "name") {
      const raw = typeof body.displayName === "string"
        ? body.displayName.trim()
        : "";
      if (raw.length > 60) {
        return respond({ error: "That name is too long" }, 400);
      }
      // A name is not a handle: no character class, no reserved list, no
      // lowercasing. People's names carry spaces, apostrophes, accents and
      // scripts this codebase has no business having opinions about. Length
      // is the only rule, and it is a storage bound.
      const { error } = await service.rpc("set_display_name", {
        p_user_id: viewerId,
        p_display_name: raw.length === 0 ? null : raw,
      });
      if (error) throw error;
      return respond({ displayName: raw.length === 0 ? null : raw });
    }

    if (action === "preferences") {
      // Global preferences: the languages this reader speaks and where they
      // live, read back for the You screen. Owner-only by construction --
      // `viewerId` is the verified token's, never the body's -- and the table
      // has no client grants at all (00100).
      const { data, error } = await (service as unknown as {
        from(table: string): {
          select(columns: string): {
            eq(column: string, value: string): {
              maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from("reader_preferences")
        .select("spoken_languages, home_place")
        .eq("user_id", viewerId)
        .maybeSingle();
      if (error) throw error;
      const context = readerContextFromRow(data);
      return respond({
        spokenLanguages: context?.spokenLanguages ?? [],
        homePlace: context?.homePlace ?? null,
      });
    }

    if (action === "set_preferences") {
      // Validated here for a specific answer, and again by the table's CHECKs,
      // which decide. An unknown language is refused rather than dropped: this
      // is somebody saving a setting, and saving less than they chose would
      // look like a bug.
      const input = normalizeReaderPreferences(body);
      if ("error" in input) return respond({ error: input.error }, 400);
      const { data, error } = await service.rpc("set_reader_preferences", {
        p_user_id: viewerId,
        p_spoken_languages: input.spokenLanguages,
        p_home_place: input.homePlace,
      });
      if (error) throw error;
      // A tombstoned account (00070) saves nothing; see the migration.
      if (first(data)?.gone === true) {
        return respond({ error: "Not found" }, 404);
      }
      return respond({
        spokenLanguages: input.spokenLanguages,
        homePlace: input.homePlace,
      });
    }

    if (action === "calendar") {
      // Somebody else's calendar is readable when they have a public profile,
      // and that is the point: the contribution grid is a public artefact on
      // GitHub and it is one here too. But only then -- `activity_calendar`
      // (00074) refuses an author with nothing published, because "when is
      // this person usually online" is not something a private reader offers
      // to strangers merely by existing. The viewer is passed explicitly so
      // that rule is the database's to apply rather than this handler's.
      const authorId = parseUuid(body.authorId) ?? viewerId;
      const { data, error } = await service.rpc("activity_calendar", {
        p_user_id: authorId,
        p_days: 365,
        p_viewer_id: viewerId,
      });
      if (error) throw error;
      const days = (Array.isArray(data) ? data : [])
        .map((row: Record<string, unknown>) => text(row.day))
        .filter((day): day is string => day !== null);
      return respond({ days });
    }

    if (action === "comments") {
      const authorId = parseUuid(body.authorId) ?? viewerId;
      const { data, error } = await service.rpc("profile_comments", {
        p_author_id: authorId,
        p_limit: 20,
      });
      if (error) throw error;
      const comments = (Array.isArray(data) ? data : []).map(
        (row: Record<string, unknown>) => ({
          id: text(row.comment_id),
          storyId: text(row.story_id),
          storyTitle: text(row.story_title),
          chapterNumber: typeof row.chapter_number === "number"
            ? row.chapter_number
            : null,
          content: text(row.content),
          score: count(row.score),
          createdAt: text(row.created_at),
        }),
      );
      return respond({ comments });
    }

    if (action === "delete") {
      // A guest has nothing to delete and no way back in afterwards; the
      // account they would be destroying is one they never claimed.
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const detail = typeof body.detail === "string"
        ? body.detail.trim().slice(0, 500)
        : "";

      // The database work first, and only then the auth user. The order is
      // the whole design: `delete_account` scrubs the profile and leaves a
      // tombstone so surviving stories still resolve, and deleting the auth
      // user is what actually ends the ability to sign in. If the second step
      // fails, the account is already anonymous and unusable and the call can
      // be retried -- `delete_account` is idempotent. If they were reversed, a
      // failure would leave a signed-out user with an intact profile and no
      // way to ask again.
      // The avatar FILE, before the row that points at it.
      //
      // `delete_account` nulls `avatar_url`, which removes the reference and
      // not the object. The bucket is public-read, so the picture of somebody
      // who asked to be deleted would go on being served at its old URL to
      // anyone who had ever seen it. Deleting the folder is the only part of
      // this that actually makes the image go away.
      //
      // Best effort and first: a storage hiccup must not stop the deletion,
      // but it must not be silent either.
      const { data: avatarFiles } = await service.storage
        .from(AVATAR_BUCKET)
        .list(viewerId);
      if (avatarFiles && avatarFiles.length > 0) {
        const { error: removeError } = await service.storage
          .from(AVATAR_BUCKET)
          .remove(
            avatarFiles.map((file: { name: string }) =>
              `${viewerId}/${file.name}`
            ),
          );
        if (removeError) {
          await logError({
            bucket: "engagement",
            severity: "high",
            errorCode: "delete_avatar_failed",
            error: removeError,
            context: { action },
            userId: viewerId,
          });
        }
      }

      const { data, error } = await service.rpc("delete_account", {
        p_user_id: viewerId,
        p_reason: reason.length > 0 ? reason : null,
        p_detail: detail.length > 0 ? detail : null,
      });
      if (error) throw error;
      const storiesKept = typeof data === "number" ? data : 0;

      const { error: authError } = await service.auth.admin.deleteUser(
        viewerId,
      );
      if (authError) {
        // Reported, not raised. Everything that identified the person is
        // already gone and their private data with it, so a 500 here would
        // tell them the deletion failed when the part they care about
        // succeeded.
        //
        // What is left is a credential that still authenticates. It can no
        // longer DO anything -- every profile writer refuses a tombstone
        // (00074), so the account cannot be given a name, a handle or a
        // picture again -- but the sign-in itself would still work, and the
        // caller is told so rather than left to assume otherwise.
        await logError({
          bucket: "engagement",
          severity: "high",
          errorCode: "delete_auth_user_failed",
          error: authError,
          context: { action },
          userId: viewerId,
        });
        return respond({ deleted: true, storiesKept, signInRevoked: false });
      }

      return respond({ deleted: true, storiesKept, signInRevoked: true });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("profile error:", error);
    await logError({
      bucket: "engagement",
      severity: "medium",
      errorCode: `profile_${action || "unknown"}`,
      error,
      context: { action },
      userId: viewerId,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}
