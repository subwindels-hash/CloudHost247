import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createTranslator, type Translator } from './catalogue';
import { LOCALE_STORAGE_KEY, findLocale, getDefaultLocale, resolveLocale, localeForCountry, type LocaleInfo } from './locales';
import { en, type Catalogue } from './messages/en';
import { fr, de, es, pt, it, nl, pl, ru, ar, zh, ja, ko } from './messages/translations';

/**
 * Catalogues by locale code. Only locales listed in `locales.ts` may appear here, and each must
 * define every key that `messages/en.ts` defines (enforced by `i18n-catalogues.test.ts`).
 */
export const CATALOGUES: Readonly<Record<string, Catalogue>> = {
  en,
  fr,
  de,
  es,
  pt,
  it,
  nl,
  pl,
  ru,
  ar,
  zh,
  ja,
  ko,
};

export interface LocaleContextValue {
  readonly locale: LocaleInfo;
  readonly t: Translator;
  /** Switches language and remembers the choice. Returns false, and changes nothing, for an unsupported code. */
  readonly setLocale: (code: string) => boolean;
  /** Advisory default; never overrides an explicit language preference. */
  readonly suggestCountryLocale: (country: string) => void;
}

function buildValue(locale: LocaleInfo, setLocale: LocaleContextValue['setLocale'], suggestCountryLocale: LocaleContextValue['suggestCountryLocale'] = () => {}): LocaleContextValue {
  return {
    locale,
    t: createTranslator(locale.code, CATALOGUES[locale.code] ?? en),
    setLocale,
    suggestCountryLocale,
  };
}

const LocaleContext = createContext<LocaleContextValue>(
  buildValue(getDefaultLocale(), () => false),
);

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Storage can be disabled (private browsing, strict settings). The default still applies.
    return null;
  }
}

function writeStoredLocale(code: string): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    /* The choice still applies for this page view; it simply is not remembered. */
  }
}

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  const preferred = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
  return navigator.language ? [...preferred, navigator.language] : preferred;
}

interface LocaleProviderProps {
  children: ReactNode;
  /** Overrides the stored and browser preference. Used by tests and by any server-rendered entry point. */
  initialLocale?: string;
  /** Hints from the server about the customer's saved preference (e.g. from a cookie or session). */
  savedLocaleHint?: string;
}

export function LocaleProvider({ children, initialLocale, savedLocaleHint }: LocaleProviderProps) {
  const explicitChoice = useRef(Boolean(findLocale(readStoredLocale()) || findLocale(savedLocaleHint) || findLocale(initialLocale)));
  const [locale, setLocaleState] = useState<LocaleInfo>(() => {
    const explicit = savedLocaleHint ?? initialLocale ?? readStoredLocale();
    return findLocale(explicit) ?? resolveLocale(null, browserLanguages());
  });

  useEffect(() => {
    document.documentElement.lang = locale.code;
    document.documentElement.dir = locale.dir;
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    const match = findLocale(code);
    if (!match) return false;
    explicitChoice.current = true;
    writeStoredLocale(match.code);
    setLocaleState(match);
    return true;
  }, []);

  const suggestCountryLocale = useCallback((country: string) => {
    const suggestion = localeForCountry(country) ?? getDefaultLocale();
    if (!explicitChoice.current) setLocaleState(suggestion);
  }, []);
  const value = useMemo(() => buildValue(locale, setLocale, suggestCountryLocale), [locale, setLocale, suggestCountryLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
