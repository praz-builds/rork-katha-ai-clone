/**
 * Phase 2: retrieval for the narrow subset of entities the classifier flagged.
 *
 * Off by default, and inert until two secrets are set. Nothing in the live
 * generation path imports a code branch that runs here unless
 * `GROUNDING_SEARCH_ENABLED` is on and `BRAVE_SEARCH_API_KEY` exists;
 * `createSearchProvider()` returns null otherwise and every caller falls back to
 * a model-knowledge card. That is the same shape as the SDK no-op pattern in
 * `expo/src/lib` - an unconfigured integration must be indistinguishable from
 * an absent one, not a source of runtime errors on a paid path.
 *
 * ---------------------------------------------------------------------------
 * The one rule this module exists to enforce
 * ---------------------------------------------------------------------------
 * **The query is the canonical public entity name, alone.** Not the user's
 * sentence, not their idea, not the surrounding words, not their character
 * sheets, and never a person the classifier could not establish as public.
 *
 * Katha stories are private by default. A user typing "a story where my
 * therapist Anjali and I finally have the conversation" has not consented to
 * that sentence reaching a third-party search API, and would have no way to
 * find out that it had. Search providers log queries, and a leak of this shape
 * is silent, permanent and unfixable after the fact - there is no recall on a
 * query that has already been sent.
 *
 * Two mechanisms, because a prompt instruction is not a control:
 *
 *   1. `isSearchableEntity` reads `SEARCHABLE_ENTITY_CLASSES`, which does not
 *      contain `private_individual`. It fails closed on anything unrecognised.
 *   2. `groundingSearchQuery` constructs the query from `canonicalName` and
 *      nothing else, and rejects anything that does not look like a name.
 *      There is no code path that accepts free text as a query.
 *
 * `searchEntity` applies both before touching the network. The filter is
 * deliberately duplicated at the call site rather than left to the caller,
 * because "the caller checks first" is a convention and this needs to be a
 * property.
 */

import {
  boundedText,
  type EntityMention,
  MAX_ENTITY_NAME_LENGTH,
  SEARCHABLE_ENTITY_CLASSES,
} from "./grounding-types.ts";
import type { GroundingPassage } from "./grounding-card.ts";

/**
 * A retrieval backend. One method, one shape, so Brave can be swapped for
 * another provider without any of the privacy logic above moving with it.
 *
 * `search` resolves to an empty array on any failure rather than rejecting.
 * Grounding is optional scaffolding on a path where a credit has already been
 * spent, so a provider outage must degrade to a model-knowledge card, never to
 * a failed generation.
 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, options?: { count?: number }): Promise<SearchResult[]>;
}

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

/** Results requested per entity. Five snippets is more than a card needs. */
export const DEFAULT_SEARCH_RESULT_COUNT = 5;

/**
 * How long the provider gets before the card falls back to model knowledge.
 *
 * Short, and shorter than any provider timeout in `llm.ts`, because this sits
 * *in front of* the generation the reader is waiting on. Retrieval that has not
 * answered in four seconds has already cost more than the accuracy it was
 * buying; `llm.ts`'s own deadline accounting assumes generation gets the budget,
 * not its preamble.
 */
export const SEARCH_TIMEOUT_MS = 4000;

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/**
 * Is search wired at all?
 *
 * Read lazily, never at module load, for the reason stated at the top of
 * `llm.ts`: a top-level `Deno.env.get` makes importing this module a side
 * effect, so the test suite would need `--allow-env` to reference a type and a
 * missing secret would fail at import rather than at the call that needs it.
 */
export function isGroundingSearchEnabled(): boolean {
  const flag = Deno.env.get("GROUNDING_SEARCH_ENABLED")?.trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return false;
  return Boolean(Deno.env.get("BRAVE_SEARCH_API_KEY")?.trim());
}

/**
 * The provider, or null when search is not configured.
 *
 * Null rather than a throwing stub, so the absence is handled by the same
 * branch that handles "search was tried and returned nothing" - one fallback
 * path, exercised on every run in the default configuration, instead of a rare
 * one that is only reached in production.
 */
