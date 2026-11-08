import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { publicFetch } from '../lib/api';
import { all } from 'iso-3166-1';
import {
  BASE_CURRENCY,
  CURRENCY_STORAGE_KEY,
  UNAVAILABLE_STATUS,
  formatAmountInDisplayCurrency,
  isCurrencyCode,
  resolveDisplayCurrency,
  selectableCurrencies,
  type DisplayCurrencyStatus,
} from './display-currency';
import { useLocale } from '../i18n/LocaleProvider';

export { CURRENCY_STORAGE_KEY } from './display-currency';

export type RatesState = 'loading' | 'ready' | 'unavailable';
export const COUNTRY_STORAGE_KEY = 'ch247.country';
export const COUNTRY_CODES: readonly string[] = all().map((country) => country.alpha2);
function validCountry(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_CODES.includes(value.toUpperCase());
}
function storedCountry(): string | null {
  try { const country = localStorage.getItem(COUNTRY_STORAGE_KEY); return validCountry(country) ? country.toUpperCase() : null; } catch { return null; }
}
export function browserCountry(languages: readonly string[]): string | null {
  for (const language of languages) {
    try { const region = new Intl.Locale(language).region; if (validCountry(region)) return region.toUpperCase(); } catch { /* invalid browser locale */ }
  }
  return null;
}


export interface CurrencyContextValue {
  /** The currency amounts are shown in. Always the base currency unless a valid, current rate is chosen. */
  readonly currency: string;
  readonly options: readonly string[];
  readonly ratesState: RatesState;
  readonly country: string | null;
  readonly countrySource: 'selected' | 'detected' | 'unknown';
  readonly setCountry: (country: string) => boolean;
  readonly status: DisplayCurrencyStatus;
  /** Chooses a display currency. Returns false, and changes nothing, for a code the site does not offer. */
  readonly setCurrency: (code: string) => boolean;
  /** Formats a base-currency (USD) amount for display. Non-USD sources are never converted. */
  readonly formatAmount: (amount: number, sourceCurrency?: string) => { text: string; converted: boolean; currency: string };
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(code: string): void {
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, code);
  } catch {
    /* Storage can be disabled. The choice then lasts for this page view only. */
  }
}

/** Accepts only the server's documented shape. Anything else is treated as "no rates". */
function normalizeStatus(value: unknown): DisplayCurrencyStatus {
  if (!value || typeof value !== 'object') return UNAVAILABLE_STATUS;
  const raw = value as Partial<DisplayCurrencyStatus> & { currencies?: unknown };
  if (raw.base !== BASE_CURRENCY || raw.available !== true || !Array.isArray(raw.currencies)) {
    return { ...UNAVAILABLE_STATUS, reason: raw.reason === 'stale' ? 'stale' : 'not_synced', asOf: typeof raw.asOf === 'string' ? raw.asOf : null };
  }
  const currencies = raw.currencies.filter(
    (r): r is { code: string; rate: number; observedAt: string } =>
      !!r &&
      typeof r === 'object' &&
      isCurrencyCode((r as { code?: unknown }).code) &&
      typeof (r as { rate?: unknown }).rate === 'number' &&
      Number.isFinite((r as { rate: number }).rate) &&
      (r as { rate: number }).rate > 0 &&
      typeof (r as { observedAt?: unknown }).observedAt === 'string'
  );
  return {
    base: BASE_CURRENCY,
    available: currencies.length > 0,
    reason: currencies.length > 0 ? null : 'not_synced',
    asOf: typeof raw.asOf === 'string' ? raw.asOf : null,
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
    currencies,
  };
}

/**
 * Country-to-currency mapping based on the WHMCS configuration.
 * Maps ISO country codes to currency codes that are enabled in the system.
 */
