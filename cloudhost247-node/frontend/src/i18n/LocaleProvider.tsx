import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTranslator, type Translator } from './catalogue';
import { LOCALE_STORAGE_KEY, findLocale, getDefaultLocale, resolveLocale, type LocaleInfo } from './locales';
import { en, type Catalogue } from './messages/en';

/**
 * Catalogues by locale code. Only locales listed in `locales.ts` may appear here, and each must
 * define every key that `messages/en.ts` defines (enforced by `i18n-catalogues.test.ts`).
 */
export const CATALOGUES: Readonly<Record<string, Catalogue>> = { en };

export interface LocaleContextValue {
  readonly locale: LocaleInfo;
  readonly t: Translator;
  /** Switches language and remembers the choice. Returns false, and changes nothing, for an unsupported code. */
  readonly setLocale: (code: string) => boolean;
}

function buildValue(locale: LocaleInfo, setLocale: LocaleContextValue['setLocale']): LocaleContextValue {
  return {
    locale,
    t: createTranslator(locale.code, CATALOGUES[locale.code] ?? en),
    setLocale,
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
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<LocaleInfo>(() =>
    resolveLocale(initialLocale ?? readStoredLocale(), browserLanguages()),
  );

  useEffect(() => {
    document.documentElement.lang = locale.code;
    document.documentElement.dir = locale.dir;
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    const match = findLocale(code);
    if (!match) return false;
    writeStoredLocale(match.code);
    setLocaleState(match);
    return true;
  }, []);

  const value = useMemo(() => buildValue(locale, setLocale), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
