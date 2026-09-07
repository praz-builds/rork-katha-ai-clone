import { BANNED_PHRASES, BANNED_WORDS } from "./ban-lists.ts";

export type PhraseSeed = string | {
  phrase: string;
  register?: string | null;
  difficulty?: string | null;
};

export const MAX_PHRASE_LAYER_PHRASES = 8;

const CURLY_APOSTROPHES = /[\u2018\u2019\u02bc\u2032]/g;
const CURLY_QUOTES = /[\u201c\u201d\u2033]/g;
const DASHES = /[\u2010-\u2015]/g;
const NON_WORD_PUNCTUATION = /[^\p{L}\p{N}'\s]+/gu;
const WILDCARD = ".*";

export function normalizePhraseKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CURLY_APOSTROPHES, "'")
    .replace(CURLY_QUOTES, '"')
    .replace(DASHES, " ")
    .toLocaleLowerCase("en-US")
    .replace(NON_WORD_PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "");
}

export function isAllowedCorpusPhrase(value: string): boolean {
  const key = normalizePhraseKey(value);
  if (!key) return false;

  const words = key.split(/\s+/);
  if (words.some((word) => BANNED_WORDS.includes(word as never))) {
    return false;
  }

  for (const pattern of BANNED_PHRASES) {
    if (phrasePatternMatches(key, normalizeBanPattern(pattern))) return false;
  }
  return true;
}

/**
 * Normalise a ban pattern WITHOUT destroying its wildcards.
 *
 * `normalizePhraseKey` strips everything that is not a letter, number or
 * apostrophe, which is right for a phrase and wrong for a pattern: it turned
 * "knot in .* stomach" into the literal "knot in stomach", so the three
 * variable-word patterns in the ban list matched only a collapsed form nobody
 * ever writes. "knot in my stomach" was allowed straight into the corpus while
 * "knot in stomach" was refused -- exactly backwards.
 *
 * So the wildcard is held out of normalisation and put back afterwards.
 */
function normalizeBanPattern(pattern: string): string {
  return pattern
    .split(WILDCARD)
    .map((segment) => normalizePhraseKey(segment))
    .join(" .* ")
    .replace(/\s+/g, " ")
    .trim();
}

function phrasePatternMatches(key: string, pattern: string): boolean {
  if (!pattern) return false;
  const source = pattern
    .split(/\s+/)
    .map((part) => part === ".*" ? ".*" : escapeRegExp(part))
    .join("\\s+");
  return new RegExp(`(?:^|\\s)${source}(?:\\s|$)`).test(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPhraseLayer(savedPhrases: PhraseSeed[] = []): string {
  const phrases = dedupePhraseSeeds(savedPhrases).slice(
    0,
    MAX_PHRASE_LAYER_PHRASES,
  );
  if (!phrases.length) return "";

  return `## Reader phrase seeds

The reader is learning these everyday English phrases. Use at most ${MAX_PHRASE_LAYER_PHRASES} so the story stays fiction-first rather than becoming a lesson.

Weave any that fit into DIALOGUE only. The narration ban lists still govern narration completely. Never force a phrase, never gloss or explain it in the prose, and never let a phrase drive a scene that would not otherwise happen. A story that reads like a lesson has failed.

${
    phrases.map((phrase) => `- "${phrase.phrase}"${phraseLabel(phrase)}`).join(
      "\n",
    )
  }`;
}

function dedupePhraseSeeds(savedPhrases: PhraseSeed[]): Array<{
  phrase: string;
  register?: string | null;
  difficulty?: string | null;
}> {
  const seen = new Set<string>();
  const result: Array<{
    phrase: string;
    register?: string | null;
    difficulty?: string | null;
  }> = [];

  for (const seed of savedPhrases) {
    const phrase = typeof seed === "string" ? seed : seed.phrase;
    const normalized = normalizePhraseKey(phrase);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      phrase: phraseForPrompt(phrase),
      register: typeof seed === "string" ? null : seed.register,
      difficulty: typeof seed === "string" ? null : seed.difficulty,
    });
  }
  return result;
}

function phraseForPrompt(value: string): string {
  return value
    .replace(/<\s*\/?\s*katha\s*:\s*[a-z-]*\s*>?/gi, "")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function phraseLabel(
  seed: { register?: string | null; difficulty?: string | null },
): string {
  const details = [seed.register, seed.difficulty]
    .filter((value): value is string => typeof value === "string" && !!value);
  return details.length ? ` (${details.join(", ")})` : "";
}

/**
 * Read the phrases this reader has saved, for seeding their next generation.
 *
 * This is the wire that makes the phrase layer real. Without it
 * `buildUserPrompt` received an empty list on every production call, the layer
 * rendered as `""`, and the whole pillar was inert while looking finished.
 *
 * Best-effort by construction, for the same reason grounding is: a reader's
 * saved phrases are a convenience they did not explicitly request for THIS
 * generation, and a paid story must never fail because a nice-to-have lookup
 * did. Every failure path returns an empty array, which renders the prompt
 * exactly as it was before this existed.
 *
 * Newest first, and capped at the layer's own cap: reading more rows than can
 * possibly be used is wasted latency on the paid path.
 */
export async function fetchPhraseSeeds(
  client: {
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      select: (columns: string) => any;
    };
  },
  userId: string,
  language?: string,
): Promise<PhraseSeed[]> {
  try {
    // Filters first, then ordering, then the cap. PostgREST does not care about
    // the order these are chained in, but a reader does, and appending a filter
    // after `.limit()` reads as though it applies to the truncated set.
    let query = client
      .from("saved_phrases")
      .select("phrase_text")
      .eq("user_id", userId);
    if (language) query = query.eq("language", language);

    const { data, error } = await query
      .order("saved_at", { ascending: false })
      .limit(MAX_PHRASE_LAYER_PHRASES);
    if (error || !Array.isArray(data)) return [];
    return data
      .map((row: { phrase_text?: unknown }) => row?.phrase_text)
      .filter((text: unknown): text is string =>
        typeof text === "string" && text.trim().length > 0
      );
  } catch {
    return [];
  }
}