function countryToCurrencyMap(enabledCurrencies: string[], _baseCurrency: string): Map<string, string> {
  const commonCountryCurrencies: ReadonlyArray< readonly [string, string] > = [
    // Africa
    ['ng', 'NGN'],
    ['za', 'ZAR'],
    ['eg', 'EGP'],
    ['ke', 'KES'],
    ['ma', 'MAD'],
    ['et', 'ETB'],
    ['gh', 'GHS'],
    ['tz', 'TZS'],
    ['ug', 'UGX'],
    ['dz', 'DZD'],
    ['ci', 'XOF'],
    ['ne', 'XOF'],
    ['ml', 'XOF'],
    ['bf', 'XOF'],
    ['sn', 'XOF'],
    ['tg', 'XOF'],
    ['bj', 'XOF'],
    ['cd', 'CDF'],
    ['sz', 'SZL'],
    ['rw', 'RWF'],
    ['bw', 'BWP'],
    ['cg', 'XAF'],
    ['cm', 'XAF'],
    ['cf', 'XAF'],
    ['td', 'XAF'],
    ['cv', 'CVE'],
    ['gw', 'XOF'],
    ['gq', 'XAF'],
    ['st', 'STN'],
    ['sc', 'SCR'],
    ['mu', 'MUR'],
    // Europe
    ['at', 'EUR'],
    ['be', 'EUR'],
    ['bg', 'EUR'],
    ['hr', 'EUR'],
    ['cy', 'EUR'],
    ['cz', 'CZK'],
    ['dk', 'DKK'],
    ['ee', 'EUR'],
    ['fi', 'EUR'],
    ['fr', 'EUR'],
    ['de', 'EUR'],
    ['gr', 'EUR'],
    ['hu', 'HUF'],
    ['ie', 'EUR'],
    ['it', 'EUR'],
    ['lv', 'EUR'],
    ['lt', 'EUR'],
    ['lu', 'EUR'],
    ['mt', 'EUR'],
    ['nl', 'EUR'],
    ['pl', 'PLN'],
    ['pt', 'EUR'],
    ['ro', 'RON'],
    ['sk', 'EUR'],
    ['si', 'EUR'],
    ['es', 'EUR'],
    ['se', 'SEK'], ['no', 'NOK'],
    ['ch', 'CHF'],
    ['gb', 'GBP'],
    // North America
    ['us', 'USD'],
    ['ca', 'CAD'],
    ['mx', 'MXN'],
    // Oceania
    ['au', 'AUD'],
    ['nz', 'NZD'],
    ['pf', 'XPF'],
    ['gu', 'USD'],
    ['in', 'INR'], ['jp', 'JPY'], ['kr', 'KRW'], ['cn', 'CNY'], ['hk', 'HKD'], ['sg', 'SGD'], ['id', 'IDR'], ['my', 'MYR'], ['ph', 'PHP'], ['pk', 'PKR'], ['bd', 'BDT'],
    // Middle East
    ['ae', 'AED'],
    ['sa', 'SAR'],
    ['iq', 'IQD'],
    ['il', 'ILS'],
    ['jo', 'JOD'],
    ['kz', 'KZT'],
    ['kw', 'KWD'],
    ['lb', 'LBP'],
    ['om', 'OMR'],
    ['qa', 'QAR'],
    ['ye', 'YER'],
    ['sy', 'SYP'],
    ['tr', 'TRY'],
    // South America
    ['ar', 'ARS'],
    ['bo', 'BOB'],
    ['br', 'BRL'],
    ['cl', 'CLP'],
    ['co', 'COP'],
    ['gf', 'EUR'],
    ['gy', 'GYD'],
    ['pe', 'PEN'],
    ['py', 'PYG'],
    ['sr', 'SRD'],
    ['uy', 'UYU'],
    ['ve', 'VES'],
  ];

  const map = new Map<string, string>();
  for (const [countryCode, currencyCode] of commonCountryCurrencies) {
    if (enabledCurrencies.includes(currencyCode)) {
      map.set(countryCode, currencyCode);
    }
  }
  return map;
}

/**
 * Resolve the currency to show based on the priority order:
 * 1. Explicit/stored customer preference (localStorage or savedPreference)
 * 2. Authenticated account preference (from WHMCS / API)
 * 3. Geographic signal (IP country) mapped against enabled currencies
 * 4. Default currency (base currency = USD)
 */
function resolveAutoCurrency(
  requested: string | null,
  status: DisplayCurrencyStatus,
  savedPreference: string | undefined,
  authenticatedPreference: string | undefined,
  ipCountry: string | null,
  enabledCurrencies: string[],
  baseCurrency: string
): string {
  const explicit = requested ?? (savedPreference && isCurrencyCode(savedPreference) ? savedPreference : null);
  if (explicit && isCurrencyCode(explicit)) {
    return resolveDisplayCurrency(explicit, status);
  }

  if (authenticatedPreference && isCurrencyCode(authenticatedPreference)) {
    const selectable = selectableCurrencies(status);
    if (selectable.includes(authenticatedPreference)) {
      return authenticatedPreference;
    }
  }

  if (ipCountry && ipCountry.length === 2) {
    const countryCode = ipCountry.toLowerCase();
    const countryMap = countryToCurrencyMap(enabledCurrencies, baseCurrency);
    const mappedCurrency = countryMap.get(countryCode);
    if (mappedCurrency && isCurrencyCode(mappedCurrency)) {
      const selectable = selectableCurrencies(status);
      if (selectable.includes(mappedCurrency)) {
        return mappedCurrency;
      }
    }
  }

  return baseCurrency;
}

/**
 * Holds the display-currency choice and the current rate status. Independent of the language choice:
 * changing one never changes the other. The status is refreshed periodically; if the request fails,
 * the site keeps working in USD.
 */
