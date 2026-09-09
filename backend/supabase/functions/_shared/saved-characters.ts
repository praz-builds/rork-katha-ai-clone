/**
 * The writer's saved characters, on the generation path.
 *
 * Two jobs, both best-effort around a paid generation:
 *
 * - **Resolve.** A brief may reference a saved character by id instead of
 *   restating it. The client already copies the fields when the writer taps a
 *   saved character, so the id is mostly a link; but a field the client left
 *   blank is filled from the library here, and the portrait the writer paid
 *   for once comes along. An id that is not the caller's is dropped silently:
 *   the character keeps whatever the brief said and simply does not link to
 *   somebody else's row. A generation must never fail over a stale id.
 *
 * - **Remember.** After a story's first chapter is persisted, its cast is
 *   copied into `user_characters` (migration 00057) so the next brief can
 *   start from it. Names already saved are skipped by the database. A
 *   failure here is logged and costs the writer nothing but the convenience.
 */

import type { CharacterInput } from "./types.ts";

export interface SavedCharacterRow {
  id: string;
  name: string;
  description: string | null;
  background: string | null;
  appearance: string | null;
  portrait_url: string | null;
}

/** The slice of the Supabase client these helpers use. */
export interface SavedCharacterClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        in(
          column: string,
          values: readonly string[],
        ): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

function fill(value: string | undefined, fallback: string | null) {
  if (typeof value === "string" && value.trim()) return value;
  return fallback ?? undefined;
}

export async function resolveSavedCharacters(
  client: SavedCharacterClient,
  userId: string,
  characters: readonly CharacterInput[],
): Promise<CharacterInput[]> {
  const ids = [
    ...new Set(
      characters.map((c) => c.savedCharacterId).filter((
        id,
      ): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (ids.length === 0) return [...characters];

  let rows: SavedCharacterRow[] = [];
  try {
    const { data, error } = await client
      .from("user_characters")
      .select("id, name, description, background, appearance, portrait_url")
      .eq("owner_id", userId)
      .in("id", ids);
    if (error) throw error;
    rows = (data ?? []) as SavedCharacterRow[];
  } catch (error) {
    console.error("saved character lookup failed:", String(error));
    return characters.map((c) => ({ ...c, savedCharacterId: undefined }));
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return characters.map((character) => {
    if (!character.savedCharacterId) return { ...character };
    const saved = byId.get(character.savedCharacterId);
    if (!saved) return { ...character, savedCharacterId: undefined };
    return {
      ...character,
      name: fill(character.name, saved.name) ?? character.name,
      description: fill(character.description, saved.description),
      background: fill(character.background, saved.background),
      appearance: fill(character.appearance, saved.appearance),
      portraitUrl: fill(character.portraitUrl, saved.portrait_url),
      savedCharacterId: saved.id,
    };
  });
}

/** Copy a finished story's cast into the author's library. Never throws. */
export async function rememberStoryCharacters(
  client: SavedCharacterClient,
  userId: string,
  storyId: string,
): Promise<number> {
  try {
    const { data, error } = await client.rpc("remember_story_characters", {
      p_user_id: userId,
      p_story_id: storyId,
    });
    if (error) throw error;
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.error("remember_story_characters failed:", String(error));
    return 0;
  }
}
