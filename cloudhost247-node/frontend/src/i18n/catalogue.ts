import { en, type Catalogue, type MessageKey } from './messages/en';

export type Params = Readonly<Record<string, string | number>>;

export interface Translator {
  (key: MessageKey, params?: Params): string;
  /** Picks `<key>.one` or `<key>.other` using the locale's plural rules. */
  plural(key: string, count: number, params?: Params): string;
}

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
  const lookup = (key: string): string | undefined => catalogue[key] ?? fallback[key];
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
    const template = lookup(`${key}.${category}`) ?? lookup(`${key}.other`);
    return template === undefined ? key : interpolate(template, { count, ...params });
  };
  return translate;
}

/**
 * The plural categories a locale can select, e.g. `['one', 'other']` for English and German,
 * `['one', 'few', 'many', 'other']` for Russian, and `['other']` alone for Japanese. CLDR always
 * includes `other`. A malformed tag falls back to English's categories rather than throwing.
 */
export function pluralCategories(locale: string): readonly string[] {
  try {
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    return new Intl.PluralRules('en').resolvedOptions().pluralCategories;
  }
}

/** Splits `base.one`, `base.other`, `base.few`, … into a base and a CLDR plural category. */
function pluralForm(key: string): { base: string; category: string } | null {
  const match = /^(.+)\.(zero|one|two|few|many|other)$/.exec(key);
  if (!match) return null;
  return { base: match[1] as string, category: match[2] as string };
}

/**
 * Keys that the English source defines but a catalogue lacks, and keys a catalogue defines that
 * English does not — plural-aware.
 *
 * Plurals are compared against the categories the target locale can actually select, not against
 * English's two forms. A German catalogue must define `one` and `other`; a Russian catalogue must
 * additionally define `few` and `many` (and is not faulted for them); a Japanese catalogue must
 * define `other` only. English's own key set is unchanged by this rule. Every key that is not part
 * of a plural family — that is, every key that is not `<base>.one`/`.other` in the English source —
 * is still compared literally, and any key that English does not define is reported as `extra`.
 */
export function compareWithEnglish(catalogue: Catalogue, locale = 'en'): { missing: string[]; extra: string[] } {
  const categories = new Set(pluralCategories(locale));

  // A base is treated as a plural family only when the English source defines `other` plus at least
  // one further form, which is what makes an ordinary key ending in e.g. `.other` safe.
  const families = new Map<string, Set<string>>();
  for (const key of Object.keys(en)) {
    const form = pluralForm(key);
    if (!form) continue;
    const seen = families.get(form.base) ?? new Set<string>();
    seen.add(form.category);
    families.set(form.base, seen);
  }
  for (const [base, seen] of [...families]) {
    if (!seen.has('other') || seen.size < 2) families.delete(base);
  }

  const inFamily = (key: string): boolean => {
    const form = pluralForm(key);
    return form !== null && families.has(form.base);
  };

  const requiredPlurals = [...families.keys()].flatMap((base) =>
    [...categories].map((category) => `${base}.${category}`),
  );

  const missing = [
    ...Object.keys(en).filter((key) => !inFamily(key) && catalogue[key] === undefined),
    ...requiredPlurals.filter((key) => catalogue[key] === undefined),
  ].sort();

  const extra = Object.keys(catalogue)
    .filter((key) => {
      const form = pluralForm(key);
      // A form of a known plural family is allowed exactly when the locale selects that category —
      // an unused `one` form in a language that never selects it is dead weight, not a translation.
      if (form !== null && families.has(form.base)) return !categories.has(form.category);
      return !(key in en);
    })
    .sort();

  return { missing, extra };
}
