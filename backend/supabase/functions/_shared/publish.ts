/**
 * Publishing by toggle.
 *
 * Product decision, 2026-09-09: the visibility switch in the create brief IS
 * the publish button. A story generated with `visibility: "public"` is public
 * the moment its first chapter is persisted. There is no separate review step.
 *
 * Product decision, 2026-09-18: the toggle is honoured. Until then three more
 * things could turn a public request private here - an entity gate for a
 * story naming a living public figure or a private individual (migration
 * 00050), a refusal when entity classification never answered (00058), and a
 * database CHECK behind both. The owner removed all three for the MVP
 * (migration 00091), because every name on a writer's character sheet is
 * classified `private_individual` - the sheet is the sole authority on who a
 * character is - so every story with a named cast, which is nearly every
 * story, came back private whatever the writer had asked for. A switch that
 * says "public" over a story that stays private is the product lying.
 *
 * What can still forbid it is one thing: **the caller is a guest.**
 * `publish-story` has always refused a public request from an anonymous
 * session ("Create an account before publishing publicly"), and the rule is
 * the same here. That is abuse control - a throwaway session must not be able
 * to put prose on the public feed - not privacy, so it stays. `account_required`.
 *
 * The columns written are exactly the ones `publish-story` writes, in the same
 * order (chapters first, then the story), so the two paths cannot disagree
 * about what "public" means.
 */

import { logError } from "./errors.ts";

export type VisibilityRequest = "private" | "public";

/**
 * Why a public request stayed private.
 *
 * `account_required` is the guest rule. `publish_failed` means one of the two
 * visibility writes errored: the story is written, paid for and delivered,
 * it is simply still private, and the client's own follow-up `publish-story`
 * call (`applyVisibility` in `generation-session.ts`) is the retry.
 */
export type VisibilityBlockedReason = "account_required" | "publish_failed";

export interface VisibilityOutcome {
  /** What the request asked for. */
  requested: VisibilityRequest;
  /** What the story actually is now. */
  applied: VisibilityRequest;
  /** Why `applied` differs from `requested`; null when they agree. */
  reason: VisibilityBlockedReason | null;
}

/**
 * Read a `visibility` field. Absent means private - a client that says
 * nothing must never publish - and anything other than the two words is an
 * error rather than a guess.
 */
export function parseVisibilityRequest(
  value: unknown,
): VisibilityRequest | null {
  if (value === undefined || value === null) return "private";
  if (value === "private" || value === "public") return value;
  return null;
}

/** The narrow slice of the Supabase client this module uses. */
export interface VisibilityFilter extends PromiseLike<{ error: unknown }> {
  eq(column: string, value: unknown): VisibilityFilter;
}
export interface VisibilityClient {
  from(table: string): {
    update(values: Record<string, unknown>): VisibilityFilter;
  };
}

export async function applyRequestedVisibility(
  client: VisibilityClient,
  input: {
    storyId: string;
    requested: VisibilityRequest;
    isAnonymous: boolean;
  },
): Promise<VisibilityOutcome> {
  const { requested } = input;
  if (requested === "private") {
    return { requested, applied: "private", reason: null };
  }
  if (input.isAnonymous) {
    return { requested, applied: "private", reason: "account_required" };
  }

  // NEVER THROWS PAST THIS POINT. Both callers run this after the chapter is
  // persisted and the credit deducted, inside the block whose `catch` refunds
  // the operation and fails the request. A visibility write that errored used
  // to land there, so a hiccup on `stories.is_public` threw away a chapter
  // the writer had already been shown. Visibility is not worth a chapter: a
  // failed flip leaves the story private and says so.
  const publishedAt = new Date().toISOString();
  const { error: chapterError } = await client
    .from("chapters")
    .update({ is_published: true, published_at: publishedAt })
    .eq("story_id", input.storyId)
    .eq("is_published", false);
  if (chapterError) {
    console.error("publish: chapter flip failed", errorCode(chapterError));
    await logPublishFailure(input.storyId, "chapters", chapterError);
    return { requested, applied: "private", reason: "publish_failed" };
  }

  // Chapters first, then the story, the same order `publish-story` uses: a
  // story that went public before its chapters would be listed with a zero
  // chapter count. The cost of that order is this branch - the chapters are
  // already marked published when the story write fails - so the chapters
  // this call flipped (matched by the exact `published_at` it wrote) are put
  // back, leaving the rows as they were before it ran rather than half
  // published. Best effort: nothing reads `chapters.is_published` without the
  // story's own visibility in front of it (RLS and every feed query check the
  // story), so a revert that also fails leaks nothing, and a later publish
  // simply finishes the job.
  const { error: storyError } = await client
    .from("stories")
    .update({ is_public: true })
    .eq("id", input.storyId);
  if (storyError) {
    console.error("publish: story flip failed", errorCode(storyError));
    await logPublishFailure(input.storyId, "stories", storyError);
    const { error: revertError } = await client
      .from("chapters")
      .update({ is_published: false, published_at: null })
      .eq("story_id", input.storyId)
      // Both halves of "what this call published": the timestamp it wrote,
      // and the flag it set. The timestamp alone is unique in practice --
      // nothing else writes `published_at` while a generation is in flight --
      // but "in practice" is an argument about today's callers, and this
      // clause makes the bound a property of the query instead.
      .eq("is_published", true)
      .eq("published_at", publishedAt);
    if (revertError) {
      console.error("publish: chapter revert failed", errorCode(revertError));
      await logPublishFailure(input.storyId, "revert", revertError);
    }
    return { requested, applied: "private", reason: "publish_failed" };
  }
  return { requested, applied: "public", reason: null };
}

/**
 * A failed visibility flip is recorded, not merely printed.
 *
 * The Observability Gate: a failure that exists only in a console line did
 * not happen as far as the system is concerned, and this one is invisible
 * everywhere else -- the client reads `story.is_public` and never looks at
 * `visibility.reason`, so a writer whose public story came out private has
 * nothing to report and nobody to report it to. `logError` never throws, so
 * this is safe inside the block above that must not throw.
 *
 * `failure` says which of the three writes failed; `code` is the Postgres
 * code. Neither carries prose, a title or a seed.
 */
async function logPublishFailure(
  storyId: string,
  failure: "chapters" | "stories" | "revert",
  error: unknown,
): Promise<void> {
  await logError({
    bucket: "publishing",
    severity: "high",
    source: "runtime",
    errorCode: "visibility_flip_failed",
    error,
    context: { story_id: storyId, failure, code: errorCode(error) },
  });
}

/** A Postgres/PostgREST code for a log line - never a message, never content. */
function errorCode(error: unknown): string {
  const code = error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === "string" ? code : "unknown";
}
