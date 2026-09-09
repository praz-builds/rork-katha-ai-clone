/**
 * Renaming a character across prose that has already been written.
 *
 * `reimagine-chapter` regenerates ONE chapter with the model. When the reader
 * also asks for a replacement to apply to every chapter, the other chapters
 * are not regenerated - that would cost a credit each and rewrite prose the
 * reader liked - they are edited: the old name becomes the new name, and
 * nothing else changes. The rules are deliberately narrow so the result is
 * predictable:
 *
 * - **Whole words only.** "Maya" does not touch "Mayank" or "Himalaya".
 *   Word boundaries are Unicode-aware, so a name inside quotes, before a
 *   comma, or at the end of a sentence still matches, and a name written in a
 *   non-Latin script is handled the same way.
 * - **Possessives follow for free.** "Maya's" is the word "Maya" followed by
 *   "'s", so it becomes "Priya's" without special handling. Curly apostrophes
 *   are the same case.
 * - **Case is preserved where it is a signal.** A name in ALL CAPS (a shouted
 *   line, a chapter heading) is replaced in all caps. Any other spelling gets
 *   the replacement exactly as the reader typed it, because a name has its own
 *   capitalisation and is not subject to sentence case.
 * - **A first name stands in for a full name.** If the old name is "Aarav
 *   Mehta" and the new one "Rohan Iyer", then "Aarav" alone becomes "Rohan".
 *   Prose refers to people by first name far more often than by full name;
 *   without this, most mentions would survive the rename. A surname alone is
 *   not substituted - "Mehta" is more likely to be a family, a shop or a
 *   different Mehta than a reference to the character.
 * - **Pronouns are not touched.** Replacing "he" with "she" needs a reading of
 *   every sentence; this module does not attempt it, and the product decision
 *   was explicit that it must not. A gender change is a job for reimagining
 *   the chapter, not for a rename.
 */

export interface CharacterRename {
  /** The name as it appears in the prose today. */
  from: string;
  /** The name that should replace it. */
  to: string;
}

/** Unicode letter, digit, mark or underscore: what a "word" is made of. */
const WORD_CHAR = "[\\p{L}\\p{N}\\p{M}_]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAllCaps(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return letters.length > 1 && letters === letters.toUpperCase();
}

/**
 * The (from, to) pairs a single rename expands to, longest first, so a full
 * name is matched before the first name that is a prefix of it.
 */
export function expandRename(rename: CharacterRename): CharacterRename[] {
  const from = rename.from.trim().replace(/\s+/g, " ");
  const to = rename.to.trim().replace(/\s+/g, " ");
  if (!from || !to) return [];
  if (from.localeCompare(to, undefined, { sensitivity: "accent" }) === 0) {
    return [];
  }
  const pairs: CharacterRename[] = [{ from, to }];
  const fromParts = from.split(" ");
  const toParts = to.split(" ");
  if (fromParts.length > 1 && fromParts[0].length >= 2) {
    const first = fromParts[0];
    const toFirst = toParts[0];
    if (toFirst && first.toLowerCase() !== toFirst.toLowerCase()) {
      pairs.push({ from: first, to: toFirst });
    }
  }
  return pairs;
}

/** Replace every whole-word occurrence of one name with another. */
export function substituteCharacterName(
  text: string,
  from: string,
  to: string,
): string {
  const source = from.trim();
  const target = to.trim();
  if (!source || !target || !text) return text;
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escapeRegExp(source)}(?!${WORD_CHAR})`,
    "giu",
  );
  return text.replace(pattern, (match) => {
    if (isAllCaps(match)) return target.toUpperCase();
    return target;
  });
}

/** Apply a list of renames to a block of prose, each expanded per the rules above. */
export function substituteCharacters(
  text: string,
  renames: readonly CharacterRename[],
): string {
  let result = text;
  for (const rename of renames) {
    for (const pair of expandRename(rename)) {
      result = substituteCharacterName(result, pair.from, pair.to);
    }
  }
  return result;
}

/**
 * Apply the same renames to every string inside a JSON value - the
 * `series_state` a story carries is a bag of sentences about the cast, and it
 * must call the character by the same name the chapters now do.
 */
export function substituteCharactersInJson<T>(
  value: T,
  renames: readonly CharacterRename[],
): T {
  if (typeof value === "string") {
    return substituteCharacters(value, renames) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      substituteCharactersInJson(item, renames)
    ) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteCharactersInJson(item, renames);
    }
    return out as T;
  }
  return value;
}
