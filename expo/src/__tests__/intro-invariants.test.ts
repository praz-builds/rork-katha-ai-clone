/**
 * The two claims the intro makes about itself, as tests.
 *
 * `KathaOnboarding.jsx` asserts in comments that the appearance line typed on
 * screen 1 IS the string that drew the portrait beside it, and that the three
 * openings on screen 2 are real `toDirection()` output rather than prose
 * somebody wrote. `AGENTS.md` now states the first as a rule. Both were true
 * when written and neither was pinned by anything, so both could drift in a
 * later edit without a single test going red -- and the failure is invisible:
 * the screen still renders, it just stops being honest about the product.
 *
 * These read the two source files as text rather than importing them. The
 * generator is a Deno script under `backend/` with a `https://` import, so the
 * Jest/Expo module graph cannot load it, and the appearance line is the only
 * thing in it this test cares about.
 */
import { toDirection } from '@/lib/directions';

declare const __dirname: string;
declare function require(id: string): unknown;

const fs = require('fs') as { readFileSync(file: string, encoding: 'utf8'): string };
const path = require('path') as { join(...parts: string[]): string };

const repoRoot = path.join(__dirname, '..', '..', '..');
const screen = fs.readFileSync(
  path.join(repoRoot, 'expo', 'src', 'screens', 'KathaOnboarding.jsx'),
  'utf8',
);
const script = fs.readFileSync(
  path.join(repoRoot, 'backend', 'scripts', 'generate-intro-characters.ts'),
  'utf8',
);

describe('the intro tells the truth about the product', () => {
  it('types the same appearance line that the portrait script draws from', () => {
    // The screen's constant, and the script's entry for the same character.
    const typed = /const RAYA_APPEARANCE =\s*\n\s*'([^']+)'/.exec(screen)?.[1];
    const drawn = /slug: "raya",\s*\n\s*appearance:\s*\n\s*"([^"]+)"/.exec(script)?.[1];

    // A null here means the shape of one of the two declarations changed, not
    // that the strings differ; say so rather than failing on `undefined`.
    expect(typed).toBeDefined();
    expect(drawn).toBeDefined();
    expect(typed).toBe(drawn);
  });

  it('shows openings the real converter really produces from real beats', () => {
    const block = /const DIRECTIONS = \[([\s\S]*?)\];/.exec(screen)?.[1];
    expect(block).toBeDefined();
    const directions = [...(block ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(directions).toHaveLength(3);

    /*
      THE BEATS ARE THE TEST, not the cards.

      A first version asserted `toDirection(card) === card`, which is true of
      any string opening with one of the 36 verbs in `ALREADY_IMPERATIVE` --
      including "Open", "Have" and "Show". Prose someone wrote by hand starting
      "Show ..." passed it, so it pinned "is an imperative fixed point" and not
      "is real converter output". It also left the two cards that do NOT come
      from the passthrough frame completely unguarded.

      These are the beats the shaping call actually returned, kept here because
      they exist nowhere else in the repo -- only their converted forms ship.
      Each one exercises a different frame, which is the whole reason the three
      cards read differently, so a change to any of those frames fails here.
    */
    const beats = [
      // ALREADY_IMPERATIVE: passed through untouched.
      'Open with Raya stopping on the dark trail when the forest suddenly falls completely silent',
      // MODAL_CLAUSE: "X must decide ..." -> "Have X decide ...".
      'Raya must decide whether to tell Praz the childhood promise she never kept',
      // The whatHappens frame: "What will happen when ..." -> "Show what happens when ...".
      'What will happen when Praz loses the trail in the darkening still forest?',
    ];
    expect(beats.map((beat) => toDirection(beat))).toEqual(directions);
  });

  it('keeps every intro headline to one line', () => {
    // Not a pixel measurement -- Jest has no font. The bound that matters is
    // recorded in AGENTS.md as one line, and the longest headline measured
    // 286pt against 374pt available at the reference width, so this pins the
    // character budget that produced it. See the HEADLINES doc comment.
    const block = /const HEADLINES = \[([\s\S]*?)\n\];/.exec(screen)?.[1];
    expect(block).toBeDefined();
    const headlines = [...(block ?? '').matchAll(/\[\s*(?:'([^']*)'|"([^"]*)")/g)]
      .map((m) => m[1] ?? m[2]);
    expect(headlines).toHaveLength(3);
    for (const headline of headlines) {
      expect(headline.length).toBeLessThanOrEqual(24);
    }
  });
});
