import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import pt from '@/i18n/pt.json';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...flatKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

describe('i18n key parity', () => {
  const enKeys = flatKeys(en);
  const esKeys = flatKeys(es);
  const ptKeys = flatKeys(pt);

  it('en.json has keys', () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it('es.json has the same keys as en.json', () => {
    expect(esKeys).toEqual(enKeys);
  });

  it('pt.json has the same keys as en.json', () => {
    expect(ptKeys).toEqual(enKeys);
  });

  it('no translation value is empty', () => {
    const check = (obj: Record<string, unknown>, lang: string, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
          expect(value.trim().length).toBeGreaterThan(0);
        } else if (typeof value === 'object' && value !== null) {
          check(value as Record<string, unknown>, lang, path);
        }
      }
    };
    check(en, 'en');
    check(es, 'es');
    check(pt, 'pt');
  });
});
