import { describe, expect, it } from 'vitest';
import { compareWithEnglish } from '../../src/i18n/catalogue';
import { CATALOGUES } from '../../src/i18n/LocaleProvider';
import { LOCALES } from '../../src/i18n/locales';
import { en } from '../../src/i18n/messages/en';

/**
 * A language is listed only when its catalogue is complete. These tests are the gate: a locale in
 * the switcher with a missing key, or a catalogue with no matching entry, fails the build.
 */
describe('translation catalogues', () => {
  it('has a catalogue for every listed locale, and no catalogue for an unlisted one', () => {
    const listed = LOCALES.map((locale) => locale.code).sort();
    const catalogued = Object.keys(CATALOGUES).sort();
    expect(catalogued).toEqual(listed);
  });

  it.each(LOCALES.map((locale) => [locale.code]))('%s defines every English key and nothing else', (code) => {
    const result = compareWithEnglish(CATALOGUES[code] ?? {}, code);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('requires the plural forms a locale selects, and permits only those', () => {
    // Russian selects one/few/many/other, so `few` and `many` are required, not "extra" keys.
    const russian = { ...en, 'language.switcher.count.few': 'доступно языков: {count}', 'language.switcher.count.many': 'доступно языков: {count}' };
    expect(compareWithEnglish(russian, 'ru')).toEqual({ missing: [], extra: [] });

    // Japanese selects `other` only, so carrying an English `one` form is what would be wrong.
    const japanese = { ...en } as Record<string, string>;
    delete japanese['language.switcher.count.one'];
    expect(compareWithEnglish(japanese, 'ja')).toEqual({ missing: [], extra: [] });
    expect(compareWithEnglish({ ...japanese, 'language.switcher.count.one': 'x' }, 'ja').extra).toEqual([
      'language.switcher.count.one',
    ]);

    // A locale-aware catalogue is still faulted for a key English does not define at all.
    expect(compareWithEnglish({ ...en, 'footer.nav.careers': 'Careers' }, 'de').extra).toEqual(['footer.nav.careers']);
  });

  it('has no empty or whitespace-only strings in any catalogue', () => {
    for (const [code, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(value.trim(), `${code}:${key}`).not.toBe('');
      }
    }
  });

  it('keeps placeholders identical in every translation of a string', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((m) => m[0]).sort();
    for (const [code, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(placeholders(value), `${code}:${key}`).toEqual(placeholders(en[key as keyof typeof en]));
      }
    }
  });

  it('contains no placeholder or holding text in English', () => {
    for (const value of Object.values(en)) {
      expect(value).not.toMatch(/lorem ipsum|coming soon|todo|tbd|xxx/i);
    }
  });
});
