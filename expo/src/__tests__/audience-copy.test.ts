/**
 * The audience switch is "All-ages", and nothing offers a PIN gate.
 *
 * Katha's Play listing targets 18+ only. A control labelled "Kids" invites a
 * Families-policy review of the whole app, and `en.json` advertised "Kids mode
 * and PIN gate" for a PIN that never existed. The rename is copy only:
 * `audienceMode: "kids"` and every identifier keep their names, which is why
 * this scans what a person can SEE (locale values, JSX text and accessibility
 * strings) rather than the source as a whole.
 */
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import pt from '@/i18n/pt.json';

declare const __dirname: string;
declare function require(id: string): unknown;
const fs = require('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: string, encoding: 'utf8'): string;
};
const path = require('path') as { join(...parts: string[]): string };

function values(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj && typeof obj === 'object') return Object.values(obj).flatMap(values);
  return [];
}

const FORBIDDEN = /\bkids?\b|\bPIN\b|parental|infantil|niños|ninos|crianças|controle dos pais/i;

it('no locale string advertises a kids mode, a PIN or parental controls', () => {
  for (const [lang, bundle] of Object.entries({ en, es, pt })) {
    const offending = values(bundle).filter((value) => FORBIDDEN.test(value));
    expect({ lang, offending }).toEqual({ lang, offending: [] });
  }
});

it('labels the audience genre key All-ages in all three locales', () => {
  expect(en.genres.kids).toBe('All-ages');
  expect(es.genres.kids).toBe('Todas las edades');
  expect(pt.genres.kids).toBe('Todas as idades');
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|jsx|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

it('no screen draws "Kids" or "PIN" as text or as an accessibility name', () => {
  const offending: string[] = [];
  // Every source file under src/ (screens, and the .ts data files they
  // render, such as voice descriptions), plus App.tsx at the root.
  const files = [...sourceFiles(path.join(__dirname, '..')), path.join(__dirname, '..', '..', 'App.tsx')];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // JSX text between tags, and every string literal in any quote style
    // (labels, hints, titles, data). Comments and identifiers are not
    // user-visible, and the check is case-sensitive, so the internal
    // `'kids'` audience value never trips it.
    const texts = [
      ...source.matchAll(/>([^<>{}\n]+)</g),
      ...source.matchAll(/"([^"\n]*)"/g),
      ...source.matchAll(/'([^'\n]*)'/g),
      ...source.matchAll(/`([^`]*)`/g),
    ].map((match) => match[1]);
    for (const text of texts) {
      if (/\bKids\b|\bPIN\b|Parental/.test(text)) offending.push(`${file}: ${text}`);
    }
  }
  expect(offending).toEqual([]);
});
