import type { DirectionChooser, OfferedDirection } from "@/types/domain";

/**
 * Reading `chapters.directions_offered`, `direction_chosen` and
 * `direction_chosen_by` back off a row.
 *
 * WHY THIS IS ITS OWN FILE AND NOT PART OF `api.ts`. Two different paths
 * hydrate chapters from the database and both need these columns:
 * `hydrateStoryRow` in `lib/api.ts`, for the stories you wrote, and
 * `loadStoryChapters` in `lib/search.ts`, for every story opened from
 * Explore, search or a curated rail -- which is to say somebody else's, the
 * only kind whose branching a reader is ever actually curious about. `api.ts`
 * already imports from `search.ts` (`publishedOffsetFrom`), so exporting the
 * parsers from `api.ts` and importing them into `search.ts` would close an
 * import CYCLE. Under Metro a cycle resolves to `undefined` at module-init
 * time rather than failing loudly, so the symptom would not be a build error;
 * it would be a parser that is `undefined` in whichever module happened to
 * initialise first, and a reader who sees the paths on their own stories and
 * never on anyone else's. A leaf module both sides import cannot do that.
 *
 * Keeping them together also keeps the two paths from drifting into
 * disagreeing about what a malformed offer means, which matters more than it
 * sounds: the two surfaces would disagree about whether a chapter was offered
 * any paths at all.
 */

/** `null`, `""` and whitespace all mean "no value", not an empty string. */
function trimmedOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The most offered paths that will ever be rendered.
 *
 * `continue-story` writes three. This is not a guess at what it writes, it is
 * a refusal to trust a jsonb column with no shape: the read-only block draws
 * one card per entry in a plain `View` with no virtualisation, so a row that
 * somehow carried thousands would lock the reader's chapter boundary trying to
 * draw them. Eight is comfortably above anything the product generates and
 * comfortably below anything that hurts.
 *
 * Nothing user-controlled reaches this column today -- only `service_role`
 * writes `chapters`, and readers have no insert or update path -- so this is
 * defence in depth rather than a fix for a reachable bug. It is here because
 * the cost is one `slice` and the failure it prevents is silent.
 */
const MAX_RENDERED_DIRECTIONS = 8;

/**
 * `chapters.directions_offered` as something that can be put on a page.
 *
 * Every value here is distrusted on purpose. The column is `jsonb` with no
 * shape enforced by Postgres, it is written by a function that has already
 * changed what it records once, and the oldest rows have no value at all. So
 * the only thing this accepts is a real array of objects carrying usable
 * prose; anything else -- a string, an object, a row with a missing `prompt`,
 * an array of nulls -- contributes nothing and takes nothing down with it.
 *
 * An empty result is `undefined` rather than `[]`, because the surface that
 * reads this renders NOTHING when there is nothing: a heading over an empty
 * list is how a chapter written before 00078 would end up claiming it was
 * offered no paths, which is not something anyone knows.
 */
export function parseOfferedDirections(
  value: unknown,
): OfferedDirection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const offered: OfferedDirection[] = [];
  value.slice(0, MAX_RENDERED_DIRECTIONS).forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const record = entry as Record<string, unknown>;
    const prompt = trimmedOrUndefined(record.prompt);
    // The prose is the whole point of the row. Without it there is nothing to
    // show, so the entry is dropped rather than rendered blank.
    if (!prompt) return;
    // The id is only a render key. A row that lost its own still has prose
    // worth reading, so it borrows its position rather than being discarded.
    offered.push({
      id: trimmedOrUndefined(record.id) ?? `offered-${index}`,
      prompt,
    });
  });
  return offered.length ? offered : undefined;
}

/** `chapters.direction_chosen`, or nothing. */
export function parseDirectionChosen(value: unknown): string | undefined {
  return trimmedOrUndefined(value);
}

/**
 * `chapters.direction_chosen_by`, or nothing.
 *
 * The CHECK constraint allows exactly three values, and a value outside them
 * resolves to `undefined` rather than to a default -- the attribution line a
 * reader sees is built from this, and defaulting it would put a sentence about
 * who decided under a chapter where nobody knows.
 */
export function parseDirectionChooser(
  value: unknown,
): DirectionChooser | undefined {
  if (value === "reader" || value === "model" || value === "ranking") {
    return value;
  }
  return undefined;
}
