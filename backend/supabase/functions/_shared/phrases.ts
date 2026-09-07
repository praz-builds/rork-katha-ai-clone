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
    if (phrasePatternMatches(key, normalizePhraseKey(pattern))) return false;
  }
  return true;
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
