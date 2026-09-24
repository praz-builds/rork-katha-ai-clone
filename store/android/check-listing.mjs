#!/usr/bin/env node
/**
 * Checks every store listing field against Google Play's limits.
 *
 *   node store/android/check-listing.mjs
 *
 * Play counts characters, not bytes, so "Histórias" is 9, not 10. Exits 1 if
 * any field is over its limit, empty, or carries a word the listing must not
 * use (see BANNED below).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "metadata");

const LIMITS = {
  "title.txt": 30,
  "short_description.txt": 80,
  "full_description.txt": 4000,
};

// The target audience is 18+ only. A "kids" claim in the listing invites a
// Families-policy review and contradicts the target-audience declaration.
// Pricing claims are also banned: prices vary by country and come from Play.
const BANNED = [/\bkids?\b/i, /\bchild(ren)?\b/i, /\bcrian[çc]as?\b/i, /\bni[ñn]os?\b/i, /\$\d/, /\bR\$/];

let failed = 0;
for (const locale of readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  for (const [file, limit] of Object.entries(LIMITS)) {
    const path = join(ROOT, locale, file);
    if (!existsSync(path)) {
      console.error(`MISSING ${locale}/${file}`);
      failed++;
      continue;
    }
    const text = readFileSync(path, "utf8").replace(/\n$/, "");
    const length = [...text].length;
    const hits = BANNED.filter((re) => re.test(text)).map(String);
    const ok = length > 0 && length <= limit && hits.length === 0;
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${locale.padEnd(7)} ${file.padEnd(22)} ${String(length).padStart(4)} / ${limit}` +
        (hits.length ? `  banned: ${hits.join(" ")}` : ""),
    );
  }
}
process.exit(failed ? 1 : 0);
