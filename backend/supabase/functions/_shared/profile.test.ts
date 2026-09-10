import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVATAR_MAX_BYTES,
  avatarStoragePath,
  decodeAvatarDataUrl,
  handleProfile,
  normalizeUsername,
  readOwnProfile,
  readPublicProfile,
  readPublicStories,
  RESERVED_USERNAMES,
  usernameProblem,
} from "./profile.ts";

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

Deno.test("a handle is normalized before it is judged", () => {
  assertEquals(normalizeUsername("  AdaLovelace "), "adalovelace");
  assertEquals(normalizeUsername(null), "");
  assertEquals(normalizeUsername(42), "");
});

Deno.test("the handle rules match the ones the database enforces", () => {
  for (const good of ["ada", "ada_l", "a1b", "x9_9x", "a".repeat(20)]) {
    assertEquals(usernameProblem(good), null, good);
  }

  for (
    const bad of [
      "ab",
      "a".repeat(21),
      "_ada",
      "ada_",
      "ada lovelace",
      "ada-lovelace",
      "ada!",
      "",
      "ÁDA",
    ]
  ) {
    assertEquals(usernameProblem(bad), "invalid", bad);
  }

  // Reserved is a different answer from invalid, because the user can fix one
  // of them by trying again with the same idea and not the other.
  for (const reserved of RESERVED_USERNAMES) {
    assertEquals(usernameProblem(reserved), "reserved", reserved);
    assertEquals(usernameProblem(reserved.toUpperCase()), "reserved", reserved);
  }
});

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

function dataUrl(mime: string, bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return `data:${mime};base64,${btoa(binary)}`;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00];

Deno.test("an avatar is accepted only when the bytes are an image we allow", () => {
  const jpeg = decodeAvatarDataUrl(dataUrl("image/jpeg", JPEG));
  assert(!("error" in jpeg));
  assertEquals(jpeg.contentType, "image/jpeg");
  assertEquals(jpeg.extension, "jpg");

  const png = decodeAvatarDataUrl(dataUrl("image/png", PNG));
  assert(!("error" in png));
  assertEquals(png.extension, "png");

  // A GIF announced as a PNG. The declaration is the client's; the bytes are
  // the fact, and the bytes are what decide.
  assertEquals(decodeAvatarDataUrl(dataUrl("image/png", GIF)), {
    error: "type",
  });

  // A type outside the allow-list is refused on the label alone, before any
  // decoding happens.
  assertEquals(decodeAvatarDataUrl(dataUrl("image/gif", GIF)), {
    error: "type",
  });

  // A JPEG announced as a PNG is stored as a JPEG rather than mislabelled in
  // the bucket.
  const lying = decodeAvatarDataUrl(dataUrl("image/png", JPEG));
  assert(!("error" in lying));
  assertEquals(lying.contentType, "image/jpeg");
});

Deno.test("an avatar that is not a data URL, or is empty, is refused", () => {
  for (
    const bad of [
      null,
      42,
      "",
      "https://example.com/photo.jpg",
      "data:image/png;base64,",
      "data:image/png,notbase64",
      "data:image/png;base64,!!!!",
    ]
  ) {
    const result = decodeAvatarDataUrl(bad);
    assert("error" in result, `${String(bad)} must be refused`);
  }
});

Deno.test("an avatar larger than the ceiling is refused as too large, not as broken", () => {
  const huge = [...JPEG, ...new Array(AVATAR_MAX_BYTES).fill(0x20)];
  assertEquals(decodeAvatarDataUrl(dataUrl("image/jpeg", huge)), {
    error: "size",
  });

  // "Too large" and "unreadable" are different messages to the user: one says
  // pick a smaller photo, the other says pick a different one.
  const fine = [...JPEG, ...new Array(1024).fill(0x20)];
  assert(!("error" in decodeAvatarDataUrl(dataUrl("image/jpeg", fine))));
});

Deno.test("each avatar upload gets its own key, under the owner's folder", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const first = avatarStoragePath(user, "jpg", 1_000);
  const second = avatarStoragePath(user, "jpg", 2_000);

  assert(first.startsWith(`${user}/`));
  assert(first.endsWith(".jpg"));
  // A fixed key would be served from every CDN edge and image cache that still
  // holds the previous picture, so the user would upload a new avatar and keep
  // seeing the old one.
  assert(first !== second);

  // And the same millisecond is not the same key. `Date.now()` is only
  // millisecond-resolution, so a double tap on the picker (or a request the
  // client retried) can produce two uploads with an identical timestamp --
  // and the upload is an upsert, so the second would overwrite the first
  // while `set_avatar` stored whichever URL came back last.
  const sameMs = new Set(
    Array.from({ length: 200 }, () => avatarStoragePath(user, "jpg", 1_000)),
  );
  assertEquals(sameMs.size, 200);
});

// ---------------------------------------------------------------------------
// Reading a profile
// ---------------------------------------------------------------------------

type RpcCall = { name: string; params: Record<string, unknown> };

