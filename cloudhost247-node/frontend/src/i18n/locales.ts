/**
 * The locales the CloudHost247 web application can be shown in.
 *
 * A locale is listed here only when its message catalogue is complete and has been checked by a
 * reviewer. Adding a language means: (1) a catalogue in `messages/<code>.ts` with every key that
 * `messages/en.ts` defines, (2) a reviewed translation sign-off in the pull request, and (3) an entry
 * below. Until then the language does not exist for the visitor: it is not offered in the switcher,
 * and a stored or browser preference for it falls back to English.
 */
export type TextDirection = 'ltr' | 'rtl';

export interface LocaleInfo {
  /** BCP-47 language tag. Used for `<html lang>` and for Intl formatting. */
  readonly code: string;
  /** English name, used for screen-reader labels. */
  readonly englishName: string;
  /** The language's own name for itself, shown in the switcher. */
  readonly nativeName: string;
  readonly dir: TextDirection;
}

export const DEFAULT_LOCALE = 'en';

/** localStorage key that stores the visitor's explicit choice. */
export const LOCALE_STORAGE_KEY = 'ch247.locale';

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'it', englishName: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
  { code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', dir: 'ltr' },
  { code: 'pl', englishName: 'Polish', nativeName: 'Polski', dir: 'ltr' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'zh', englishName: 'Chinese (Simplified)', nativeName: '中文 (简体)', dir: 'ltr' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', dir: 'ltr' },
];

function normalise(code: string): string {
  return code.trim().replace(/_/g, '-').toLowerCase();
}

/**
 * Finds a supported locale for a tag. Exact matches win; otherwise the base language is used, so a
 * browser reporting `en-GB` is served the `en` catalogue. Anything unrecognised returns undefined.
 */
export function findLocale(code: unknown): LocaleInfo | undefined {
  if (typeof code !== 'string' || code.length === 0 || code.length > 35) return undefined;
  const wanted = normalise(code);
  const exact = LOCALES.find((locale) => normalise(locale.code) === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  return LOCALES.find((locale) => normalise(locale.code) === base);
}

export function getDefaultLocale(): LocaleInfo {
  const locale = findLocale(DEFAULT_LOCALE);
  if (!locale) throw new Error('DEFAULT_LOCALE is not listed in LOCALES');
  return locale;
}

/**
 * Resolves a stored or requested tag to a supported locale, in this order: the tag itself, then the
 * browser's preferred languages, then the default. It never returns an unsupported locale.
 */
export function resolveLocale(requested: unknown, browserLanguages: readonly string[] = []): LocaleInfo {
  const direct = findLocale(requested);
  if (direct) return direct;
  for (const language of browserLanguages) {
    const match = findLocale(language);
    if (match) return match;
  }
  return getDefaultLocale();
}
