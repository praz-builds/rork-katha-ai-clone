/**
 * Does this story idea ask for a faith tradition, and if so, is it asking for a
 * canonical story or an original one?
 *
 * PURE, DETERMINISTIC, NO MODEL CALL. Same input, same output, forever, for
 * free. That is the whole design constraint, and it is not a shortcut: the
 * alternative — asking a model "is this a religious request" on every
 * generation — adds latency and cost to every story to answer a question that
 * an explicit phrase answers exactly, and it introduces a second place where a
 * misjudgement about somebody's faith can happen invisibly.
 *
 * THE BIAS IS TOWARDS SILENCE. Returning `undefined` costs a reader a
 * preference they did not ask for. Returning the wrong tradition puts a faith
 * on a family's bedtime story that is not theirs. Those are not comparable, so
 * every rule below requires INTENT, never mere mention: a character named
 * Christian, a church bake sale, a Christmas tree and a curry are not requests
 * for a faith story, and none of them matches here.
 */

import {
  isSupportedTradition,
  type SupportedTraditionId,
} from "./traditions.ts";

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * What kind of story the idea asks for.
 *
 * - `canonical` — a traditional story that already exists: "tell me the story
 *   of Noah", "a Bible story", "retell the Ramayana".
 * - `inspired` — an original story in a tradition's spirit: "a Jewish bedtime
 *   story about kindness".
 * - `none` — no faith request detected.
 */
export type TraditionProvenance = "canonical" | "inspired" | "none";

export type TraditionEvidenceKind =
  /** A phrase that identifies a tradition. */
  | "tradition"
  /** A phrase that asks for an existing, traditional story. */
  | "canonical"
  /** A phrase that asks for something original within a tradition. */
  | "inspired";

export type TraditionEvidence = {
  readonly kind: TraditionEvidenceKind;
  /** The tradition this evidence points at, when it points at one. */
  readonly tradition?: SupportedTraditionId;
  /** A stable label for the rule that fired, for logging. */
  readonly rule: string;
  /** The text that matched, lowercased and trimmed. Bounded. */
  readonly matched: string;
};

export type TraditionClassification = {
  /** `undefined` whenever the signal is absent, weak or contradictory. */
  readonly tradition: SupportedTraditionId | undefined;
  readonly provenance: TraditionProvenance;
  /** 0..1. A reporting and threshold aid, not a probability. */
  readonly confidence: number;
  readonly evidence: readonly TraditionEvidence[];
  /**
   * True when a `canonical` reading was downgraded to `inspired` by
   * `downgradeCanonicalRequest`. Present so the caller can log the difference
   * between "they did not ask for a retelling" and "they did and we could not
   * give them one".
   */
  readonly downgraded?: true;
};

/**
 * PHASE 1 CANNOT DO CANONICAL RETELLING, and this constant says so out loud so
 * a caller does not have to infer it from a comment.
 *
 * Three independent reasons, any one of which is sufficient:
 *
 * 1. NO VERIFIED SOURCE. Scripture quotation is forbidden outright in Phase 1
 *    (`ScripturePolicy.directQuotationAllowed`, permanently `false`, with
 *    `verifiedSourceFile: null`). A retelling of Noah or of the Ramayana that
 *    may not quote and has no checked source is the model's recollection of the
 *    story, which is exactly the fabrication the scripture rule exists to stop —
 *    only now with a sacred name on it.
 * 2. GROUNDING WILL NOT HELP. The grounding pipeline explicitly excludes
 *    folklore and myth figures from the entities it will look up, so the one
 *    mechanism that could fetch real source material declines this case by
 *    design.
 * 3. THE BASE PROMPT FIGHTS IT. The existing prompt instructs the model to
 *    silently rename casts drawn from existing works. Pointed at a canonical
 *    religious story that produces a renamed, unrecognisable version of a
 *    sacred narrative — the worst available outcome.
 *
 * So the classifier REPORTS canonical honestly, and the caller downgrades. The
 * truth stays in the log; only the behaviour changes.
 */
export const CANONICAL_RETELLING_SUPPORTED = false;

/** Ideas longer than this are truncated before matching, for determinism. */
const MAX_SCAN_LENGTH = 4000;
const MAX_MATCH_LENGTH = 80;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Phrases that identify a tradition ON THEIR OWN, because the phrase itself
 * carries the intent — nobody writes "an Islamic bedtime story" about anything
 * other than an Islamic bedtime story.
 */
