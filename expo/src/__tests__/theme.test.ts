import { colors, spacing, radius, fonts, genreLabels, genreGradients, type, shadows, motion } from '@/theme';
import { GENRES } from '@/types/domain';

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

  describe('shadows', () => {
    it('exports 3 elevation levels', () => {
      expect(shadows).toHaveProperty('card');
      expect(shadows).toHaveProperty('raised');
      expect(shadows).toHaveProperty('overlay');
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
