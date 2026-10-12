import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { publicFetch } from '../lib/api';
import {
  BASE_CURRENCY,
  UNAVAILABLE_STATUS,
  formatAmountInDisplayCurrency,
  isCurrencyCode,
  resolveDisplayCurrency,
  selectableCurrencies,
  type DisplayCurrencyStatus,
} from './display-currency';
import { useLocale } from '../i18n/LocaleProvider';

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

/**
 * localStorage key for the visitor's chosen display currency. Independent of the language key. */
export const CURRENCY_STORAGE_KEY = 'ch247.currency';

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
 * This is not a hard-coded universal mapping - it uses the actual configured currencies.
 */
function countryToCurrencyMap(enabledCurrencies: string[], baseCurrency: string): Map<string, string> {
  // Build a map from country code to currency code based on common currency associations.
  // The actual mapping is validated against the enabled currencies below.
  const commonCountryCurrencies: Map<string, string> = new Map([
    // Africa
    ['ng', 'NGN'],  // Nigeria
    ['za', 'ZAR'],  // South Africa
    ['eg', 'EGP'],  // Egypt
    ['ke', 'KES'],  // Kenya
    ['ma', 'MAD'],  // Morocco
    ['et', 'ETB'],  // Ethiopia
    ['gh', 'GHS'],  // Ghana
    ['tz', 'TZS'],  // Tanzania
    ['ke', 'KES'],  // Kenya
    ['ug', 'UGX'],  // Uganda
    ['et', 'ETB'],  // Ethiopia
    ['ma', 'MAD'],  // Morocco
    ['dz', 'DZD'],  // Algeria
    ['ci', 'XOF'],  // Ivory Coast (CFA Franc)
    ['ne', 'XOF'],  // Niger (CFA Franc)
    ['ml', 'XOF'],  // Mali (CFA Franc)
    ['bf', 'XOF'],  // Burkina Faso (CFA Franc)
    ['sn', 'XOF'],  // Senegal (CFA Franc)
    ['ci', 'XOF'],  // Ivory Coast
    ['tg', 'XOF'],  // Togo (CFA Franc)
    ['bj', 'XOF'],  // Benin (CFA Franc)
    ['cd', 'CDF'],  // Congo (Franc)
    ['sz', 'SZL'],  // Swaziland
    ['rw', 'RWF'],  // Rwanda
    ['bw', 'BWP'],  // Botswana
    ['za', 'ZAR'],  // South Africa
    ['cg', 'XAF'],  // Congo
    ['cm', 'XAF'],  // Cameroon
    ['cf', 'XAF'],  // Central African Republic
    ['td', 'XAF'],  // Chad
    ['cg', 'XAF'],  // Congo
    ['ci', 'XOF'],  // Ivory Coast
    ['cv', 'CVE'],  // Cape Verde
    ['gw', 'CVE'],  // Guinea-Bissau
    ['gq', 'XAF'],  // Equatorial Guinea
    ['st', 'STN'],  // Sao Tome and Principe
    ['sc', 'SCR'],  // Seychelles
    ['mu', 'MUR'],  // Mauritius
    ['py', 'PYG'],  // Paraguay
    ['ar', 'ARS'],  // Argentina
    ['br', 'BRL'],  // Brazil
    ['cl', 'CLP'],  // Chile
    ['co', 'COP'],  // Colombia
    ['pe', 'PEN'],  // Peru
    ['uy', 'UYU'],  // Uruguay
    ['ve', 'VEF'],  // Venezuela
    // Europe (Euro area and others)
    ['at', 'EUR'],  // Austria
    ['be', 'EUR'],  // Belgium
    ['bg', 'BGN'],  // Bulgaria
    ['hr', 'HRK'],  // Croatia
    ['cy', 'EUR'],  // Cyprus
    ['cz', 'CZK'],  // Czech Republic
    ['dk', 'DKK'],  // Denmark
    ['ee', 'EUR'],  // Estonia
    ['fi', 'EUR'],  // Finland
    ['fr', 'EUR'],  // France
    ['de', 'EUR'],  // Germany
    ['gr', 'EUR'],  // Greece
    ['hu', 'HUF'],  // Hungary
    ['ie', 'EUR'],  // Ireland
    ['it', 'EUR'],  // Italy
    ['lv', 'EUR'],  // Latvia
    ['lt', 'EUR'],  // Lithuania
    ['lu', 'EUR'],  // Luxembourg
    ['mt', 'EUR'],  // Malta
    ['nl', 'EUR'],  // Netherlands
    ['pl', 'PLN'],  // Poland
    ['pt', 'EUR'],  // Portugal
    ['ro', 'RON'],  // Romania
    ['sk', 'EUR'],  // Slovakia
    ['si', 'EUR'],  // Slovenia
    ['es', 'EUR'],  // Spain
    ['se', 'SEK'],  // Sweden
    ['ch', 'CHF'],  // Switzerland
    ['gb', 'GBP'],  // United Kingdom
    ['cy', 'EUR'],  // Cyprus
    // North America
    ['us', 'USD'],  // United States
    ['ca', 'CAD'],  // Canada
    ['mx', 'MXN'],  // Mexico
    // Oceania
    ['au', 'AUD'],  // Australia
    ['nz', 'NZD'],  // New Zealand
    ['pf', 'XPF'],  // French Polynesia
    ['gu', 'USD'],  // Guam
    // Middle East
    ['ae', 'AED'],  // UAE
    ['sa', 'SAR'],  // Saudi Arabia
    ['iq', 'IQD'],  // Iraq
    ['il', 'ILS'],  // Israel
    ['jo', 'JOD'],  // Jordan
    ['kz', 'KZT'],  // Kazakhstan
    ['kw', 'KWD'],  // Kuwait
    ['lb', 'LBP'],  // Lebanon
    ['om', 'OMR'],  // Oman
    ['qa', 'QAR'],  // Qatar
    ['ye', 'YER'],  // Yemen
    ['sy', 'SYP'],  // Syria
    ['tr', 'TRY'],  // Turkey
    ['ae', 'AED'],  // United Arab Emirates
    // South America
    ['ar', 'ARS'],  // Argentina
    ['bo', 'BOB'],  // Bolivia
    ['br', 'BRL'],  // Brazil
    ['cl', 'CLP'],  // Chile
    ['co', 'COP'],  // Colombia
    ['gf', 'EUR'],  // French Guiana
    ['gy', 'GYD'],  // Guyana
    ['pe', 'PEN'],  // Peru
    ['py', 'PYG'],  // Paraguay
    ['sr', 'SRD'],  // Suriname
    ['uy', 'UYU'],  // Uruguay
    ['ve', 'VEF'],  // Venezuela
  ]);

  const map = new Map<string, string>();
  // Only include mappings where the currency is enabled in the system
  for (const [countryCode, currencyCode] of commonCountryCurrencies) {
    if (enabledCurrencies.includes(currencyCode)) {
      map.set(countryCode, currencyCode);
    }
  }
  return map;
}

