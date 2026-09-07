import { pageIndexForOffset, paginateChapter, sentenceAnchorForOffset } from "@/lib/paginate";

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
