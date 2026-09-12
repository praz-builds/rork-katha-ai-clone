import AsyncStorage from "@react-native-async-storage/async-storage";

import { captureError } from "@/lib/analytics";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { CreateDraft, SavedCharacter } from "@/types/domain";

/**
 * The user's saved-character library.
 *
 * Backed by the `user_characters` table (migration 00057, owner-only RLS)
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
// The table migration 00057 actually creates. It was `saved_characters` here,
// which exists in no migration: every list and every save failed against a
// configured backend, silently falling through to the offline store on read
// and throwing on write.
const TABLE = "user_characters";

/**
 * The retired column, still selected and never written.
 *
 * `user_characters.description` held what the Craft sheet used to call
 * Description, back when the sheet asked for that AND an Appearance. Appearance
 * is the only field now, but a character saved before the change has its text
 * only here -- so this is still read, and `fromRow` resolves it into
 * `appearance` when that column is empty. Dropping it from the select would
 * turn every previously saved character into a bare name.
 */
const LEGACY_ROLE_COLUMN = "description";

const SELECT_COLUMNS =
  `id, name, ${LEGACY_ROLE_COLUMN}, background, appearance, portrait_url, source_story_id, created_at`;

/**
 * Escapes a name for a PostgREST `ilike` pattern.
 *
 * `%` and `_` are wildcards there, so a character called "Mr_Fox" would match
 * -- and then UPDATE -- "MrsFox" instead. Postgres's default LIKE escape is a
 * backslash, so the backslash itself has to go first.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

type DraftCharacter = CreateDraft["characters"][number];

export type SavedCharacterInput = {
  name: string;
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
    background: saved.background,
    appearance: saved.appearance ?? "",
    portraitUrl: saved.portraitUrl,
    portraitStatus: saved.portraitUrl ? "ready" : "idle",
    isHero,
    savedCharacterId: saved.id,
  };
}

type Row = {
  id: string;
  name: string;
  /** Retired. Read as `appearance`'s fallback only -- see `LEGACY_ROLE_COLUMN`. */
  description: string | null;
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
    background: row.background ?? undefined,
    // The retired column is the fallback, never a second field. A character
    // saved before Description was merged into Appearance has its text only
    // there, and the picker would otherwise list them with no detail at all.
    appearance: row.appearance?.trim() || row.description?.trim() || undefined,
    portraitUrl: row.portrait_url ?? undefined,
    sourceStoryId: row.source_story_id ?? undefined,
    createdAt: row.created_at,
  };
}

function toRow(input: SavedCharacterInput) {
  return {
    name: input.name.trim(),
    // The retired column is read, never written: a save must not resurrect the
    // field the sheet stopped collecting. `LEGACY_ROLE_COLUMN` says why the
    // column is still selected.
    background: input.background ?? null,
    appearance: input.appearance ?? null,
    portrait_url: input.portraitUrl ?? null,
    source_story_id: input.sourceStoryId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Field limits
// ---------------------------------------------------------------------------

/**
 * The same bounds migration 00057 puts on the table, checked here first.
 *
 * `user_characters` CHECKs `char_length(btrim(name)) between 1 and 100` and
 * `char_length(...) <= 500` on `background` and `appearance`. Without this the
 * 501st character of an appearance comes back as a PostgREST constraint
 * violation -- `new row for relation "user_characters" violates check
 * constraint` -- which is what the onboarding screen would then have to show
 * the user. Trimming first matters as much as the ceiling: the table measures
 * the trimmed name, so " " is a zero-length name to Postgres and a one
 * character name to a naive client check.
 */
const MAX_NAME_LENGTH = 100;
const MAX_DETAIL_LENGTH = 500;

function boundedDetail(
  value: string | undefined,
  field: "background" | "appearance",
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DETAIL_LENGTH) {
    throw new Error(
      `A character's ${field} is at most ${MAX_DETAIL_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** The input as the table will accept it, or a readable refusal. */
export function boundSavedCharacterInput(
  input: SavedCharacterInput,
): SavedCharacterInput {
  const name = input.name.trim();
  if (!name) throw new Error("A saved character needs a name.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `A character's name is at most ${MAX_NAME_LENGTH} characters.`,
    );
  }
  return {
    ...input,
    name,
    background: boundedDetail(input.background, "background"),
    appearance: boundedDetail(input.appearance, "appearance"),
  };
}

/**
 * Refuse the offline store in a build that is supposed to have a backend.
 *
 * The AsyncStorage fallback exists so the flow can be walked with no
 * credentials -- the offline walkthrough and Jest. In a release build
 * `isSupabaseConfigured` being false means the bundle shipped without
 * `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY`, and silently writing to the device
 * instead is the worst available answer: the onboarding character appears to
 * save, survives the session, and never exists anywhere the account can reach
 * it. Loud beats lost.
 */
function assertLocalFallbackAllowed(): void {
  if (__DEV__ || isSupabaseConfigured) return;
  try {
    captureError({
      bucket: "auth",
      severity: "critical",
      errorCode: "supabase_unconfigured_in_release",
      error: new Error("supabase_unconfigured_in_release"),
      context: { feature: "saved_characters" },
    });
  } catch {
    // Reporting the misconfiguration must not replace throwing on it.
  }
  throw new Error("Saving is unavailable right now. Please try again later.");
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
    .select(SELECT_COLUMNS)
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
  // Bounded before anything is sent, so a 501-character appearance fails here
  // with a sentence a screen can show rather than as a PostgREST constraint
  // violation.
  const bounded = boundSavedCharacterInput(input);
  const name = bounded.name;

  if (!isSupabaseConfigured) {
    assertLocalFallbackAllowed();
    const local = await readLocal();
    const key = nameKey(name);
    const existing = local.find((character) => nameKey(character.name) === key);
    const next: SavedCharacter = {
      id: existing?.id ?? localId(),
      name,
      background: bounded.background,
      appearance: bounded.appearance,
      portraitUrl: bounded.portraitUrl ?? existing?.portraitUrl,
      sourceStoryId: bounded.sourceStoryId ?? existing?.sourceStoryId,
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
    .ilike("name", escapeLikePattern(name))
    .limit(1);
  if (lookupError) throw new Error(lookupError.message);
  const existing = (existingRows ?? [])[0] as { id: string; portrait_url: string | null } | undefined;

  const row = toRow(bounded);
  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...row, portrait_url: row.portrait_url ?? existing.portrait_url })
      .eq("id", existing.id)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
  }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...row, owner_id: user.userId })
    .select(SELECT_COLUMNS)
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
