import type { Story } from "@/types/domain";

/**
 * The signed-in (or guest) user id, as `bootstrap-user` reported it.
 *
 * Held here rather than in `session.ts` so that this module has no
 * dependency on the network layer: a test that mocks `@/lib/session` down to
 * `bootstrapUser` alone must not take ownership checks down with it.
 */
let viewerId: string | null = null;

/** Called by `bootstrapUser` once the server has said who the viewer is. */
export function setViewerId(id: string | null): void {
  viewerId = id;
}

export function getViewerId(): string | null {
  return viewerId;
}

/**
 * Whether the current reader owns this story and may edit it.
 *
 * Two ways to own a story. A story generated with no backend configured is
 * stamped `authorId: "me"` by `localGeneratedStory` in `src/lib/api.ts`, and
 * so is the provisional story a generation session shows while the server is
 * still writing. A story that came back from the server carries its real
 * `author_id`, which is compared against the id `bootstrap-user` handed this
 * client. Before that comparison existed every server-generated story failed
 * the check, so Edit never appeared on a story the writer had just paid for.
 */
export function isOwnStory(story: Pick<Story, "authorId">): boolean {
  if (story.authorId === "me") return true;
  return viewerId !== null && story.authorId === viewerId;
}
