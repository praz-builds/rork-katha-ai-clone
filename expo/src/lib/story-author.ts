import { useEffect, useState } from "react";
import { authors } from "@/data/seed";
import { isOwnStory } from "@/lib/ownership";
import { fetchPublicProfile, isRealAuthorId, type PublicProfile } from "@/lib/profile";
import type { Author, Story } from "@/types/domain";

/**
 * Who wrote a story, as the reader may show it.
 *
 * WHY NOT `authorFor`. The seed's `authorFor` falls back to `authors[0]` for
 * any id it does not know, which is the house account. Every real writer's
 * story therefore ended with "Katha AI", the house bio and 48,200 followers.
 * Here the seed is consulted ONLY for an id that is actually in it; a real
 * account is read from its public profile, the same source `AuthorScreen`
 * uses, and your own story says "You".
 */
export type StoryAuthor = {
  displayName: string;
  bio?: string;
  followers: number;
  /** What the server says about the viewer following; null until it has said. */
  isFollowing: boolean | null;
  /** A real account with a profile page to open. Never "", "me" or a seed id. */
  canOpen: boolean;
  /** Follow is offered: a real account that is not the viewer. */
  canFollow: boolean;
  isOwn: boolean;
};

/** The seed author with exactly this id, or null. No fallback, on purpose. */
export function seedAuthorExact(authorId: string): Author | null {
  return authors.find((author) => author.id === authorId) ?? null;
}

/** Pure: resolves what can be said now, given the profile if one has loaded. */
export function resolveStoryAuthor(
  story: Pick<Story, "authorId" | "viewerFollowsAuthor">,
  profile: PublicProfile | null,
): StoryAuthor {
  const real = isRealAuthorId(story.authorId);
  if (isOwnStory(story)) {
    return {
      displayName: "You",
      followers: 0,
      isFollowing: null,
      canOpen: real,
      canFollow: false,
      isOwn: true,
    };
  }
  if (!real) {
    const seed = seedAuthorExact(story.authorId);
    return {
      displayName: seed?.displayName ?? "A Katha writer",
      bio: seed?.bio,
      followers: seed?.followers ?? 0,
      isFollowing: null,
      canOpen: false,
      canFollow: false,
      isOwn: false,
    };
  }
  return {
    // The handle, as `AuthorScreen` shows it. The display name is private by
    // design (`_shared/profile.ts`): it is what a person is called on their
    // own home screen, never on a byline a stranger sees.
    displayName: profile?.username ? `@${profile.username}` : "A Katha writer",
    bio: profile?.bio ?? undefined,
    followers: profile?.followers ?? 0,
    isFollowing: profile ? profile.isFollowing : story.viewerFollowsAuthor ?? null,
    canOpen: true,
    canFollow: true,
    isOwn: false,
  };
}

export function useStoryAuthor(
  story: Pick<Story, "authorId" | "viewerFollowsAuthor">,
): StoryAuthor {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const own = isOwnStory(story);
  const real = isRealAuthorId(story.authorId);

  useEffect(() => {
    // Cleared first: a failed read must not leave the previous story's author
    // on this one.
    setProfile(null);
    if (!real || own) return;
    let alive = true;
    fetchPublicProfile(story.authorId)
      .then((result) => {
        if (alive && result) setProfile(result.profile);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [story.authorId, real, own]);

  return resolveStoryAuthor(story, profile);
}
