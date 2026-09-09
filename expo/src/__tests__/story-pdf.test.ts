/**
 * The PDF is the story taken off the screen, so the document's SHAPE is the
 * contract: a title page, then every chapter under its own heading, in order,
 * with nothing from the story able to break out of the markup.
 */
import { stories } from "@/data/seed";
import { buildStoryHtml, escapeHtml, pdfFileName } from "@/lib/story-pdf";
import type { Story } from "@/types/domain";

const series = stories.find((story) => story.chapters.length > 1)!;
const standalone = stories.find((story) => story.chapters.length === 1)!;

const build = (story: Story) =>
  buildStoryHtml({ story, authorName: "Mira R.", dateLabel: "Aug 16, 2026" });

it("escapes the characters that would change the document", () => {
  expect(escapeHtml(`<b>"Tom & Jerry"</b>`)).toBe(
    "&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;",
  );
});

it("opens with a title page naming the story, the author and the date", () => {
  const html = build(series);
  const titlePageEnd = html.indexOf("</section>");
  const titlePage = html.slice(0, titlePageEnd);

  expect(titlePage).toContain(`<h1>${escapeHtml(series.title)}</h1>`);
  expect(titlePage).toContain("by Mira R.");
  expect(titlePage).toContain("Aug 16, 2026");
});

it("renders every chapter, in order, under its own heading", () => {
  const html = build(series);
  const headings = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((match) => match[1]);

  expect(headings).toEqual(series.chapters.map((chapter) => escapeHtml(chapter.title)));

  // Every paragraph of every chapter reaches the page.
  for (const chapter of series.chapters) {
    for (const paragraph of chapter.paragraphs) {
      expect(html).toContain(`<p>${escapeHtml(paragraph)}</p>`);
    }
  }
});

it("gives a standalone story no chapter heading, since it has one title", () => {
  const html = build(standalone);
  expect(html).not.toContain("<h2>");
  expect(html).toContain(`<p>${escapeHtml(standalone.chapters[0].paragraphs[0])}</p>`);
});

it("cannot be broken out of by story text", () => {
  const hostile: Story = {
    ...standalone,
    title: `</title><script>alert(1)</script>`,
    chapters: [{
      ...standalone.chapters[0],
      paragraphs: [`<img src=x onerror=alert(1)>`],
    }],
  };
  const html = build(hostile);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
});

it("derives a file name the OS will accept", () => {
  expect(pdfFileName("Heartbeats in the Rain")).toBe("Heartbeats in the Rain.pdf");
  // Dropping the punctuation leaves a double space behind the slash; the
  // collapse is what keeps it from reaching the file name.
  expect(pdfFileName(`What's / next: "Part 2"?`)).toBe("Whats next Part 2.pdf");
  expect(pdfFileName("")).toBe("Katha story.pdf");
  expect(pdfFileName("x".repeat(100))).toHaveLength(64);
});
