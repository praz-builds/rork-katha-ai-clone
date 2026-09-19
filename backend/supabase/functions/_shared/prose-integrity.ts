/**
 * The prose integrity pass: what the model left in a chapter that is not the
 * chapter.
 *
 * # Why this exists
 *
 * Editors read 83 production chapters on 2026-09-18 and every one needed a fix.
 * Most of the fixes were craft, and belong in the prompt. A distinct set were
 * not craft at all -- they were text that should never have reached a reader,
 * and that no amount of prompt wording had kept out:
 *
 *   1. **The brief, pasted in.** A `moments` entry, or a character's
 *      `background` / `appearance` sentence, copied word for word into the
 *      narration or put in a character's mouth. The brief is written in the
 *      register of a note ("Grew up in Lahore and moved to Karachi when her
 *      father lost his job"), so it reads as exactly what it is: the author's
 *      notes showing through the page.
 *   2. **The model's own working notes.** "The air was thick is banned, avoid.
 *      Use:" and "Word count check: ...approx 1330 words..." -- reasoning that
 *      leaked into the output channel.
 *   3. **JSON residue.** A chapter ending `arrived."}",`, or a final paragraph
 *      duplicated after the object closed -- what a structured response looks
 *      like when the parser took the wrong half of it.
 *   4. **Structure talk.** "That was in Chapter 1", "the evidence bag from
 *      Chapter 1": the story referring to itself as a book.
 *
 * # Why it removes rather than reports
 *
 * `content-scan.ts` deliberately only REPORTS crude vocabulary, because splicing
 * a word out of a sentence leaves a sentence that no longer parses. Everything
 * here is different in kind: each thing removed is a whole unit (a sentence, a
 * line, a paragraph, a trailing fragment) that was never prose, so taking it out
 * leaves the prose around it exactly as the model wrote it. The streamed path
 * has already shown the reader these words; the persisted chapter -- which is
 * what every later read, the narration and the next chapter's context window
 * are built from -- is still worth getting right, and the `done` payload
 * carries the cleaned row back to the screen.
 *
 * # Why it is conservative, and how
 *
 * A false positive here deletes a sentence a writer paid for, which is worse
 * than a leak an editor can still catch. So every rule is anchored on a shape
 * real prose does not take, not on a word real prose might use:
 *
 *   - "is banned" alone is prose ("Smoking is banned on the platform"); "is
 *     banned, avoid" is a note.
 *   - "Chapter 3" alone is prose ("chapter three of the manual", "the first
 *     chapter of her novel"); "from Chapter 1" with no book in the sentence is
 *     structure.
 *   - a sentence that merely mentions what a moment is about is the story doing
 *     its job; nine consecutive words of the brief is a paste.
 *
 * And there are two circuit breakers. The brief-echo rule stands down entirely
 * when it would remove more than a small share of the chapter, because at that
 * point the likelier explanation is a brief so generic it matches ordinary
 * sentences. And if the whole pass would remove more than 40% of the chapter's
 * words, it reverts to the residue-only cleanup: something unforeseen is
 * matching, and keeping a chapter with a blemish beats shipping half of one.
 *
 * # Measured, not silent
 *
 * `enforceProseIntegrity` logs every removal through `errors.ts` at `low`
 * severity -- kinds and counts only, never the removed text, per that module's
 * PII rule -- so the rate can be measured and the prompt fixes that follow can
 * be judged against it.
 */