function stubClient(
  responses: Record<string, unknown>,
  rows: unknown[] = [],
): {
  client: Parameters<typeof readOwnProfile>[0];
  calls: RpcCall[];
  filters: [string, unknown][];
} {
  const calls: RpcCall[] = [];
  const filters: [string, unknown][] = [];

  const chain = {
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return chain;
    },
    is(column: string, value: unknown) {
      filters.push([column, value]);
      return chain;
    },
    neq(column: string, value: unknown) {
      filters.push([`neq:${column}`, value]);
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      return Promise.resolve({
        data: responses[name] ?? null,
        error: null,
      });
    },
    from() {
      return { select: () => chain };
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return { client, calls, filters };
}

Deno.test("the owner's profile reports zeros rather than nothing", async () => {
  const { client } = stubClient({
    profile_overview: [{
      username: "ada",
      avatar_url: null,
      bio: null,
      member_since: "2026-01-01T00:00:00Z",
      current_streak: 0,
      longest_streak: 0,
      last_activity_date: null,
      stories_written: 0,
      chapters_written: 0,
      total_reads: 0,
      total_likes: 0,
      phrases_saved: 0,
      followers: 0,
      following: 0,
    }],
  });

  const profile = await readOwnProfile(client, "u1");
  assert(profile);
  assertEquals(profile.username, "ada");
  assertEquals(profile.currentStreak, 0);
  // Never read yet is a null date, not today. Today would start a streak the
  // reader has not earned.
  assertEquals(profile.lastActivityDate, null);
});

Deno.test("a public profile never carries a private field", async () => {
  const { client, calls } = stubClient({
    public_profile: [{
      username: "ada",
      avatar_url: "https://cdn/a.jpg",
      bio: "Writes at night.",
      member_since: "2026-01-01T00:00:00Z",
      first_published_at: "2026-02-01T00:00:00Z",
      stories_published: 3,
      total_reads: 120,
      total_likes: 14,
      followers: 9,
      following: 4,
      is_following: true,
      // A future change to the RPC that started returning something private
      // must not reach the client just because it was in the row.
      credits_balance: 400,
      saved_phrases: 22,
    }],
  });

  const profile = await readPublicProfile(client, "author-1", "viewer-1");
  assert(profile);
  assertEquals(Object.keys(profile).sort(), [
    "authorId",
    "avatarUrl",
    "bio",
    "firstPublishedAt",
    "followers",
    // The other half of the pair, added in 00073: a page that showed who was
    // interested in somebody while hiding who they were interested in read as
    // oddly one-sided. Public, and deliberately in this list.
    "following",
    "isFollowing",
    "memberSince",
    "storiesPublished",
    "totalLikes",
    "totalReads",
    "username",
  ]);
  assertEquals(calls[0].params.p_viewer_id, "viewer-1");
});

Deno.test("a signed-out visitor is never shown as following", async () => {
  const { client, calls } = stubClient({
    public_profile: [{ username: "ada", is_following: true }],
  });
  const profile = await readPublicProfile(client, "author-1", null);
  assertEquals(calls[0].params.p_viewer_id, null);
  // The RPC decides this, but the shape must survive a null viewer without
  // inventing a relationship.
  assert(profile);
  assertEquals(profile.isFollowing, true);
});

Deno.test("the public story list filters on exactly the private-story gate", async () => {
  const { client, filters } = stubClient({}, [
    {
      id: "s1",
      title: "A Public Story",
      genre: ["romance"],
      primary_genre: "romance",
      themes: [],
      cover_image_url: null,
      read_count: 10,
      like_count: 2,
      word_count: 900,
      created_at: "2026-02-01T00:00:00Z",
    },
  ]);

  const stories = await readPublicStories(client, "author-1");
  assertEquals(stories.length, 1);
  assertEquals(stories[0].title, "A Public Story");

  // Every clause, asserted individually. A story kept private because it names
  // a real living person is the one that must never appear here, and the
  // `entity_gate_reason is null` filter is the only thing in this list that
  // exists solely for that.
  assertEquals(filters, [
    ["author_id", "author-1"],
    ["is_public", true],
    ["status", "complete"],
    ["entity_gate_reason", null],
    ["neq:content_rating", "explicit"],
  ]);
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

Deno.test("handleProfile answers CORS preflight without auth", async () => {
  const response = await handleProfile(
    new Request("https://example.com/profile", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 204);
});

Deno.test("handleProfile rejects non-POST methods", async () => {
  const response = await handleProfile(
    new Request("https://example.com/profile", { method: "GET" }),
  );
  assertEquals(response.status, 405);
  assertEquals(await response.json(), { error: "Method not allowed" });
});

Deno.test("handleProfile rejects a malformed body before anything else", async () => {
  const response = await handleProfile(
    new Request("https://example.com/profile", {
      method: "POST",
      body: "not json",
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "Invalid JSON body" });
});

Deno.test("the owner's own profile needs a session; a guest is refused", async () => {
  for (const action of ["me", "username", "bio", "avatar"]) {
    const response = await handleProfile(
      new Request("https://example.com/profile", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    );
    assertEquals(response.status, 401, action);
    assertEquals(await response.json(), { error: "Unauthorized" });
  }
});

Deno.test("a public profile request refuses an authorId that is not a UUID", async () => {
  const response = await handleProfile(
    new Request("https://example.com/profile", {
      method: "POST",
      body: JSON.stringify({ action: "public", authorId: "kathaai" }),
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "authorId must be a valid UUID",
  });
});
