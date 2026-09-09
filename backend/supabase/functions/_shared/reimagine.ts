/**
 * The pure parts of `reimagine-chapter`: reading the request's replacement
 * list, and turning it into a cast and a set of renames.
 *
 * They live here rather than in the handler because they are where the
 * product's rules actually are - what a replacement may say, what replacing a
 * character does to the roster the prompt describes, and which replacements
 * escape the chapter they were made in - and none of that needs a database, a
 * model, or a request. The handler is the transport around them.
 */

import type { CharacterRename } from "./character-substitution.ts";
import { parseUuid } from "./operations.ts";
import type { CharacterInput } from "./types.ts";

/** The reimagine prompt is a sentence or two, not a brief. */
export const MAX_PROMPT_LENGTH = 500;
/** More than this and the sheet is being used as a find-and-replace tool. */
const MAX_REPLACEMENTS = 6;

/**
 * A replacement, after the ids have been resolved against the caller's saved
 * characters and the free-text fields have been trimmed.
 */
export interface ResolvedReplacement {
  fromName: string;
  to: CharacterInput;
  applyToAllChapters: boolean;
}

/**
 * Read the `character_replacements` array. Returns a message rather than
 * throwing, because every one of these is a client bug the caller should see.
 *
 * `to` is one of two shapes and never both: a reference to a row in the
 * caller's saved-character library, or a character typed in the sheet. The
 * library lookup happens later (it needs the database); this only decides that
 * the request is well formed.
 */
export function parseReplacements(
  value: unknown,
): { replacements: RawReplacement[] } | { error: string } {
  if (value === undefined || value === null) return { replacements: [] };
  if (!Array.isArray(value)) {
    return { error: "character_replacements must be an array" };
  }
  if (value.length > MAX_REPLACEMENTS) {
    return {
      error:
        `character_replacements must have ${MAX_REPLACEMENTS} entries or fewer`,
    };
  }
  const replacements: RawReplacement[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      return { error: "Each character replacement must be an object" };
    }
    const entry = raw as Record<string, unknown>;
    const fromName = typeof entry.from_name === "string"
      ? entry.from_name.trim()
      : "";
    if (!fromName || fromName.length > 100) {
      return { error: "from_name must be 1-100 characters" };
    }
    // Two replacements of the same name would apply in an order the caller
    // cannot see, and the second would rewrite the first one's output.
    const key = fromName.toLowerCase();
    if (seen.has(key)) {
      return { error: `Duplicate replacement for "${fromName}"` };
    }
    seen.add(key);

    const to = entry.to;
    if (!to || typeof to !== "object") {
      return { error: `Replacement for "${fromName}" needs a "to"` };
    }
    const target = to as Record<string, unknown>;
    const savedId = target.saved_character_id;
    if (savedId !== undefined && savedId !== null) {
      if (!parseUuid(savedId)) {
        return { error: "to.saved_character_id must be a UUID" };
      }
      replacements.push({
        fromName,
        savedCharacterId: parseUuid(savedId)!,
        applyToAllChapters: entry.apply_to_all_chapters === true,
      });
      continue;
    }
    const name = typeof target.name === "string" ? target.name.trim() : "";
    if (!name || name.length > 100) {
      return {
        error: `Replacement for "${fromName}" needs a name of 1-100 characters`,
      };
    }
    for (const field of ["role", "appearance", "background"] as const) {
      const text = target[field];
      if (
        text !== undefined && text !== null &&
        (typeof text !== "string" || text.length > 500)
      ) {
        return {
          error: `to.${field} must be a string of 500 characters or fewer`,
        };
      }
    }
    replacements.push({
      fromName,
      character: {
        name,
        description: optionalText(target.role),
        appearance: optionalText(target.appearance),
        background: optionalText(target.background),
      },
      applyToAllChapters: entry.apply_to_all_chapters === true,
    });
  }
  return { replacements };
}

export interface RawReplacement {
  fromName: string;
  savedCharacterId?: string;
  character?: CharacterInput;
  applyToAllChapters: boolean;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The cast the prompt should describe, with the replacements applied.
 *
 * A replaced character is not appended alongside the original - the model would
 * then have both people in the room. The row is swapped in place so the new
 * character inherits the old one's position in the cast (lead or not), which is
 * what "replace Maya with Priya" means.
 */
export function applyReplacementsToCast(
  cast: readonly CharacterInput[],
  replacements: readonly ResolvedReplacement[],
): CharacterInput[] {
  const byName = new Map(
    replacements.map((r) => [r.fromName.toLowerCase(), r]),
  );
  const used = new Set<string>();
  const next = cast.map((character) => {
    const match = byName.get(character.name.trim().toLowerCase());
    if (!match) return character;
    used.add(match.fromName.toLowerCase());
    return {
      ...match.to,
      // Fields the sheet left blank inherit from the person being replaced, so
      // a swap does not silently drop everything the story knew about the role.
      description: match.to.description ?? character.description,
      background: match.to.background ?? character.background,
      appearance: match.to.appearance ?? character.appearance,
      isHero: character.isHero,
    };
  });
  // A replacement whose `from_name` is not in the roster is still honoured:
  // the model invents unnamed people, and the reader may be renaming one of
  // them. It joins the cast rather than being dropped.
  for (const replacement of replacements) {
    if (!used.has(replacement.fromName.toLowerCase())) {
      next.push({ ...replacement.to });
    }
  }
  return next;
}

/** The renames a set of replacements implies, for the substitution helper. */
export function renamesFor(
  replacements: readonly ResolvedReplacement[],
  scope: "all" | "any",
): CharacterRename[] {
  return replacements
    .filter((r) => scope === "any" || r.applyToAllChapters)
    .map((r) => ({ from: r.fromName, to: r.to.name }))
    .filter((r) => r.from && r.to);
}