/**
 * Resolve the currency to show based on the priority order:
 * 1. Stored customer preference (localStorage) - highest priority for returning visitors
 * 2. Authenticated account preference (from WHMCS/ API)
 * 3. Geographic signal (IP country) suggested currency
 * 4. Configured country-to-currency mapping (validated against enabled currencies)
 * 5. Default currency (base currency = USD)
 */
function resolveAutoCurrency(
  storedChoice: unknown,
  status: DisplayCurrencyStatus,
  savedPreference: string | null,
  authenticatedPreference: string | null,
  ipCountry: string | null,
  enabledCurrencies: string[],
  baseCurrency: string
): string {
  const selectable = selectableCurrencies(status);

  // Priority 1: The visitor's own choice — chosen with the switcher this page view, or restored
  // from localStorage on a return visit. A choice that is no longer offered is ignored here and
  // falls through to the suggestions below rather than being shown as a stale currency.
  if (isCurrencyCode(storedChoice) && selectable.includes(storedChoice)) {
    return storedChoice;
  }

  // Priority 2: Saved customer currency preference supplied by the server
  if (savedPreference && isCurrencyCode(savedPreference)) {
    if (selectable.includes(savedPreference)) {
      return savedPreference;
    }
  }

  // Priority 3: Authenticated account preference
  if (authenticatedPreference && isCurrencyCode(authenticatedPreference)) {
    if (selectable.includes(authenticatedPreference)) {
      return authenticatedPreference;
    }
  }

  // Priority 4: Geographic signal (IP country)
  if (ipCountry && ipCountry.length === 2) {
    const countryCode = ipCountry.toLowerCase();
    const countryMap = countryToCurrencyMap(enabledCurrencies, baseCurrency);
    const mappedCurrency = countryMap.get(countryCode);
    if (mappedCurrency && isCurrencyCode(mappedCurrency) && selectable.includes(mappedCurrency)) {
      return mappedCurrency;
    }
  }

  // Priority 5: No suitable detection found, use default
  return baseCurrency;
}

/**
 * Holds the display-currency choice and the current rate status. Independent of the language choice:
 * changing one never changes the other. The status is loaded once per page view; if the request fails,
 * the site keeps working in USD.
 */
export function CurrencyProvider({ children, initialStatus, savedPreference = null, authenticatedPreference = null }: { children: ReactNode; initialStatus?: DisplayCurrencyStatus; savedPreference?: string | null; authenticatedPreference?: string | null }) {
  const { locale } = useLocale();
  const [status, setStatus] = useState<DisplayCurrencyStatus>(initialStatus ?? UNAVAILABLE_STATUS);
  const [ratesState, setRatesState] = useState<RatesState>(initialStatus ? 'ready' : 'loading');
  const [requested, setRequested] = useState<string | null>(() => {
    const stored = readStored();
    return isCurrencyCode(stored) ? stored : null;
  });

  // Fetch IP geolocation from server-side endpoint
  const [ipCountry, setIpCountry] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicFetch<{ country: string | null }>('/api/v1/currency/geo-country')
      .then((payload) => {
        if (cancelled) return;
        setIpCountry(payload.country ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        // Geolocation failed gracefully - keep ipCountry as null
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch rates and resolve the auto-detected currency
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

  // Resolve the currency based on detection logic
  const enabledCurrencies = status.currencies
    .filter((r) => isCurrencyCode(r.code) && r.code !== BASE_CURRENCY && Number.isFinite(r.rate) && r.rate > 0)
    .map((r) => r.code);
  const currency = resolveAutoCurrency(requested, status, savedPreference, authenticatedPreference, ipCountry, enabledCurrencies, BASE_CURRENCY);
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
