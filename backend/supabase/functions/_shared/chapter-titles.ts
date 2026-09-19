/**
 * Chapter titles that are not a title already used in the same story.
 *
 * # Why a server-side guard and not only a prompt line
 *
 * The 2026-09-18 editorial review found auto-run series where consecutive
 * chapters came back with the same title or nearly the same one: "The Spare
 * Keys" twice, three chapters called "The Urdu Newspaper". The prompt already
 * said "differ from every chapter title already used in this story"
 * (`CHAPTER_TITLE_SHAPE`), and it could not work, because no continuation call
 * was ever TOLD the earlier titles. The naming call sees the brief; the prose
 * call sees a window of the last few chapters' prose. Neither had the list.
 *
 * That is fixed at the prompt (`previousChapterTitles` in `story-prompts.ts`
 * and the naming prompt in `story-stream.ts`), and this is the half that makes
 * it true regardless: whatever the model returns, a title that normalises to
 * one already in the story is replaced before it is persisted. A table of
 * contents with the same line in it three times is a defect the reader sees on
 * every open, and it is cheap to make impossible.
 *
 * # Why the fallback is derived and not asked for
 *
 * A second naming call would cost seconds on a path the reader is waiting on,
 * and could return a duplicate again. The chapter already carries text written
 * about its own events -- the hook it ends on, its first line -- so a title is
 * derived from that, deterministically, and the same chapter always gets the
 * same fallback. It is plainer than a model's title, and it is always this
 * chapter's own.
 */

/** Words a title may lose at either edge without changing what it names. */
const EDGE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

/** Words that stay lower case inside a title-cased fallback. */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/** A numbering placeholder rather than a name: "Chapter 3", "Part Two". */
const NUMBERED_TITLE_RE =
  /^(?:chapter|part)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)$/i;

/**
 * The longest fallback title, in words, before trailing connectives are
 * trimmed. The shape rule asks for one to four; six is what it takes for a
 * clause to still name something once "in the" and friends come off the end
 * ("Someone Had Been in the Flat", not "Someone Had Been").
 */
const FALLBACK_MAX_WORDS = 6;

/**
 * The comparison form of a title.
 *
 * Case, punctuation, a leading article and a plural "s" are all noise: "The
 * Spare Keys", "Spare Key" and "the spare keys." are one title to a reader
 * scanning a table of contents.
 */
export function normalizeChapterTitle(title: string): string {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  while (words.length > 1 && ["the", "a", "an"].includes(words[0])) {
    words.shift();
  }
  return words
    .map((
      w,
    ) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
      ? w.slice(0, -1)
      : w)
    )
    .join(" ");
}

/**
 * Whether `candidate` is the same title as one already in the story.
 *
 * Equal after normalisation, or one wholly containing the other as a run of
 * words when the shorter is at least two words: "The Urdu Newspaper" and "The
 * Urdu Newspaper Again" are the same chapter to a reader. A single shared word
 * is not ("Keys" and "The Spare Keys" can both exist), because one word in
 * common is what any two chapters of one story will have.
 */
export function isDuplicateChapterTitle(
  candidate: string,
  existing: readonly string[],
): boolean {
  const mine = normalizeChapterTitle(candidate);
  if (!mine) return false;
  return existing.some((title) => {
    const theirs = normalizeChapterTitle(title);
    if (!theirs) return false;
    if (mine === theirs) return true;
    const [shorter, longer] = mine.length <= theirs.length
      ? [mine, theirs]
      : [theirs, mine];
    if (shorter.split(" ").length < 2) return false;
    return ` ${longer} `.includes(` ${shorter} `);
  });
}

/**
 * A short title from a line of the chapter's own text.
 *
 * The first clause of the line, at most six words, trimmed of connective
 * words at either edge and title-cased: "Someone had been in the flat while
 * she slept." gives "Someone Had Been in the Flat". Null when the line has too
 * little in it to name anything.
 */