import { logError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The parts of the brief the model must never quote back. */
export interface ProseIntegrityBrief {
  /** Pinned story moments. Private guidance: they are meant to happen, never to be quoted. */
  moments?: readonly string[];
  /** The chapter plan. Same status as `moments`. */
  beats?: readonly string[];
  /** The cast, whose sheet sentences are notes about a person, not lines. */
  characters?: readonly {
    background?: string | null;
    appearance?: string | null;
    /** The retired single field, still present on older rows. */
    description?: string | null;
  }[];
}

export type ProseRemovalKind =
  | "json_residue"
  | "markup_residue"
  | "heading"
  | "model_note"
  | "duplicate_paragraph"
  | "brief_echo"
  | "structure_reference"
  | "reader_address"
  /** A rule matched but stood down under a circuit breaker. Nothing removed. */
  | "brief_echo_capped"
  | "reverted";

export interface ProseRemoval {
  kind: ProseRemovalKind;
  /** How many units (sentences, lines, paragraphs, fragments) were affected. */
  count: number;
}

export interface ProseIntegrityResult {
  text: string;
  removals: ProseRemoval[];
  /** Whether `text` differs from the input. */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * A run this long, shared with a brief sentence, is a paste.
 *
 * Nine is the editors' threshold and it is deliberately high. Eight words of a
 * brief turn up in honest prose often enough ("she had not been back to the
 * house since"), because a brief and its story are about the same things. Nine
 * contiguous words, after normalisation, did not turn up once in the 83
 * reviewed chapters except where the brief had been pasted.
 */
export const BRIEF_ECHO_MIN_WORDS = 9;

/** The brief-echo rule stands down above this share of a chapter's sentences. */
const BRIEF_ECHO_MAX_SHARE = 0.15;
/** ...but a few echoes are always removable, however short the chapter. */
const BRIEF_ECHO_MIN_ALLOWANCE = 3;
/** The whole pass reverts to residue-only above this share of words removed. */
const MAX_REMOVED_WORD_SHARE = 0.4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clean one chapter body. Pure: no I/O, no logging, never throws.
 *
 * The order matters. Residue is stripped first because it sits outside the
 * prose and would otherwise defeat the duplicate-paragraph check (a repeated
 * paragraph followed by `"}` does not equal the paragraph before it). The
 * sentence-level rules run on what is left, and the duplicate check runs last
 * so it sees the chapter's true final paragraph.
 */
export function cleanChapterProse(
  input: string,
  brief: ProseIntegrityBrief = {},
): ProseIntegrityResult {
  if (typeof input !== "string" || !input.trim()) {
    return { text: input, removals: [], changed: false };
  }
  const tally = new Map<ProseRemovalKind, number>();
  const note = (kind: ProseRemovalKind, count = 1) => {
    if (count > 0) tally.set(kind, (tally.get(kind) ?? 0) + count);
  };

  let text = input.replace(/\r\n?/g, "\n");
  text = stripJsonResidue(text, note);
  text = stripMarkupResidue(text, note);
  // Everything after this line is judged against what the residue pass left,
  // so the revert breaker below can keep the residue cleanup even when it
  // throws the rest away.
  const residueOnly = tidy(text);

  let paragraphs = splitParagraphs(residueOnly);
  paragraphs = dropLeadingHeading(paragraphs, note);
  paragraphs = paragraphs.map((p) => stripModelNotes(p, note));
  paragraphs = paragraphs.map((p) => stripStructureReferences(p, note));
  paragraphs = stripBriefEchoes(paragraphs, brief, note);
  paragraphs = paragraphs.filter((p) => p.trim());
  paragraphs = dropTrailingDuplicates(paragraphs, note);

  let cleaned = tidy(paragraphs.join("\n\n"));

  const before = countWords(residueOnly);
  const after = countWords(cleaned);
  if (
    !cleaned.trim() ||
    (before > 0 && (before - after) / before > MAX_REMOVED_WORD_SHARE)
  ) {
    // Something matched far more than any real leak does. Keep the residue
    // cleanup, which only ever touches text outside the prose, and record that
    // the rest stood down so the rate of this is visible too.
    for (const kind of [...tally.keys()]) {
      if (kind !== "json_residue" && kind !== "markup_residue") {
        tally.delete(kind);
      }
    }
    note("reverted");
    cleaned = residueOnly;
  }

  // A chapter that was nothing but residue is not a chapter this pass can
  // repair. Hand the input back untouched and let the caller's own emptiness
  // check fail it and refund the credit.
  //
  // And a chapter nothing matched in is handed back byte for byte. The pass
  // re-joins paragraphs as it goes, and "clean prose, but its whitespace
  // normalised" is still a rewrite nobody asked for.
  if (!cleaned.trim()) {
    return { text: input, removals: [], changed: false };
  }
  const removals = [...tally.entries()].map(([kind, count]) => ({
    kind,
    count,
  }));
  // A breaker that stood down removed nothing, and is still worth reporting.
  if (!removals.some((r) => r.kind !== "brief_echo_capped")) {
    return { text: input, removals, changed: false };
  }
  return { text: cleaned, removals, changed: cleaned !== input };
}

export interface ProseIntegrityContext {
  feature:
    | "generate_story"
    | "generate_story_stream"
    | "continue_story"
    | "reimagine_chapter"
    | "edit_story";
  storyId?: string | null;
  userId?: string | null;
  chapterNumber?: number | null;
}

/**
 * Clean a chapter body and record what was removed. Never throws.
 *
 * The one entry point every prose-writing path calls, immediately before the
 * chapter is persisted, so the measurement and the behaviour cannot drift
 * between the five paths that write model prose. Only kinds and counts reach
 * `error_events`; the removed text never does.
 *
 * The brand scan rides along because it runs on the same text at the same
 * moment, and because it is the other thing the 2026-09-18 review found that
 * the prompt was not preventing. It is REPORT-ONLY, unlike everything above:
 * a brand name is a word inside a sentence, and replacing it means choosing a
 * substitute the story never asked for (see the module note in
 * `content-scan.ts` for the same trade on crude vocabulary).
 */
export interface EnforcedProse extends ProseIntegrityResult {
  /**
   * The telemetry writes, already handed to the runtime's background runner.
   *
   * Not awaited by the handlers, deliberately: `logError` can take its whole
   * 1.5s timeout against a slow database, and a writer waiting for a chapter
   * must not pay that for a measurement. Exposed so a test can wait for it.
   */
  telemetry: Promise<void>;
}

/**
 * Run telemetry after the response, where the runtime allows it.
 *
 * The same contract as `runInBackground` in `media.ts`, restated rather than
 * imported: `media.ts` pulls in the image and cover-prompt modules, which the
 * text paths deliberately load lazily. `logError` never rejects, so the catch
 * is only a second guarantee that an unhandled rejection cannot take an
 * isolate down mid-stream.
 */
function inBackground(work: Promise<unknown>): Promise<void> {
  const settled = work.then(() => {}, () => {});
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(settled);
  return settled;
}

export async function enforceProseIntegrity(
  text: string,
  brief: ProseIntegrityBrief,
  context: ProseIntegrityContext,
): Promise<EnforcedProse> {
  let result: ProseIntegrityResult;
  try {
    result = cleanChapterProse(text, brief);
  } catch (error) {
    // Unreachable by design, and still guarded: a bug in a cleanup pass must
    // never cost a writer a chapter they have paid for.
    console.error("[prose-integrity] pass threw; keeping the original text");
    const telemetry = inBackground(logError({
      bucket: "generation.story",
      severity: "medium",
      source: "runtime",
      errorCode: "prose_integrity_failed",
      error,
      context: baseContext(context),
      userId: context.userId ?? null,
    }));
    return { text, removals: [], changed: false, telemetry };
  }

  const telemetry: Promise<unknown>[] = [];
  if (result.removals.length) {
    const kinds = result.removals.map((r) => r.kind);
    const removedCount = result.removals.reduce((n, r) => n + r.count, 0);
    console.warn(
      `[prose-integrity] ${context.feature}: ${
        result.removals.map((r) => `${r.kind}x${r.count}`).join(", ")
      }`,
    );
    telemetry.push(logError({
      bucket: "generation.story",
      severity: "low",
      source: "runtime",
      errorCode: "prose_integrity_removed",
      error: new Error("Non-prose text removed from a generated chapter"),
      context: {
        ...baseContext(context),
        codes: kinds,
        removed_count: removedCount,
        words: countWords(text) - countWords(result.text),
      },
      userId: context.userId ?? null,
    }));
  }

  const brands = scanBrandNames(result.text);
  if (brands.length) {
    console.warn(
      `[prose-integrity] brand names in ${context.feature}: ${
        brands.join(", ")
      }`,
    );
    telemetry.push(logError({
      bucket: "generation.story",
      severity: "low",
      source: "runtime",
      errorCode: "brand_name_leaked",
      error: new Error("Generated prose named a real brand"),
      context: {
        ...baseContext(context),
        // Slugs from the closed list below, never text from the chapter.
        terms: brands,
        term_count: brands.length,
      },
      userId: context.userId ?? null,
    }));
  }
  return {
    ...result,
    telemetry: inBackground(Promise.allSettled(telemetry)),
  };
}

function baseContext(context: ProseIntegrityContext): Record<string, unknown> {
  return {
    feature: context.feature,
    ...(context.storyId ? { story_id: context.storyId } : {}),
    ...(typeof context.chapterNumber === "number"
      ? { chapter_number: context.chapterNumber }
      : {}),
  };
}

/**
 * The chapter's `first_line`, kept true to the body that is actually stored.
 *
 * The model writes `first_line` alongside the body, so when the pass removed a
 * heading or an opening note, the model's line quotes text that is no longer
 * there -- and `first_line` is what a card and a share preview show as the
 * chapter's opening. When the body is unchanged the model's line stands; when
 * it changed and the line no longer opens it, the stored body's first
 * paragraph replaces it, which is the same fallback `parseStructuredOutput`
 * uses when the model sent none.
 */
export function alignFirstLine(
  firstLine: string | null | undefined,
  body: string,
  bodyChanged: boolean,
): string {
  const line = (firstLine ?? "").trim();
  if (!bodyChanged) return line;
  const opening = body.trimStart();
  if (line && opening.startsWith(line)) return line;
  return opening.split(/\n/)[0]?.trim() ?? "";
}

/** The same brief shape every caller already holds, from a request or a row. */
export function proseIntegrityBrief(input: {
  moments?: unknown;
  beats?: unknown;
  characters?:
    | readonly {
      background?: string | null;
      appearance?: string | null;
      description?: string | null;
    }[]
    | null;
}): ProseIntegrityBrief {
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  return {
    moments: strings(input.moments),
    beats: strings(input.beats),
    characters: input.characters ?? [],
  };
}

// ---------------------------------------------------------------------------
// Brand names: report-only
// ---------------------------------------------------------------------------

/**
 * The brands the 2026-09-18 review actually found in production prose.
 *
 * Not a list of every brand -- that list is the prompt's job and cannot be a
 * regex. This is the measurement: these are the names that got past the "No
 * real brand names" rule, so whether they keep turning up is how we learn if
 * the reinforced rule works.
 *
 * Case-sensitive on purpose. Several are ordinary words in lower case ("a
 * husky voice", "a solo flight", "the greyhound slept", the corolla of a
 * flower), and a proper-noun match is what separates the brand from the word.
 * Known and accepted false positives: "Milo" and "Solo" as character names,
 * and a sentence that opens on "Husky" or "Greyhound". The consequence is one
 * noisy low-severity row, never a changed chapter.
 */
const BRAND_PATTERNS: ReadonlyArray<readonly [slug: string, re: RegExp]> = [
  ["manchester_united", /\bManchester United\b/],
  ["bajaj", /\bBajaj\b/],
  ["corolla", /\bCorolla\b/],
  ["pakola", /\bPakola\b/],
  ["subaru", /\bSubaru\b/],
  ["foodland", /\bFoodland\b/],
  ["freightliner", /\bFreightliner\b/],
  ["greyhound", /\bGreyhound\b/],
  ["safeway", /\bSafeway\b/],
  ["husky", /\bHusky\b/],
  ["milo", /\bMilo\b/],
  ["fanice", /\bFan ?Ice\b/],
  ["bic", /\bBic\b|\bBIC\b/],
  ["kodak", /\bKodak\b/],
  ["basf", /\bBASF\b/],
  ["solo", /\bSolo\b/],
  ["paris_match", /\bParis Match\b/],
  ["agrobank", /\bAgrobank\b/],
  ["wells_fargo", /\bWells Fargo\b/],
  ["western_union", /\bWestern Union\b/],
];

/** Slugs of the known brands named in `text`, deduplicated, in list order. */
export function scanBrandNames(text: unknown): string[] {
  if (typeof text !== "string" || !text) return [];
  return BRAND_PATTERNS.filter(([, re]) => re.test(text)).map(([slug]) => slug);
}

// ---------------------------------------------------------------------------
// Residue: text that sits outside the prose
// ---------------------------------------------------------------------------

type Note = (kind: ProseRemovalKind, count?: number) => void;

const SCHEMA_KEYS =
  "title|chapter_title|chapter_body|word_count|themes|first_line|previously_summary|series_state|hook_type|hook_text";

/**
 * The seam where the chapter string ended and the rest of the JSON object
 * began: a closing quote, a comma and the next schema key. Prose never
 * contains `", "word_count":`, which is what makes cutting here safe.
 */
const JSON_TAIL_RE = new RegExp(`"\\s*,\\s*"(?:${SCHEMA_KEYS})"\\s*:`);

/** The opening of a JSON object that was handed over as prose. */
const JSON_HEAD_RE =
  /^\s*(?:```(?:json)?\s*)?\{[\s\S]{0,2000}?"chapter_body"\s*:\s*"/;

/**
 * Trailing brace residue: `"}`, `"}",`, `\n}`, `"]}` and the like.
 *
 * Anchored on a closing brace, which story prose never ends on. A chapter that
 * ends on `]` alone is left alone: "the sign read [CLOSED]" is prose.
 */
const TRAILING_BRACE_RE = /[\s"',\]]*\}[\s"'},\]]*$/;

function stripJsonResidue(text: string, note: Note): string {
  let out = text;

  // A whole object delivered as the body -- the text-fallback parser keeps
  // everything after the first line, which for a JSON answer is JSON.
  const head = JSON_HEAD_RE.exec(out);
  if (head) {
    out = out.slice(head[0].length);
    note("json_residue");
  }

  const tail = JSON_TAIL_RE.exec(out);
  if (tail) {
    out = out.slice(0, tail.index);
    note("json_residue");
  }

  // Escaped newlines are what a JSON string looks like before it is parsed.
  // Only unescaped when the text has no real paragraph breaks of its own, so
  // a chapter that happens to discuss a literal backslash-n is untouched.
  if (!out.includes("\n\n") && /\\n\\n/.test(out)) {
    out = out.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, " ");
    note("json_residue");
  }

  const brace = TRAILING_BRACE_RE.exec(out);
  if (brace) {
    out = rebalanceTrailingQuote(out.slice(0, brace.index));
    note("json_residue");
  }
  return out;
}

/**
 * Put back a closing quote the residue strip took with it.
 *
 * `"The bus has arrived."}` loses `"}` to the strip, which leaves the final
 * line of dialogue unclosed. An odd count of straight double quotes in the
 * final paragraph means exactly that, and one quote closes it. Curly quotes are
 * directional and never part of JSON residue, so they are not counted.
 */