const SELF_EVIDENT: readonly {
  readonly tradition: SupportedTraditionId;
  readonly rule: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  {
    tradition: "christian",
    rule: "christian.self",
    pattern:
      /\b(?:bible|biblical|christian|gospel)\s+(?:bedtime\s+)?(?:stor(?:y|ies)|tale|parable)\b|\bchristian\s+faith\b|\bthe\s+gospels?\b/,
  },
  {
    tradition: "muslim",
    rule: "muslim.self",
    pattern:
      /\b(?:islamic|muslim|qur'?anic)\s+(?:bedtime\s+)?(?:stor(?:y|ies)|tale|values?|faith)\b|\bthe\s+qur'?an\b|\bthe\s+koran\b|\bhadith\b/,
  },
  {
    tradition: "jewish",
    rule: "jewish.self",
    pattern:
      /\b(?:jewish|torah|talmudic)\s+(?:bedtime\s+)?(?:stor(?:y|ies)|tale|values?|faith)\b|\bthe\s+torah\b|\bthe\s+talmud\b/,
  },
  {
    tradition: "hindu",
    rule: "hindu.self",
    pattern:
      /\b(?:hindu|puranic)\s+(?:bedtime\s+)?(?:stor(?:y|ies)|tale|values?|faith)\b|\bthe\s+ramayana\b|\bthe\s+mahabharata\b|\bthe\s+(?:bhagavad\s+)?gita\b/,
  },
]);

/**
 * Terms that NAME a tradition but do not, on their own, ask for one.
 *
 * "christian", "muslim", "jewish", "hindu" as bare adjectives appear in plenty
 * of ideas that are not faith requests, so each occurrence must also sit near
 * an intent marker AND survive the name guard below.
 *
 * Deliberately excluded, because they are places, seasons and objects rather
 * than requests: church, mosque, synagogue, temple, Christmas, Easter, Diwali,
 * Ramadan, Hanukkah, rabbi, imam, priest. A church bake sale is a bake sale.
 */
const TRADITION_TERMS: readonly {
  readonly tradition: SupportedTraditionId;
  readonly rule: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  {
    tradition: "christian",
    rule: "christian.term",
    pattern: /\bchristian(?:ity)?\b/g,
  },
  {
    tradition: "muslim",
    rule: "muslim.term",
    pattern: /\b(?:muslim|islam)\b/g,
  },
  {
    tradition: "jewish",
    rule: "jewish.term",
    pattern: /\b(?:jewish|judaism)\b/g,
  },
  {
    tradition: "hindu",
    rule: "hindu.term",
    pattern: /\b(?:hindu|hinduism)\b/g,
  },
]);

/**
 * An intent marker: the idea is asking for a story shaped by the thing, not
 * merely containing it. Required within `INTENT_WINDOW` characters of a bare
 * tradition term before that term counts.
 */
const INTENT_MARKERS =
  /\b(?:stor(?:y|ies)|tale|bedtime|fable|parable|faith|tradition(?:s|al)?|values?|beliefs?|religion|religious|devotional|prayer|teach(?:es|ing|ings)?|raise|raising|household|upbringing)\b/;

const INTENT_WINDOW = 60;

/**
 * The name guard: "a boy named Christian" is a boy, not a tradition.
 *
 * Checked on the text immediately before each bare-term occurrence. This is the
 * single most likely false positive in the whole module — Christian is a common
 * given name, and "a bedtime story about a boy named Christian" contains both a
 * tradition term and an intent marker.
 */
