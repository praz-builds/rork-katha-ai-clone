export type PaginationTypography = {
  fontSize: number;
  lineHeight: number;
};

export type PaginationViewport = {
  width: number;
  height: number;
  /**
   * Vertical space, in the same units as `height`, that something other than
   * body text occupies on the FIRST page only -- in the reader, the chapter
   * opener (cover, story title, byline, chapter title).
   *
   * Without this every page got the same character budget, so the first page
   * was handed a full screen's worth of prose and then had the opener pushed
   * in above it. In a reader you scroll that is merely a longer first screen;
   * in a reader you turn page by page it means page one, the first thing
   * anyone sees, is the one page that does not fit and has to be scrolled --
   * the exact behaviour horizontal paging exists to remove. Optional, and
   * `0`/absent reproduces the uniform-page behaviour exactly.
   */
  firstPageOffset?: number;
};

export type PageSlice = {
  text: string;
  start: number;
  end: number;
};

const AVERAGE_READER_CHAR_WIDTH = 0.53;
const PAGE_FILL = 0.9;

/**
 * Canonical text coordinate space.
 *
 * Every offset this module hands out or accepts (`PageSlice.start`/`end`,
 * `pageIndexForOffset`, `sentenceAnchorForOffset`) is an index into
 * `normalizeText(rawChapterText)`, never into the raw chapter text as it
 * comes off the network or out of seed data.
 *
 * `paginateChapter` normalizes before slicing, so its page offsets are
 * already in this space. Normalization collapses `\r\n` to `\n`, drops
 * trailing horizontal whitespace before a newline, and trims the ends of the
 * string -- all changes that shift character indices relative to the raw
 * text whenever a chapter has leading/trailing whitespace, CRLF line
 * endings, or trailing spaces before a blank line. A caller that computes an
 * offset (search match position, a saved reading position, a sentence
 * anchor) against the raw text and then compares it to a `PageSlice` is
 * comparing two different coordinate systems and will land on the wrong
 * page. `normalizeText` is exported specifically so every offset producer
 * normalizes first and stays in this one space.
 */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function previousBreak(text: string, target: number, min: number): number {
  const window = text.slice(min, target);
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("\n\n"),
  );
  if (sentence >= 0) return min + sentence + 2;

  const whitespace = window.lastIndexOf(" ");
  if (whitespace >= 0) return min + whitespace + 1;

  return target;
}

export function paginateChapter(
  text: string,
  viewport: PaginationViewport,
  typography: PaginationTypography,
): PageSlice[] {
  const normalized = normalizeText(text);
  if (!normalized) return [{ text: "", start: 0, end: 0 }];

  const readableWidth = Math.max(180, viewport.width);
  const readableHeight = Math.max(120, viewport.height);
  const charsPerLine = Math.max(
    18,
    Math.floor(readableWidth / (typography.fontSize * AVERAGE_READER_CHAR_WIDTH)),
  );
  // The budget is per page rather than one value for the chapter, because the
  // first page has less room for prose than the rest of them.
  const targetCharsFor = (available: number) => {
    const linesPerPage = Math.max(4, Math.floor(Math.max(120, available) / typography.lineHeight));
    return Math.max(140, Math.floor(charsPerLine * linesPerPage * PAGE_FILL));
  };
  const bodyTargetChars = targetCharsFor(readableHeight);
  const firstTargetChars = targetCharsFor(readableHeight - Math.max(0, viewport.firstPageOffset ?? 0));
  const pages: PageSlice[] = [];
  let start = 0;

  while (start < normalized.length) {
    const targetChars = pages.length === 0 ? firstTargetChars : bodyTargetChars;
    const minChars = Math.max(80, Math.floor(targetChars * 0.55));
    const remaining = normalized.length - start;
    if (remaining <= targetChars * 1.12) {
      pages.push({
        text: normalized.slice(start).trim(),
        start,
        end: normalized.length,
      });
      break;
    }

    const target = Math.min(normalized.length, start + targetChars);
    const end = previousBreak(normalized, target, start + minChars);
    pages.push({
      text: normalized.slice(start, end).trim(),
      start,
      end,
    });
    start = end;
    while (normalized[start] === " " || normalized[start] === "\n") start += 1;
  }

  return pages;
}

/**
 * `offset` must already be in the canonical (normalized-text) coordinate
 * space described above -- i.e. an offset into `normalizeText(text)`, the
 * same text `pages` was produced from.
 */
export function pageIndexForOffset(pages: readonly PageSlice[], offset: number): number {
  if (pages.length === 0) return 0;
  const clamped = Math.max(0, offset);
  const index = pages.findIndex((page) => clamped >= page.start && clamped < page.end);
  return index >= 0 ? index : pages.length - 1;
}

/**
 * Resolves `offset` (canonical coordinate space; see the module comment
 * above `normalizeText`) to the start of the sentence that contains it, so
 * that re-paginating at a different type size lands the reader back at the
 * beginning of the sentence they were reading rather than at an arbitrary
 * clamped character position. A sentence boundary is the character after
 * the nearest preceding ". ", "? ", "! " or blank-line ("\n\n") -- the same
 * boundaries `paginateChapter` breaks pages on -- with any run of
 * whitespace immediately after that boundary also skipped. When no boundary
 * precedes `offset`, the anchor is the start of the text.
 */
export function sentenceAnchorForOffset(text: string, offset: number): number {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  const clamped = Math.min(Math.max(0, offset), normalized.length);
  const window = normalized.slice(0, clamped);
  const boundary = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("\n\n"),
  );
  if (boundary < 0) return 0;

  let start = boundary + 2;
  while (start < clamped && (normalized[start] === " " || normalized[start] === "\n")) {
    start += 1;
  }
  return start;
}
