import { controls, radius } from '@/theme';
import { BUTTON_RECIPE } from '@/components/Button';

/*
 * `@types/node` is deliberately not a dependency of this app -- it is a
 * React Native client, and pulling Node's globals into its type space is how
 * `Buffer` and `process` start appearing in shipped code. This test is the
 * one place that genuinely needs to read the source tree, so it declares the
 * three functions it uses and nothing else.
 */
declare const __dirname: string;
declare function require(id: string): unknown;

type Dirent = { name: string; isDirectory(): boolean };
const fs = require('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(file: string, encoding: 'utf8'): string;
  existsSync(file: string): boolean;
};
const path = require('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  sep: string;
};

/**
 * THE GUARD ON THE ONE BUTTON.
 *
 * `controls.primaryCtaHeight` was documented in DESIGN_SYSTEM.md section 6,
 * exported from the theme, and consumed by NOTHING for the entire life of the
 * app. Meanwhile every screen drew its own primary CTA — 48, 50, 52, 54 and 56
 * points, at three radii, with four different labels — and no test noticed,
 * because a test that asserts a token's value passes perfectly well while
 * nothing reads the token.
 *
 * So this file checks two different things:
 *
 * 1. That `Button` actually consumes the tokens (`BUTTON_RECIPE`, which the
 *    component builds from `controls.*` at module load).
 * 2. That nothing ELSE draws a tall pill. This is the part that matters: it
 *    reads the source tree and fails on a StyleSheet entry anywhere in
 *    `src/` (`.ts`, `.tsx` and `.jsx` — the onboarding entry points are still
 *    JSX) that declares a height of 48 or more together with a rounded
 *    radius: `radius.pill`, `controls.primaryCtaRadius`, or any literal of 20
 *    or more. That shape is a text button, near enough, and the only file
 *    allowed to have one is `Button.tsx`.
 *
 * Anything that legitimately has that shape and is NOT a button is listed in
 * `ALLOWED` below, with a reason per entry. Adding a line there is a decision
 * somebody makes on purpose in a diff a reviewer can see; drawing a fifth
 * button in a screen file is not. The allow-list is itself checked: an entry
 * whose style is gone, or whose style is no longer a tall pill, fails, so
 * exemptions cannot quietly accumulate past the thing they exempted.
 *
 * ## WHAT THIS DOES NOT CATCH, stated rather than implied
 *
 * It reads `StyleSheet.create` entries, and only their literal text. So it
 * misses:
 *
 * - an INLINE style object (`style={{ minHeight: 56, borderRadius: 28 }}`),
 *   which never reaches a named entry;
 * - a COMPUTED height (`minHeight: spacing.huge + spacing.sm`), because the
 *   arithmetic is not evaluated;
 * - a height or radius arriving through a spread or a variable that is not a
 *   `controls.*` token or a SCREAMING_CASE constant declared in the same file.
 *
 * Those are real holes. They are left open because closing them means
 * evaluating the module rather than reading it, and a guard that catches the
 * common shape and says so is worth more than one that pretends to catch
 * everything. The compile-time half of the same job is `ButtonLayoutStyle` in
 * `Button.tsx`, which stops the recipe being overridden through the `style`
 * prop.
 *
 * Follows the style of `theme.test.ts`, which enforces token invariants by
 * computing them rather than by restating them.
 */

const SRC = path.join(__dirname, '..');

/** Directories this walk does not enter. Tests are not shipped UI. */
const SKIP_DIRS = new Set(['__tests__', '__mocks__']);

/**
 * Every source file under `src/`, excluding tests and mocks.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(full, out);
    } else if (/\.(ts|tsx|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The style entries in one file, as `{ name, body }`.
 *
 * A brace-balanced walk rather than a regex, because a style entry contains
 * nested objects (`shadowOffset`, `transform`) and a regex that stops at the
 * first `}` reads half of one. Nested objects are then flattened out of the
 * body, so `height` inside `shadowOffset` cannot be mistaken for the entry's
 * own height.
 */
