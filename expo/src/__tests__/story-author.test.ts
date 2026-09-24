/**
 * Who a story is by, as the reader shows it.
 *
 * `authorFor` falls back to the house account for any id the seed does not
 * know, so every real writer's story ended "Katha AI", with the house bio and
 * 48,200 followers. `resolveStoryAuthor` only uses the seed for a seed id.
 */
import { resolveStoryAuthor } from "@/lib/story-author";
import type { PublicProfile } from "@/lib/profile";

const REAL = "7c1f3a52-0d4e-4b8a-9f6e-2a3b4c5d6e7f";

const profile: PublicProfile = {
  authorId: REAL,
  username: "mira",
  avatarUrl: null,
  bio: "Writes about trains.",
  memberSince: null,
  firstPublishedAt: null,
  storiesPublished: 2,
  totalReads: 0,
  totalLikes: 0,
  followers: 31,
  following: 0,
  isFollowing: true,
};

it("never signs a real writer's story as the house account", () => {
  const loading = resolveStoryAuthor({ authorId: REAL }, null);
  expect(loading.displayName).toBe("A Katha writer");
  expect(loading.bio).toBeUndefined();
  expect(loading.followers).toBe(0);

  const loaded = resolveStoryAuthor({ authorId: REAL }, profile);
  expect(loaded).toMatchObject({
    displayName: "@mira",
    bio: "Writes about trains.",
    followers: 31,
    isFollowing: true,
    canOpen: true,
    canFollow: true,
  });
});

it("uses the follow the story carries until the profile answers", () => {
  expect(resolveStoryAuthor({ authorId: REAL, viewerFollowsAuthor: true }, null).isFollowing).toBe(true);
  expect(resolveStoryAuthor({ authorId: REAL }, null).isFollowing).toBeNull();
});

it("keeps a seed author only for its own seed id", () => {
  expect(resolveStoryAuthor({ authorId: "zoeok" }, null).displayName).toBe("Zoe Okonkwo");
});

it("does not invent an author, or a link, for an id it cannot place", () => {
  for (const authorId of ["", "not-a-seed-or-uuid"]) {
    const author = resolveStoryAuthor({ authorId }, null);
    expect(author.displayName).toBe("A Katha writer");
    expect(author.displayName).not.toBe("Katha AI");
    expect(author.canOpen).toBe(false);
    expect(author.canFollow).toBe(false);
  }
});

it("calls your own story yours, and offers no Follow on it", () => {
  const own = resolveStoryAuthor({ authorId: "me" }, null);
  expect(own).toMatchObject({ displayName: "You", isOwn: true, canFollow: false, canOpen: false });
});
