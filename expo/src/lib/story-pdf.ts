/**
 * "Download as PDF" for a story.
 *
 * One HTML document, two ways out. On native, `expo-print` renders the HTML
 * to a PDF file and the share sheet is the save path (Files, AirDrop, Mail -
 * the platform's own "where do you want this" rather than one we invent). On
 * web there is no file system to hand a PDF to, so the browser's print dialog
 * is the save path: every browser offers "Save as PDF" there, and it is the
 * one place a web user already knows to look.
 *
 * The document is built by a pure function so the shape of what a reader
 * takes away - a title page, then every chapter under its own heading - can be
 * tested without a printer or a DOM.
 */
import { Platform } from "react-native";
import type { Story } from "@/types/domain";

/** Escape the four characters that would otherwise change the document's structure. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type StoryPdfInput = {
  story: Story;
  authorName: string;
  /** Pre-formatted publication date, as the detail page shows it. */
  dateLabel: string;
};

/**
 * The printable document.
 *
 * Serif body at book proportions, because the PDF is the story taken off the
 * screen and a reader will meet it in a viewer that knows nothing about the
 * app's type ramp. `Literata` is named first so a device that has it (every
 * device that has run the app) matches the reader; Georgia and a generic
 * serif are the honest fallbacks everywhere else.
 */
export function buildStoryHtml({ story, authorName, dateLabel }: StoryPdfInput): string {
  const isStandalone = story.chapters.length === 1;
  const chapters = story.chapters.map((chapter) => {
    const heading = isStandalone
      ? ""
      : `<h2>${escapeHtml(chapter.title)}</h2>`;
    const paragraphs = chapter.paragraphs
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("\n");
    return `<section class="chapter">\n${heading}\n${paragraphs}\n</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(story.language || "en")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(story.title)}</title>
<style>
  @page { margin: 22mm 18mm; }
  body { font-family: Literata, Georgia, "Times New Roman", serif; color: #0F0E0C; font-size: 12pt; line-height: 1.6; margin: 0; }
  .title-page { min-height: 80vh; display: flex; flex-direction: column; justify-content: center; text-align: center; page-break-after: always; }
  .title-page h1 { font-size: 30pt; line-height: 1.2; margin: 0 0 12pt; font-weight: 700; }
  .title-page .byline { font-size: 13pt; color: #6B6560; margin: 0 0 6pt; }
  .title-page .date { font-size: 11pt; color: #9C9691; margin: 0; }
  .title-page .colophon { font-size: 10pt; color: #9C9691; margin-top: 36pt; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  h2 { font-size: 18pt; margin: 0 0 18pt; font-weight: 600; }
  p { margin: 0 0 10pt; text-align: left; orphans: 3; widows: 3; }
</style>
</head>
<body>
<section class="title-page">
  <h1>${escapeHtml(story.title)}</h1>
  <p class="byline">by ${escapeHtml(authorName)}</p>
  <p class="date">${escapeHtml(dateLabel)}</p>
  <p class="colophon">Written on Katha AI</p>
</section>
${chapters}
</body>
</html>`;
}

/**
 * A file name the OS will accept: the title with anything outside letters,
 * digits, spaces and hyphens dropped, collapsed, and capped, then `.pdf`.
 */
export function pdfFileName(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${cleaned || "Katha story"}.pdf`;
}

/**
 * Web: the print dialog, fed the document through a hidden iframe so the app
 * page itself is never what gets printed.
 *
 * The iframe is removed once printing is done (`afterprint`), with a timed
 * fallback for browsers that never fire it.
 */
function printOnWeb(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = globalThis.document;
    if (!doc?.body) {
      reject(new Error("Printing is not available here"));
      return;
    }
    const frame = doc.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    doc.body.appendChild(frame);

    const cleanup = () => {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };

    const frameWindow = frame.contentWindow;
    const frameDoc = frameWindow?.document;
    if (!frameWindow || !frameDoc) {
      cleanup();
      reject(new Error("Printing is not available here"));
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    frameWindow.addEventListener("afterprint", finish);

    // Fonts and layout need a tick before the print engine snapshots them.
    setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
        // Some browsers never fire `afterprint` for an iframe; do not leak it.
        setTimeout(finish, 60_000);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 50);
  });
}

/**
 * Native: render to a file, then hand it to the share sheet.
 *
 * Both modules are loaded lazily so a test or a web bundle that never
 * downloads a PDF does not pay for them, and so this file has no native
 * import at module scope.
 */
async function shareOnNative(html: string, fileName: string): Promise<void> {
  const Print = await import("expo-print");
  const Sharing = await import("expo-sharing");
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: fileName,
  });
}

/**
 * Save the story as a PDF, the platform's way.
 *
 * Resolves when the dialog has been handed the document. Rejects only when
 * the platform cannot print at all; a user dismissing the dialog is not an
 * error and resolves normally.
 */
export async function downloadStoryPdf(input: StoryPdfInput): Promise<void> {
  const html = buildStoryHtml(input);
  if (Platform.OS === "web") {
    await printOnWeb(html);
    return;
  }
  await shareOnNative(html, pdfFileName(input.story.title));
}
