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

export type VisibilityRequest = "private" | "public";

/**
 * Why a public request stayed private. One value today; a union rather than a
 * literal so the response shape (`visibility.reason`) does not have to change
 * again if a second reason is ever added.
 */
export type VisibilityBlockedReason = "account_required";

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

  const { error: chapterError } = await client
    .from("chapters")
    .update({ is_published: true, published_at: new Date().toISOString() })
    .eq("story_id", input.storyId)
    .eq("is_published", false);
  if (chapterError) throw chapterError;

  // Any error on the story flip is thrown, not folded into a private outcome.
  // There used to be a `gate_constraint` branch here for the 00050 CHECK
  // refusing the write; that constraint is gone (00091), so a refusal now is
  // a real failure and the caller's error handling is the right place for it.
  const { error: storyError } = await client
    .from("stories")
    .update({ is_public: true })
    .eq("id", input.storyId);
  if (storyError) throw storyError;
  return { requested, applied: "public", reason: null };
}
