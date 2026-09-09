import AsyncStorage from "@react-native-async-storage/async-storage";

import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { CreateDraft, SavedCharacter } from "@/types/domain";

/**
 * The user's saved-character library.
 *
 * Backed by the `saved_characters` table (migration 00057, owner-only RLS)
 * through PostgREST: there is no edge function in the path, because "list my
 * rows, add one, delete one" is exactly what row-level security expresses,
 * and an anonymous guest session created by `bootstrap-user` is a real
 * `authenticated` identity to Postgres.
 *
 * Without a configured backend (the offline walkthrough, Jest) the same API
 * is served from AsyncStorage so the brief's Saved tab and the Reimagine
 * picker still work end to end. That store is per device and is never
 * synced; it exists so the flow can be walked, not as a second source of
 * truth.
 *
 * Names are the identity a writer thinks in, so saving twice with the same
 * name (case-insensitive, trimmed) UPDATES the existing entry rather than
 * growing a second "Naina". The backend auto-saves a brief's cast on first
 * generation through the same rule.
 */

const LOCAL_KEY = "katha.saved-characters.v1";
const TABLE = "saved_characters";

type DraftCharacter = CreateDraft["characters"][number];

export type SavedCharacterInput = {
  name: string;
  role?: string;
  background?: string;
  appearance?: string;
  portraitUrl?: string;
  sourceStoryId?: string;
};

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A brief's character as the library stores it. */
export function savedCharacterInputFromDraft(
  character: DraftCharacter,
  sourceStoryId?: string,
): SavedCharacterInput {
  return {
    name: character.name.trim(),
    role: character.description?.trim() || undefined,
    background: character.background?.trim() || undefined,
    appearance: character.appearance?.trim() || undefined,
    portraitUrl: character.portraitStatus === "ready" ? character.portraitUrl : undefined,
    sourceStoryId,
  };
}

/** A library entry as the brief's cast list holds it. */
export function draftCharacterFromSaved(
  saved: SavedCharacter,
  isHero: boolean,
): DraftCharacter {
  return {
    name: saved.name,
    description: saved.role ?? "",
    background: saved.background,
    appearance: saved.appearance,
    portraitUrl: saved.portraitUrl,
    portraitStatus: saved.portraitUrl ? "ready" : "idle",
    isHero,
    savedCharacterId: saved.id,
  };
}

type Row = {
  id: string;
  name: string;
  role: string | null;
  background: string | null;
  appearance: string | null;
  portrait_url: string | null;
  source_story_id: string | null;
  created_at: string;
};

function fromRow(row: Row): SavedCharacter {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? undefined,
    background: row.background ?? undefined,
    appearance: row.appearance ?? undefined,
    portraitUrl: row.portrait_url ?? undefined,
    sourceStoryId: row.source_story_id ?? undefined,
    createdAt: row.created_at,
  };
}

function toRow(input: SavedCharacterInput) {
  return {
    name: input.name.trim(),
    role: input.role ?? null,
    background: input.background ?? null,
    appearance: input.appearance ?? null,
    portrait_url: input.portraitUrl ?? null,
    source_story_id: input.sourceStoryId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Local store (no backend)
// ---------------------------------------------------------------------------

async function readLocal(): Promise<SavedCharacter[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedCharacter[]) : [];
  } catch {
    return [];
  }
}

async function writeLocal(characters: SavedCharacter[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(characters));
  } catch {
    // Storage failure leaves the in-memory result intact for this call; the
    // next list simply reads what was last written successfully.
  }
}

function localId(): string {
  return `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Every saved character, newest first. */
export async function listSavedCharacters(): Promise<SavedCharacter[]> {
  if (!isSupabaseConfigured) {
    const local = await readLocal();
    return [...local].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await bootstrapUser();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, role, background, appearance, portrait_url, source_story_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(fromRow);
}

/**
 * Save a character to the library, updating the entry that already carries
 * this name (case-insensitive) rather than adding a duplicate.
 */
export async function saveCharacterToLibrary(
  input: SavedCharacterInput,
): Promise<SavedCharacter> {
  const name = input.name.trim();
  if (!name) throw new Error("A saved character needs a name.");

  if (!isSupabaseConfigured) {
    const local = await readLocal();
    const key = nameKey(name);
    const existing = local.find((character) => nameKey(character.name) === key);
    const next: SavedCharacter = {
      id: existing?.id ?? localId(),
      name,
      role: input.role,
      background: input.background,
      appearance: input.appearance,
      portraitUrl: input.portraitUrl ?? existing?.portraitUrl,
      sourceStoryId: input.sourceStoryId ?? existing?.sourceStoryId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await writeLocal([
      next,
      ...local.filter((character) => character.id !== next.id),
    ]);
    return next;
  }

  const user = await bootstrapUser();
  if (!user) throw new Error("Please sign in to save characters.");
  const { data: existingRows, error: lookupError } = await supabase
    .from(TABLE)
    .select("id, portrait_url")
    .ilike("name", name)
    .limit(1);
  if (lookupError) throw new Error(lookupError.message);
  const existing = (existingRows ?? [])[0] as { id: string; portrait_url: string | null } | undefined;

  const row = toRow({ ...input, name });
  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...row, portrait_url: row.portrait_url ?? existing.portrait_url })
      .eq("id", existing.id)
      .select("id, name, role, background, appearance, portrait_url, source_story_id, created_at")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
  }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...row, owner_id: user.userId })
    .select("id, name, role, background, appearance, portrait_url, source_story_id, created_at")
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data as Row);
}

export async function deleteSavedCharacter(id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const local = await readLocal();
    await writeLocal(local.filter((character) => character.id !== id));
    return;
  }
  await bootstrapUser();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
