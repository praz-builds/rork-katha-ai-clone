import { colors, spacing, radius, fonts, controls, genreLabels, genreGradients, type, onboardingType, onboardingRamp, shadows, motion } from '@/theme';
import {
  OPTICAL_SCALE,
  opticalSize,
  IconAdd,
  IconBack,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconChevronForward,
  IconClose,
  IconRemove,
} from '@/theme/icons';
import { GENRES } from '@/types/domain';

/**
 * Split a CSS box-shadow string into its layers. A naive `.split(',')` is wrong
 * because every layer contains an `rgba(r, g, b, a)` with its own commas, so
 * split only on the commas that sit at paren depth zero.
 */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}
/**
 * WCAG relative luminance from a #rrggbb string. Computed, never hardcoded, so
 * the ground/surface contrast invariant survives a retune of the ramp.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The measured floor for "a white card lifts off the ground without a border".
 * See the doc comment on `colors` in theme.ts. The old ramp (#FAF7F2 ground)
 * measured 0.067 and failed this.
 */
const GROUND_SURFACE_MIN_DELTA = 0.1;


describe('theme tokens', () => {
  describe('colors', () => {
    it('exports all required color keys', () => {
      const required = ['bg', 'canvas', 'surface', 'border', 'ink', 'muted', 'accent', 'heart', 'info', 'premium', 'success'];
      for (const key of required) {
        expect(colors).toHaveProperty(key);
      }
    });

    it('every color value is a non-empty string', () => {
      for (const value of Object.values(colors)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it('exposes the onboarding semantic colours as valid hex', () => {
      // `strong` is icon ink, `track` is the divider hairline. Both are new and
      // both are referenced by name in DESIGN_SYSTEM.md, so they must exist.
      for (const key of ['strong', 'track'] as const) {
        expect(colors).toHaveProperty(key);
        expect(colors[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it('keeps `surface` pure white so a card reads as white on the ground', () => {
      expect(colors.surface).toBe('#FFFFFF');
      expect(luminance(colors.surface)).toBe(1);
    });

    it('separates ground from surface enough that a card lifts without a border', () => {
      // The whole card treatment rests on this gap. Computed from the hex, so a
      // future retune of `bg` cannot quietly collapse the contrast again.
      const delta = luminance(colors.surface) - luminance(colors.bg);
      expect(delta).toBeGreaterThanOrEqual(GROUND_SURFACE_MIN_DELTA);
    });

    it('keeps the neutral ramp monotonic, lightest first', () => {
      // surface2 must stay BELOW bg: it is a recessed inset fill, and if it
      // crosses the ground it starts reading as a raised card instead.
      const ramp = ['surface', 'bg', 'surface2', 'track', 'canvas', 'border', 'borderStrong'] as const;
      const measured = ramp.map((key) => luminance(colors[key]));
      for (let i = 1; i < measured.length; i += 1) {
        expect(measured[i - 1]).toBeGreaterThan(measured[i]);
      }
    });

    it('keeps a trace of warmth in the ground rather than going neutral grey', () => {
      // Warmth is carried by R > G > B. A blue-cast ground would turn the sepia
      // reader into a yellow stain on the next screen.
      for (const key of ['bg', 'canvas', 'surface2', 'track', 'border', 'borderStrong'] as const) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(colors[key].slice(i, i + 2), 16));
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThan(b);
      }
    });

    it('leaves the sepia reader tokens untouched by the ramp retune', () => {
      // The reader ground is designed warm and full-bleed. It is not part of the
      // neutral ramp and must not drift with it.
      expect(colors.sepia).toBe('#F4E8D0');
      expect(colors.sepiaText).toBe('#4A3B2A');
      expect(colors.sepiaHeading).toBe('#33291f');
      expect(colors.sepiaBody).toBe('#4a3f35');
      expect(colors.sepiaMuted).toBe('#8b7d6b');
      expect(colors.sepiaSecondary).toBe('#6a5c4c');
      expect(colors.sepiaAccent).toBe('#A64C1C');
      expect(colors.sepiaButton).toBe('#ec6f2c');
      expect(colors.sepiaPlaceholder).toBe('#e7dcc6');
      expect(colors.sepiaToggleTrack).toBe('#e7ddca');
    });

    it('keeps the accent Katha orange, not the reference green', () => {
      expect(colors.accent).toBe('#FF6B1A');
      expect(colors.accentSoft).toBe('#FFEFE2');
    });

    it('sepia palette is complete', () => {
      const sepia = ['sepia', 'sepiaText', 'sepiaHeading', 'sepiaBody', 'sepiaMuted', 'sepiaSecondary', 'sepiaAccent', 'sepiaButton', 'sepiaPlaceholder', 'sepiaToggleTrack'];
      for (const key of sepia) {
        expect(colors).toHaveProperty(key);
      }
    });
  });

  describe('spacing', () => {
    it('exports a positive number scale', () => {
      for (const value of Object.values(spacing)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }
    });

    it('has required scale steps', () => {
      expect(spacing).toHaveProperty('xs');
      expect(spacing).toHaveProperty('sm');
      expect(spacing).toHaveProperty('md');
      expect(spacing).toHaveProperty('lg');
      expect(spacing).toHaveProperty('xl');
      expect(spacing).toHaveProperty('xxl');
    });

    it('exposes the semantic `related` token, tighter than the inter-element gap', () => {
      expect(spacing).toHaveProperty('related');
      expect(typeof spacing.related).toBe('number');
      // The invariant that gives the token meaning: a group's internal gap must be
      // visibly tighter than the gap between groups, otherwise grouping disappears.
      expect(spacing.related).toBeLessThan(spacing.md);
      // A screen title and the sentence under it are one group and use this
      // token; the gap below the pair is `spacing.xxl` or larger.
      expect(spacing.related).toBeLessThan(spacing.xxl);
    });

    it('exposes `betweenGroups` as the other half of the rhythm, clearly wider than `related`', () => {
      // `related` alone cannot produce grouping: hierarchy is the CONTRAST
      // between the gap inside a group and the gap around it. Marginally
      // larger is not larger - the pair must read as two different distances
      // at a glance, so the between-groups gap is at least twice the internal
      // one. Without this a section head sits equidistant between the section
      // above it and the content below it and stops heading anything.
      expect(spacing).toHaveProperty('betweenGroups');
      expect(typeof spacing.betweenGroups).toBe('number');
      expect(spacing.betweenGroups).toBeGreaterThan(spacing.related);
      expect(spacing.betweenGroups).toBeGreaterThanOrEqual(spacing.related * 2);
      // It is drawn from the existing scale, never a new off-grid number.
      expect(Object.values(spacing)).toContain(spacing.betweenGroups);
      expect(spacing.betweenGroups % 4).toBe(0);
    });
  });

  describe('radius', () => {
    it('has pill value of 999', () => {
      expect(radius.pill).toBe(999);
    });

    it('all values are positive numbers', () => {
      for (const value of Object.values(radius)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }
    });
  });

  describe('fonts', () => {
    it('exports display, ui, brand, reader families', () => {
      expect(fonts.display).toBe('BricolageGrotesque');
      expect(fonts.ui).toBe('HankenGrotesk');
      expect(fonts.brand).toBe('Baloo2');
      expect(fonts.reader).toBe('Literata');
    });
  });

  describe('typography', () => {
    it('exports 7 text styles', () => {
      const styles = Object.keys(type);
      expect(styles.length).toBe(7);
      expect(styles).toEqual(expect.arrayContaining(['largeTitle', 'title', 'headline', 'body', 'subhead', 'caption', 'reader']));
    });

    it('every style has fontSize and fontFamily', () => {
      for (const [, style] of Object.entries(type)) {
        expect(style).toHaveProperty('fontSize');
        expect(style).toHaveProperty('fontFamily');
        expect(typeof style.fontSize).toBe('number');
      }
    });

    it('reader style has lineHeight', () => {
      expect(type.reader.lineHeight).toBe(30);
    });
  });

  describe('onboarding typography', () => {
    it('exports the levels at the specified metrics', () => {
      expect(onboardingType.title.fontSize).toBe(28);
      expect(onboardingType.title.lineHeight).toBe(34);
      expect(onboardingType.sectionHeader.fontSize).toBe(12);
      expect(onboardingType.sectionHeader.lineHeight).toBe(16);
      expect(onboardingType.body.fontSize).toBe(16);
      expect(onboardingType.body.lineHeight).toBe(21);
      expect(onboardingType.helper.fontSize).toBe(14.5);
      expect(onboardingType.helper.lineHeight).toBe(18);
      expect(onboardingType.caption.fontSize).toBe(12);
      expect(onboardingType.caption.lineHeight).toBe(16);
    });

    it('names every size level in the ramp, and leaves the eyebrow out of it', () => {
      // `sectionHeader` is a treatment, not a level: it shares `caption`'s size
      // and is told apart by case, weight, tracking and colour. Ordering it
      // against the others would assert a rank it does not hold.
      expect([...onboardingRamp]).toEqual(['title', 'body', 'helper', 'caption']);
      const unlisted = Object.keys(onboardingType).filter(
        (level) => !onboardingRamp.includes(level as (typeof onboardingRamp)[number]),
      );
      expect(unlisted).toEqual(['sectionHeader']);
    });

    it('steps down strictly through the size ramp', () => {
      for (let i = 1; i < onboardingRamp.length; i += 1) {
        const larger = onboardingType[onboardingRamp[i - 1]].fontSize;
        const smaller = onboardingType[onboardingRamp[i]].fontSize;
        expect(larger).toBeGreaterThan(smaller);
      }
    });

    it('keeps exactly one large size, so a screen has one heading', () => {
      // The failure this guards against is the one the product owner caught:
      // section labels promoted to near-title size, five to a screen, until the
      // actual title stopped reading as the title. Everything that is not the
      // title sits at or under `body`.
      for (const level of Object.keys(onboardingType) as (keyof typeof onboardingType)[]) {
        if (level === 'title') continue;
        expect(onboardingType[level].fontSize).toBeLessThanOrEqual(
          onboardingType.body.fontSize,
        );
      }
      expect(onboardingType.title.fontSize / onboardingType.body.fontSize).toBeGreaterThan(1.5);
    });

    it('sets secondary copy smaller than the content it supports', () => {
      // A helper line the same size as the text in the field under it gives a
      // supporting sentence equal billing with the user's own words.
      expect(onboardingType.helper.fontSize).toBeLessThan(onboardingType.body.fontSize);
      expect(onboardingType.helper.fontSize).toBeGreaterThan(onboardingType.caption.fontSize);
    });

    it('keeps the title big enough to read as a screen heading at 390pt', () => {
      // 22 fitted the longest heading in the flow onto one 326pt line by half a
      // point and did not read as a heading. 28 wraps the two longest headings
      // to exactly two lines and leaves the short ones on one.
      expect(onboardingType.title.fontSize).toBeGreaterThanOrEqual(26);
      expect(onboardingType.title.fontSize).toBeLessThan(type.largeTitle.fontSize);
    });

    it('carries a line height that moved with the size', () => {
      // A size changed without its line height is the standard way this ramp
      // rots. Headings set tight, body and caption looser.
      for (const level of Object.keys(onboardingType) as (keyof typeof onboardingType)[]) {
        const { fontSize, lineHeight } = onboardingType[level];
        expect(lineHeight).toBeGreaterThan(fontSize);
        expect(lineHeight / fontSize).toBeGreaterThanOrEqual(1.15);
        expect(lineHeight / fontSize).toBeLessThanOrEqual(1.45);
      }
      expect(onboardingType.title.lineHeight / onboardingType.title.fontSize).toBeLessThan(
        onboardingType.body.lineHeight / onboardingType.body.fontSize,
      );
    });

    it('tracks sentence-case titles negative and uppercase eyebrows positive', () => {
      // The resolved spec conflict: "negative tracking on every heading" means
      // sentence-case headings. The section header is the uppercase eyebrow,
      // where positive tracking is correct and matches ONBOARDING_FLOW.md §1.
      expect(onboardingType.title.letterSpacing).toBeLessThan(0);
      expect(onboardingType.sectionHeader.letterSpacing).toBeGreaterThan(0);
      // Body-weight levels are neither heading: at or just above zero, never
      // negative, because tracking in at a small optical size closes counters.
      expect(onboardingType.body.letterSpacing).toBeGreaterThan(0);
      expect(onboardingType.helper.letterSpacing).toBeGreaterThan(0);
      expect(onboardingType.caption.letterSpacing).toBeGreaterThanOrEqual(0);
    });

    it('tracks the eyebrow at the 0.08em the flow spec fixes for uppercase', () => {
      const em =
        onboardingType.sectionHeader.letterSpacing / onboardingType.sectionHeader.fontSize;
      expect(em).toBeGreaterThan(0.07);
      expect(em).toBeLessThan(0.095);
      // The title's own tightness is em-relative too: -0.9 at 28 is -0.032em,
      // the same as the -0.7 at 22 it replaced.
      const titleEm =
        Math.abs(onboardingType.title.letterSpacing) / onboardingType.title.fontSize;
      expect(titleEm).toBeGreaterThan(0.025);
      expect(titleEm).toBeLessThan(0.04);
    });

    it('reaches semibold by naming the semibold family, not via fontWeight', () => {
      // Inter Tight is two static instances. fontWeight cannot synthesise 600,
      // so a semibold token must name the InterTightSemiBold family outright.
      expect(fonts.tight).toBe('InterTight');
      expect(fonts.tightSemiBold).toBe('InterTightSemiBold');
      expect(onboardingType.title.fontFamily).toBe(fonts.tightSemiBold);
      expect(onboardingType.sectionHeader.fontFamily).toBe(fonts.tightSemiBold);
      expect(onboardingType.body.fontFamily).toBe(fonts.tight);
      expect(onboardingType.helper.fontFamily).toBe(fonts.tight);
      expect(onboardingType.caption.fontFamily).toBe(fonts.tight);
      expect(onboardingType.title.fontFamily).not.toBe(fonts.tight);
      // Stated as a rule over the whole ramp, so a level added later cannot
      // reach for `fontWeight` and silently render regular.
      for (const level of Object.keys(onboardingType) as (keyof typeof onboardingType)[]) {
        const style = onboardingType[level];
        if (style.fontWeight === '600') {
          expect(style.fontFamily).toBe(fonts.tightSemiBold);
        } else {
          expect(style.fontFamily).toBe(fonts.tight);
        }
      }
    });

    it('leaves the app-wide `type` scale untouched', () => {
      expect(type.title.fontFamily).toBe(fonts.display);
      expect(Object.keys(type).length).toBe(7);
    });
  });

  describe('shadows', () => {
    it('exports 3 elevation levels plus the icon-button treatment', () => {
      expect(shadows).toHaveProperty('card');
      expect(shadows).toHaveProperty('raised');
      expect(shadows).toHaveProperty('overlay');
      expect(shadows).toHaveProperty('iconButton');
      expect(shadows).toHaveProperty('iconButtonPressed');
    });

    it('every shadow is layered - depth needs a contact layer and an ambient one', () => {
      for (const [name, value] of Object.entries(shadows)) {
        expect(typeof value).toBe('string');
        expect(shadowLayers(value).length).toBeGreaterThan(1);
        expect(name).toBeTruthy();
      }
    });

    it('the icon button carries an inset highlight so it is not a flat fill', () => {
      expect(shadows.iconButton).toContain('inset');
      expect(shadowLayers(shadows.iconButton).filter((l) => l.startsWith('inset')).length).toBeGreaterThan(0);
    });
  });

  describe('controls', () => {
    it('keeps the circular icon button inside the 38-46 range, ascending', () => {
      expect(controls.iconButtonSm).toBe(38);
      expect(controls.iconButtonLg).toBe(46);
      expect(controls.iconButtonSm).toBeLessThan(controls.iconButton);
      expect(controls.iconButton).toBeLessThan(controls.iconButtonLg);
    });
  });

  describe('icons', () => {
    it('exports a component for every role the onboarding flow needs', () => {
      const set = {
        IconBack,
        IconClose,
        IconRemove,
        IconAdd,
        IconCheck,
        IconCheckCircle,
        IconChevronDown,
        IconChevronForward,
      };
      for (const [name, Component] of Object.entries(set)) {
        expect(typeof Component).toBe('function');
        expect((Component as { displayName?: string }).displayName).toBe(name);
      }
    });

    it('scales a lucide-equivalent size up to match Ionicons optical sizing', () => {
      expect(OPTICAL_SCALE).toBeGreaterThan(1);
      expect(opticalSize(16)).toBe(18);
      expect(opticalSize(14)).toBe(16);
      expect(Number.isInteger(opticalSize(22))).toBe(true);
    });
  });

  describe('motion', () => {
    it('exports 3 duration tokens in ascending order', () => {
      expect(motion.fast).toBeLessThan(motion.base);
      expect(motion.base).toBeLessThan(motion.slow);
    });
  });

  describe('genre data', () => {
    it('genreLabels covers all GENRES', () => {
      for (const genre of GENRES) {
        expect(genreLabels).toHaveProperty(genre);
        expect(typeof genreLabels[genre]).toBe('string');
      }
    });

    it('genreGradients covers all GENRES with 3-stop arrays', () => {
      for (const genre of GENRES) {
        expect(genreGradients).toHaveProperty(genre);
        expect(genreGradients[genre]).toHaveLength(3);
      }
    });
  });
});