function styleEntries(source: string): { name: string; body: string; line: number }[] {
  const entries: { name: string; body: string; line: number }[] = [];
  const opener = /(\w+)\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    const body = source.slice(match.index + match[0].length, i - 1);
    entries.push({
      name: match[1],
      body: body.replace(/\{[^{}]*\}/g, '{}'),
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return entries;
}

/** The floor at which a pill stops being a chip and starts being a button. */
const BUTTON_HEIGHT_FLOOR = 48;

/**
 * The radius at which a corner stops being a card's and starts being a pill's.
 * `radius.pill` and `controls.primaryCtaRadius` are the tokens; the literals
 * in the tree run 17, 20, 26, 28 and 999, and everything from 20 up on
 * something 48 tall is a button shape.
 */
const PILL_RADIUS_FLOOR = 20;
const RADIUS_TOKEN = /borderRadius\s*:\s*(?:radius\.pill|controls\.primaryCtaRadius)/;
const RADIUS_LITERAL = /borderRadius\s*:\s*(\d+(?:\.\d+)?)/;

/** Whether this style entry draws a pill-ish corner. */
function isPill(body: string): boolean {
  if (RADIUS_TOKEN.test(body)) return true;
  const literal = body.match(RADIUS_LITERAL);
  return literal ? Number(literal[1]) >= PILL_RADIUS_FLOOR : false;
}
const HEIGHT_LITERAL = /(?:^|[^A-Za-z])(?:minHeight|height)\s*:\s*(\d+(?:\.\d+)?)/;
const HEIGHT_TOKEN = /(?:^|[^A-Za-z])(?:minHeight|height)\s*:\s*controls\.(\w+)/;
const HEIGHT_CONST = /(?:^|[^A-Za-z])(?:minHeight|height)\s*:\s*([A-Z][A-Z0-9_]+)\b/;
const WIDTH_LITERAL = /(?:^|[^A-Za-z])(?:minWidth|width)\s*:\s*(\d+(?:\.\d+)?)/;

/**
 * How tall this style entry is, or `null` when it does not set a height.
 *
 * Three spellings, because all three are in the tree: a literal, a
 * `controls.*` token, and a SCREAMING_CASE module constant (the tab bar's
 * `TAB_BAR_HEIGHT`). The constant is resolved from its own file, so aliasing
 * a number through a `const` is not a way past this test.
 */
function heightOf(body: string, source: string): number | null {
  const literal = body.match(HEIGHT_LITERAL);
  if (literal) return Number(literal[1]);
  const token = body.match(HEIGHT_TOKEN);
  if (token) {
    const value = (controls as Record<string, number>)[token[1]];
    return typeof value === 'number' ? value : null;
  }
  const constant = body.match(HEIGHT_CONST);
  if (constant) {
    const declared = source.match(
      new RegExp(`const\\s+${constant[1]}\\s*=\\s*(?:controls\\.(\\w+)|(\\d+(?:\\.\\d+)?))`),
    );
    if (!declared) return null;
    if (declared[1]) {
      const value = (controls as Record<string, number>)[declared[1]];
      return typeof value === 'number' ? value : null;
    }
    return Number(declared[2]);
  }
  return null;
}

/**
 * A disc or a rounded square, rather than a pill.
 *
 * Every false positive the radius floor introduced was one of these: a 68pt
 * play button, an 86pt avatar, a 54pt emoji disc, a 306 x 346 card. They all
 * declare their own width, and it is never greater than their height —
 * whereas a text button is wide, usually as wide as whatever contains it, and
 * a button that pins its width to its height has no room for a label. So the
 * width is the discriminator, and it costs nothing to read.
 */
function isSquarish(body: string): boolean {
  const width = body.match(WIDTH_LITERAL);
  const height = body.match(HEIGHT_LITERAL);
  if (!width || !height) return false;
  return Number(width[1]) <= Number(height[1]);
}

/** Whether this entry has the shape the guard is looking for. */
function isButtonShaped(body: string, source: string): boolean {
  if (!isPill(body) || isSquarish(body)) return false;
  const height = heightOf(body, source);
  return height !== null && height >= BUTTON_HEIGHT_FLOOR;
}

/**
 * Every entry in the tree with that shape, keyed as `ALLOWED` keys are.
 */
function buttonShapedEntries(): { key: string; where: string; height: number }[] {
  const found: { key: string; where: string; height: number }[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/borderRadius/.test(source)) continue;
    const relative = path.relative(SRC, file).split(path.sep).join('/');
    for (const entry of styleEntries(source)) {
      if (!isButtonShaped(entry.body, source)) continue;
      found.push({
        key: `${relative}#${entry.name}`,
        where: `${relative}:${entry.line}`,
        height: heightOf(entry.body, source)!,
      });
    }
  }
  return found;
}

/**
 * Tall pills that are not buttons, keyed `<path relative to src>#<styleName>`.
 *
 * Every entry says why it is not a button. A tall pill that is a button does
 * not belong here — it belongs in `Button`.
 *
 * Only styles the scan actually flags belong here, and the stale check below
 * enforces that. Things that are pill-shaped but never flagged — `Button`'s
 * own `base`/`sizeLg`/`sizeSm` (the radius and the height live in separate
 * entries), `Toggle#track` (32pt, the 44 beside it is the target), a tab
 * column with no height of its own — used to be listed here as documentation,
 * which made the list read as longer and more contested than it is. What they
 * are, and why none of them is a button, is in the doc comment on `Button`.
 */
const ALLOWED: Record<string, string> = {
  // The app chrome.
  'components/BottomTabs.tsx#bar':
    'The floating tab bar. A 64pt pill holding four tabs and the Create ' +
    'button is the app chrome, not a control with a label on it.',

  // Destructive controls, deliberately unlike every other button in the app.
  // See the note in Button.tsx and the doc comment on `colors.danger`.
  'components/profile/DeleteAccountSheet.tsx#deleteButton':
    'Deleting an account is drawn in colors.danger, which exists so that this ' +
    'one act cannot be performed by muscle memory. Giving it a Button variant ' +
    'is the first step back toward it looking ordinary.',
  'components/profile/DeleteAccountSheet.tsx#continueButton':
    'The step INTO the delete flow. It is primary-SHAPED -- a filled 50pt ' +
    'pill with a white label -- and it is deliberately not the primary: it ' +
    'fills colors.ink, and it sits one row above "Keep my account" and one ' +
    'screen before the danger-red confirm. Drawing it with Button would make ' +
    'the way to deleting an account the brightest, friendliest control on a ' +
    'sheet whose entire palette exists to stop this path feeling routine, ' +
    'and it would need an ink variant on Button that no other screen wants. ' +
    'Reviewed 2026-09-20 and kept for that reason rather than by default. It ' +
    'follows that this one control also keeps its own 0.4-opacity disabled ' +
    'state; it is not drawn by Button, so Button\'s grey plate does not ' +
    'reach it. If this sheet is ever restyled onto the accent, this entry ' +
    'goes and the control moves to Button with it.',
  'components/moderation/StoryActionsSheet.tsx#destructiveButton':
    'Block author, in colors.premium. Same argument as above; the ordinary ' +
    'buttons in this same sheet DID move to Button.',

  // An outline affordance, not a filled secondary.
  'components/reader/ChapterEnd.tsx#secondaryButton':
    'The Reimagine pill at a chapter end: an accent-outlined, accent-labelled ' +
    'control that deliberately reads as an offer rather than as the way ' +
    'forward. Button.secondary is a neutral surface with a neutral label and ' +
    'would flatten that distinction.',
};

describe('the one button', () => {
  describe('the recipe', () => {
    it('is 52 at radius.pill', () => {
      expect(controls.primaryCtaHeight).toBe(52);
      expect(controls.primaryCtaRadius).toBe(radius.pill);
    });

    it('is what Button actually consumes, not just what the theme exports', () => {
      // The failure this catches: a token that is documented, exported, and
      // read by nothing. BUTTON_RECIPE is built inside Button.tsx from
      // controls.*, so this passes only while the component is still wired to
      // them.
      expect(BUTTON_RECIPE.lg).toBe(controls.primaryCtaHeight);
      expect(BUTTON_RECIPE.sm).toBe(controls.buttonSmHeight);
      expect(BUTTON_RECIPE.radius).toBe(controls.primaryCtaRadius);
    });

    it('has converged with the onboarding CTA', () => {
      // The two-recipe split is over. If somebody reintroduces it, they have
      // to delete this line, which is a thing a reviewer can see.
      expect(controls.onboardingCtaHeight).toBe(controls.primaryCtaHeight);
    });

    it('keeps the small size at the platform minimum', () => {
      expect(controls.buttonSmHeight).toBe(44);
      expect(controls.buttonSmHeight).toBeLessThan(controls.primaryCtaHeight);
    });
  });

  describe('no second button', () => {
    it('finds no tall pill outside Button.tsx that is not allow-listed', () => {
      const offenders = buttonShapedEntries()
        .filter((found) => !(found.key in ALLOWED))
        .map((found) => `${found.where} — "${found.key.split('#')[1]}" is ${found.height}pt and rounded`);
      expect(offenders).toEqual([]);
    });

    it('would catch a new one', () => {
      // The guard's own guard. If the parser stops recognising the shape, the
      // test above starts passing for the wrong reason and nobody finds out.
      const sample = `
        const styles = StyleSheet.create({
          myNewCta: {
            minHeight: 56,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
          },
        });
      `;
      const entry = styleEntries(sample).find((e) => e.name === 'myNewCta');
      expect(entry).toBeDefined();
      expect(isPill(entry!.body)).toBe(true);
      expect(heightOf(entry!.body, sample)).toBe(56);
    });

    it('catches the other two spellings of a rounded corner', () => {
      // The first version of this guard only knew `radius.pill` and a literal
      // 999, so `borderRadius: controls.primaryCtaRadius` and a bare 26 --
      // both of which draw exactly the same pill -- walked straight past it.
      const sample = `
        const styles = StyleSheet.create({
          viaToken: { minHeight: 52, borderRadius: controls.primaryCtaRadius },
          viaLiteral: { minHeight: 52, borderRadius: 26 },
        });
      `;
      for (const name of ['viaToken', 'viaLiteral']) {
        const entry = styleEntries(sample).find((e) => e.name === name)!;
        expect(isButtonShaped(entry.body, sample)).toBe(true);
      }
    });

    it('leaves discs, avatars and cards alone', () => {
      // A 68pt play button at radius 34 is as round as a pill and is not one.
      // What separates them is the width: a button is wide enough for a label.
      const sample = `
        const styles = StyleSheet.create({
          playButton: { width: 68, height: 68, borderRadius: 34 },
          card: { width: 306, height: 346, borderRadius: 22 },
        });
      `;
      for (const name of ['playButton', 'card']) {
        const entry = styleEntries(sample).find((e) => e.name === name)!;
        expect(isButtonShaped(entry.body, sample)).toBe(false);
      }
    });

    it('reads .jsx as well, because the onboarding entry points are still JSX', () => {
      // `KathaOnboarding.jsx` and `KathaOnboardingComplete.jsx` are shipped UI
      // and were outside the walk entirely.
      const scanned = sourceFiles(SRC).map((file) => path.relative(SRC, file));
      expect(scanned.some((file) => file.endsWith('.jsx'))).toBe(true);
    });

    it('leaves chips alone', () => {
      // A 40pt pill is a chip, and there are dozens of them. The floor is the
      // whole reason this test is usable.
      const sample = `
        const styles = StyleSheet.create({
          chip: { minHeight: 40, borderRadius: radius.pill },
        });
      `;
      const entry = styleEntries(sample).find((e) => e.name === 'chip')!;
      expect(heightOf(entry.body, sample)).toBeLessThan(BUTTON_HEIGHT_FLOOR);
    });

    it('does not carry a stale allow-list entry', () => {
      // An exemption is a claim that a specific style in a specific file has
      // the button's shape and is not a button. Two ways that claim can rot:
      // the style disappears, or it stops being a tall pill. Either way the
      // line is now a comment about a codebase that no longer exists, and the
      // next style to take that name inherits the exemption for free.
      const shaped = new Set(buttonShapedEntries().map((found) => found.key));
      const stale: string[] = [];
      for (const key of Object.keys(ALLOWED)) {
        const [relative, name] = key.split('#');
        const file = path.join(SRC, relative);
        if (!fs.existsSync(file)) {
          stale.push(`${key} (file is gone)`);
          continue;
        }
        const source = fs.readFileSync(file, 'utf8');
        if (!styleEntries(source).some((e) => e.name === name)) {
          stale.push(`${key} (style is gone)`);
          continue;
        }
        if (!shaped.has(key)) stale.push(`${key} (no longer a tall pill)`);
      }
      expect(stale).toEqual([]);
    });
  });
});

/**
 * A BUTTON THAT SAYS IT IS WORKING MUST SAY SO TO A SCREEN READER TOO.
 *
 * `Button` distinguishes two facts that look identical on screen: `disabled`
 * means "not available", `loading` means "you already pressed this and it is
 * working". Only `loading` puts `busy` in the accessibility state and swaps
 * the label for a spinner.
 *
 * Four call sites had the busy half of that and not the other: their label
 * swapped to "Saving" / "Sending..." while the press was in flight, and the
 * button went dim with nothing to say it was a request rather than an
 * unfilled form. Someone who cannot see the label change hears "dimmed" and
 * has no way to tell a save in progress from a save that was refused.
 *
 * The rule this pins is exactly that pairing, and no wider: a label that
 * TURNS INTO a busy word implies a busy state. It deliberately says nothing
 * about a button disabled by work happening somewhere else -- CreateBriefFlow
 * waits on a portrait generated in another part of the screen and its label
 * never changes, and a spinner there would claim the button was working.
 */
describe('a busy label and a busy state', () => {
  /** The words a button uses for "this press is in flight". */
  const BUSY_LABEL = /^["'`](Saving|Sending|Submitting|Publishing|Loading)\b/i;

  /** Each `<Button ... />` element in a file, as its raw JSX text. */
  function buttonElements(source: string): { body: string; line: number }[] {
    const found: { body: string; line: number }[] = [];
    const opener = /<Button\b/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(source)) !== null) {
      // Props end at the first `>` that is not inside braces.
      let depth = 0;
      let index = match.index;
      for (; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        else if (char === '>' && depth === 0) break;
      }
      found.push({
        body: source.slice(match.index, index + 1),
        line: source.slice(0, match.index).split('\n').length,
      });
    }
    return found;
  }

  /** The busy flag a button names in its own label, when it names one. */
  function busyFlag(body: string): string | null {
    const ternary = /label=\{\s*([A-Za-z_$][\w$.]*)\s*\?\s*(["'`][^"'`]*["'`])/
      .exec(body);
    if (!ternary) return null;
    return BUSY_LABEL.test(ternary[2]) ? ternary[1] : null;
  }

  /** Every `<Button>` in shipped source whose label swaps to a busy word. */
  function busyLabelledButtons(): { file: string; line: number; flag: string }[] {
    const found: { file: string; line: number; flag: string }[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('<Button')) continue;
      for (const element of buttonElements(source)) {
        const flag = busyFlag(element.body);
        if (flag === null) continue;
        found.push({
          file: path.relative(SRC, file).split(path.sep).join('/'),
          line: element.line,
          flag,
        });
      }
    }
    return found;
  }

  it('gives every self-reported busy button a matching loading prop', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('<Button')) continue;
      for (const element of buttonElements(source)) {
        const flag = busyFlag(element.body);
        if (flag === null) continue;
        const loading = new RegExp(
          `loading=\\{\\s*${flag.replace(/\./g, '\\.')}\\s*\\}`,
        );
        if (!loading.test(element.body)) {
          const relative = path.relative(SRC, file).split(path.sep).join('/');
          offenders.push(`${relative}:${element.line} (${flag})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the sites it is meant to be watching', () => {
    // A source-scanning guard that matches nothing passes forever. These four
    // are the ones the sweep found; the assertion is that the scan still sees
    // them at all, not that they are the only ones allowed to exist.
    const watched = busyLabelledButtons().map((found) => found.file);
    expect(watched).toEqual(expect.arrayContaining([
      'components/library/AddPhrasesSheet.tsx',
      'components/comments/CommentRow.tsx',
      'components/moderation/StoryActionsSheet.tsx',
      'components/profile/IdentityEditor.tsx',
    ]));
  });
});
