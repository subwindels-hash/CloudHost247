import { describe, expect, it } from 'vitest';
import { compareWithEnglish, createTranslator, interpolate } from '../../src/i18n/catalogue';
import { en } from '../../src/i18n/messages/en';
import { DEFAULT_LOCALE, findLocale, getDefaultLocale, resolveLocale } from '../../src/i18n/locales';

/**
 * The translation core. These are the rules every language depends on: an unsupported tag never
 * becomes the active locale, a missing string falls back to English rather than blank, placeholders
 * are substituted only when a value is given, and plural forms follow the locale's own rules.
 */
describe('locale resolution', () => {
  it('uses English as the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(getDefaultLocale().code).toBe('en');
  });

  it('matches tags case-insensitively and falls back from a region to its base language', () => {
    expect(findLocale('en')?.code).toBe('en');
    expect(findLocale('EN')?.code).toBe('en');
    expect(findLocale('en_GB')?.code).toBe('en');
    expect(findLocale('en-US')?.code).toBe('en');
  });

  it('rejects anything that is not a listed locale', () => {
    // fr, de, es, pt, it, nl, pl, ru, ar, zh, ja, ko are now supported locales
    expect(findLocale('xx')).toBeUndefined();
    expect(findLocale('')).toBeUndefined();
    expect(findLocale('   ')).toBeUndefined();
    expect(findLocale('x'.repeat(40))).toBeUndefined();
    expect(findLocale(undefined)).toBeUndefined();
    expect(findLocale(42)).toBeUndefined();
    expect(findLocale({ code: 'en' })).toBeUndefined();
  });

  it('never resolves to an unsupported locale, even when the stored value is unsupported', () => {
    // fr is now a supported locale, so resolveLocale('fr') returns French
    expect(resolveLocale('fr').code).toBe('fr');
    expect(resolveLocale('../../etc/passwd').code).toBe('en');
    expect(resolveLocale('<script>').code).toBe('en');
  });

  it('uses the first supported browser language when the stored choice is missing or unsupported', () => {
    // de is now a supported locale, so resolveLocale(null, ['de-DE', 'en-AU']) returns German
    expect(resolveLocale(null, ['de-DE', 'en-AU']).code).toBe('de');
    // pt is now a supported locale, so resolveLocale('pt-BR', ['de-DE']) returns Portuguese
    expect(resolveLocale('pt-BR', ['de-DE']).code).toBe('pt');
  });

  it('prefers the explicit stored choice over the browser languages', () => {
    expect(resolveLocale('en', ['de-DE']).code).toBe('en');
  });
});

describe('interpolate', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('Hello {name}, you have {count} tickets', { name: 'Ada', count: 3 })).toBe(
      'Hello Ada, you have 3 tickets',
    );
  });

  it('leaves a placeholder visible when no value is supplied, so the gap shows in review', () => {
    expect(interpolate('Renewal due {date}')).toBe('Renewal due {date}');
    expect(interpolate('Renewal due {date}', { other: 'x' })).toBe('Renewal due {date}');
  });

  it('does not interpret HTML or template syntax in values', () => {
    expect(interpolate('{v}', { v: '<b>x</b>' })).toBe('<b>x</b>');
  });
});

describe('createTranslator', () => {
  it('returns the English text for a listed key', () => {
    const t = createTranslator('en', en);
    expect(t('header.account.logout')).toBe('Log out');
  });

  it('falls back to English for a key the locale has not translated', () => {
    const t = createTranslator('de', { 'header.account.logout': 'Abmelden' });
    expect(t('header.account.logout')).toBe('Abmelden');
    expect(t('header.account.dashboard')).toBe('Dashboard');
  });

  it('returns the key itself when no catalogue defines it, so the gap is visible', () => {
    const t = createTranslator('en', en);
    expect(t('not.a.real.key' as never)).toBe('not.a.real.key');
  });

  it('chooses the singular or plural form from the locale plural rules', () => {
    const t = createTranslator('en', en);
    expect(t.plural('language.switcher.count', 1)).toBe('1 language available');
    expect(t.plural('language.switcher.count', 2)).toBe('2 languages available');
    expect(t.plural('language.switcher.count', 0)).toBe('0 languages available');
  });

  it('uses plural categories beyond one and other where the language has them', () => {
    const catalogue = {
      'items.zero': 'no items',
      'items.one': 'one item',
      'items.two': 'two items',
      'items.few': '{count} items (few)',
      'items.many': '{count} items (many)',
      'items.other': '{count} items',
    };
    const arabic = createTranslator('ar', catalogue);
    expect(arabic.plural('items', 0)).toBe('no items');
    expect(arabic.plural('items', 1)).toBe('one item');
    expect(arabic.plural('items', 2)).toBe('two items');
    expect(arabic.plural('items', 5)).toBe('5 items (few)');
    expect(arabic.plural('items', 11)).toBe('11 items (many)');
  });

  it('falls back to the other form when a category is missing', () => {
    const polish = createTranslator('pl', { 'files.other': '{count} plików' });
    expect(polish.plural('files', 1)).toBe('1 plików');
  });

  it('does not throw for an unknown or malformed locale tag', () => {
    const t = createTranslator('not a locale!!', en);
    expect(t.plural('language.switcher.count', 1)).toBe('1 language available');
  });
});

describe('catalogue completeness helper', () => {
  it('reports nothing for the English source against itself', () => {
    expect(compareWithEnglish(en)).toEqual({ missing: [], extra: [] });
  });

  it('reports missing and extra keys', () => {
    const result = compareWithEnglish({ 'header.menu.open': 'Ouvrir', 'stray.key': 'x' });
    expect(result.missing).toContain('header.menu.close');
    expect(result.extra).toEqual(['stray.key']);
  });
});
