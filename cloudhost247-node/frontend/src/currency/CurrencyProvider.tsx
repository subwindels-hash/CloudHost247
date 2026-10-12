import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { publicFetch } from '../lib/api';
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

export interface CurrencyContextValue {
  /** The currency amounts are shown in. Always the base currency unless a valid, current rate is chosen. */
  readonly currency: string;
  readonly options: readonly string[];
  readonly ratesState: RatesState;
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
    ['gw', 'CVE'],
    ['gq', 'XAF'],
    ['st', 'STN'],
    ['sc', 'SCR'],
    ['mu', 'MUR'],
    // Europe
    ['at', 'EUR'],
    ['be', 'EUR'],
    ['bg', 'BGN'],
    ['hr', 'HRK'],
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
    ['se', 'SEK'],
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
    ['ve', 'VEF'],
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
 * changing one never changes the other. The status is loaded once per page view; if the request fails,
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
  const { locale } = useLocale();
  const [status, setStatus] = useState<DisplayCurrencyStatus>(initialStatus ?? UNAVAILABLE_STATUS);
  const [ratesState, setRatesState] = useState<RatesState>(initialStatus ? 'ready' : 'loading');
  const [requested, setRequested] = useState<string | null>(() => {
    const stored = readStored();
    return isCurrencyCode(stored) ? stored : null;
  });

  const [ipCountry, setIpCountry] = useState<string | null>(null);
  useEffect(() => {
    if (initialStatus || requested || savedPreference || authenticatedPreference) return undefined;
    let cancelled = false;
    publicFetch<{ country: string | null }>('/api/v1/currency/geo-country')
      .then((payload) => {
        if (cancelled) return;
        setIpCountry(payload.country ?? null);
      })
      .catch(() => {
        /* Geolocation failed gracefully — keep ipCountry as null */
      });
    return () => {
      cancelled = true;
    };
  }, [initialStatus, requested, savedPreference, authenticatedPreference]);

  useEffect(() => {
    if (initialStatus) return undefined;
    let cancelled = false;
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
      });
    return () => {
      cancelled = true;
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
    ipCountry,
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

  const formatAmount = useCallback(
    (amount: number, sourceCurrency: string = BASE_CURRENCY) =>
      formatAmountInDisplayCurrency(amount, sourceCurrency, currency, status, locale.code),
    [currency, status, locale.code]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, options, ratesState, status, setCurrency, formatAmount }),
    [currency, options, ratesState, status, setCurrency, formatAmount]
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

const FALLBACK: CurrencyContextValue = {
  currency: BASE_CURRENCY,
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
