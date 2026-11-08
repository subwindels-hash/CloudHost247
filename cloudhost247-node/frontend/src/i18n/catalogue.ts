import { en, type Catalogue, type MessageKey } from './messages/en';

export type Params = Readonly<Record<string, string | number>>;

export interface Translator {
  (key: MessageKey, params?: Params): string;
  /** Picks `<key>.one` or `<key>.other` using the locale's plural rules. */
  plural(key: string, count: number, params?: Params): string;
}

/** Missing catalog entries observed in this page session. Only locale and message keys are stored;
 * translated text, interpolation values and customer data are never recorded or transmitted. */
const missingKeys = new Map<string, Set<string>>();
function recordMissing(locale: string, key: string): void {
  // Only application-defined keys are accepted: never retain arbitrary dynamic/user content.
  if (!(key in en)) return;
  const keys = missingKeys.get(locale) ?? new Set<string>();
  keys.add(key);
  missingKeys.set(locale, keys);
}
export function getMissingTranslationKeys(): Record<string, string[]> {
  return Object.fromEntries([...missingKeys].map(([locale, keys]) => [locale, [...keys].sort()]));
}
export function clearMissingTranslationKeys(): void { missingKeys.clear(); }

/**
 * Replaces `{name}` placeholders. A placeholder with no value is left visible, so a missing
 * parameter shows up in review instead of silently disappearing.
 */
export function interpolate(template: string, params: Params = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Builds a translator for one locale. Lookup order: the locale's catalogue, then English. A key that
 * is missing from both is returned as the key itself, which is visibly wrong and is caught by the
 * catalogue tests.
 */
export function createTranslator(locale: string, catalogue: Catalogue, fallback: Catalogue = en): Translator {
  const lookup = (key: string): string | undefined => {
    if (catalogue[key] === undefined) recordMissing(locale, key);
    return catalogue[key] ?? fallback[key];
  };
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = new Intl.PluralRules('en');
  }

  const translate = ((key: MessageKey, params?: Params) => {
    const template = lookup(key);
    return template === undefined ? key : interpolate(template, params);
  }) as Translator;

  translate.plural = (key: string, count: number, params?: Params) => {
    const category = rules.select(count);
    const categoryKey = `${key}.${category}`;
    const otherKey = `${key}.other`;
    // A locale's "other" form is a valid plural fallback, not a missing translation.
    const local = catalogue[categoryKey] ?? catalogue[otherKey];
    if (local === undefined) {
      recordMissing(locale, otherKey in en ? otherKey : categoryKey);
    }
    const template = local ?? fallback[categoryKey] ?? fallback[otherKey];
    return template === undefined ? key : interpolate(template, { count, ...params });
  };
  return translate;
}

/** Keys that the English source defines but a catalogue lacks, and keys a catalogue defines that English does not. */
export function compareWithEnglish(catalogue: Catalogue): { missing: string[]; extra: string[] } {
  return {
    missing: Object.keys(en).filter((key) => catalogue[key] === undefined),
    extra: Object.keys(catalogue).filter((key) => !(key in en)),
  };
}
