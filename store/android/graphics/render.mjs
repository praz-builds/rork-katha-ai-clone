#!/usr/bin/env node
/**
 * Renders the Play Store graphics from their HTML sources.
 *
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
 *   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node store/android/graphics/render.mjs
 *
 * playwright-core is not a repo dependency on purpose: this runs a few times a
 * year, and a browser toolchain in expo/package.json would ride along with
 * every install. Point PLAYWRIGHT_CORE at any install of it (a scratch
 * `npm i playwright-core` works) and CHROME at a local Chrome.
 *
 * Output, next to this file:
 *   feature-graphic-en.png  feature-graphic-pt.png  feature-graphic-es.png  (1024 x 500)
 *   icon-512.png                                                          (512 x 512)
 *
 * The pages load only local files (the app's own fonts and covers), and the
 * script waits for every font face before capturing, so two runs produce the
 * same pixels.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const CHROME = process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const JOBS = [
  { src: "feature-graphic.html", query: "?lang=en", out: "feature-graphic-en.png", width: 1024, height: 500 },
  { src: "feature-graphic.html", query: "?lang=pt", out: "feature-graphic-pt.png", width: 1024, height: 500 },
  { src: "feature-graphic.html", query: "?lang=es", out: "feature-graphic-es.png", width: 1024, height: 500 },
  // Play asks for a 32-bit PNG (with alpha) for the icon. A page screenshot of
  // fully opaque art is written as 24-bit RGB, so this one is drawn onto a
  // canvas and exported from there, which always encodes RGBA.
  { src: "icon-512.html", query: "", out: "icon-512.png", width: 512, height: 512, canvas: true },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  // file:// pages loading sibling files (fonts, covers) need this.
  // The rest pin rasterisation to the CPU and sRGB, so a re-run on the same
  // machine produces the same bytes.
  args: [
    "--allow-file-access-from-files",
    "--font-render-hinting=none",
    "--disable-gpu",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
  ],
});
try {
  for (const job of JOBS) {
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(join(HERE, job.src)).href + job.query);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    // Fail loudly rather than ship a graphic in a fallback font or with a
    // missing cover.
    const problems = await page.evaluate(() => {
      const bad = [];
      for (const face of document.fonts) {
        if (face.status !== "loaded") bad.push(`font ${face.family}: ${face.status}`);
      }
      for (const img of document.images) {
        if (!img.complete || img.naturalWidth === 0) bad.push(`image ${img.src}`);
      }
      return bad;
    });
    if (problems.length) throw new Error(`${job.out}: ${problems.join(", ")}`);
    if (job.canvas) {
      const dataUrl = await page.evaluate(({ width, height }) => {
        const img = document.images[0];
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL("image/png");
      }, { width: job.width, height: job.height });
      writeFileSync(join(HERE, job.out), Buffer.from(dataUrl.split(",")[1], "base64"));
    } else {
      await page.screenshot({
        path: join(HERE, job.out),
        clip: { x: 0, y: 0, width: job.width, height: job.height },
      });
    }
    await page.close();
    console.log(`rendered ${job.out} (${job.width}x${job.height})`);
  }
} finally {
  await browser.close();
}
