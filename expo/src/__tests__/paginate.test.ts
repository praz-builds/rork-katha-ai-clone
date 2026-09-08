import { normalizeText, pageIndexForOffset, paginateChapter, sentenceAnchorForOffset } from "@/lib/paginate";

const chapter = Array.from(
  { length: 36 },
  (_, index) => `Sentence ${index + 1} begins here and carries enough words to look like a real paragraph on a phone.`,
).join(" ");

it("splits a chapter into a stable page count for a viewport and type size", () => {
  const pages = paginateChapter(chapter, { width: 350, height: 420 }, { fontSize: 18, lineHeight: 30 });

  expect(pages).toHaveLength(9);
  expect(pages[0].start).toBe(0);
  expect(pages[pages.length - 1].end).toBe(chapter.length);
});

it("maps a larger type size back to the same sentence anchor", () => {
  const sentence = "Sentence 18 begins";
  const offset = chapter.indexOf(sentence);
  const anchor = sentenceAnchorForOffset(chapter, offset);
  const largerPages = paginateChapter(chapter, { width: 350, height: 420 }, { fontSize: 22, lineHeight: 34 });
  const nextIndex = pageIndexForOffset(largerPages, anchor);

  expect(largerPages[nextIndex].text).toContain(sentence);
});

it("resolves a mid-sentence offset to the start of its sentence, not merely a clamped offset", () => {
  const sentenceStart = chapter.indexOf("Sentence 18 begins");
  // An offset that lands in the middle of the sentence -- past its first word --
  // rather than exactly on the boundary previousBreak() would already produce.
  const midSentenceOffset = sentenceStart + "Sentence 18 ".length;
  expect(midSentenceOffset).toBeGreaterThan(sentenceStart);

  const anchor = sentenceAnchorForOffset(chapter, midSentenceOffset);

  // A contract that only clamps would return midSentenceOffset unchanged
  // (it is already a valid, in-range offset). Honouring the "sentence
  // anchor" contract means walking back to where the sentence began.
  expect(anchor).toBe(sentenceStart);
  expect(anchor).not.toBe(midSentenceOffset);
  expect(chapter.slice(anchor, anchor + "Sentence 18".length)).toBe("Sentence 18");
});

it("keeps search offsets in the same coordinate space paginateChapter produces, across a chapter with leading whitespace and a blank line between paragraphs", () => {
  const filler = (count: number, start: number) =>
    Array.from(
      { length: count },
      (_, index) => `Filler sentence number ${start + index} exists only to occupy space on the page and push the story further along its plot without saying much of anything new.`,
    ).join(" ");

  // Leading whitespace/newlines that normalizeText trims away entirely
  // (2200 characters), plus a blank line with trailing spaces before it
  // (also collapsed by normalizeText) between paragraphs. Both shift every
  // later character index relative to the raw text a naive, un-normalized
  // search would scan against.
  const leadingPadding = " \n".repeat(1100);
  const blankLineWithTrailingSpace = "\n\n   \n\n";
  const needle = "BEACON";
  const raw =
    leadingPadding +
    filler(3, 1) +
    blankLineWithTrailingSpace +
    `the lighthouse keeper found a ${needle} burning steady in the fog.` +
    " " +
    filler(60, 100);

  const viewport = { width: 640, height: 1104 };
  const typography = { fontSize: 18, lineHeight: 30 };
  const pages = paginateChapter(raw, viewport, typography);
  const normalized = normalizeText(raw);

  const canonicalOffset = normalized.indexOf(needle);
  const rawOffset = raw.indexOf(needle);

  // The raw and canonical offsets genuinely differ (by the length of the
  // trimmed leading whitespace) -- proof this case exercises the
  // coordinate mismatch rather than a no-op.
  expect(rawOffset).not.toBe(canonicalOffset);
  expect(pages.length).toBeGreaterThan(1);

  // Looking the match up with the canonical (normalized) offset -- the same
  // coordinate space paginateChapter itself used -- finds the page that
  // actually contains it.
  const canonicalPage = pageIndexForOffset(pages, canonicalOffset);
  expect(pages[canonicalPage].text).toContain(needle);

  // Looking it up with the raw-text offset instead resolves to a different,
  // wrong page: exactly the bug a search computed against the original
  // text (rather than the normalized text pagination uses) produces.
  const rawPage = pageIndexForOffset(pages, rawOffset);
  expect(rawPage).not.toBe(canonicalPage);
  expect(pages[rawPage].text).not.toContain(needle);
});