const NAME_CONTEXT = /\b(?:named|called|name\s+is|name's|nicknamed)\s+$/;

/** Asks for a story that already exists. */
const CANONICAL_MARKERS: readonly {
  readonly rule: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  { rule: "canonical.retell", pattern: /\bre-?tell(?:ing|s)?\b/ },
  {
    rule: "canonical.the-story-of",
    pattern: /\bthe\s+(?:stor(?:y|ies)|tale|parable)\s+of\b/,
  },
  {
    rule: "canonical.from-the-text",
    pattern:
      /\b(?:stor(?:y|ies)|tale|passage)\s+(?:from|in|out\s+of)\s+the\s+(?:bible|qur'?an|koran|torah|talmud|gospels?|ramayana|mahabharata|gita|puranas)\b/,
  },
  {
    rule: "canonical.text-story",
    pattern:
      /\b(?:bible|biblical|qur'?anic|torah|talmudic|puranic|scriptural)\s+(?:bedtime\s+)?stor(?:y|ies)\b/,
  },
  { rule: "canonical.parable", pattern: /\bparable\s+of\b/ },
  {
    rule: "canonical.traditional",
    pattern:
      /\b(?:traditional|classic|the\s+original)\s+(?:bible|qur'?anic|torah|hindu|islamic|jewish|christian)\s+(?:stor(?:y|ies)|tale)\b/,
  },
]);

/** Asks for something new that merely lives inside a tradition. */
const INSPIRED_MARKERS: readonly {
  readonly rule: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  { rule: "inspired.spirit", pattern: /\bin\s+the\s+spirit\s+of\b/ },
  { rule: "inspired.inspired-by", pattern: /\binspired\s+by\b/ },
  {
    rule: "inspired.original",
    pattern: /\b(?:original|brand\s+new|my\s+own)\s+(?:stor(?:y|ies)|tale)\b/,
  },
  { rule: "inspired.about", pattern: /\bstor(?:y|ies)\s+about\b/ },
]);

/**
 * Figures whose name identifies a tradition unambiguously.
 *
 * Shared figures — Noah, Moses, Abraham, Joseph, Jonah, David — are DELIBERATELY
 * ABSENT. They belong to three traditions at once, so naming one tells us a
 * canonical story was asked for and tells us nothing about whose. Guessing
 * there would be exactly the mistake this module refuses to make, so
 * `CANONICAL_ANY_FIGURES` below records the provenance without a tradition.
 */
const DISTINCTIVE_FIGURES: readonly {
  readonly tradition: SupportedTraditionId;
  readonly rule: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  {
    tradition: "christian",
    rule: "christian.figure",
    pattern:
      /\b(?:jesus|the\s+good\s+samaritan|the\s+prodigal\s+son|the\s+nativity)\b/,
  },
  {
    tradition: "muslim",
    rule: "muslim.figure",
    pattern:
      /\b(?:prophet\s+muhammad|the\s+prophet\s+\(pbuh\)|nuh|ibrahim|musa|yusuf|maryam)\b/,
  },
  {
    tradition: "jewish",
    rule: "jewish.figure",
    pattern: /\b(?:queen\s+esther|the\s+maccabees|rabbi\s+akiva)\b/,
  },
  {
    tradition: "hindu",
    rule: "hindu.figure",
    pattern:
      /\b(?:rama|sita|krishna|ganesha|ganesh|hanuman|shiva|durga|lakshmi)\b/,
  },
]);

/**
 * Figures that mark a canonical request but belong to no single tradition.
 * Provenance only; never a tradition vote.
 */
const CANONICAL_ANY_FIGURES =
  /\b(?:noah(?:'s)?(?:\s+ark)?|moses|abraham|jonah|daniel\s+in\s+the\s+lions|david\s+and\s+goliath|the\s+exodus)\b/;

// ---------------------------------------------------------------------------
// Classify
// ---------------------------------------------------------------------------

function normalize(input: string): string {
  return input
    .slice(0, MAX_SCAN_LENGTH)
    .toLocaleLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function bounded(text: string): string {
  return text.slice(0, MAX_MATCH_LENGTH);
}

/**
 * Whether a bare term occurrence at `index` is a real request rather than a
 * mention: it must not be a personal name, and an intent marker must sit within
 * `INTENT_WINDOW` characters on either side.
 */
function hasIntentAround(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - INTENT_WINDOW), index);
  if (NAME_CONTEXT.test(before)) return false;
  const after = text.slice(
    index + length,
    index + length + INTENT_WINDOW,
  );
  return INTENT_MARKERS.test(before) || INTENT_MARKERS.test(after);
}

/**
 * Read a story idea and report what it asks for.
 *
 * Never throws, never calls out, never guesses. Empty, non-string and
 * unrecognised input all return the same silent result.
 */
export function classifyTradition(idea: unknown): TraditionClassification {
  const silent: TraditionClassification = {
    tradition: undefined,
    provenance: "none",
    confidence: 0,
    evidence: Object.freeze([]),
  };
  if (typeof idea !== "string") return silent;
  const text = normalize(idea);
  if (!text) return silent;

  const evidence: TraditionEvidence[] = [];
  const votes = new Map<SupportedTraditionId, number>();
  const vote = (tradition: SupportedTraditionId, weight: number) => {
    votes.set(tradition, (votes.get(tradition) ?? 0) + weight);
  };

  // 1. Self-evident phrases: the phrase carries the intent by itself.
  for (const rule of SELF_EVIDENT) {
    const hit = rule.pattern.exec(text);
    if (!hit) continue;
    evidence.push({
      kind: "tradition",
      tradition: rule.tradition,
      rule: rule.rule,
      matched: bounded(hit[0]),
    });
    vote(rule.tradition, 3);
  }

  // 2. Bare terms: only count where intent surrounds them and no name guard
  //    fires.
  for (const rule of TRADITION_TERMS) {
    const pattern = new RegExp(rule.pattern.source, "g");
    for (let hit = pattern.exec(text); hit; hit = pattern.exec(text)) {
      if (!hasIntentAround(text, hit.index, hit[0].length)) continue;
      evidence.push({
        kind: "tradition",
        tradition: rule.tradition,
        rule: rule.rule,
        matched: bounded(hit[0]),
      });
      vote(rule.tradition, 2);
      break; // one vote per term; repetition is not more evidence.
    }
  }

  // 3. Distinctive figures.
  for (const rule of DISTINCTIVE_FIGURES) {
    const hit = rule.pattern.exec(text);
    if (!hit) continue;
    evidence.push({
      kind: "tradition",
      tradition: rule.tradition,
      rule: rule.rule,
      matched: bounded(hit[0]),
    });
    vote(rule.tradition, 2);
  }

  // Pick a winner only if it is a clear one. A tie between two traditions is a
  // contradictory idea ("a Jewish and Muslim story"), and the honest answer to
  // a contradictory idea is no answer.
  let tradition: SupportedTraditionId | undefined;
  let top = 0;
  let tied = false;
  for (const [id, score] of votes) {
    if (score > top) {
      top = score;
      tradition = id;
      tied = false;
    } else if (score === top) {
      tied = true;
    }
  }
  if (tied) tradition = undefined;
  if (!isSupportedTradition(tradition)) tradition = undefined;

  // 4. Provenance.
  let canonical = false;
  for (const marker of CANONICAL_MARKERS) {
    const hit = marker.pattern.exec(text);
    if (!hit) continue;
    canonical = true;
    evidence.push({
      kind: "canonical",
      rule: marker.rule,
      matched: bounded(hit[0]),
    });
  }
  const anyFigure = CANONICAL_ANY_FIGURES.exec(text);
  if (anyFigure) {
    canonical = true;
    evidence.push({
      kind: "canonical",
      rule: "canonical.shared-figure",
      matched: bounded(anyFigure[0]),
    });
  }
  // A distinctive figure named at all is a request for that figure's story.
  if (evidence.some((e) => e.rule.endsWith(".figure"))) canonical = true;

  let provenance: TraditionProvenance;
  if (canonical) {
    provenance = "canonical";
  } else if (tradition) {
    provenance = "inspired";
    for (const marker of INSPIRED_MARKERS) {
      const hit = marker.pattern.exec(text);
      if (!hit) continue;
      evidence.push({
        kind: "inspired",
        rule: marker.rule,
        matched: bounded(hit[0]),
      });
    }
  } else {
    provenance = "none";
  }

  // Confidence: a reporting aid, computed deterministically from the evidence
  // that actually fired. It is not a probability and nothing branches on it
  // today; a future confirmation UI ("did you mean a Muslim story?") is what it
  // exists for.
  let confidence = 0;
  if (tradition) {
    const selfEvident = evidence.some((e) =>
      e.tradition === tradition && e.rule.endsWith(".self")
    );
    confidence = selfEvident ? 0.85 : 0.6;
    const supporting = evidence.filter((e) => e.tradition === tradition).length;
    confidence = Math.min(0.95, confidence + 0.05 * (supporting - 1));
  } else if (provenance === "canonical") {
    confidence = 0.4;
  }

  return {
    tradition,
    provenance,
    confidence: Math.round(confidence * 100) / 100,
    evidence: Object.freeze(evidence),
  };
}

/**
 * Phase 1's one-line answer to a canonical request: write an original story in
 * the tradition's spirit instead.
 *
 * Callers use this rather than reinterpreting the classification themselves, so
 * that the day canonical retelling becomes possible there is exactly one place
 * to stop calling it. See `CANONICAL_RETELLING_SUPPORTED` for the three reasons
 * it is not possible today.
 *
 * A canonical request with no identified tradition downgrades to `none`, not to
 * `inspired`: "tell me the story of Noah" names a story we cannot tell and a
 * tradition we did not identify, so there is nothing to be inspired by, and
 * inventing one would be the guess this module exists to avoid.
 */
export function downgradeCanonicalRequest(
  result: TraditionClassification,
): TraditionClassification {
  if (result.provenance !== "canonical") return result;
  return {
    ...result,
    provenance: result.tradition ? "inspired" : "none",
    downgraded: true,
  };
}

/**
 * The whole pipeline a caller wants: classify, then apply Phase 1's canonical
 * policy. Reach for this unless you specifically need the undowngraded truth
 * (logging, analytics, a future confirmation UI).
 */
export function classifyTraditionForGeneration(
  idea: unknown,
): TraditionClassification {
  const result = classifyTradition(idea);
  return CANONICAL_RETELLING_SUPPORTED ? result : downgradeCanonicalRequest(
    result,
  );
}
