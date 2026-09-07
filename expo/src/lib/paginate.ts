export type PaginationTypography = {
  fontSize: number;
  lineHeight: number;
};

export type PaginationViewport = {
  width: number;
  height: number;
};

export type PageSlice = {
  text: string;
  start: number;
  end: number;
};

const AVERAGE_READER_CHAR_WIDTH = 0.53;
const PAGE_FILL = 0.9;

function normalizeText(text: string): string {
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
  const linesPerPage = Math.max(
    4,
    Math.floor(readableHeight / typography.lineHeight),
  );
  const targetChars = Math.max(
    140,
    Math.floor(charsPerLine * linesPerPage * PAGE_FILL),
  );
  const minChars = Math.max(80, Math.floor(targetChars * 0.55));
  const pages: PageSlice[] = [];
  let start = 0;

  while (start < normalized.length) {
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

export function pageIndexForOffset(pages: readonly PageSlice[], offset: number): number {
  if (pages.length === 0) return 0;
  const clamped = Math.max(0, offset);
  const index = pages.findIndex((page) => clamped >= page.start && clamped < page.end);
  return index >= 0 ? index : pages.length - 1;
}

export function sentenceAnchorForOffset(text: string, offset: number): number {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return Math.min(Math.max(0, offset), normalized.length);
}