function rebalanceTrailingQuote(text: string): string {
  const trimmed = text.trimEnd();
  const lastBreak = trimmed.lastIndexOf("\n\n");
  const lastParagraph = trimmed.slice(lastBreak + 1);
  const quotes = (lastParagraph.match(/"/g) ?? []).length;
  return quotes % 2 === 1 ? `${trimmed}"` : trimmed;
}

function stripMarkupResidue(text: string, note: Note): string {
  let out = text;
  // The prompt fences user text in `<katha:...>` tags and tells the model
  // never to repeat them. When it does anyway, the tag is never prose.
  const fenced = out.match(/<\s*\/?\s*katha\s*:[^>\n]*>/gi);
  if (fenced) {
    out = out.replace(/<\s*\/?\s*katha\s*:[^>\n]*>/gi, "");
    note("markup_residue", fenced.length);
  }
  // A markdown code fence around the whole answer, open or closed.
  const fences = out.match(/^\s*```[a-z]*\s*$/gim);
  if (fences) {
    out = out.replace(/^\s*```[a-z]*\s*$/gim, "");
    note("markup_residue", fences.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Headings: a title line the prose contract said not to write
// ---------------------------------------------------------------------------

const NUMBER_WORD =
  "\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv";

const HEADING_RE = new RegExp(
  `^(?:#{1,6}\\s+\\S.*|\\*\\*[^*\\n]{1,80}\\*\\*|(?:chapter|part)\\s+(?:${NUMBER_WORD})\\b[^.!?\\n]{0,80})$`,
  "i",
);

/**
 * Drop a heading the model put above the chapter.
 *
 * Only the first paragraph, and only when it is a single short line with no
 * sentence punctuation -- "# The Spare Keys", "**The Spare Keys**", "Chapter 3:
 * The Spare Keys". The reader shows the chapter title from its own field, so a
 * heading in the body is the title printed twice.
 */
function dropLeadingHeading(paragraphs: string[], note: Note): string[] {
  if (paragraphs.length < 2) return paragraphs;
  const first = paragraphs[0].trim();
  if (first.includes("\n") || countWords(first) > 12) return paragraphs;
  if (!HEADING_RE.test(first)) return paragraphs;
  note("heading");
  return paragraphs.slice(1);
}

// ---------------------------------------------------------------------------
// Model notes: reasoning that leaked into the output
// ---------------------------------------------------------------------------

/**
 * Whole lines that are notes, never prose.
 *
 * Each pattern needs a shape and not just a word. "is banned" is prose;
 * "is banned, avoid" is a note. "about 1,300 words" is prose (somebody's
 * thesis); "approx 1330 words" and "Word count check:" are notes, because
 * nobody in a story abbreviates "approximately" or checks a word count with a
 * colon.
 */
const NOTE_LINE_RES: readonly RegExp[] = [
  /\bis (?:banned|forbidden|on the ban(?:ned)? list)\b[^.\n]{0,40}\b(?:avoid|use|instead|replace)\b/i,
  /\bbanned (?:word|phrase|cliche|cliché|name)s?\b/i,
  /\bavoid\s*[.,;:]\s*use\s*:/i,
  /\bword count\b\s*(?:check|target|so far|total)?\s*[:=\-–]/i,
  /\b(?:approx\.?|~)\s*\d[\d,]{2,6}\s*words\b/i,
  /^\s*[(\[]\s*(?:note|n\.b\.|a\/n|author'?s note|writer'?s note|editor'?s note)\s*:/i,
  /\[\s*(?:author|writer|editor)'?s? note\b/i,
  /^\s*(?:note to self|self-check|checklist|moments (?:delivered|covered|checklist)|beats? (?:covered|delivered))\s*:/i,
  /^\s*(?:here(?:'s| is)|below is)\b[^.!?\n]{0,60}\b(?:chapter|story)\b[^.!?\n]*:\s*$/i,
];

/** The label a note hands over to its replacement text with. */
const NOTE_FOLLOW_ON_RE =
  /^\s*(?:use|instead|try|replace(?: it)? with|better|rewrite)\s*:\s*/i;

/** Inline note spans inside an otherwise real sentence or line. */
const INLINE_NOTE_RES: readonly RegExp[] = [
  /\s*\((?:note|n\.b\.|a\/n)\s*:[^)\n]*\)?/gi,
  /\s*\[\s*(?:author|writer|editor)'?s? note[^\]\n]*\]?/gi,
];

function stripModelNotes(paragraph: string, note: Note): string {
  let removed = 0;
  const lines = paragraph.split("\n").flatMap((line) => {
    let next = line;
    for (const re of INLINE_NOTE_RES) {
      const hits = next.match(re);
      if (hits) {
        next = next.replace(re, "");
        removed += hits.length;
      }
    }
    if (!next.trim()) return line.trim() ? [] : [next];

    // A note line is dropped whole. A note sentence inside a line of prose is
    // dropped on its own, so the prose around it survives.
    if (NOTE_LINE_RES.some((re) => re.test(next))) {
      const sentences = splitSentences(next);
      const isNote = sentences.map((s) =>
        NOTE_LINE_RES.some((re) => re.test(s))
      );
      // A pattern that spans two sentences ("avoid. Use:") matched the line
      // but no single sentence of it, so the line is the note.
      if (!isNote.some(Boolean)) {
        removed++;
        return [];
      }
      const kept: string[] = [];
      for (let i = 0; i < sentences.length; i++) {
        if (isNote[i]) {
          removed++;
          continue;
        }
        // "...is banned, avoid. Use: The air hung heavy with diesel." The
        // label belongs to the note; what follows it is the prose the model
        // meant to write instead, so only the label goes.
        const sentence = i > 0 && isNote[i - 1]
          ? sentences[i].replace(NOTE_FOLLOW_ON_RE, "")
          : sentences[i];
        if (/[\p{L}\p{N}]/u.test(sentence)) kept.push(sentence);
      }
      const joined = kept.join("").trim();
      return joined ? [joined] : [];
    }
    return [next];
  });
  note("model_note", removed);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structure references: the story talking about itself as a book
// ---------------------------------------------------------------------------

/**
 * Nouns that put a chapter INSIDE the story world: a manual, a thesis, a
 * scripture. A sentence naming one is somebody's book, and its chapter
 * references are left alone.
 *
 * NOUNS ONLY. The first version also exempted any sentence containing "read",
 * "wrote" or "page", which let a leak through whenever the model's sentence
 * happened to use one of them for something else ("She read the label on the
 * evidence bag from Chapter 1"). Reading a chapter in-world is caught by
 * `READING_VERB_BEFORE_RE` instead, which looks only at the words directly in
 * front of the reference.
 */
const IN_WORLD_BOOK_RE =
  /\b(?:book|books|novel|novels|manual|textbook|handbook|guidebook|bible|scripture|quran|koran|torah|gospel|verse|thesis|dissertation|manuscript|memoir|diary|journal|screenplay|cookbook|syllabus|constitution|statute|edition|publisher)\b/i;

/**
 * A reading or writing verb within two words of the reference: "read aloud
 * from Chapter 3", "quoting from chapter two", "skipped back to chapter 4".
 * That is a character with a book in their hands, not the story citing itself.
 */
const READING_VERB_BEFORE_RE =
  /\b(?:read|reads|reading|recit\w*|quot\w*|wrote|writ\w*|flip\w*|skip\w*|turn\w*|open\w*|study\w*|studied|memori[sz]\w*)\s+(?:\S+\s+){0,2}$/i;

/**
 * "from Chapter 1", "back in Chapter 2", "(see Chapter 3)". The preposition is
 * what makes it a cross-reference; the negative lookahead keeps "in chapter 3
 * of the manual", which is somebody's book.
 */
const STRUCTURE_PHRASE_RE = new RegExp(
  `\\s*[,(]?\\s*(?:\\bsee\\s+|\\bas\\s+(?:seen\\s+)?in\\s+|\\blike\\s+in\\s+|\\bback\\s+in\\s+|\\b(?:in|from|since|during|after|before)\\s+)(?:the\\s+)?chapter\\s+(?:${NUMBER_WORD})\\b(?!\\s+of\\b)\\s*\\)?`,
  "gi",
);

/**
 * Structure talk with no phrase to lift out: the sentence is the problem.
 *
 * Only at the START of a sentence. "the first chapter she ever finished" and
 * "the next chapter of their lives" are prose; a sentence that OPENS "In this
 * chapter," or "At the end of the previous chapter," is narration about the
 * book.
 */
const STRUCTURE_SENTENCE_RES: readonly RegExp[] = [
  /^\s*(?:in|at the (?:end|start) of) (?:this|the (?:next|previous|last)) chapter\b(?!\s+of\b)/i,
];

const READER_ADDRESS_RE =
  /\b(?:dear|gentle|dear,? sweet) reader\b|\bas (?:you,? )?the reader\b|\bthe reader (?:will|may|might|already|knows?|remembers?|recalls?|has seen)\b|\byou,? (?:dear )?reader\b/i;

function stripStructureReferences(paragraph: string, note: Note): string {
  const sentences = splitSentences(paragraph);
  let structure = 0;
  let reader = 0;
  const kept: (string | null)[] = sentences.map((sentence) => {
    if (READER_ADDRESS_RE.test(sentence)) {
      reader++;
      return null;
    }
    if (IN_WORLD_BOOK_RE.test(sentence)) return sentence;

    if (STRUCTURE_SENTENCE_RES.some((re) => re.test(sentence))) {
      structure++;
      return null;
    }
    // Lift each cross-reference out, unless the words right before it say a
    // character is reading. Then keep the sentence when what is left is still
    // a sentence: "She held up the evidence bag from Chapter 1." becomes "She
    // held up the evidence bag." When it is not ("That was in Chapter 1."),
    // the whole sentence was the reference and goes.
    let lifts = 0;
    STRUCTURE_PHRASE_RE.lastIndex = 0;
    const replaced = sentence.replace(
      STRUCTURE_PHRASE_RE,
      (match: string, offset: number) => {
        if (READING_VERB_BEFORE_RE.test(sentence.slice(0, offset + 1))) {
          return match;
        }
        lifts++;
        return " ";
      },
    );
    if (!lifts) return sentence;
    structure++;
    const lifted = tidySentence(replaced);
    return countWords(lifted) >= 4 ? lifted : null;
  });
  note("structure_reference", structure);
  note("reader_address", reader);
  return joinKeptSentences(sentences, kept);
}

// ---------------------------------------------------------------------------
// Brief echoes: the brief pasted into the prose
// ---------------------------------------------------------------------------

/**
 * Every pronoun collapses to one token before comparison.
 *
 * A character sheet is written about the character ("when her father lost his
 * job"), and the paste shows up in their own mouth ("when my father lost my
 * job" is never it, but "when my father lost his job" is). Without this the
 * one-word swap splits a nine-word run in two and the echo is missed, which is
 * precisely the dialogue case the editors flagged most.
 */
const PRONOUNS = new Set(
  "i me my mine myself you your yours yourself he him his himself she her hers herself they them their theirs themselves we us our ours ourselves it its itself"
    .split(" "),
);

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/(\p{L})'(\p{L})/gu, "$1$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (PRONOUNS.has(w) ? "_p" : w));
}

function shingles(words: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

function briefSentences(brief: ProseIntegrityBrief): string[] {
  const sources: string[] = [
    ...(brief.moments ?? []),
    ...(brief.beats ?? []),
  ];
  for (const character of brief.characters ?? []) {
    for (
      const field of [
        character.background,
        character.appearance,
        character.description,
      ]
    ) {
      if (typeof field === "string" && field.trim()) sources.push(field);
    }
  }
  return sources.flatMap((source) =>
    typeof source === "string" ? splitSentences(source) : []
  );
}

function stripBriefEchoes(
  paragraphs: string[],
  brief: ProseIntegrityBrief,
  note: Note,
): string[] {
  const grams = new Set<string>();
  for (const sentence of briefSentences(brief)) {
    for (
      const gram of shingles(normalizedWords(sentence), BRIEF_ECHO_MIN_WORDS)
    ) {
      grams.add(gram);
    }
  }
  if (!grams.size) return paragraphs;

  const split = paragraphs.map((p) => splitSentences(p));
  const isEcho = (sentence: string) =>
    shingles(normalizedWords(sentence), BRIEF_ECHO_MIN_WORDS).some((g) =>
      grams.has(g)
    );

  const total = split.reduce((n, s) => n + s.length, 0);
  const echoes = split.reduce((n, s) => n + s.filter(isEcho).length, 0);
  if (!echoes) return paragraphs;

  // The breaker. A handful of pasted sentences is a leak; a fifth of the
  // chapter matching the brief is a brief generic enough to match ordinary
  // prose, and deleting that much is the failure this module must never have.
  const allowance = Math.max(
    BRIEF_ECHO_MIN_ALLOWANCE,
    Math.floor(total * BRIEF_ECHO_MAX_SHARE),
  );
  if (echoes > allowance) {
    note("brief_echo_capped", echoes);
    return paragraphs;
  }

  note("brief_echo", echoes);
  return split.map((sentences) =>
    joinKeptSentences(
      sentences,
      sentences.map((s) => (isEcho(s) ? null : s)),
    )
  );
}

// ---------------------------------------------------------------------------
// Duplicate trailing paragraphs
// ---------------------------------------------------------------------------

/**
 * Drop a final paragraph that repeats one before it.
 *
 * The residue case: the model closed the JSON, then wrote the last paragraph
 * again. Two shapes are caught -- an exact repeat of the paragraph before, and
 * a truncated copy of it (the repeat cut off where the output cap landed).
 * A short repeat is spared: "Knock." twice is a refrain, and a refrain is
 * craft. Loops, because the repeat is sometimes repeated.
 */
function dropTrailingDuplicates(paragraphs: string[], note: Note): string[] {
  const out = [...paragraphs];
  while (out.length >= 2) {
    const last = normalizedWords(out[out.length - 1]).join(" ");
    const lastWords = countWords(out[out.length - 1]);
    const prev = normalizedWords(out[out.length - 2]).join(" ");
    const repeatsPrevious = lastWords >= 6 &&
      (last === prev || (lastWords >= 8 && prev.startsWith(`${last} `)));
    const repeatsEarlier = lastWords >= 12 &&
      out.slice(0, -2).some((p) => normalizedWords(p).join(" ") === last);
    if (!repeatsPrevious && !repeatsEarlier) break;
    out.pop();
    note("duplicate_paragraph");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.replace(/[ \t]+$/gm, "")).filter(
    (p) => p.trim(),
  );
}

const ABBREVIATION_RE =
  /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|No|vs|etc|Lt|Col|Gen|Capt|Sgt)\.["'”’)]*\s*$/;

/**
 * Split into sentences, each keeping its trailing whitespace, so joining the
 * pieces back reproduces the input exactly. A closing quote or bracket stays
 * with the sentence it closes. "Mr." and friends do not end a sentence.
 */
export function splitSentences(text: string): string[] {
  const raw =
    text.match(/[^.!?…\n]+(?:[.!?…]+["'”’)\]]*|\n|$)\s*|[.!?…\n]+\s*/g) ??
      [text];
  const merged: string[] = [];
  for (const piece of raw) {
    if (!piece) continue;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && ABBREVIATION_RE.test(prev)) {
      merged[merged.length - 1] = prev + piece;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/**
 * Rejoin sentences after some were dropped, keeping dialogue quotes balanced.
 *
 * Dropping `"Grew up in Lahore and moved to Karachi.` from `"Grew up in Lahore
 * and moved to Karachi. Now I sell tea."` would leave `Now I sell tea."` with a
 * closer and no opener. A dropped sentence with an odd number of quotes owned
 * one end of a quotation, so that quote mark is handed to its neighbour: an
 * opener to the next kept sentence, a closer to the previous one.
 */
function joinKeptSentences(
  sentences: readonly string[],
  kept: readonly (string | null)[],
): string {
  const out = kept.map((s) => s);
  for (let i = 0; i < sentences.length; i++) {
    if (kept[i] !== null) continue;
    const dropped = sentences[i].trim();
    const quoteCount = (dropped.match(/["“”]/g) ?? []).length;
    if (quoteCount % 2 === 0) continue;
    const opens = /^["“]/.test(dropped);
    if (opens) {
      const next = out.findIndex((s, j) => j > i && s !== null);
      if (next !== -1) {
        const opener = dropped[0];
        out[next] = `${opener}${(out[next] as string).replace(/^\s+/, "")}`;
      }
    } else {
      let prev = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (out[j] !== null) {
          prev = j;
          break;
        }
      }
      if (prev !== -1) {
        const closer = /”\s*$/.test(dropped) ? "”" : '"';
        const s = out[prev] as string;
        const trailing = s.match(/\s*$/)?.[0] ?? "";
        out[prev] = `${s.trimEnd()}${closer}${trailing}`;
      }
    }
  }
  return out.filter((s): s is string => s !== null).join("").trim();
}

function tidySentence(sentence: string): string {
  const trailing = sentence.match(/\s*$/)?.[0] ?? "";
  const body = sentence
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return body ? `${body}${trailing || " "}` : "";
}

function tidy(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim())
    .join("\n\n")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
