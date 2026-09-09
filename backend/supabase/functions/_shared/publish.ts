/**
 * Publishing by toggle.
 *
 * Product decision, 2026-09-09: the visibility switch in the create brief IS
 * the publish button. A story generated with `visibility: "public"` is public
 * the moment its first chapter is persisted, unless something forbids it -
 * and then it is private, and the response says why, so the client can show
 * the same "This one stays private" explanation it already shows on a refused
 * publish. There is no separate review step any more.
 *
 * What can forbid it, in the order it is checked:
 *
 * 1. **The caller is a guest.** `publish-story` has always refused a public
 *    request from an anonymous session ("Create an account before publishing
 *    publicly"), and the rule is the same here. `account_required`.
 * 2. **The entity gate.** A story that names a living public figure or a
 *    private individual (`_shared/entity-visibility-gate.ts`, migration 00050)
 *    is forced private whatever was asked. The reason is the gate's own enum.
 * 3. **The database.** The 00050 CHECK constraint is the real gate; this
 *    module is the courtesy in front of it. If the update is refused with
 *    `23514` anyway - a race with the gate being written, a future gate this
 *    code does not know about - the story stays private and the outcome says
 *    `gate_constraint` rather than pretending it was published.
 *
 * The columns written are exactly the ones `publish-story` writes, in the same
 * order (chapters first, then the story), so the two paths cannot disagree
 * about what "public" means.
 */

import type { GatingReason } from "./entity-visibility-gate.ts";

export type VisibilityRequest = "private" | "public";

export type VisibilityBlockedReason =
  | GatingReason
  | "account_required"
  | "gate_constraint";

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

function isCheckViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" &&
      (error as { code?: unknown }).code === "23514",
  );
}

export async function applyRequestedVisibility(
  client: VisibilityClient,
  input: {
    storyId: string;
    requested: VisibilityRequest;
    isAnonymous: boolean;
    gateReason: GatingReason | null;
  },
): Promise<VisibilityOutcome> {
  const { requested } = input;
  if (requested === "private") {
    return { requested, applied: "private", reason: null };
  }
  if (input.isAnonymous) {
    return { requested, applied: "private", reason: "account_required" };
  }
  if (input.gateReason) {
    return { requested, applied: "private", reason: input.gateReason };
  }

  const { error: chapterError } = await client
    .from("chapters")
    .update({ is_published: true, published_at: new Date().toISOString() })
    .eq("story_id", input.storyId)
    .eq("is_published", false);
  if (chapterError) throw chapterError;

  const { error: storyError } = await client
    .from("stories")
    .update({ is_public: true })
    .eq("id", input.storyId);
  if (storyError) {
    if (isCheckViolation(storyError)) {
      // The chapters are marked published on a story that stays private. That
      // is the state a refused publish-story call leaves behind too, and it
      // is harmless: nothing reads `chapters.is_published` without the
      // story's own visibility in front of it.
      return { requested, applied: "private", reason: "gate_constraint" };
    }
    throw storyError;
  }
  return { requested, applied: "public", reason: null };
}
