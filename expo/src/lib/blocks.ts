import { useSyncExternalStore } from "react";

import { blockAuthor, unblockAuthor } from "@/lib/comments";
import { getViewerId } from "@/lib/ownership";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * The people this reader has blocked, held once for the whole app.
 *
 * WHY THE CLIENT HOLDS IT AS WELL AS THE SERVER. Every server read that lists
 * somebody else's work already honours `user_blocks`: the comments thread,
 * Explore's search, the `feed` and `library` functions and a public profile.
 * But a block lands in the middle of a session, on top of lists that were
 * fetched before it: Home's Katha Originals, the stories opened from search,
 * Explore's current page and the Starred shelf. Without a copy here the
 * blocked writer's cards stay on screen until the next cold start, which is
 * exactly the moment a reader decides the button did nothing.
 *
 * So the set is loaded once after boot, grows the instant a block is
 * confirmed, and shrinks the instant one is undone. Screens filter through
 * `withoutBlockedAuthors`.
 */

let blocked: ReadonlySet<string> = new Set();
/**
 * Bumped when the account changes, so a block-list read started for the
 * previous identity cannot write into the next one.
 */
let epoch = 0;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  blocked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return blocked;
}

/** The current set, re-rendering the caller whenever it changes. */
export function useBlockedAuthorIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getBlockedAuthorIds(): ReadonlySet<string> {
  return blocked;
}

/** Record a block the server has confirmed. */
export function rememberBlocked(authorId: string): void {
  if (!authorId || blocked.has(authorId)) return;
  publish(new Set([...blocked, authorId]));
}

/** Record an unblock the server has confirmed. */
export function forgetBlocked(authorId: string): void {
  if (!blocked.has(authorId)) return;
  const next = new Set(blocked);
  next.delete(authorId);
  publish(next);
}

/** The account is gone (sign-out, deletion, a different sign-in). */
export function clearBlockedAuthors(): void {
  epoch += 1;
  if (blocked.size > 0) publish(new Set());
}

/**
 * Drop every story written by somebody the reader has blocked.
 *
 * Returns the same array when nothing is removed, so a `useMemo` downstream
 * does not see a new list on every render of an unblocked reader, which is
 * nearly every reader.
 */
export function withoutBlockedAuthors<T extends { authorId: string }>(
  stories: T[],
  blockedIds: ReadonlySet<string>,
): T[] {
  if (blockedIds.size === 0) return stories;
  const kept = stories.filter((story) => !blockedIds.has(story.authorId));
  return kept.length === stories.length ? stories : kept;
}

/**
 * Block someone, then hide them everywhere this session has already drawn.
 *
 * Rejects when the write did not land, and in that case nothing is hidden:
 * a block the reader believes happened and did not is the failure this whole
 * surface exists to prevent.
 */
export async function blockAuthorEverywhere(authorId: string): Promise<void> {
  if (isSupabaseConfigured) await blockAuthor(authorId);
  rememberBlocked(authorId);
}

/** Undo a block. Rejects, and changes nothing, when the write did not land. */
export async function unblockAuthorEverywhere(authorId: string): Promise<void> {
  if (isSupabaseConfigured) await unblockAuthor(authorId);
  forgetBlocked(authorId);
}

/** The signed-in viewer, or null when there is no session. */
async function currentUserId(): Promise<string | null> {
  const known = getViewerId();
  if (known) return known;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the block list for whoever is signed in now.
 *
 * `user_blocks` is readable by its own blocker (migration 00043), so this is
 * one indexed PostgREST read. False when it could not be read; the set is
 * then left as it was rather than emptied, because "we could not ask" is not
 * "you have blocked nobody".
 */
export async function refreshBlockedAuthors(): Promise<boolean> {
  if (!isSupabaseConfigured) return true;
  const startedIn = epoch;
  const userId = await currentUserId();
  if (!userId) return true;
  try {
    const { data, error } = await supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);
    if (error || !Array.isArray(data)) return false;
    if (startedIn !== epoch) return false;
    publish(
      new Set(
        data
          .map((row) => (row as Record<string, unknown>).blocked_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export type BlockedAccount = {
  id: string;
  /** The handle, or "Reader" for an account that never chose one. */
  name: string;
  avatarUrl: string | null;
  blockedAt: string | null;
};

/**
 * Everyone this reader has blocked, newest first, with the name to show.
 *
 * Two reads rather than an embed: `user_blocks` has two foreign keys to
 * `profiles`, so PostgREST cannot guess which one an embed means, and the
 * profile columns a stranger may read are only `id, username, avatar_url`
 * (migration 00006). `ok: false` is a failed read, never an empty list.
 */
export async function fetchBlockedAccounts(): Promise<
  { ok: true; accounts: BlockedAccount[] } | { ok: false }
> {
  if (!isSupabaseConfigured) return { ok: true, accounts: [] };
  const userId = await currentUserId();
  if (!userId) return { ok: true, accounts: [] };
  try {
    const { data: rows, error } = await supabase
      .from("user_blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(rows)) return { ok: false };

    const order = rows
      .map((row) => row as Record<string, unknown>)
      .filter((row) => typeof row.blocked_id === "string")
      .map((row) => ({
        id: row.blocked_id as string,
        blockedAt: typeof row.created_at === "string" ? row.created_at : null,
      }));
    // The list is the record, so the store follows it.
    publish(new Set(order.map((row) => row.id)));
    if (order.length === 0) return { ok: true, accounts: [] };

    const { data: people, error: peopleError } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", order.map((row) => row.id));
    if (peopleError || !Array.isArray(people)) return { ok: false };

    const byId = new Map(
      people.map((person) => {
        const record = person as Record<string, unknown>;
        return [String(record.id), record] as const;
      }),
    );
    return {
      ok: true,
      accounts: order.map(({ id, blockedAt }) => {
        const person = byId.get(id);
        const username = typeof person?.username === "string"
          ? person.username.trim()
          : "";
        return {
          id,
          name: username || "Reader",
          avatarUrl: typeof person?.avatar_url === "string"
            ? person.avatar_url
            : null,
          blockedAt,
        };
      }),
    };
  } catch {
    return { ok: false };
  }
}
