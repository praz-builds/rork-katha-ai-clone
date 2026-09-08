import type { Story } from "@/types/domain";

/**
 * Whether the current reader owns this story and may edit it.
 *
 * There is no auth-linked "current user" check anywhere else in the client
 * yet: no screen compares a signed-in Supabase user id against
 * `story.authorId`. The one place ownership is already expressed is
 * `localGeneratedStory` in `src/lib/api.ts`, which stamps a story the current
 * session just generated with the sentinel `authorId: "me"`. Reusing that
 * exact sentinel, rather than inventing a second and parallel notion of
 * ownership, is what "check how ownership is determined elsewhere" means
 * until the client has a real signed-in user id to compare against.
 */
export function isOwnStory(story: Pick<Story, "authorId">): boolean {
  return story.authorId === "me";
}