export function createSearchProvider(): SearchProvider | null {
  if (!isGroundingSearchEnabled()) return null;
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY")?.trim();
  if (!apiKey) return null;
  return new BraveSearchProvider(apiKey);
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async search(
    query: string,
    options?: { count?: number },
  ): Promise<SearchResult[]> {
    const count = options?.count ?? DEFAULT_SEARCH_RESULT_COUNT;
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    // Grounding is about facts, not about what happened this week, so the
    // discussion and news verticals are noise here - and a forum thread is the
    // likeliest place for the retrieved text to contain an injection attempt.
    url.searchParams.set("result_filter", "web");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": this.#apiKey,
        },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return parseBraveResults(await response.json(), count);
    } catch {
      // Every failure is the same failure to the caller: no passages, build the
      // card from model knowledge. Nothing here is worth retrying inside a
      // window the reader is watching.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Read Brave's response shape defensively.
 *
 * Exported so the parser can be tested without a network call or an API key -
 * the response shape is the part that breaks when a provider changes, and it
 * should not need a live key to have a regression test.
 */
export function parseBraveResults(
  payload: unknown,
  limit = DEFAULT_SEARCH_RESULT_COUNT,
): SearchResult[] {
  if (!payload || typeof payload !== "object") return [];
  const web = (payload as Record<string, unknown>).web;
  if (!web || typeof web !== "object") return [];
  const results = (web as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  const parsed: SearchResult[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as Record<string, unknown>;
    const snippet = boundedText(result.description, 2000);
    const url = boundedText(result.url, 2000);
    if (!snippet || !url) continue;
    parsed.push({
      title: boundedText(result.title, 300) ?? "",
      snippet,
      url,
    });
    if (parsed.length >= limit) break;
  }
  return parsed;
}

/**
 * The hard filter. The only question that decides whether a query is sent.
 *
 * Class membership, and nothing else - not confidence, not `needsGrounding`,
 * not what the model said in `searchable`. Those are relevance signals and this
 * is a privacy gate; mixing them would mean a tuning change to a relevance
 * threshold could widen what leaves the system.
 *
 * `entity.searchable` is checked too, but only as a second `false` - it is
 * derived from the same set one call earlier, so agreement is expected and a
 * disagreement means something has been mutated in between.
 */
export function isSearchableEntity(entity: EntityMention): boolean {
  return entity.searchable &&
    SEARCHABLE_ENTITY_CLASSES.has(entity.entityClass);
}

/**
 * The entire query, or null if no safe one can be built.
 *
 * There is deliberately no parameter for extra context, no genre hint, no
 * disambiguating clause from the idea. Every one of those would be an argument
 * that starts as a constant and ends, two refactors later, as the user's
 * sentence - which is precisely the leak this module is built to make
 * structurally impossible rather than merely discouraged.
 *
 * Punctuation is stripped rather than escaped. A canonical name has no business
 * containing quotes or operators, and a query built from something that does is
 * a query built from something that is not a name.
 */
export function groundingSearchQuery(entity: EntityMention): string | null {
  if (!isSearchableEntity(entity)) return null;

  const name = boundedText(entity.canonicalName, MAX_ENTITY_NAME_LENGTH);
  if (!name) return null;

  const cleaned = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s'.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  // A "name" that survives the strip as one or two characters is not one, and a
  // multi-line value was never a name to begin with. Refusing is free: the card
  // falls back to model knowledge.
  if (cleaned.length < 3) return null;
  return cleaned;
}

/**
 * Retrieve passages for one entity, or return none.
 *
 * The filter runs here as well as in `groundingSearchQuery` because this is the
 * function that touches the network, and the guarantee should hold at the point
 * of the outbound call rather than one frame above it.
 */
export async function searchEntity(
  entity: EntityMention,
  provider: SearchProvider | null,
): Promise<GroundingPassage[]> {
  if (!provider) return [];
  const query = groundingSearchQuery(entity);
  if (!query) return [];

  const results = await provider.search(query, {
    count: DEFAULT_SEARCH_RESULT_COUNT,
  });
  return results.map((result) => ({
    title: result.title,
    snippet: result.snippet,
    url: result.url,
  }));
}