export function CurrencyProvider({
  children,
  initialStatus,
  savedPreference,
  authenticatedPreference,
}: {
  children: ReactNode;
  initialStatus?: DisplayCurrencyStatus;
  savedPreference?: string;
  authenticatedPreference?: string;
}) {
  const { locale, suggestCountryLocale } = useLocale();
  const [status, setStatus] = useState<DisplayCurrencyStatus>(initialStatus ?? UNAVAILABLE_STATUS);
  const [ratesState, setRatesState] = useState<RatesState>(initialStatus ? 'ready' : 'loading');
  const [requested, setRequested] = useState<string | null>(() => {
    const stored = readStored();
    return isCurrencyCode(stored) ? stored : null;
  });

  const [selectedCountry, setSelectedCountry] = useState<string | null>(storedCountry);
  const [ipCountry, setIpCountry] = useState<string | null>(null);
  useEffect(() => {
    if (selectedCountry) return undefined;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      publicFetch<{ country: string | null }>('/api/v1/currency/geo-country', { cache: 'no-store' })
        .then((payload) => {
          if (!cancelled) setIpCountry(validCountry(payload.country) ? payload.country.toUpperCase() : null);
        })
        .catch(() => { if (!cancelled) setIpCountry(null); })
        .finally(() => { inFlight = false; });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', onVisible); };
  }, [selectedCountry]);

  useEffect(() => {
    const country = selectedCountry ?? ipCountry;
    if (country) suggestCountryLocale(country);
  }, [selectedCountry, ipCountry, suggestCountryLocale]);

  useEffect(() => {
    if (initialStatus) return undefined;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      publicFetch<unknown>('/api/v1/currency/rates')
        .then((payload) => {
          if (cancelled) return;
          setStatus(normalizeStatus(payload));
          setRatesState('ready');
        })
        .catch(() => {
          if (cancelled) return;
          setStatus(UNAVAILABLE_STATUS);
          setRatesState('unavailable');
        })
        .finally(() => { inFlight = false; });
    };
    refresh();
    // Revalidate on long-lived pages as well as initial load. Never keep showing a rate after
    // a failed refresh; a later successful refresh restores the visitor's saved preference.
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initialStatus]);

  const enabledCurrencies = useMemo(
    () =>
      status.currencies
        .filter((r) => isCurrencyCode(r.code) && r.code !== BASE_CURRENCY && Number.isFinite(r.rate) && r.rate > 0)
        .map((r) => r.code),
    [status]
  );

  const currency = resolveAutoCurrency(
    requested,
    status,
    savedPreference,
    authenticatedPreference,
    selectedCountry ?? ipCountry,
    enabledCurrencies,
    BASE_CURRENCY
  );
  const options = useMemo(() => selectableCurrencies(status), [status]);

  const setCurrency = useCallback(
    (code: string) => {
      if (!isCurrencyCode(code) || !selectableCurrencies(status).includes(code)) return false;
      writeStored(code);
      setRequested(code);
      return true;
    },
    [status]
  );

  const setCountry = useCallback((code: string) => {
    if (!validCountry(code)) return false;
    const next = code.toUpperCase();
    try { localStorage.setItem(COUNTRY_STORAGE_KEY, next); } catch { /* applies for this page view */ }
    setSelectedCountry(next);
    // Choosing a country resets prior display defaults; later explicit language/currency choices
    // remain independent and are respected until the visitor chooses another country.
    try { localStorage.removeItem(CURRENCY_STORAGE_KEY); } catch { /* storage unavailable */ }
    setRequested(null);
    suggestCountryLocale(next, true);
    return true;
  }, [suggestCountryLocale]);

  const formatAmount = useCallback(
    (amount: number, sourceCurrency: string = BASE_CURRENCY) =>
      formatAmountInDisplayCurrency(amount, sourceCurrency, currency, status, locale.code),
    [currency, status, locale.code]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, options, ratesState, status, setCurrency, formatAmount, country: selectedCountry ?? ipCountry, countrySource: selectedCountry ? 'selected' : ipCountry ? 'detected' : 'unknown', setCountry }),
    [currency, options, ratesState, status, setCurrency, formatAmount, selectedCountry, ipCountry, setCountry]
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

const FALLBACK: CurrencyContextValue = {
  currency: BASE_CURRENCY,
  country: null,
  countrySource: 'unknown',
  setCountry: () => false,
  options: [BASE_CURRENCY],
  ratesState: 'unavailable',
  status: UNAVAILABLE_STATUS,
  setCurrency: () => false,
  formatAmount: (amount, sourceCurrency = BASE_CURRENCY) => ({
    text: formatAmountInDisplayCurrency(amount, sourceCurrency, BASE_CURRENCY, UNAVAILABLE_STATUS, 'en-US').text,
    converted: false,
    currency: sourceCurrency,
  }),
};

/** Outside a provider (e.g. an isolated component test) the site behaves as USD-only. */
export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext) ?? FALLBACK;
}
