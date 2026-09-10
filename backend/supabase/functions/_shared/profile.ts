/**
 * The profile endpoint: one surface for the reader's own profile, and one for
 * somebody else's.
 *
 * These are two different products sharing a file because they share exactly
 * one thing -- a `profiles` row -- and disagree about everything else. The
 * owner's view is allowed to know about drafts, saved phrases and streaks. The
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
  avatarUrl: string | null;
  bio: string | null;
  memberSince: string | null;
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
            is(column: string, value: unknown): {
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
    avatarUrl: text(row.avatar_url),
    bio: text(row.bio),
    memberSince: text(row.member_since),
    currentStreak: count(row.current_streak),
    longestStreak: count(row.longest_streak),
    lastActivityDate: text(row.last_activity_date),
    storiesWritten: count(row.stories_written),
    chaptersWritten: count(row.chapters_written),
    totalReads: count(row.total_reads),
    totalLikes: count(row.total_likes),
    phrasesSaved: count(row.phrases_saved),
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
    isFollowing: row.is_following === true,
  };
}

/**
 * The stories a stranger may see on this byline.
 *
 * The predicate is character-for-character the one inside `public_profile`'s
 * counts, and that is not an accident that can be allowed to drift: a list
 * that is narrower than its own count reads as censorship, and a list that is
 * wider than its count is a leak. `entity_gate_reason is null` is the clause
 * that matters most -- a story kept private because it names a real living
 * person must never appear under any circumstances -- and it is stated here
 * even though `is_public = true` already implies it through migration 00050's
 * constraint.
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
    .is("entity_gate_reason", null)
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

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

type ServiceClient = RpcClient & {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): PromiseLike<{ error: unknown }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
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
      const profile = await readPublicProfile(service, authorId, viewerId);
      if (!profile) return respond({ error: "Not found" }, 404);
      const stories = await readPublicStories(service, authorId);
      return respond({ profile, stories });
    }

    // Everything below is the caller's own profile and needs a session.
    if (!viewerId) return respond({ error: "Unauthorized" }, 401);

    const service = serviceClient();

    if (action === "me") {
      const profile = await readOwnProfile(service, viewerId);
      if (!profile) return respond({ error: "Not found" }, 404);
      return respond({ profile });
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