export function titleFromLine(line: string | null | undefined): string | null {
  if (typeof line !== "string") return null;
  const clause = line
    .replace(/^[\s"“”'‘’(]+/, "")
    .split(/[.!?…;:,()"“”]|\s[-–—]\s/)[0]
    ?.trim();
  if (!clause) return null;
  const words = clause.split(/\s+/).slice(0, FALLBACK_MAX_WORDS + 2);
  while (
    words.length && EDGE_STOPWORDS.has(words[words.length - 1].toLowerCase())
  ) {
    words.pop();
  }
  const clipped = words.slice(0, FALLBACK_MAX_WORDS);
  while (
    clipped.length &&
    EDGE_STOPWORDS.has(clipped[clipped.length - 1].toLowerCase())
  ) {
    clipped.pop();
  }
  if (clipped.length < 2) return null;
  return clipped
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export interface DistinctTitleInput {
  /** What the model offered, best first. Blanks and nulls are skipped. */
  candidates: readonly (string | null | undefined)[];
  /** Every chapter title already in the story. */
  existingTitles: readonly (string | null | undefined)[];
  /** The story's own title, which a chapter title must not repeat either. */
  storyTitle?: string | null;
  chapterNumber: number;
  /** The chapter's own text, in the order it is tried for a fallback. */
  hookText?: string | null;
  firstLine?: string | null;
  body?: string | null;
}

export interface DistinctTitle {
  title: string;
  /** How the title was chosen: a model candidate, or the derived fallback. */
  source: "candidate" | "derived" | "numbered";
  /** Whether a candidate was refused as a duplicate on the way. */
  replacedDuplicate: boolean;
}

/**
 * The first usable title that is not already in the story.
 *
 * Model candidates first, in order -- the streamed path offers the early name
 * and then the metadata name, so a duplicate early name can still lose to a
 * distinct metadata one before anything is derived. Then titles derived from
 * the chapter's hook, its first line and its opening sentence. `Chapter N` is
 * the last resort: the shape rule bans numbering because it is dull, and a
 * dull title is still better than a duplicate one.
 */
export function chooseDistinctChapterTitle(
  input: DistinctTitleInput,
): DistinctTitle {
  const taken = [
    ...input.existingTitles.filter((t): t is string =>
      typeof t === "string" && Boolean(t.trim())
    ),
    ...(input.storyTitle?.trim() ? [input.storyTitle] : []),
  ];
  let replacedDuplicate = false;

  for (const candidate of input.candidates) {
    const title = candidate?.trim();
    if (!title) continue;
    // "Chapter 1" is what `parseStructuredOutput` fills in when the model sent
    // no chapter title at all -- on chapter five as readily as on chapter one.
    // It is a placeholder, not a candidate.
    if (NUMBERED_TITLE_RE.test(title)) continue;
    if (!isDuplicateChapterTitle(title, taken)) {
      return { title, source: "candidate", replacedDuplicate };
    }
    replacedDuplicate = true;
  }

  const firstSentence = input.body?.trim().split(/(?<=[.!?…])\s/)[0];
  for (const line of [input.hookText, input.firstLine, firstSentence]) {
    const derived = titleFromLine(line);
    if (derived && !isDuplicateChapterTitle(derived, taken)) {
      return { title: derived, source: "derived", replacedDuplicate };
    }
  }
  return {
    title: numberedTitle(input.chapterNumber, taken),
    source: "numbered",
    replacedDuplicate,
  };
}

/**
 * `Chapter N`, or the first of `Chapter Na`, `Chapter Nb`, ... that is free.
 *
 * The last resort has to be checked like everything before it, or the guard
 * has a hole exactly where it is supposed to be unconditional: a writer can
 * title chapter two "Chapter 5" in the notepad, and then chapter five would
 * persist a duplicate. The suffix is attached to the number rather than added
 * as a separate word because `isDuplicateChapterTitle` treats "Chapter 5
 * Again" as a repeat of "Chapter 5" (a two-word run contained in it), which is
 * the right rule for real titles and would reject every spaced variant here.
 * A story tops out at fifteen chapters, so 27 options always contain a free
 * one; the final line is unreachable and exists for the type checker.
 */
function numberedTitle(
  chapterNumber: number,
  taken: readonly string[],
): string {
  const options = [
    `Chapter ${chapterNumber}`,
    ..."abcdefghijklmnopqrstuvwxyz".split("").map((suffix) =>
      `Chapter ${chapterNumber}${suffix}`
    ),
  ];
  return options.find((title) => !isDuplicateChapterTitle(title, taken)) ??
    options[options.length - 1];
}
